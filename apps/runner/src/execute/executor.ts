import { DEFAULT_VIEWPORT, TestStepSchema, collectSecretValues } from "@testflow/contracts";
import type { RunJobData, RunStatus, TestStep } from "@testflow/contracts";
import type { Page } from "playwright";
import type { Redis } from "ioredis";
import type { DataSource } from "typeorm";
import { TestStepEntity } from "@testflow/db";
import { ArtifactCollector, startTracing, stopTracing } from "./artifacts.js";
import { executeCodeRun } from "./code-executor.js";
import { openBrowserSession } from "./browser.js";
import type { BrowserSession } from "./browser.js";
import { executeStep } from "./interpreter.js";
import type { LiveStreamRegistry } from "./live-stream.js";
import { RunReporter } from "./reporter.js";
import type { RunnerConfig } from "../env.js";

/**
 * run 1건의 실행 오케스트레이션.
 *
 * 순서가 전부다 —
 * ```
 * 스텝 로드 → step_results 를 pending 으로 시딩 → runs.status=running
 *   → 브라우저 기동(고유 임시 프로필) → tracing 시작
 *   → 스텝 루프 (취소·타임아웃 감시)
 *   → [실패면 그 자리에서 스크린샷]
 *   → tracing 중지 → context.close() (★ 영상은 여기서 확정된다)
 *   → 증적 저장 + artifacts 행 + artifact.ready
 *   → runs 최종 status 확정 + run.finished
 * ```
 */

export interface ExecuteRunResult {
  status: RunStatus;
  passedSteps: number;
  totalSteps: number;
  failedSeq: number | null;
  errorMessage: string | null;
  artifactCount: number;
}

/**
 * 취소/타임아웃 신호를 실행 루프에 전달하는 손잡이.
 *
 * ★ 취소는 "다음 스텝 경계에서 멈춘다"가 기본이고, 스텝 하나가 타임아웃(최대 30초)을
 *   통째로 쓰는 동안 매달리지 않도록 **브라우저를 즉시 끊는** 경로를 따로 둔다
 *   (`onAbort` 에 세션 kill 을 걸어 둔다). 그래야 진행 중인 Playwright 호출이 바로 던진다.
 */
export class RunAbortHandle {
  private reason: "cancelled" | "timeout" | null = null;
  private listener: ((reason: "cancelled" | "timeout") => void) | null = null;

  abort(reason: "cancelled" | "timeout"): void {
    // 먼저 온 사유가 이긴다. 타임아웃 직후 도착한 취소가 사유를 바꾸면 이력이 헷갈린다.
    if (this.reason !== null) return;
    this.reason = reason;
    this.listener?.(reason);
  }

  onAbort(listener: (reason: "cancelled" | "timeout") => void): void {
    this.listener = listener;
    if (this.reason !== null) listener(this.reason);
  }

  get aborted(): boolean {
    return this.reason !== null;
  }

  get abortReason(): "cancelled" | "timeout" | null {
    return this.reason;
  }
}

/** DB 에서 스텝을 읽어 계약(`TestStepSchema`)으로 검증한다. */
export async function loadSteps(dataSource: DataSource, scenarioId: string): Promise<TestStep[]> {
  const rows = await dataSource.getRepository(TestStepEntity).find({
    where: { scenarioId },
    order: { sequence: "ASC" },
  });

  return rows.map((row) =>
    TestStepSchema.parse({
      id: row.id,
      scenarioId: row.scenarioId,
      sequence: row.sequence,
      name: row.name,
      actionType: row.actionType,
      target: row.targetJson,
      input: row.inputJson,
      // options 가 NULL 이면 zod 기본값(timeoutMs 10000 / optional false)이 채워진다.
      ...(row.optionsJson === null ? {} : { options: row.optionsJson }),
    }),
  );
}

