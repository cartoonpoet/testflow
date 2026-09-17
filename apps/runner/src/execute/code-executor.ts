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
 * ## ★ 라이브 스트리밍은 여기에 없다 (Gen-Phase 4)
 * `connectOverCDP` · screencast · `/live/:runId` 는 **의도적으로 붙이지 않았다.** 스트림 없이
 * "코드가 실행되고 결과가 DB·SSE 에 남는다"가 먼저 성립해야, 라이브를 붙였을 때 무엇이 깨졌는지
 * 구분된다(03-phases 진행 전략). 붙일 지점은 `CDP_ATTACH_POINT` 주석이 표시한다.
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
import { extractUnsupportedConfigMessage } from "./pw-config.js";
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
 * reporter 가 POST 하는 NDJSON 을 받는 loopback HTTP 서버.
 *
 * ★ **127.0.0.1 에만 바인딩하고 포트는 0(빈 포트 자동 할당)** 이다. 동시 실행 2건이
 *   포트를 다투지 않게 하려면 고정 포트를 쓸 수 없다(PoC 는 host 포트에서 파생시켰다).
 */
async function startEventSink(onEvents: (chunk: string) => void): Promise<EventSink> {
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
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}/events`,
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
}): Promise<ExecuteRunResult> {
  const { job, config, dataSource, redis, abort, log } = params;

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

  const sink = await startEventSink((chunk) => {
    for (const event of parseReporterNdjson(chunk)) {
      const action = mapper.accept(event);
      if (action === null) continue;
      chain = chain.then(() => apply(action)).catch((error: unknown) => {
        log(`  이벤트 처리 실패: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  });

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
    });
    const ws = workspace;

    const env: Record<string, string> = {
      ...buildPwEnv({
        reporterPath: pwReporterModulePath(),
        eventsUrl: sink.url,
        // ★ 사용자 config 에 baseURL 이 없으면 이 값이 `use.baseURL` 이 된다 —
        //   그래야 화면의 환경 선택(`runs.base_url`)이 코드 실행에 실제로 반영된다.
        baseUrl: job.baseUrl,
        headless: config.headless,
        viewport: { width: DEFAULT_VIEWPORT.w, height: DEFAULT_VIEWPORT.h },
        // 이번 범위에는 사용자 config 저장 경로가 없다. 병합 경로는 만들어 뒀다(Task 3.1).
        userConfigPath: null,
        // ★ CDP_ATTACH_POINT — Gen-Phase 4 가 여기에 빈 포트를 넣으면 경로 D 가 켜진다.
        //   그 다음 `connectOverCDP` + `startScreencast` 를 붙인다(code-browser.ts).
        cdpPort: null,
      }),
      // 사용자 코드가 `process.env["TESTFLOW_VAR_<KEY>"]` 로 읽는다.
      ...buildVariableEnv(job.variables),
      // 환경 라벨은 사용자 코드가 분기에 쓸 수 있게 넘긴다(baseUrl 은 buildPwEnv 가 넣는다).
      TESTFLOW_ENV_LABEL: job.envLabel,
      // Playwright 의 자체 색상·진행표시를 끈다(로그가 ANSI 로 더러워진다).
      FORCE_COLOR: "0",
      CI: "1",
    };

    const child: ChildProcess = spawn(
      process.execPath,
      [pwCliPath(), "test", "--config", ws.configPath],
      {
        cwd: ws.dir,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // ★ 취소·하드 타임아웃이 오면 프로세스를 끊는다. Playwright 는 SIGTERM 에
    //   `FullResult.status = "interrupted"` 를 보고하고 종료한다 → `cancelled` 로 매핑된다.
    let killTimer: NodeJS.Timeout | null = null;
    abort.onAbort((reason) => {
      log(`  실행 중단 신호(${reason}) — playwright 프로세스 종료`);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
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
    await sink.close().catch(() => undefined);
    const dir = workspace?.dir ?? "?";
    await workspace?.dispose().catch((error: unknown) => {
      log(`작업공간 정리 실패 — ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  const totalSteps = mapper.totalSteps;
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
