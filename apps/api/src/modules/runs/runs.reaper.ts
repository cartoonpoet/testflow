import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { Repository } from "typeorm";
import { Redis } from "ioredis";
import {
  RUN_QUEUE_NAME,
  RUN_REAPER_INTERVAL_MS,
  RUN_REAPER_LOCK_KEY,
  RUN_STALE_ERROR_MESSAGE,
  RUN_STALE_GRACE_MS,
  runnerHeartbeatKey,
} from "@testflow/contracts";
import type { RunJobData } from "@testflow/contracts";
import { RunEntity, StepResultEntity } from "@testflow/db";
import { REDIS_CLIENT } from "../../common/redis/redis.module.js";
import { RunEventsService } from "./runs.sse.js";

/**
 * ★ 고아(stale) run 회수 — "영원히 실행 중"을 없앤다.
 *
 * ## 무엇이 문제였나
 * Runner 프로세스가 실행 도중 죽으면(`SIGKILL`·OOM·호스트 재부팅) 그 run 의 `status` 를
 * 종료 상태로 확정할 주체가 **아무도 없다.** heartbeat 는 30초 뒤 만료되어
 * `GET /api/health` 가 `runner: "down"` 을 보여 주지만, `runs.status` 는 `running` 그대로다.
 * 사용자 입장에서는 끝나지 않는 실행이 목록에 남고 —
 *  - 취소해도 신호를 받을 Runner 가 없어 상태가 그대로이며,
 *  - 삭제는 `assertDeletable()` 이 **409** 로 막는다(진행 중 실행은 지우지 않는다).
 * 즉 **사용자가 자기 손으로 치울 수 없는 행**이 된다.
 *
 * ## 누가 회수하나 — API 쪽 주기 작업 (+ Runner 기동 정리)
 * 회수 주체는 **죽는 쪽과 다른 프로세스**여야 한다. Runner 가 자기 죽음을 정리할 수는 없다.
 * 그래서 이 서비스(API)가 1차 주체다. Runner 기동 시의 자기 이름 정리(`apps/runner/src/main.ts`)
 * 는 **2차**이고, 서로의 사각지대를 덮는다:
 *  - API 주기 작업은 Runner 가 **다시 뜨지 않아도** 동작한다. 다만 `RUNNER_ID` 를 고정한
 *    Runner 가 유예 안에 재기동하면 heartbeat 가 되살아나 그 run 을 영영 못 잡는다.
 *  - Runner 기동 정리는 정확히 그 경우를 덮는다. 다만 Runner 가 안 뜨면 영원히 안 돈다.
 *
 * ## 판정 기준 — `RUN_STALE_GRACE_MS` 의 JSDoc 이 단일 근거다
 * 요약하면 **heartbeat 부재가 1차 신호**이고 경과 시간은 오탐 방지용 2차 조건이다.
 * 경과 시간만으로 판정하면 `RUNNER_RUN_TIMEOUT_MS`(기본 300초)와 반드시 충돌한다 —
 * 정상적으로 오래 도는 실행을 죽이는 회수 장치는 **없는 것보다 나쁘다.**
 *
 * ## 중복 회수 방지 — 2겹
 *  1. Redis 락(`RUN_REAPER_LOCK_KEY`, `SET NX PX`). API 가 여러 대여도 한 번에 한 대만 훑는다.
 *  2. **조건부 UPDATE** (`WHERE id = ? AND status = 'running'`). `affected === 0` 이면
 *     그 사이 누군가(Runner 의 지연된 보고·다른 API·사용자 취소)가 이미 확정한 것이므로
 *     **SSE 를 쏘지 않고 조용히 넘어간다.** 락이 없어도 상태·이벤트가 두 번 나가지 않는다.
 *
 * ## 무엇을 건드리지 않나
 *  - `queued` 는 회수 대상이 **아니다.** 큐 job 은 Redis 에 남아 있어 Runner 가 다시 뜨면
 *    그대로 집어 간다. 회수하면 멀쩡히 실행될 예약을 죽이는 것이다.
 *  - 증적(`artifacts`)은 손대지 않는다. Runner 가 죽기 전에 flush 한 것이 있으면 그대로 남는다
 *    (증적 목록·영상은 `run_id` 로만 묶여 있어 상태 확정과 무관하다).
 */
