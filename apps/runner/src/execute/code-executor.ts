/**
 * 코드 시나리오 실행 엔진 — `playwright test` 오케스트레이션 (03-phases Task 3.5).
 *
 * ```
 * scenario_codes 조회 → runs.status=running → 작업공간 생성
 *   → loopback 이벤트 서버 기동 → spawn(playwright test --config <생성 config>)
 *   → reporter NDJSON → pw-event-mapper → RunReporter.publish()  (+ step_results INSERT, total_steps UPDATE)
 *   → 프로세스 종료 대기 (취소·하드 타임아웃 감시)
 *   → 증적 수집(outputDir 훑기) + artifacts 행 + artifact.ready    ← ★ run.finished 보다 먼저
 *   → runs 최종 status 확정 + run.finished
 *   → 작업공간 삭제 (항상)
 * ```
 *
 * ## ★ 라이브 스트리밍 (Gen-Phase 4 Task 4.4) — 경로 D
 * ```
 * findFreeCdpPort() → use.launchOptions.args 에 --remote-debugging-port=<p> 덧붙이기
 *   → spawn 직후 startCodeBrowser() (백그라운드 폴링)
 *   → connectOverCDP → watchBrowserPages → startScreencast → LiveStreamSession
 *   → 뷰어는 같은 WS 서버의 /live/:runId 로 붙는다 (record/ws-server.ts)
 * ```
 * ★★ **스트림은 실행의 전제가 아니다.** CDP 부착이 실패해도(포트 선점·worker 재시작 후
 *    재바인딩 실패) 실행은 그대로 끝까지 간다. 그 원칙을 코드로 보장하는 지점이 세 곳이다 —
 *      ① 포트 할당 실패 → `cdpPort = null` 로 그냥 진행한다.
 *      ② `startCodeBrowser()` 는 **동기 반환**이고 `await` 하지 않는다(최대 30초 폴링을 기다리지 않는다).
 *      ③ supervisor 의 예외는 그 안에서 삼켜 뷰어에게만 `{t:"error"}` 로 알린다.
 *    실패는 `{t:"error"}` 로 뷰어에만 알리고 `run.finished` 는 정상적으로 발행된다.
 *
 * ## ★ 실행 환경 오류(`error`) ↔ 시나리오 실패(`failed`) 구분 — 04-gen-6 결정 6번
 * | 상황 | status |
 * |---|---|
 * | 단정문 실패 · 테스트 타임아웃 | `failed` / `timeout` |
 * | `scenario_codes` 행이 없음 · spawn 실패 · CLI 부재 | `error` |
 * | `ERR_MODULE_NOT_FOUND`(import 검증을 우회해 들어온 코드) | **`error`** ← `failed` 가 아니다 |
 * | 지원하지 않는 사용자 config (게이트 G1) | `error` |
 * | 사용자 취소 · 하드 타임아웃 | `cancelled` / `timeout` |
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { ChildProcess } from "node:child_process";
import { DEFAULT_VIEWPORT, collectSecretValues } from "@testflow/contracts";
import type { RunJobData, RunStatus } from "@testflow/contracts";
import type { Redis } from "ioredis";
import type { DataSource } from "typeorm";
import { collectPlaywrightArtifacts } from "./code-artifacts.js";
import { findFreeCdpPort, startCodeBrowser } from "./code-browser.js";
import type { CodeBrowserAttachment } from "./code-browser.js";
import {
  CONTAINER_HOST_ALIAS,
  CONTAINER_PW_CONFIG_MODULE,
  CONTAINER_PW_REPORTER_MODULE,
  runnerDistDir,
  spawnCodeContainer,
} from "./code-container.js";
import type { CodeContainerHandle } from "./code-container.js";
import { PW_CONFIG_FILENAME, extractUnsupportedConfigMessage } from "./pw-config.js";
import type { LiveStreamRegistry, LiveStreamSession } from "./live-stream.js";
import type { CodeWorkspace } from "./code-workspace.js";
import {
  ARTIFACT_SETTLE_MS,
  buildPwEnv,
  buildVariableEnv,
  createCodeWorkspace,
  pwCliPath,
  pwReporterModulePath,
} from "./code-workspace.js";
import {
  PwEventMapper,
  isEnvironmentErrorMessage,
  parseReporterNdjson,
  stripAnsi,
} from "./pw-event-mapper.js";
import type { MappedAction } from "./pw-event-mapper.js";
import { RunReporter } from "./reporter.js";
import type { RunAbortHandle, ExecuteRunResult } from "./executor.js";
import type { RunnerConfig } from "../env.js";

/** `playwright test` 프로세스에 SIGTERM 을 준 뒤 SIGKILL 까지 기다리는 시간. */
const KILL_GRACE_MS = 5_000;

