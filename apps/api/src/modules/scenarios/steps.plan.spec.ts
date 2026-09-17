import { describe, expect, it } from "vitest";
import { StepPlanError, planStepReplacement } from "./steps.plan.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

describe("planStepReplacement — 전량 치환 계획", () => {
  it("순서만 바꾸면 전부 UPDATE 이고 삭제·삽입이 없다", () => {
    const plan = planStepReplacement([A, B, C], [{ id: C }, { id: A }, { id: B }]);

    expect(plan.deleteIds).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([
      { id: C, index: 0, sequence: 1 },
      { id: A, index: 1, sequence: 2 },
      { id: B, index: 2, sequence: 3 },
    ]);
  });

  it("요청에서 빠진 스텝은 삭제 대상이고 나머지 sequence 는 1..n 으로 다시 매겨진다", () => {
    const plan = planStepReplacement([A, B, C], [{ id: C }, { id: A }]);

    expect(plan.deleteIds).toEqual([B]);
    expect(plan.updates).toEqual([
      { id: C, index: 0, sequence: 1 },
      { id: A, index: 1, sequence: 2 },
    ]);
  });

  it("id 없는 항목은 INSERT 다 — 순서 변경·삭제·추가가 한 번에 처리된다", () => {
    const plan = planStepReplacement([A, B], [{ id: B }, {}, { id: A }]);

    expect(plan.deleteIds).toEqual([]);
    expect(plan.inserts).toEqual([{ index: 1, sequence: 2 }]);
    expect(plan.updates).toEqual([
      { id: B, index: 0, sequence: 1 },
      { id: A, index: 2, sequence: 3 },
    ]);
  });

  it("빈 배열은 전량 삭제다", () => {
    const plan = planStepReplacement([A, B], []);
    expect(plan.deleteIds).toEqual([A, B]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it("최종 sequence 는 항상 1..n 연속이다 (uq_test_steps_seq 전제)", () => {
    const plan = planStepReplacement([A, B, C], [{ id: C }, {}, { id: A }, {}, { id: B }]);
    const sequences = [...plan.updates, ...plan.inserts]
      .sort((x, y) => x.index - y.index)
      .map((item) => item.sequence);
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
  });

  it("같은 id 가 두 번 오면 거부한다", () => {
    expect(() => planStepReplacement([A, B], [{ id: A }, { id: A }])).toThrow(StepPlanError);
  });

  it("이 시나리오에 없는 id 는 거부한다 (조용히 새 행으로 만들지 않는다)", () => {
    expect(() => planStepReplacement([A], [{ id: C }])).toThrow(StepPlanError);
  });
});
