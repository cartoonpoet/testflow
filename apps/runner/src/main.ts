import "reflect-metadata";
import { Worker } from "bullmq";
import type { Job } from "bullmq";
import { Redis } from "ioredis";
import { DataSource } from "typeorm";
import {
  RUN_JOB_NAME,
  RUN_QUEUE_NAME,
  RUNNER_HEARTBEAT_TTL_SEC,
  RunJobDataSchema,
  collectSecretValues,
  runCancelChannel,
  runnerHeartbeatKey,
} from "@testflow/contracts";
import type { RunJobData } from "@testflow/contracts";
import { createDataSourceOptions } from "@testflow/db";
import { RunAbortHandle, executeRun } from "./execute/executor.js";
import { maskSecretText } from "./mask.js";
import { loadConfig } from "./env.js";
import type { RunnerConfig } from "./env.js";
import { startRecordingWsServer } from "./record/ws-server.js";

/**
 * Runner 진입점 — BullMQ Worker (03-phases Task 6.7).
 *
 * ## 큐 규약 (깨면 API 와 연결이 끊긴다)
 * - 큐 이름 `run`, job 이름 `execute`, **`jobId = runId`**
 * - 페이로드는 `RunJobDataSchema`. **`variables` 평문이 존재하는 유일한 장소다** —
 *   로그·DB·`docker inspect` 어디로도 흘리지 않는다.
 *
 * ## heartbeat
 * `SET testflow:runner:heartbeat:<runnerId> <ISO> EX 30` 을 10초마다 갱신한다.
 * API 의 `GET /api/health` 가 이 접두사를 SCAN 해서 `runner: "ok"|"down"` 을 판정한다.
 * TTL 의 1/3 주기로 갱신하는 이유는 한 번 걸러도 키가 살아 있게 하기 위해서다.
 *
 * ## 취소
 * `run:<id>:cancel` 채널을 구독한다. 큐에 남아 있는 job 은 API 가 직접 지우고
 * `cancelled` 로 확정하지만, **이미 `running` 인 run 의 최종 status 확정은 Runner 의 몫**이다
 * (API 가 먼저 바꾸면 Runner 가 나중에 `passed` 로 덮어써 상태가 되돌아간다 — 04-gen-5 이슈 4번).
 *
 * ## 녹화 WS 서버 (Gen-Phase 7 Task 7.2)
 * `RUNNER_WS_PORT`(기본 4100)에 `ws` 서버를 함께 띄운다. 경로는 `/rec/:sessionId?token=…`
 * 하나뿐이고, 토큰은 API 가 Redis 에 넣은 **SHA-256 해시**와 타이밍 안전 비교한다.
 * **API 를 중계로 끼우지 않는다** — 프레임마다 홉이 늘면 지연이 배가된다.
 * 제어 채널(`rec:<id>:control`) 구독도 그 서버가 맡는다.
 */

const HEARTBEAT_INTERVAL_MS = (RUNNER_HEARTBEAT_TTL_SEC * 1000) / 3;

function log(message: string): void {
  process.stdout.write(`[runner] ${new Date().toISOString()} ${message}\n`);
}

/** 실행 중인 run 의 취소 손잡이. 취소 채널 메시지를 여기로 꽂는다. */
const inFlight = new Map<string, RunAbortHandle>();