@Injectable()
export class StaleRunReaper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StaleRunReaper.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    @InjectRepository(RunEntity) private readonly runs: Repository<RunEntity>,
    @InjectRepository(StepResultEntity) private readonly stepResults: Repository<StepResultEntity>,
    @InjectQueue(RUN_QUEUE_NAME) private readonly queue: Queue<RunJobData>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly events: RunEventsService,
  ) {}

  /**
   * `@nestjs/schedule` 을 쓰지 않는다 — **런타임 의존성을 늘리지 않기 위해서다.**
   * 주기 작업이 이것 하나뿐이라 `setInterval` 한 줄이면 충분하고, `unref()` 로
   * 이 타이머가 프로세스 종료를 붙잡지 않게 한다(`enableShutdownHooks` 와 궁합).
   */
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep(), RUN_REAPER_INTERVAL_MS);
    this.timer.unref();
    this.logger.log(
      `고아 실행 회수 시작 — 주기 ${String(RUN_REAPER_INTERVAL_MS)}ms · ` +
        `유예 ${String(RUN_STALE_GRACE_MS)}ms (heartbeat 부재가 1차 조건)`,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * 1회 훑기. 예외를 밖으로 던지지 않는다 — `setInterval` 콜백에서 던지면
   * `unhandledRejection` 이 되어 프로세스가 죽는다(그 자체가 이번 작업이 막으려는 사고다).
   */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    const token = randomUUID();
    try {
      const acquired = await this.redis.set(
        RUN_REAPER_LOCK_KEY,
        token,
        "PX",
        RUN_REAPER_INTERVAL_MS * 4,
        "NX",
      );
      if (acquired !== "OK") return 0;

      try {
        return await this.reclaimStale();
      } finally {
        // 락은 최적화일 뿐이라 해제 실패를 신경 쓰지 않는다(TTL 로 사라진다).
        // 남의 락을 풀지 않도록 토큰이 같을 때만 지운다.
        const current = await this.redis.get(RUN_REAPER_LOCK_KEY).catch(() => null);
        if (current === token) await this.redis.del(RUN_REAPER_LOCK_KEY).catch(() => 0);
      }
    } catch (error) {
      this.logger.warn(`고아 실행 회수 실패: ${String(error)}`);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  private async reclaimStale(): Promise<number> {
    const running = await this.runs.find({ where: { status: "running" }, take: 500 });
    if (running.length === 0) return 0;

    const alive = await this.aliveRunnerIds(running);
    const now = new Date();
    let reclaimed = 0;

    for (const run of running) {
      if (!isStaleRun(run, { now, aliveRunnerIds: alive, graceMs: RUN_STALE_GRACE_MS })) continue;
      if (await this.reclaim(run)) reclaimed += 1;
    }
    return reclaimed;
  }

  /**
   * 후보 run 들의 `runner_id` 중 **heartbeat 키가 살아 있는** 것만 모은다.
   *
   * `EXISTS` 를 파이프라인 한 번으로 묶는다 — run 이 수백 건이어도 왕복은 1회다.
   * ★ Redis 조회가 실패하면 **아무도 살아 있지 않다고 단정하지 않는다.** 그 순간
   *   전 run 이 회수 대상이 되어 정상 실행을 몰살한다. 실패하면 전부 "살아 있다"로 본다.
   */
  private async aliveRunnerIds(runs: readonly RunEntity[]): Promise<ReadonlySet<string>> {
    const ids = [...new Set(runs.map((run) => run.runnerId).filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Set();

    try {
      const pipeline = this.redis.pipeline();
      for (const id of ids) pipeline.exists(runnerHeartbeatKey(id));
      const replies = await pipeline.exec();
      if (replies === null) return new Set(ids);

      const alive = new Set<string>();
      replies.forEach(([error, value], index) => {
        const id = ids[index];
        if (id === undefined) return;
        // 개별 명령이 실패하면 그 Runner 는 "살아 있다"로 본다(오탐 금지).
        if (error !== null || value === 1) alive.add(id);
      });
      return alive;
    } catch {
      return new Set(ids);
    }
  }

  /**
   * run 1건을 `error` 로 확정하고 SSE 로 종료를 알린다.
   *
   * 순서: **조건부 UPDATE → 스텝 정리 → 큐 job 제거 → SSE 발행.**
   *  - UPDATE 가 먼저다. 여기서 걸러지면(`affected === 0`) 나머지를 아예 하지 않는다.
   *  - 큐 job 을 지우는 이유: Worker 가 죽으면 BullMQ job 은 lock 만료 후 **stalled 로
   *    재배달**된다. 그대로 두면 Runner 가 다시 떴을 때 이미 `error` 로 확정한 run 을
   *    되살려 `running` 으로 되돌린다(상태가 뒤로 간다 — 04-gen-5 이슈 4번과 같은 부류).
   *    ★ 다만 **삭제만으로는 못 막는다** — BullMQ 는 lock 이 걸린 active job 의 삭제를
   *    거부한다(실측). 최종 방어선은 Runner 의 `main.ts` Worker 앞단에서 하는
   *    **"이미 끝난 run 이면 job 을 버린다"** 검사다. 여기 삭제는 아직 대기 중인 job 을
   *    일찍 치우는 역할이다.
   *  - SSE 는 맨 뒤다. 화면이 이벤트를 받고 재조회했을 때 DB 가 이미 확정돼 있어야 한다.
   */
  private async reclaim(run: RunEntity): Promise<boolean> {
    const finishedAt = new Date();
    const durationMs =
      run.startedAt === null ? null : Math.max(0, finishedAt.getTime() - run.startedAt.getTime());

    const updated = await this.runs.update(
      { id: run.id, status: "running" },
      {
        status: "error",
        errorMessage: RUN_STALE_ERROR_MESSAGE,
        finishedAt,
        ...(durationMs === null ? {} : { durationMs }),
      },
    );
    if ((updated.affected ?? 0) === 0) return false;

    // 끝나지 않은 스텝은 `skipped` 다. 남겨 두면 끝난 실행에 "대기 중" 스텝이 보인다.
    await this.stepResults
      .createQueryBuilder()
      .update()
      .set({ status: "skipped" })
      .where("run_id = :runId AND status IN (:...open)", {
        runId: run.id,
        open: ["pending", "running"],
      })
      .execute()
      .catch(() => undefined);

    const job = await this.queue.getJob(run.id).catch(() => undefined);
    if (job) await job.remove().catch(() => undefined);

    const fresh = await this.runs.findOne({ where: { id: run.id } });
    const at = finishedAt.toISOString();
    await this.events.publish(run.id, {
      event: "run.status",
      runId: run.id,
      status: "error",
      runnerId: run.runnerId,
      at,
    });
    await this.events.publish(run.id, {
      event: "run.finished",
      runId: run.id,
      status: "error",
      passedSteps: fresh?.passedSteps ?? run.passedSteps,
      totalSteps: fresh?.totalSteps ?? run.totalSteps,
      durationMs,
      errorMessage: RUN_STALE_ERROR_MESSAGE,
      at,
    });

    this.logger.warn(
      `고아 실행 회수 — ${run.runCode} (runner=${run.runnerId ?? "unknown"}) → error`,
    );
    return true;
  }
}

/**
 * 회수 대상인가. **부수효과가 없는 순수 판정**이라 테스트가 이 함수 하나만 본다.
 *
 * ① Runner 가 살아 있으면(heartbeat 키 존재) **무조건 false.** 실행이 아무리 오래 돌아도
 *    회수하지 않는다 — 이것이 정상 장시간 실행을 지키는 조건이다.
 * ② `runner_id` 가 없는 `running` 행은 있을 수 없지만(reporter 가 둘을 한 UPDATE 로 쓴다)
 *    만에 하나 생기면 누구도 책임지지 않는 행이므로 유예 뒤 회수한다.
 * ③ 시각 기준은 `started_at`, 없으면 `queued_at` 이다.
 */
export function isStaleRun(
  run: Pick<RunEntity, "runnerId" | "startedAt" | "queuedAt">,
  options: { now: Date; aliveRunnerIds: ReadonlySet<string>; graceMs: number },
): boolean {
  if (run.runnerId !== null && options.aliveRunnerIds.has(run.runnerId)) return false;
  const since = run.startedAt ?? run.queuedAt;
  return options.now.getTime() - since.getTime() >= options.graceMs;
}
