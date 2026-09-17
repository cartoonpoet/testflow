import {
  Controller,
  Get,
  Headers,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { Repository } from "typeorm";
import { Redis } from "ioredis";
import type { Response } from "express";
import { RunEntity } from "@testflow/db";
import {
  RUN_EVENT_BUFFER_MAX,
  RUN_EVENT_BUFFER_TTL_SEC,
  RUN_QUEUE_NAME,
  RunEventEnvelopeSchema,
  collectSecretValues,
  runCancelChannel,
  runEventBufferKey,
  runEventChannel,
  runEventSeqKey,
} from "@testflow/contracts";
import type { RunEvent, RunEventEnvelope, RunJobData } from "@testflow/contracts";
import { REDIS_CLIENT } from "../../common/redis/redis.module.js";
import { maskSecrets } from "../../common/utils/mask.js";

/** keep-alive 주석 주기. 프록시(nginx 기본 60초)가 유휴 연결을 끊는 것을 막는다. */
const KEEPALIVE_MS = 15_000;

/** 클라이언트 재연결 대기 시간 힌트(`retry:`). */
const RETRY_MS = 3000;

/**
 * ★ SSE 중계 — Redis pub/sub → `text/event-stream`.
 *
 * ## 이벤트 규약 (Gen-Phase 6 `reporter.ts` 가 이대로 publish 해야 한다)
 *  - 채널: `run:<runId>`                       (`runEventChannel`)
 *  - 버퍼: `run:<runId>:events` (Redis List)   (`runEventBufferKey`)
 *  - 순번: `run:<runId>:seq`    (INCR)          (`runEventSeqKey`)
 *  - 채널과 버퍼에 흘리는 바이트는 **완전히 동일**한 `RunEventEnvelope` JSON 이다:
 *    `{"seq": 1, "payload": {"event":"run.status", ...}}`
 *  - SSE 로 나갈 때 `id:` = `seq`, `event:` = `payload.event`, `data:` = `payload`(마스킹 후).
 *
 * ## `Last-Event-ID` 재연결
 *  1. **먼저 구독**하고 들어오는 이벤트를 메모리에 쌓는다.
 *  2. 그다음 버퍼를 `LRANGE` 로 읽어 `seq > Last-Event-ID` 인 것만 내보낸다.
 *  3. 마지막으로 1번에서 쌓인 것을 `seq` 중복을 걸러 내보낸다.
 *
 *  순서가 반대면(버퍼 먼저 → 구독 나중) 그 사이에 발행된 이벤트가 **영구히 사라진다.**
 *  `RUN_EVENT_BUFFER_MAX`(500) 를 넘겨 밀려난 이벤트는 재전송할 수 없다 — 그때는
 *  클라이언트가 `GET /api/runs/:id` 로 전체 상태를 다시 읽어야 한다.
 *
 * ## 마스킹 — 3중 방어
 *  1. **계약 파싱** — `RunEventEnvelopeSchema` 가 스키마에 없는 키를 통째로 버린다.
 *     Runner 가 실수로 `password` 필드를 붙여 보내도 클라이언트까지 가지 않는다.
 *  2. **값 기반** — 그 run 의 BullMQ job 페이로드(= 평문 변수가 존재하는 유일한 장소)에서
 *     `collectSecretValues()` 로 Secret 값을 꺼내 `maskSecrets()` 에 넘긴다. Playwright
 *     에러 메시지에 박힌 비밀번호는 **이 경로로만** 잡힌다(키 이름이 없으므로).
 *     새로 저장하는 것이 없다 — 이미 Redis 에 있는 job 을 읽을 뿐이다.
 *  3. **키 기반** — `maskSecrets()` 가 `password|token|secret|…` 키를 항상 가린다.
 *
 * Runner 의 `reporter.ts` 도 publish 전에 같은 마스킹을 해야 한다(Task 6.4) —
 * DB(`error_message`)에 남는 값은 여기를 거치지 않기 때문이다. 두 겹 다 필요하다.
 */
@Injectable()
export class RunEventsService implements OnApplicationShutdown {
  private readonly subscribers = new Set<Redis>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(RunEntity) private readonly runs: Repository<RunEntity>,
    @InjectQueue(RUN_QUEUE_NAME) private readonly queue: Queue<RunJobData>,
  ) {}

  /**
   * 이 run 의 Secret **값** 목록.
   *
   * 평문 변수가 존재하는 유일한 장소인 BullMQ job 페이로드에서 읽는다. job 이 이미
   * 만료됐으면 빈 배열이고, 그 경우 마스킹은 키 기반만 남는다(그때는 실행이 끝난 뒤라
   * 새 이벤트도 더 오지 않는다). **읽기만 한다 — 어디에도 다시 저장하지 않는다.**
   */
  private async secretValuesOf(runId: string): Promise<string[]> {
    try {
      const job = await this.queue.getJob(runId);
      if (!job) return [];
      return collectSecretValues(job.data.variables, job.data.secretKeys);
    } catch {
      return [];
    }
  }

  /**
   * 스트림을 열기 **전에** run 존재를 확인한다.
   *
   * `RunsService` 를 주입하지 않은 이유는 순환 참조다 — `runs.service.ts` 가 취소 이벤트를
   * 쏘려고 이 서비스를 주입한다. 존재 확인 한 줄 때문에 `forwardRef` 를 끌어들일 이유가 없다.
   */
  async assertRunExists(runId: string): Promise<void> {
    const exists = await this.runs.exists({ where: { id: runId } });
    if (!exists) throw new NotFoundException(`실행을 찾을 수 없습니다: ${runId}`);
  }

  /**
   * 이벤트 1건 발행. **API 쪽 발행 경로는 실행 취소뿐이고**, 나머지는 Runner 가 쓴다.
   * Runner 도 이 순서를 그대로 지켜야 한다(위 "이벤트 규약" 참조).
   */
  async publish(runId: string, payload: RunEvent): Promise<number> {
    const seqKey = runEventSeqKey(runId);
    const bufferKey = runEventBufferKey(runId);

    const seq = await this.redis.incr(seqKey);
    const envelope: RunEventEnvelope = { seq, payload };
    const body = JSON.stringify(envelope);

    await this.redis
      .multi()
      .expire(seqKey, RUN_EVENT_BUFFER_TTL_SEC)
      .rpush(bufferKey, body)
      .ltrim(bufferKey, -RUN_EVENT_BUFFER_MAX, -1)
      .expire(bufferKey, RUN_EVENT_BUFFER_TTL_SEC)
      .exec();

    // ★ 버퍼에 넣은 뒤 publish 한다. 반대면 재연결 재전송에 구멍이 생긴다.
    await this.redis.publish(runEventChannel(runId), body);
    return seq;
  }

  /** 실행 중인 Runner 에게 취소를 알린다(Gen-Phase 6 Task 6.7 이 구독). */
  async publishCancelSignal(runId: string): Promise<void> {
    await this.redis.publish(
      runCancelChannel(runId),
      JSON.stringify({ runId, at: new Date().toISOString() }),
    );
  }

  /**
   * `GET /api/runs/:id/events` 본체. 응답을 직접 쓴다.
   *
   * Nest 의 `@Sse()` 를 쓰지 않은 이유: `id:` 부여 · `Last-Event-ID` 재전송 ·
   * `:ping` 주석 keep-alive 를 **전부 직접 제어**해야 하는데, Observable 래퍼 뒤에서는
   * 그 세 가지가 모두 우회 코드가 된다.
   */
  async stream(runId: string, lastEventId: number, res: Response): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx 가 SSE 를 버퍼링하지 않게 한다(이게 없으면 이벤트가 몰아서 도착한다).
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: ${String(RETRY_MS)}\n\n`);
    res.write(": connected\n\n");
    res.flushHeaders?.();

    let highWater = lastEventId;
    let closed = false;
    const pending: RunEventEnvelope[] = [];
    let replaying = true;

    // 큐 페이로드에서 이 run 의 Secret 값을 읽어 둔다(위 "마스킹 — 3중 방어" 2번).
    const secretValues = await this.secretValuesOf(runId);

    const emit = (envelope: RunEventEnvelope): void => {
      if (closed || envelope.seq <= highWater) return;
      highWater = envelope.seq;

      // ★ 나가기 직전 마스킹 (03-phases Task 5.2).
      const masked = maskSecrets(envelope.payload, secretValues);
      res.write(
        `id: ${String(envelope.seq)}\n` +
          `event: ${envelope.payload.event}\n` +
          `data: ${JSON.stringify(masked)}\n\n`,
      );
    };

    const subscriber = this.redis.duplicate();
    this.subscribers.add(subscriber);

    const keepalive = setInterval(() => {
      if (!closed) res.write(": ping\n\n");
    }, KEEPALIVE_MS);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      this.subscribers.delete(subscriber);
      subscriber.removeAllListeners();
      void subscriber.quit().catch(() => subscriber.disconnect());
      res.end();
    };

    res.on("close", cleanup);
    res.on("error", cleanup);

    subscriber.on("message", (_channel: string, raw: string) => {
      const envelope = parseEnvelope(raw);
      if (!envelope) return;
      if (replaying) pending.push(envelope);
      else emit(envelope);
    });

    // ① 먼저 구독한다.
    await subscriber.subscribe(runEventChannel(runId));

    // ② 그다음 버퍼를 읽어 누락분을 재전송한다.
    const buffered = await this.redis.lrange(runEventBufferKey(runId), 0, -1);
    for (const raw of buffered) {
      const envelope = parseEnvelope(raw);
      if (envelope) emit(envelope);
    }

    // ③ 마지막으로 구독 중 쌓인 것을 흘린다(emit 이 seq 중복을 거른다).
    replaying = false;
    for (const envelope of pending) emit(envelope);
    pending.length = 0;
  }

  async onApplicationShutdown(): Promise<void> {
    for (const subscriber of this.subscribers) {
      await subscriber.quit().catch(() => subscriber.disconnect());
    }
    this.subscribers.clear();
  }
}

/** 깨진 메시지 하나가 스트림 전체를 죽이지 않게 한다. */
export function parseEnvelope(raw: string): RunEventEnvelope | null {
  try {
    const parsed = RunEventEnvelopeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** `Last-Event-ID` 헤더(또는 `?lastEventId=`)를 seq 로 해석한다. 이상값은 0 으로 본다. */
export function parseLastEventId(...candidates: (string | undefined)[]): number {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.trim() === "") continue;
    const value = Number(candidate);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return 0;
}

@Controller()
export class RunsSseController {
  constructor(private readonly events: RunEventsService) {}

  /**
   * `GET /api/runs/:id/events` (`Accept: text/event-stream`).
   *
   * 존재하지 않는 run 은 스트림을 열기 **전에** 404 로 끊는다. 스트림을 연 뒤에는
   * HTTP 상태 코드를 바꿀 수 없어 클라이언트가 오류를 알 방법이 없어진다.
   *
   * `EventSource` 는 헤더를 붙일 수 없으므로 브라우저 재연결은 `Last-Event-ID` 헤더가
   * 자동으로 붙지만, 수동 테스트(`curl`)를 위해 `?lastEventId=` 도 받는다.
   */
  @Get("runs/:id/events")
  async stream(
    @Param("id") id: string,
    @Res() res: Response,
    @Headers("last-event-id") lastEventIdHeader?: string,
    @Query("lastEventId") lastEventIdQuery?: string,
  ): Promise<void> {
    await this.events.assertRunExists(id);
    await this.events.stream(id, parseLastEventId(lastEventIdHeader, lastEventIdQuery), res);
  }
}
