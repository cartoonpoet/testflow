import "reflect-metadata";
import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import { Redis } from "ioredis";
import { DataSource } from "typeorm";
import {
  RUN_JOB_NAME,
  RUN_QUEUE_NAME,
  RUNNER_HEARTBEAT_TTL_SEC,
  RunJobDataSchema,
  collectSecretValues,
  isTerminalRunStatus,
  maskSecretsInText,
  runCancelChannel,
  runnerCapacityKey,
  runnerHeartbeatKey,
} from "@testflow/contracts";
import type { RunJobData } from "@testflow/contracts";
import { RunEntity, createDataSourceOptions } from "@testflow/db";
import { RunAbortHandle, executeRun } from "./execute/executor.js";
import { LiveStreamRegistry } from "./execute/live-stream.js";
import { maskSecretText } from "./mask.js";
import { loadConfig } from "./env.js";
import type { RunnerConfig } from "./env.js";
import { reclaimOwnOrphanRuns } from "./reclaim.js";
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

  /**
   * 큐 **쓰기용** 핸들. Worker 와 달리 job 을 *읽고 지우는* 데만 쓴다 —
   * 고아 run 회수가 재배달 대상 job 을 치워야 하기 때문이다(`reclaim.ts` 주석).
   */
  const queue = new Queue<RunJobData>(RUN_QUEUE_NAME, {
    connection: { host: config.redis.host, port: config.redis.port },
  });

  /*
   * ★ 내 이전 생이 남긴 고아 run 정리. **Worker 를 만들기 전에** 한다 —
   *   Worker 가 먼저 돌면 재배달된 job 을 집어 들어 같은 run 이 다시 `running` 이 된다.
   *   실패해도 기동을 막지 않는다(정리는 API 쪽 회수 장치가 한 번 더 받친다).
   */
  const reclaimed = await reclaimOwnOrphanRuns({
    dataSource,
    redis,
    queue,
    runnerId: config.runnerId,
    log,
  }).catch((error: unknown) => {
    log(`고아 실행 정리 실패(무시하고 계속): ${maskSecretsInText(String(error))}`);
    return 0;
  });
  if (reclaimed > 0) log(`고아 실행 ${String(reclaimed)}건을 error 로 확정했다.`);

  /**
   * ★ 실행 라이브 스트림 레지스트리 (라운드 2 Task 4.4).
   *
   * **BullMQ Worker(프레임 생산)와 WS 서버(프레임 소비)가 이 객체 하나로 만난다.**
   * 둘이 같은 프로세스에서 도는 것이 전제다 — Playwright 가 Runner 에만 있으므로
   * 라운드 1의 녹화 세션과 같은 구조다(04-gen-7). 프로세스를 쪼개려면 프레임을
   * Redis 로 흘려야 하고 그 순간 지연 예산이 무너진다.
   */
  const liveStreams = new LiveStreamRegistry();

  // 녹화 WS 서버 — BullMQ Worker 와 같은 프로세스에서 돈다(Playwright 는 Runner 에만 있다).
  // `/rec/:sessionId`(녹화) + `/live/:runId`(실행 라이브) 두 경로를 같은 포트에서 연다.
  const recorder = await startRecordingWsServer({
    config,
    redis,
    subscriber: recordingSubscriber,
    dataSource,
    log,
    liveStreams,
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

      /**
       * ★★ **재배달 방어** — 이미 끝난 run 을 다시 실행하지 않는다. (실측으로 발견했다)
       *
       * Worker 가 죽으면 그 job 은 lock 이 만료된 뒤 BullMQ 에 의해 **stalled 로 재배달**된다.
       * 그 사이 고아 회수 장치(`StaleRunReaper` · `reclaim.ts`)가 run 을 `error` 로 확정했다면,
       * 재배달된 job 이 **끝난 run 을 되살려 `running` → `passed` 로 되돌린다.**
       * 상태가 뒤로 가는 것은 04-gen-5 이슈 4번과 같은 부류의 최악이다.
       *
       * 회수 쪽에서 `job.remove()` 를 부르지만 **그것만으로는 못 막는다** — BullMQ 는
       * **lock 이 걸린 active job 의 삭제를 거부한다.** 실제로 회수 직후 Runner 를 다시 띄웠더니
       * 이미 `error` 로 확정하고 **행까지 지운** run 2건을 그대로 집어 들었다(실측 로그).
       * 그래서 진짜 방어선은 여기, **실행 직전의 DB 한 줄**이다.
       *
       * 행이 아예 없는 경우(사용자가 삭제)도 같이 막는다 — 그대로 진행하면 `step_results`
       * INSERT 가 FK 위반으로 터진다.
       */
      const current = await dataSource
        .getRepository(RunEntity)
        .findOne({ where: { id: data.runId } });
      if (!current) {
        log(`run ${data.runId} 행이 없다(삭제됨) — 재배달된 job 을 버린다.`);
        return;
      }
      if (isTerminalRunStatus(current.status)) {
        log(`run ${current.runCode} 은 이미 ${current.status} 다 — 재배달된 job 을 버린다.`);
        return;
      }

      const abort = new RunAbortHandle();
      inFlight.set(data.runId, abort);

      // 하드 타임아웃. 넘기면 브라우저를 끊고 status 를 `timeout` 으로 확정한다.
      const timer = setTimeout(() => {
        log(`run ${data.runId} 하드 타임아웃(${String(config.runTimeoutMs)}ms)`);
        abort.abort("timeout");
      }, config.runTimeoutMs);

      try {
        const result = await executeRun({
          job: data,
          config,
          dataSource,
          redis,
          abort,
          log,
          liveStreams,
        });
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

  const terminate = setupShutdown(async () => {
    log("종료 신호 수신 — 진행 중인 실행을 마치고 정리합니다.");
    await worker.close();
    liveStreams.closeAll();
    await recorder.close().catch(() => undefined);
    await queue.close().catch(() => undefined);
    await recordingSubscriber.quit().catch(() => undefined);
    await subscriber.quit().catch(() => undefined);
    await redis
      .del(runnerHeartbeatKey(config.runnerId), runnerCapacityKey(config.runnerId))
      .catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await queueConnection.quit().catch(() => undefined);
    await dataSource.destroy().catch(() => undefined);
    log("정리 완료.");
  });

  /**
   * ★ 프로세스 레벨 예외 핸들러 — **기존 종료 경로를 그대로 탄다.**
   *
   * 새 종료 절차를 만들지 않는 이유가 핵심이다. `worker.close()` 는 진행 중인 실행이
   * 끝나기를 기다리고, 그 안에서 중단이 걸리면 #13 이 만든 **graceful 종료
   * (`RUNNER_GRACEFUL_STOP_MS`, 기본 10초)** 가 돌아 Playwright 가 영상·trace 를 완성한다.
   * 여기서 `process.exit(1)` 을 바로 불렀다면 그 증적이 통째로 사라진다 —
   * "실행이 왜 죽었는지"를 보려는 사람에게서 유일한 단서를 빼앗는 셈이다.
   */
  installProcessGuards(terminate, config);
}

/**
 * `unhandledRejection` · `uncaughtException` → **로그를 남기고 graceful 종료.**
 *
 * ## 왜 잡고 계속 돌지 않는가
 * Runner 의 상태는 프로세스 밖으로 뻗어 있다 — Playwright 브라우저·docker 컨테이너·
 * 임시 작업공간·BullMQ job lock. `uncaughtException` 이 터진 시점은 그중 어디가 끊겼는지
 * 알 수 없는 지점이고, 그 상태로 다음 job 을 받으면 **증적이 섞이거나 컨테이너가 누수된다.**
 * 종료를 택하면 손실은 그 순간의 실행 하나로 끝나고, 그 실행조차
 *  ① `worker.close()` 의 graceful 경로로 증적을 남기고,
 *  ② 그래도 못 끝내면 **API 의 `StaleRunReaper` 가 heartbeat 부재로 회수**한다
 *     (이번 작업의 세 갈래가 여기서 맞물린다).
 * 그다음 프로세스 관리자가 깨끗한 Runner 를 다시 띄우고, 그 Runner 는 기동하면서
 * 자기 이름의 고아 run 을 정리한다(`reclaim.ts`).
 *
 * ## 로그에 비밀값을 남기지 않는다
 * `job.data.variables` 는 **평문 변수가 존재하는 유일한 장소**이고, 그 값은 Playwright
 * 예외 메시지에 그대로 실려 나온다. 어느 run 의 값인지 알 수 없는 지점이라 값 기반
 * 마스킹을 걸 수 없으므로 **키 기반 마스킹(`maskSecretText`)만** 걸고 스택은 찍지 않는다 —
 * 스택 프레임에 인자를 싣는 라이브러리가 있어 "가려지지 않은 평문"의 마지막 경로가 된다.
 */
function installProcessGuards(
  terminate: (reason: string, code: number) => void,
  config: RunnerConfig,
): void {
  // graceful 증적 flush 를 기다린 뒤에도 안 죽으면 강제 종료한다.
  const forceAfterMs = config.gracefulStopMs + 20_000;

  const fatal = (kind: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    log(`${kind}: ${maskSecretsInText(maskSecretText(message.split("\n")[0] ?? message))}`);
    const force = setTimeout(() => process.exit(1), forceAfterMs);
    force.unref();
    terminate(kind, 1);
  };

  process.on("unhandledRejection", (reason: unknown) => {
    fatal("처리되지 않은 Promise rejection", reason);
  });
  process.on("uncaughtException", (error: Error) => {
    fatal("처리되지 않은 예외", error);
  });
}

/** heartbeat 를 즉시 1회 + 주기 갱신. health 가 Runner 기동 직후부터 `ok` 를 보도록. */
async function startHeartbeat(redis: Redis, config: RunnerConfig): Promise<void> {
  const key = runnerHeartbeatKey(config.runnerId);
  /*
   * ★ 라운드 7 — **동시 실행 한도**를 같이 적는다(같은 주기·같은 TTL).
   *   웹이 "여러 개 병렬 실행"을 말하려면 실제로 몇 개가 동시에 도는지 알아야 하는데,
   *   그 값은 이 프로세스만 안다. API 가 자기 env 에서 읽으면 설정이 두 벌이 된다.
   *   heartbeat 값을 JSON 으로 바꾸지 않고 **키를 따로** 둔 이유는 `contracts` 주석 참조 —
   *   health 판정(`…heartbeat:*` SCAN)이 한 줄도 바뀌지 않아야 한다.
   */
  const capacity = runnerCapacityKey(config.runnerId);
  const beat = async (): Promise<void> => {
    await redis
      .multi()
      .set(key, new Date().toISOString(), "EX", RUNNER_HEARTBEAT_TTL_SEC)
      .set(capacity, String(config.concurrency), "EX", RUNNER_HEARTBEAT_TTL_SEC)
      .exec()
      .catch(() => undefined);
  };
  await beat();
  const timer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  // Node 가 이 타이머 때문에 종료를 못 하는 일이 없게 한다.
  timer.unref();
  log(
    `heartbeat 등록 — ${key} (TTL ${String(RUNNER_HEARTBEAT_TTL_SEC)}s) · ` +
      `capacity=${String(config.concurrency)}`,
  );
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

/**
 * 종료 경로를 **하나로** 만든다. 반환값(`terminate`)을 신호 핸들러와 예외 핸들러가 같이 쓴다 —
 * 종료 절차가 두 벌이 되면 "신호로 죽을 때는 증적이 남고 예외로 죽을 때는 안 남는" 상태가 된다.
 */
function setupShutdown(cleanup: () => Promise<void>): (reason: string, code: number) => void {
  let closing = false;
  const terminate = (reason: string, code: number): void => {
    if (closing) return;
    closing = true;
    log(`${reason} — 종료 절차 시작`);
    void cleanup().then(
      () => process.exit(code),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", () => terminate("SIGINT 수신", 0));
  process.on("SIGTERM", () => terminate("SIGTERM 수신", 0));
  return terminate;
}

main().catch((error: unknown) => {
  log(`기동 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