export async function executeRun(params: {
  job: RunJobData;
  config: RunnerConfig;
  dataSource: DataSource;
  redis: Redis;
  abort: RunAbortHandle;
  log: (message: string) => void;
  /**
   * 실행 라이브 스트림 레지스트리(라운드 2 Task 4.4). **코드 경로만 쓴다** —
   * 녹화 기반 실행(`steps`)은 우리가 page 를 소유하지만 라이브 뷰 요구가 없었고,
   * 붙이면 라운드 1 경로에 손을 대게 된다. 없으면 스트림 없이 실행한다.
   */
  liveStreams?: LiveStreamRegistry;
}): Promise<ExecuteRunResult> {
  // ★ 실행 엔진 분기 (03-phases Task 3.7). **아래 녹화 경로는 한 줄도 바뀌지 않았다** —
  //   두 엔진이 공존하고, 분기만 앞에 붙는다. 공유하는 것은 `RunReporter`(= SSE/DB 규약),
  //   `storage/`, 취소 채널, heartbeat 다. 다른 것은 쟁점 2에 정리돼 있다.
  //   `sourceType` 은 API 가 큐 페이로드에 실어 준다(04-gen-2 §4).
  if (params.job.sourceType === "code") {
    return executeCodeRun(params);
  }

  const { job, config, dataSource, redis, abort, log } = params;

  // ★ 평문 비밀번호가 존재하는 유일한 장소에서 마스킹 대상 "값"을 뽑는다.
  //   이 배열은 reporter 안에 갇혀 DB·이벤트로 나가는 모든 문자열에 적용된다.
  const secretValues = collectSecretValues(job.variables, job.secretKeys);
  const reporter = new RunReporter(redis, dataSource, job.runId, config.runnerId, secretValues);

  const steps = job.scenarioId === null ? [] : await loadSteps(dataSource, job.scenarioId);
  await reporter.seedStepResults(steps);

  const startedAt = await reporter.runStarted();
  log(`run ${job.runId} 시작 — 스텝 ${String(steps.length)}개 / ${job.baseUrl}`);

  const collector = await ArtifactCollector.create({
    runId: job.runId,
    artifactRoot: config.artifactRoot,
    reporter,
    keepOnSuccess: config.keepArtifactsOnSuccess,
  });

  let session: BrowserSession | null = null;
  let passedSteps = 0;
  let failedSeq: number | null = null;
  let errorMessage: string | null = null;
  let status: RunStatus = "passed";
  let traceSaved = false;

  try {
    // 실행 격리는 모드에 따라 갈린다(`browser.ts`): local = 고유 임시 프로필,
    // docker = 실행 1건당 컨테이너 1개(`--memory`/`--cpus`).
    session = await openBrowserSession({
      runId: job.runId,
      config,
      headless: config.headless,
      videoDir: collector.videoOptions({ width: DEFAULT_VIEWPORT.w, height: DEFAULT_VIEWPORT.h }).dir,
    });
    const opened = session;
    // ★ 취소/타임아웃이 오면 스텝이 끝나기를 기다리지 않고 브라우저를 끊는다.
    //   그래야 진행 중인 Playwright 호출이 즉시 던지고 루프가 빠져나온다.
    abort.onAbort(() => {
      void opened.kill();
    });

    const context = session.context;
    traceSaved = await startTracing(context);

    const page: Page = context.pages()[0] ?? (await context.newPage());
    collector.attach(page);
    context.on("page", (openedPage: Page) => {
      collector.attach(openedPage);
    });

    for (const step of steps) {
      if (abort.aborted) {
        status = abort.abortReason === "timeout" ? "timeout" : "cancelled";
        errorMessage =
          status === "timeout"
            ? `실행 하드 타임아웃(${String(config.runTimeoutMs)}ms)을 초과했습니다.`
            : "사용자 요청으로 실행이 취소되었습니다.";
        break;
      }

      const stepStartedAt = await reporter.stepStarted(step, steps.length);
      const t0 = Date.now();
      try {
        const outcome = await executeStep(
          { page, scope: { variables: job.variables, baseUrl: job.baseUrl, envLabel: job.envLabel } },
          step,
        );
        passedSteps += 1;
        await reporter.stepFinished({
          step,
          status: "passed",
          startedAt: stepStartedAt,
          durationMs: Date.now() - t0,
        });
        log(`  #${String(step.sequence)} ${step.name} — PASS (${outcome.detail})`);
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);

        if (abort.aborted) {
          // ★ 취소/타임아웃이 브라우저를 끊어서 난 예외다. **실패로 기록하면 안 된다** —
          //   테스터가 직접 멈춘 실행이 "실패 1건"으로 통계에 잡히면 성공률이 왜곡된다.
          status = abort.abortReason === "timeout" ? "timeout" : "cancelled";
          errorMessage =
            status === "timeout"
              ? `실행 하드 타임아웃(${String(config.runTimeoutMs)}ms)을 초과했습니다.`
              : "사용자 요청으로 실행이 취소되었습니다.";
          await reporter.stepFinished({
            step,
            status: "skipped",
            startedAt: stepStartedAt,
            durationMs: Date.now() - t0,
            errorMessage,
          });
          log(`  #${String(step.sequence)} ${step.name} — ABORT(${status})`);
          break;
        }

        if (step.options.optional) {
          // `optional: true` 인 스텝은 실패해도 실행을 중단하지 않는다(계약: 상태는 `skipped`).
          await reporter.stepFinished({
            step,
            status: "skipped",
            startedAt: stepStartedAt,
            durationMs: Date.now() - t0,
            errorMessage: raw,
          });
          log(`  #${String(step.sequence)} ${step.name} — SKIP(optional)`);
          continue;
        }

        // ★ 실패한 그 자리에서 스크린샷을 찍는다. 컨텍스트를 닫은 뒤에는 화면이 없다.
        await collector.captureFailureScreenshot(page, step.sequence);
        await reporter.stepFinished({
          step,
          status: "failed",
          startedAt: stepStartedAt,
          durationMs: Date.now() - t0,
          errorMessage: raw,
        });

        failedSeq = step.sequence;
        errorMessage = raw;
        status = "failed";
        log(`  #${String(step.sequence)} ${step.name} — FAIL`);
        break;
      }
    }

    // 루프가 끝난 뒤에도 취소가 들어와 있을 수 있다(마지막 스텝 실행 중 도착).
    if (status === "passed" && abort.aborted) {
      status = abort.abortReason === "timeout" ? "timeout" : "cancelled";
      errorMessage =
        status === "timeout"
          ? `실행 하드 타임아웃(${String(config.runTimeoutMs)}ms)을 초과했습니다.`
          : "사용자 요청으로 실행이 취소되었습니다.";
    }
  } catch (error) {
    // 브라우저 기동 실패 등 스텝 바깥의 사고. `error` 상태는 "시나리오가 틀렸다"가 아니라
    // "실행 환경이 깨졌다"는 뜻이다 — 둘을 구분해야 원인 추적이 된다.
    status = "error";
    errorMessage = error instanceof Error ? error.message : String(error);
    // ★ 마스킹 3경로 중 **② 서버 로그**(03-phases Task 12.4).
    //   DB 로 가는 값은 reporter 가 마스킹하지만 **로그는 그 경로를 타지 않는다.**
    //   여기서 원문을 찍으면 `runner` 프로세스 stdout(= 배포 환경의 로그 파일)에
    //   Playwright 에러에 실린 입력값이 그대로 남는다.
    log(`run ${job.runId} 실행 환경 오류: ${reporter.mask(errorMessage)}`);
  } finally {
    if (session) {
      // 이미 kill 된 뒤(취소·타임아웃)면 trace 저장은 실패한다 — 그래도 실행은 끝나야 한다.
      if (traceSaved) traceSaved = await stopTracing(session.context, collector.tracePath);
      // ★ dispose() 안의 context.close() 로 Playwright 가 영상 파일을 최종 기록한다.
      await session.dispose().catch(() => undefined);
    }
  }

  await reporter.skipRemaining();

  const failed = status !== "passed";
  const artifactCount = await collector.finalize({ failed, traceSaved });

  await reporter.runFinished({
    status,
    startedAt,
    passedSteps,
    totalSteps: steps.length,
    failedSeq,
    errorMessage,
  });

  log(
    `run ${job.runId} 종료 — ${status} (${String(passedSteps)}/${String(steps.length)}), 증적 ${String(artifactCount)}건`,
  );

  return {
    status,
    passedSteps,
    totalSteps: steps.length,
    failedSeq,
    errorMessage: errorMessage === null ? null : reporter.mask(errorMessage),
    artifactCount,
  };
}
