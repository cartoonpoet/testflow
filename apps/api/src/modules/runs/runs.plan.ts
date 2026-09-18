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

import type { ScenarioSourceType } from "@testflow/contracts";

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
  /**
   * 라운드 2 추가. **생략하면 `"steps"`** — 라운드 1 호출부와 회귀 테스트가 그대로 통과한다.
   * (필수로 만들면 "추가"가 아니라 "변경"이 되어 기존 8건이 컴파일되지 않는다.)
   */
  sourceType?: ScenarioSourceType;
}

export interface PlannedRun {
  runCode: string;
  scenarioId: string;
  scenarioName: string;
  totalSteps: number;
  /** `runs.source_type` 스냅샷. Runner 의 엔진 분기 키이기도 하다. */
  sourceType: ScenarioSourceType;
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

/**
 * ★ `code` 시나리오의 `totalSteps` 는 **0 으로 시작한다** (03-phases 쟁점 2).
 *
 * 라운드 1은 요청 시점에 스텝 수를 확정해 넣는다. 코드 실행은 **실행해 봐야 스텝 수를 안다** —
 * Runner 가 reporter 이벤트를 받으며 `runs.total_steps` 를 **증가**시킨다.
 * 화면은 "N / M 단계" 의 M 이 커지는 것을 견뎌야 한다(계약은 이미 숫자라 바꿀 것이 없다).
 *
 * 스텝 0건을 **거부하는 규칙은 이 경로에 없다**(확인함) — 0건 거부는 발행(`publish`)에만 있고,
 * 거기서는 `sourceType` 으로 이미 갈랐다. 그래서 여기서 우회할 것이 없다.
 */
export function planRunBatch(input: PlanRunBatchInput): PlannedRun[] {
  return input.targets.map((target, index) => {
    const sourceType = target.sourceType ?? "steps";
    return {
      runCode: formatRunCode(input.startSerial + index),
      scenarioId: target.scenarioId,
      scenarioName: target.scenarioName,
      totalSteps: sourceType === "code" ? 0 : target.stepCount,
      sourceType,
      batchId: input.batchId,
      batchSequence: index + 1,
    };
  });
}
