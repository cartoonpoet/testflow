/**
 * `PUT /api/scenarios/:id/steps` (전량 치환) 의 **순수 계획 함수**.
 *
 * Nest 데코레이터·DB 접근 없이 "무엇을 지우고 무엇을 갱신하고 무엇을 새로 넣을지"만
 * 계산한다. 이렇게 분리한 이유는 두 가지다.
 *  1. 전량 치환은 이 Gen-Phase 에서 가장 깨지기 쉬운 로직인데(유니크 제약 + 순서 변경),
 *     DB 없이 단위 테스트할 수 있어야 한다.
 *  2. `uq_test_steps_seq (scenario_id, sequence)` 를 **중간 상태에서도** 위반하지 않는
 *     실행 순서를 한 곳에 문서화하기 위해서다.
 */

/**
 * ★ 중간 상태 충돌 회피용 오프셋.
 *
 * 전량 치환은 "3번을 1번으로, 1번을 3번으로" 같은 교환을 포함한다. 그대로 UPDATE 하면
 * 두 번째 UPDATE 에서 `uq_test_steps_seq` 가 터진다. 그래서 살아남는 행 전체의
 * `sequence` 를 한 번에 이 오프셋만큼 밀어 **1..n 구간을 완전히 비운 뒤** 최종값을 쓴다.
 *
 * `sequence` 는 `INT UNSIGNED`(최대 약 42.9억)라 오프셋을 더해도 넘치지 않는다.
 * 한 시나리오의 스텝이 100만 개를 넘을 일은 없으므로 구간이 겹치지 않는다.
 */
export const SEQUENCE_VACATE_OFFSET = 1_000_000;

export class StepPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepPlanError";
  }
}

export interface StepReplacementPlan {
  /** 요청에 없어서 삭제될 기존 스텝 id. */
  deleteIds: string[];
  /** 기존 행을 재사용(갱신)하는 항목. `index` 는 요청 배열에서의 위치다. */
  updates: { id: string; index: number; sequence: number }[];
  /** 새로 INSERT 할 항목. */
  inserts: { index: number; sequence: number }[];
}

/**
 * @param existingIds 해당 시나리오에 현재 존재하는 스텝 id 전체
 * @param incoming    요청으로 들어온 스텝 배열(이미 `TestStepArraySchema` 로 검증돼
 *                    `sequence` 가 1..n 연속임이 보장된 상태여야 한다)
 *
 * @throws {StepPlanError} 요청에 같은 id 가 두 번 나오거나, 이 시나리오에 속하지 않는
 *         id 가 섞여 있을 때. **조용히 새 행으로 만들지 않는다** — 그렇게 하면
 *         다른 시나리오의 스텝을 복제하는 결과가 되고 실행 이력(`step_results.step_id`)이
 *         엉뚱한 곳을 가리킨다.
 */
export function planStepReplacement(
  existingIds: readonly string[],
  incoming: readonly { id?: string | undefined }[],
): StepReplacementPlan {
  const existing = new Set(existingIds);
  const keep = new Set<string>();

  const updates: StepReplacementPlan["updates"] = [];
  const inserts: StepReplacementPlan["inserts"] = [];

  incoming.forEach((step, index) => {
    const sequence = index + 1;
    const id = step.id;

    if (id === undefined) {
      inserts.push({ index, sequence });
      return;
    }
    if (keep.has(id)) {
      throw new StepPlanError(`같은 스텝 id 가 두 번 들어왔습니다: ${id}`);
    }
    if (!existing.has(id)) {
      throw new StepPlanError(`이 시나리오의 스텝이 아닙니다: ${id}`);
    }
    keep.add(id);
    updates.push({ id, index, sequence });
  });

  return {
    deleteIds: existingIds.filter((id) => !keep.has(id)),
    updates,
    inserts,
  };
}
