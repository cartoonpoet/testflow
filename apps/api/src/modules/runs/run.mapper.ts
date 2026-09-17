import type { Run, RunListItem, RunSummary, StepResult } from "@testflow/contracts";
import type { RunEntity, StepResultEntity } from "@testflow/db";

/**
 * DB 엔티티 ↔ `@testflow/contracts` 변환. 하는 일은 **컬럼 이름 매핑과 날짜 직렬화뿐**이다
 * (타입은 contracts 에서만 정의한다 — 전 Gen-Phase 공통 규율).
 */
export function toRun(entity: RunEntity): Run {
  return {
    id: entity.id,
    runCode: entity.runCode,
    projectId: entity.projectId,
    scenarioId: entity.scenarioId,
    suiteId: entity.suiteId,
    batchId: entity.batchId,
    scenarioName: entity.scenarioName,
    envLabel: entity.envLabel,
    baseUrl: entity.baseUrl,
    browser: entity.browser,
    status: entity.status,
    runnerId: entity.runnerId,
    totalSteps: entity.totalSteps,
    passedSteps: entity.passedSteps,
    failedSeq: entity.failedSeq,
    errorMessage: entity.errorMessage,
    queuedAt: entity.queuedAt.toISOString(),
    startedAt: entity.startedAt?.toISOString() ?? null,
    finishedAt: entity.finishedAt?.toISOString() ?? null,
    durationMs: entity.durationMs,
  };
}

export function toRunListItem(entity: RunEntity): RunListItem {
  return {
    id: entity.id,
    runCode: entity.runCode,
    scenarioName: entity.scenarioName,
    browser: entity.browser,
    status: entity.status,
    durationMs: entity.durationMs,
    startedAt: entity.startedAt?.toISOString() ?? null,
  };
}

export function toStepResult(entity: StepResultEntity): StepResult {
  return {
    id: entity.id,
    runId: entity.runId,
    stepId: entity.stepId,
    sequence: entity.sequence,
    nameSnapshot: entity.nameSnapshot,
    actionType: entity.actionType,
    status: entity.status,
    startedAt: entity.startedAt?.toISOString() ?? null,
    durationMs: entity.durationMs,
    errorMessage: entity.errorMessage,
  };
}

/**
 * 실행 현황 화면 상단의 다크 요약바(`#18302a`)가 읽는 값.
 *
 * `currentStep` 은 시안 `4 / 5 단계` 의 좌변이다 — **지금 실행 중이거나 마지막으로
 * 끝난 스텝의 sequence**. 아직 아무 스텝도 시작하지 않았으면 0 이다.
 */
export function toRunSummary(entity: RunEntity, steps: readonly StepResultEntity[]): RunSummary {
  let currentStep = 0;
  for (const step of steps) {
    if (step.status === "pending") continue;
    currentStep = Math.max(currentStep, step.sequence);
  }

  return {
    envLabel: entity.envLabel,
    baseUrl: entity.baseUrl,
    browser: entity.browser,
    runnerId: entity.runnerId,
    startedAt: entity.startedAt?.toISOString() ?? null,
    totalSteps: entity.totalSteps,
    currentStep,
  };
}