/** spawn 실패·CLI 부재 등을 사용자에게 설명하는 문구. */
const MSG = {
  noCode:
    "코드 본문이 없습니다. 시나리오에 코드를 저장한 뒤 다시 실행해 주세요. (실행 환경 오류 — 시나리오 실패가 아닙니다)",
  spawnFailed: "테스트 실행 프로세스를 시작할 수 없습니다.",
  noRunEnd:
    "테스트 실행이 결과를 보고하지 못하고 종료되었습니다. 코드의 import 구문과 문법을 확인해 주세요.",
  cancelled: "사용자 요청으로 실행이 취소되었습니다.",
} as const;

interface EventSink {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * reporter 가 POST 하는 NDJSON 을 받는 HTTP 서버.
 *
 * ★ 포트는 **0(빈 포트 자동 할당)** 이다. 동시 실행 2건이 포트를 다투지 않게 하려면
 *   고정 포트를 쓸 수 없다(PoC 는 host 포트에서 파생시켜 충돌했다).
 *
 * ★ 바인딩 주소는 격리 모드에 따라 갈린다 — **실측으로 확인된 제약**(게이트 G2 ③):
 *   - `local`  : `127.0.0.1` (기본. 외부에 열지 않는다)
 *   - `docker` : **`0.0.0.0`** — 컨테이너가 `host.docker.internal` 로 닿아야 한다.
 *     `127.0.0.1` 로 두면 컨테이너에서 연결이 거부되고 **진행 이벤트가 0건**이 된다
 *     (화면에 스텝이 하나도 안 뜬다). 그만큼 로컬 노출면이 늘어나는 것이 docker 모드의
 *     대가 중 하나다 — 이 서버는 **실행 1건 동안만** 살아 있고 NDJSON 만 받는다.
 */
async function startEventSink(
  onEvents: (chunk: string) => void,
  options: { bindHost: string; urlHost: string },
): Promise<EventSink> {
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      onEvents(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(204).end();
    });
    req.on("error", () => res.writeHead(400).end());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, options.bindHost, () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://${options.urlHost}:${String(port)}/events`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** `scenario_codes` 에서 본문을 읽는다. 큐 페이로드에는 본문이 없다(04-gen-2 §4.1). */
async function loadScenarioCode(
  dataSource: DataSource,
  scenarioId: string,
): Promise<{ filename: string; content: string } | null> {
  const rows = (await dataSource.query(
    `SELECT filename, content FROM scenario_codes WHERE scenario_id = ? LIMIT 1`,
    [scenarioId],
  )) as { filename: string; content: string }[];
  const row = rows[0];
  return row === undefined ? null : { filename: row.filename, content: row.content };
}

export async function executeCodeRun(params: {
  job: RunJobData;
  config: RunnerConfig;
  dataSource: DataSource;
  redis: Redis;
  abort: RunAbortHandle;
  log: (message: string) => void;
  liveStreams?: LiveStreamRegistry;
}): Promise<ExecuteRunResult> {
  const { job, config, dataSource, redis, abort, log } = params;
  const liveStreams = params.liveStreams ?? null;

  // ★ 평문 비밀번호가 존재하는 유일한 장소에서 마스킹 대상 "값"을 뽑는다.
  //   reporter 안에 갇혀 DB·SSE 로 나가는 모든 문자열에 적용된다.
  const secretValues = collectSecretValues(job.variables, job.secretKeys);
  const reporter = new RunReporter(redis, dataSource, job.runId, config.runnerId, secretValues);

  const code = job.scenarioId === null ? null : await loadScenarioCode(dataSource, job.scenarioId);
  if (code === null) {
    // 실행 환경 오류다. `runStarted()` 를 부르지 않고 바로 접는다 — `running` 을 거치면
    // 화면에 "실행 중"이 한 번 떠 사용자가 원인을 오해한다.
    await reporter.runFinished({
      status: "error",
      startedAt: null,
      passedSteps: 0,
      totalSteps: 0,
      failedSeq: null,
      errorMessage: MSG.noCode,
    });
    log(`run ${job.runId} 코드 본문 없음 — error 확정`);
    return {
      status: "error",
      passedSteps: 0,
      totalSteps: 0,
      failedSeq: null,
      errorMessage: MSG.noCode,
      artifactCount: 0,
    };
  }

  const startedAt = await reporter.runStarted();
  log(`run ${job.runId} 시작 (코드) — ${code.filename} ${String(code.content.length)}자`);

  /* ── 라이브 스트림 준비 (경로 D) ─────────────────────────────
   * 세션을 **실행 시작과 함께** 연다. 뷰어는 `GET /api/runs/:id/live` 로 토큰을 받아
   * `/live/:runId` 로 붙는데, 세션이 없으면 4404 다 — 실행 중에만 붙을 수 있다.
   *
   * ★ 포트 할당이 실패해도 `cdpPort = null` 로 그냥 진행한다. CDP 포트가 없으면
   *   `mergePlaywrightConfig()` 가 `--remote-debugging-port` 를 넣지 않고, 실행은
   *   Gen-Phase 3 와 **완전히 동일**하게 돈다(라이브 화면만 없다).
   * ──────────────────────────────────────────────────────────── */
  /**
   * ★ 격리 모드 — **코드 실행 전용**이다(`RUNNER_CODE_EXECUTION_MODE`, 기본 `docker`).
   *   녹화 경로와 기존 `steps` 실행의 `RUNNER_EXECUTION_MODE` 는 건드리지 않는다(쟁점 4).
   */
  const isolated = config.codeExecutionMode === "docker";

  const live: LiveStreamSession | null = liveStreams === null ? null : liveStreams.open(job.runId);
  let cdpPort: number | null = null;
  if (live !== null && config.codeCdpPort > 0) {
    // 고정 포트(`RUNNER_CODE_CDP_PORT`). 동시 실행이 있으면 두 번째가 붙지 못한다 —
    // 그것이 이 설정의 알려진 대가다(env.ts 주석).
    cdpPort = config.codeCdpPort;
  } else if (live !== null) {
    cdpPort = await findFreeCdpPort().then(
      (port) => port,
      (error: unknown) => {
        log(
          `  [live] CDP 포트 할당 실패 — 라이브 없이 실행한다: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      },
    );
  }
  /**
   * ★ `docker` 격리에서는 CDP 포트가 **두 개**다 (게이트 G2 ②).
   *   - `cdpPort`   : **컨테이너 안** 포트. Chromium 이 `127.0.0.1` 에 bind 한다.
   *   - `relayPort` : 호스트로 퍼블리시되는 포트. `connectOverCDP` 는 **이쪽**에 붙는다.
   *   중계가 필요한 이유는 `pw-container-boot.ts` 주석에 실측과 함께 있다
   *   (Chromium DevTools 가 루프백 peer 만 받는다).
   *   `local` 에서는 둘이 **같은 포트**다(중계가 없다).
   */
  let attachPort: number | null = cdpPort;
  if (isolated && live !== null && cdpPort !== null) {
    attachPort = await findFreeCdpPort().then(
      (port) => port,
      () => null,
    );
  }
  let attachment: CodeBrowserAttachment | null = null;
  let container: CodeContainerHandle | null = null;

  const mapper = new PwEventMapper();
  const stepStartedAt = new Map<number, Date>();
  let passedSteps = 0;
  let failedSeq: number | null = null;
  let firstStepError: string | null = null;
  let pwStatus: RunStatus | null = null;
  let envErrorMessage: string | null = null;
  let lastTotalStepsWritten = 0;

  /**
   * 이벤트 처리는 **직렬**이어야 한다. `RunReporter.publish()` 가 `INCR seq` 로 순서를 부여하므로
   * 병렬로 들어가면 `step.started` 가 `step.finished` 보다 큰 seq 를 받을 수 있다.
   */
  let chain: Promise<void> = Promise.resolve();
  const apply = async (action: MappedAction): Promise<void> => {
    switch (action.kind) {
      case "run-begin":
        log(`  playwright 기동 — 테스트 ${String(action.totalTests)}개 / worker ${String(action.workers)}`);
        break;

      case "step-started": {
        const at = new Date(action.atMs);
        stepStartedAt.set(action.sequence, at);
        await reporter.codeStepStarted({
          sequence: action.sequence,
          name: action.name,
          actionType: action.actionType,
          totalSteps: action.totalSteps,
          startedAt: at,
        });
        // ★ `runs.total_steps` 를 실행 중에 늘린다(쟁점 2).
        if (action.totalSteps > lastTotalStepsWritten) {
          lastTotalStepsWritten = action.totalSteps;
          await reporter.updateTotalSteps(action.totalSteps);
        }
        break;
      }

      case "step-finished": {
        const at = stepStartedAt.get(action.sequence) ?? new Date(action.startedAtMs);
        if (action.status === "passed") passedSteps += 1;
        if (action.status === "failed" && failedSeq === null) {
          failedSeq = action.sequence;
          firstStepError = action.errorMessage;
        }
        await reporter.codeStepFinished({
          sequence: action.sequence,
          name: action.name,
          actionType: action.actionType,
          status: action.status,
          startedAt: at,
          durationMs: action.durationMs,
          errorMessage: action.errorMessage,
        });
        break;
      }

      case "run-error":
        // ★ 로그에도 마스킹을 거친다 — Playwright 에러 메시지에 입력값이 실려 온다.
        log(`  playwright onError: ${reporter.mask(action.message).split("\n")[0] ?? ""}`);
        if (action.environmental && envErrorMessage === null) envErrorMessage = action.message;
        break;

      case "run-end":
        pwStatus = action.status;
        break;
    }
  };

  const sink = await startEventSink(
    (chunk) => {
      for (const event of parseReporterNdjson(chunk)) {
        const action = mapper.accept(event);
        if (action === null) continue;
        chain = chain.then(() => apply(action)).catch((error: unknown) => {
          log(`  이벤트 처리 실패: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    },
    isolated
      ? { bindHost: "0.0.0.0", urlHost: CONTAINER_HOST_ALIAS }
      : { bindHost: "127.0.0.1", urlHost: "127.0.0.1" },
  );

  // 초기값을 두지 않는다 — 아래 분기가 **모든 경로에서** 확정하므로(try 의 if/else 사슬 +
  // catch) 초기값은 "혹시 빠뜨렸을 때 조용히 passed 가 되는" 위험만 남긴다.
  let status: RunStatus;
  let errorMessage: string | null = null;
  let artifactCount = 0;
  let stderrTail = "";

  /**
   * ★ 작업공간 생성을 **`try` 안에서** 한다.
   *
   * 여기서 던질 수 있는 것이 있다 — `assertSafeSpecFilename()` 이다(DB 에 직접 INSERT 된
   * `../` 파일명을 막는 3중 방어의 마지막 겹). 이걸 `try` 밖에서 만들면 방어는 성공하지만
   * **예외가 `executeCodeRun` 밖으로 나가 `run.finished` 가 발행되지 않고 run 이 영영
   * `running` 에 남는다.** 실측으로 그 상태를 봤다 — 방어가 동작한 대가로 실행이 좌초하면
   * 방어가 아니라 새 장애다.
   */
  let workspace: CodeWorkspace | null = null;

  try {
    workspace = await createCodeWorkspace({
      runId: job.runId,
      filename: code.filename,
      content: code.content,
      // ★ docker 에서는 bind mount 가능한 경로여야 하고, `node_modules` 링크를 만들지 않으며
      //   (이미지가 `/node_modules` 로 제공한다), config 는 **컨테이너 안 경로**를 import 한다.
      root: config.codeWorkspaceRoot,
      ...(isolated
        ? { skipNodeModulesLink: true, configModulePath: CONTAINER_PW_CONFIG_MODULE }
        : {}),
    });
    const ws = workspace;

    const env: Record<string, string> = {
      ...buildPwEnv({
        reporterPath: isolated ? CONTAINER_PW_REPORTER_MODULE : pwReporterModulePath(),
        eventsUrl: sink.url,
        // ★ 사용자 config 에 baseURL 이 없으면 이 값이 `use.baseURL` 이 된다 —
        //   그래야 화면의 환경 선택(`runs.base_url`)이 코드 실행에 실제로 반영된다.
        baseUrl: job.baseUrl,
        headless: config.headless,
        viewport: { width: DEFAULT_VIEWPORT.w, height: DEFAULT_VIEWPORT.h },
        // 이번 범위에는 사용자 config 저장 경로가 없다. 병합 경로는 만들어 뒀다(Task 3.1).
        userConfigPath: null,
        // ★ CDP_ATTACH_POINT — 경로 D. 값이 있으면 `mergePlaywrightConfig()` 가
        //   `use.launchOptions.args` 에 `--remote-debugging-port=<p>` 를 **덧붙인다**.
        //   `null` 이면 Gen-Phase 3 와 동일하게(라이브 없이) 실행된다.
        cdpPort,
      }),
      // 환경 라벨은 사용자 코드가 분기에 쓸 수 있게 넘긴다(baseUrl 은 buildPwEnv 가 넣는다).
      TESTFLOW_ENV_LABEL: job.envLabel,
      // Playwright 의 자체 색상·진행표시를 끈다(로그가 ANSI 로 더러워진다).
      FORCE_COLOR: "0",
      CI: "1",
    };

    /**
     * ★ `variables` 평문. 사용자 코드가 `process.env["TESTFLOW_VAR_<KEY>"]` 로 읽는다.
     *
     * 전달 방법이 모드마다 다르고, **그 차이가 게이트 G2 의 핵심**이다:
     *  - `local`  : 자식 프로세스 env (호스트 안이므로 노출면이 안 늘어난다)
     *  - `docker` : **stdin 한 줄(JSON)**. `-e` 로 주면 `docker inspect` **전문에 평문이
     *    그대로 나온다**(실측 확인). stdin 으로 주면 `docker inspect` grep **0건**이고
     *    사용자 계약(`process.env`)은 그대로다 — `pw-container-boot.ts` 가 자식 env 에만 심는다.
     */
    const variableEnv = buildVariableEnv(job.variables);

    let child: ChildProcess;
    if (isolated) {
      // 이미지·docker 가 없으면 **여기서 던진다.** local 로 조용히 내려가지 않는다
      // (격리됐다고 믿게 만드는 것이 격리가 없는 것보다 나쁘다 — `code-container.ts` 주석).
      container = await spawnCodeContainer(config, {
        runId: job.runId,
        workspaceDir: ws.dir,
        distDir: runnerDistDir(),
        configFilename: PW_CONFIG_FILENAME,
        cdpPort: cdpPort ?? 0,
        relayPort: attachPort ?? 0,
        env,
        secretEnv: variableEnv,
      });
      child = container.child;
      log(
        `  [격리] docker — 컨테이너 ${container.containerName} · 이미지 ${config.codeDockerImage} ` +
          `· 작업공간 ${ws.dir} → /ws` +
          (attachPort === null ? "" : ` · CDP 중계 127.0.0.1:${String(attachPort)} → 컨테이너 ${String(cdpPort)}`),
      );
    } else {
      log("  [격리] local — ★ 붙여넣은 코드가 Runner 호스트에서 그대로 실행된다");
      child = spawn(process.execPath, [pwCliPath(), "test", "--config", ws.configPath], {
        cwd: ws.dir,
        env: { ...process.env, ...env, ...variableEnv },
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    /* ★ 스트림 부착 — spawn **직후**, `await exit` **앞**이다.
     *
     * `startCodeBrowser()` 는 동기로 반환하고 CDP 폴링은 백그라운드에서 돈다.
     * 여기서 `await` 하면 포트가 열릴 때까지(최대 30초) 실행이 아니라 **우리가** 멈춘다.
     * 정리는 `finally` 의 `attachment.stop()` 이다(04-gen-3 전달사항 ②).
     *
     * ★ 붙는 포트는 `attachPort` 다 — docker 에서는 중계 포트, local 에서는 CDP 포트 그 자체. */
    if (live !== null && attachPort !== null) {
      attachment = startCodeBrowser({ cdpPort: attachPort, session: live, log });
    }

    // ★ 취소·하드 타임아웃이 오면 프로세스를 끊는다. Playwright 는 SIGTERM 에
    //   `FullResult.status = "interrupted"` 를 보고하고 종료한다 → `cancelled` 로 매핑된다.
    //   docker 에서는 `docker kill -s TERM` 이 그 신호를 컨테이너 PID 1 로 보낸다 —
    //   docker **클라이언트**에 SIGTERM 을 줘도 컨테이너 안의 테스트는 멈추지 않는다.
    let killTimer: NodeJS.Timeout | null = null;
    abort.onAbort((reason) => {
      log(`  실행 중단 신호(${reason}) — ${isolated ? "컨테이너" : "playwright 프로세스"} 종료`);
      if (container !== null) {
        const handle = container;
        void handle.terminate();
        killTimer = setTimeout(() => void handle.forceKill(), KILL_GRACE_MS);
      } else {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      }
      killTimer.unref();
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // 사용자 테스트의 stdout 이다(우리 이벤트는 HTTP 로 온다). 마스킹해서 흘린다.
      for (const line of text.split("\n")) {
        if (line.trim() !== "") log(`  [pw] ${reporter.mask(stripAnsi(line)).slice(0, 500)}`);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = `${stderrTail}${text}`.slice(-8_000);
    });

    const exit = await new Promise<{ code: number | null; spawnError: Error | null }>((resolve) => {
      child.once("error", (error: Error) => resolve({ code: null, spawnError: error }));
      child.once("close", (code) => resolve({ code, spawnError: null }));
    });
    if (killTimer !== null) clearTimeout(killTimer);

    // 마지막 이벤트까지 처리가 끝나야 결과 집계가 맞는다.
    await sink.close();
    await chain;

    // ★ 파일 쓰기가 가라앉기를 기다린다. `close` 는 stdio 종료일 뿐 쓰기 완료가 아니다
    //   (사유·실측은 `ARTIFACT_SETTLE_MS` 주석).
    await delay(ARTIFACT_SETTLE_MS);

    /* ── 최종 status 확정 ─────────────────────────────── */

    if (exit.spawnError !== null) {
      status = "error";
      errorMessage = `${MSG.spawnFailed} ${exit.spawnError.message}`;
    } else if (abort.aborted) {
      // 중단이 먼저다 — Playwright 가 무엇을 보고했든 사용자가 멈춘 실행이다.
      status = abort.abortReason === "timeout" ? "timeout" : "cancelled";
      errorMessage =
        status === "timeout"
          ? `실행 하드 타임아웃(${String(config.runTimeoutMs)}ms)을 초과했습니다.`
          : MSG.cancelled;
      await reporter.skipRunningSteps();
    } else if (envErrorMessage !== null) {
      // ★ `failed` 가 아니다 — 모듈을 못 찾은 것은 실행 환경 오류다(04-gen-6 결정 6번).
      status = "error";
      errorMessage = envErrorMessage;
      await reporter.skipRunningSteps();
    } else if (pwStatus === null) {
      // reporter 가 `run.end` 를 못 보냈다 = config 로드 실패·프로세스 조기 사망.
      status = "error";
      // ★ 우리가 스스로 거부한 경우(게이트 G1)라면 **그 메시지를 그대로** 보여 준다.
      //   일반 안내("import 구문을 확인하세요")를 덧붙이면 틀린 방향을 알려 주는 셈이다.
      const rejected = extractUnsupportedConfigMessage(stderrTail);
      if (rejected !== null) {
        errorMessage = rejected;
      } else {
        const detail = firstNonEmptyLine(stderrTail);
        errorMessage = detail === null ? MSG.noRunEnd : `${MSG.noRunEnd} (${detail})`;
        if (detail !== null && isEnvironmentErrorMessage(detail)) errorMessage = detail;
      }
      await reporter.skipRunningSteps();
    } else {
      status = pwStatus;
      if (status === "failed") {
        errorMessage = firstStepError ?? firstNonEmptyLine(stderrTail) ?? "테스트가 실패했습니다.";
      } else if (status === "timeout") {
        errorMessage = "테스트가 Playwright 타임아웃을 초과했습니다.";
      } else if (status === "cancelled") {
        errorMessage = MSG.cancelled;
        await reporter.skipRunningSteps();
      }
    }

    /* ── 증적 — ★ run.finished 보다 먼저 ─────────────── */
    const artifacts = await collectPlaywrightArtifacts({
      runId: job.runId,
      outputDir: ws.outputDir,
      artifactRoot: config.artifactRoot,
      reporter,
      log,
    });
    artifactCount = artifacts.published;
  } catch (error) {
    status = "error";
    errorMessage = error instanceof Error ? error.message : String(error);
    // ★ 로그로 나가는 값도 마스킹한다(마스킹 3경로 중 ② 서버 로그).
    log(`run ${job.runId} 실행 환경 오류: ${reporter.mask(errorMessage)}`);
    // 실행 중인 스텝이 있었다면 `failed` 가 아니라 `skipped` 로 접는다.
    await reporter.skipRunningSteps().catch(() => undefined);
  } finally {
    // ★ 어떤 경로로 끝나도 정리한다(성공·실패·취소·타임아웃·예외).
    //   이벤트 싱크(HTTP 서버)를 닫지 않으면 run 마다 포트가 하나씩 남는다.
    //   스트림 정리는 **증적 수집이 끝난 뒤**다 — `ARTIFACT_SETTLE_MS` 와 같은 이유로
    //   브라우저가 살아 있는 동안은 프레임이 흐르는 것이 맞다(04-gen-3 전달사항 ③).
    await attachment?.stop().catch(() => undefined);
    await sink.close().catch(() => undefined);
    const dir = workspace?.dir ?? "?";
    await workspace?.dispose().catch((error: unknown) => {
      log(`작업공간 정리 실패 — ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  const totalSteps = mapper.totalSteps;

  /* ── ★ 스트림 종료 — 캔버스를 비우지 않는다 ────────────────────
   * `{t:"state", state:"ended", runStatus}` 를 보내고 **마지막 프레임을 남긴 채**
   * `LIVE_STREAM_ENDED_LINGER_MS` 뒤에 **정상 종료(close 1000)** 한다.
   * `close(runId)` 는 레지스트리에서만 내리고 그 linger 를 건드리지 않는다
   * (`LiveStreamSession.dispose()` 주석). 캔버스가 검게 죽는 것을 막는 지점이다(쟁점 3).
   * ──────────────────────────────────────────────────────────── */
  if (live !== null) {
    const streamStats = attachment?.stats() ?? null;
    live.end(status);
    liveStreams?.close(job.runId);
    if (streamStats !== null) {
      log(
        `  [live] 스트림 종료 — pagesAttached=${String(streamStats.pagesAttached)} ` +
          `rebinds=${String(streamStats.rebinds)} rebindFail=${String(streamStats.rebindFailures)} ` +
          `frames ${String(streamStats.framesPassed)}/${String(streamStats.framesProduced)} ` +
          `(스로틀 드롭 ${String(streamStats.framesThrottled)}) ` +
          `bytes=${String(streamStats.bytesProduced)} err=${streamStats.lastError ?? "none"}`,
      );
    }
  }

  await reporter.runFinished({
    status,
    startedAt,
    passedSteps,
    totalSteps,
    failedSeq,
    errorMessage,
  });

  log(
    `run ${job.runId} 종료 — ${status} (${String(passedSteps)}/${String(totalSteps)}), ` +
      `증적 ${String(artifactCount)}건, 필터로 제외한 내부 스텝 ${String(mapper.filteredStepCount)}건`,
  );

  return {
    status,
    passedSteps,
    totalSteps,
    failedSeq,
    errorMessage: errorMessage === null ? null : reporter.mask(errorMessage),
    artifactCount,
  };
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of stripAnsi(text).split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed.slice(0, 1_000);
  }
  return null;
}