async function main(): Promise<void> {
  const config = loadConfig();

  // BullMQ 는 블로킹 명령을 쓰므로 전용 연결이 필요하다(`maxRetriesPerRequest: null` 필수).
  const queueConnection = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null,
  });
  // 이벤트 발행·heartbeat 용 일반 연결.
  const redis = new Redis({ host: config.redis.host, port: config.redis.port });
  // 구독 전용 연결(구독 모드에 들어간 연결로는 다른 명령을 보낼 수 없다).
  const subscriber = new Redis({ host: config.redis.host, port: config.redis.port });
  // 녹화 제어 채널 전용 구독 연결. 실행 취소 구독과 섞지 않는다 — 패턴이 다르고,
  // 한쪽 구독이 늘어날 때 다른 쪽 핸들러가 같이 깨우쳐지는 것을 피한다.
  const recordingSubscriber = new Redis({ host: config.redis.host, port: config.redis.port });

  const dataSource = new DataSource(createDataSourceOptions());
  await dataSource.initialize();
  log(`DB 연결 완료 (${process.env["DB_HOST"] ?? "127.0.0.1"}:${process.env["DB_PORT"] ?? "3307"})`);

  await startHeartbeat(redis, config);
  await startCancelListener(subscriber);

  // 녹화 WS 서버 — BullMQ Worker 와 같은 프로세스에서 돈다(Playwright 는 Runner 에만 있다).
  const recorder = await startRecordingWsServer({
    config,
    redis,
    subscriber: recordingSubscriber,
    dataSource,
    log,
  });

  const worker = new Worker<RunJobData>(
    RUN_QUEUE_NAME,
    async (job: Job<RunJobData>) => {
      if (job.name !== RUN_JOB_NAME) {
        log(`알 수 없는 job 이름 무시: ${job.name}`);
        return;
      }
      // ★ 큐 페이로드도 계약으로 검증한다. API 가 바뀌어 형태가 어긋나면 여기서 잡힌다.
      const data = RunJobDataSchema.parse(job.data);

      const abort = new RunAbortHandle();
      inFlight.set(data.runId, abort);

      // 하드 타임아웃. 넘기면 브라우저를 끊고 status 를 `timeout` 으로 확정한다.
      const timer = setTimeout(() => {
        log(`run ${data.runId} 하드 타임아웃(${String(config.runTimeoutMs)}ms)`);
        abort.abort("timeout");
      }, config.runTimeoutMs);

      try {
        const result = await executeRun({ job: data, config, dataSource, redis, abort, log });
        // ★ 반환값은 BullMQ job 에 저장된다. **평문 변수를 넣지 않는다.**
        return {
          status: result.status,
          passedSteps: result.passedSteps,
          totalSteps: result.totalSteps,
          artifactCount: result.artifactCount,
        };
      } finally {
        clearTimeout(timer);
        inFlight.delete(data.runId);
      }
    },
    {
      connection: queueConnection,
      concurrency: config.concurrency,
      // 실행이 길어도 stalled 로 오판하지 않게 여유를 준다.
      lockDuration: Math.max(60_000, config.runTimeoutMs + 60_000),
    },
  );

  worker.on("failed", (job, error) => {
    // ★ job.data 를 통째로 찍지 않는다 — variables 평문이 로그로 샌다.
    //   에러 **메시지 자체**에도 입력값이 실려 나오므로(Playwright) 그 job 의 Secret 값으로
    //   마스킹한 뒤 찍는다 — 마스킹 3경로 중 ② 서버 로그 (03-phases Task 12.4).
    const secretValues =
      job === undefined ? [] : collectSecretValues(job.data.variables, job.data.secretKeys);
    const first = error.message.split("\n")[0] ?? error.message;
    log(`job 실패 (runId=${job?.id ?? "unknown"}): ${maskSecretText(first, secretValues)}`);
  });
  worker.on("error", (error) => {
    log(`worker 오류: ${error.message}`);
  });

  log(
    `Worker 기동 — queue="${RUN_QUEUE_NAME}" concurrency=${String(config.concurrency)} ` +
      `mode=${config.executionMode} runnerId=${config.runnerId} artifactRoot=${config.artifactRoot} ` +
      `recorderPort=${String(recorder.port)}`,
  );

  setupShutdown(async () => {
    log("종료 신호 수신 — 진행 중인 실행을 마치고 정리합니다.");
    await worker.close();
    await recorder.close().catch(() => undefined);
    await recordingSubscriber.quit().catch(() => undefined);
    await subscriber.quit().catch(() => undefined);
    await redis.del(runnerHeartbeatKey(config.runnerId)).catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await queueConnection.quit().catch(() => undefined);
    await dataSource.destroy().catch(() => undefined);
    log("정리 완료.");
  });
}

/** heartbeat 를 즉시 1회 + 주기 갱신. health 가 Runner 기동 직후부터 `ok` 를 보도록. */
async function startHeartbeat(redis: Redis, config: RunnerConfig): Promise<void> {
  const key = runnerHeartbeatKey(config.runnerId);
  const beat = async (): Promise<void> => {
    await redis.set(key, new Date().toISOString(), "EX", RUNNER_HEARTBEAT_TTL_SEC).catch(() => undefined);
  };
  await beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  // Node 가 이 타이머 때문에 종료를 못 하는 일이 없게 한다.
  timer.unref();
  log(`heartbeat 등록 — ${key} (TTL ${String(RUNNER_HEARTBEAT_TTL_SEC)}s)`);
}

/**
 * 취소 채널 구독.
 *
 * run 마다 채널이 다르므로(`run:<id>:cancel`) 패턴 구독(`psubscribe`)을 쓴다.
 * run 을 집어들 때마다 subscribe 하면 경합(구독 전에 취소가 오면 놓친다)이 생긴다.
 */
async function startCancelListener(subscriber: Redis): Promise<void> {
  await subscriber.psubscribe("run:*:cancel");
  subscriber.on("pmessage", (_pattern: string, channel: string) => {
    for (const [runId, handle] of inFlight) {
      if (channel === runCancelChannel(runId)) {
        log(`run ${runId} 취소 신호 수신`);
        handle.abort("cancelled");
      }
    }
  });
  log("취소 채널 구독 — run:*:cancel");
}

function setupShutdown(cleanup: () => Promise<void>): void {
  let closing = false;
  const handler = (signal: string): void => {
    if (closing) return;
    closing = true;
    log(`${signal} 수신`);
    void cleanup().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
}

main().catch((error: unknown) => {
  log(`기동 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
