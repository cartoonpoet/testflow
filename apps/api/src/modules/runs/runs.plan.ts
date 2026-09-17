/**
 * 실행 요청 → run 행 묶음 계획.
 *
 * DB · 큐 · 랜덤에 의존하지 않는 **순수 함수**만 둔다(단위 테스트로 고정하기 위해).
 * 스위트 실행 모델링이 여기 들어 있다 — 02-context "규약 메모":
 *
 * > 스위트 실행은 `run` 1건(부모) + 자식 run N건이 **아니라**,
 * > `runs.suite_id` 를 가진 run 여러 건 + `runs.batch_id` 묶음으로 모델링한다.
 *
 * 이유: `step_results` 구조를 단일 시나리오 실행과 **완전히 동일**하게 유지할 수 있다.
 * 부모 run 을 두면 "스텝이 없는 run" 이라는 예외 케이스가 생겨 집계·SSE·화면이 전부 갈라진다.
 */

export const RUN_CODE_PREFIX = "RUN-";

/** 시안 표기 `RUN-2431`. 4자리 미만은 0 으로 채우고, 넘치면 그대로 늘어난다. */
export function formatRunCode(serial: number): string {
  return `${RUN_CODE_PREFIX}${String(serial).padStart(4, "0")}`;
}

export interface RunTarget {
  scenarioId: string;
  scenarioName: string;
  /** 실행 시점 스텝 수 스냅샷. SSE `totalSteps` 와 진행바의 분모가 된다. */
  stepCount: number;
}

export interface PlannedRun {
  runCode: string;
  scenarioId: string;
  scenarioName: string;
  totalSteps: number;
  batchId: string | null;
  /** 같은 batch 안에서의 순서. 단건 실행이면 1. */
  batchSequence: number;
}

export interface PlanRunBatchInput {
  /** 스위트면 `suite_scenarios.sequence` 오름차순, 단건이면 1개짜리 배열. */
  targets: readonly RunTarget[];
  /** `RUN-` 다음에 붙일 첫 일련번호. */
  startSerial: number;
  /** 스위트 실행이면 UUID, 단건 실행이면 `null`. */
  batchId: string | null;
}

export function planRunBatch(input: PlanRunBatchInput): PlannedRun[] {
  return input.targets.map((target, index) => ({
    runCode: formatRunCode(input.startSerial + index),
    scenarioId: target.scenarioId,
    scenarioName: target.scenarioName,
    totalSteps: target.stepCount,
    batchId: input.batchId,
    batchSequence: index + 1,
  }));
}
