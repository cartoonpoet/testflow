import { describe, expect, it } from "vitest";
import { formatRunCode, planRunBatch } from "./runs.plan.js";
import type { RunTarget } from "./runs.plan.js";

const BATCH_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function target(id: string, name: string, stepCount = 3): RunTarget {
  return { scenarioId: id, scenarioName: name, stepCount };
}

describe("formatRunCode", () => {
  it("시안 표기(RUN-2431) 형태로 4자리 0 패딩한다", () => {
    expect(formatRunCode(1)).toBe("RUN-0001");
    expect(formatRunCode(2431)).toBe("RUN-2431");
  });

  it("4자리를 넘으면 자르지 않고 늘린다", () => {
    expect(formatRunCode(123_456)).toBe("RUN-123456");
  });
});

describe("planRunBatch — 스위트는 부모 run 없이 batch_id 로 묶는다", () => {
  it("단건 실행이면 run 1건 · batchId 는 null", () => {
    const planned = planRunBatch({
      targets: [target("s1", "로그인")],
      startSerial: 7,
      batchId: null,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]?.batchId).toBeNull();
    expect(planned[0]?.batchSequence).toBe(1);
    expect(planned[0]?.runCode).toBe("RUN-0007");
  });

  it("스위트 3건이면 run 3건이 모두 같은 batchId 를 갖는다", () => {
    const planned = planRunBatch({
      targets: [target("s1", "로그인"), target("s2", "주문"), target("s3", "결제")],
      startSerial: 10,
      batchId: BATCH_ID,
    });

    expect(planned).toHaveLength(3);
    expect(new Set(planned.map((run) => run.batchId))).toEqual(new Set([BATCH_ID]));
    expect(planned.map((run) => run.batchSequence)).toEqual([1, 2, 3]);
  });

  it("run_code 가 연속으로 채번된다", () => {
    const planned = planRunBatch({
      targets: [target("s1", "a"), target("s2", "b"), target("s3", "c")],
      startSerial: 10,
      batchId: BATCH_ID,
    });
    expect(planned.map((run) => run.runCode)).toEqual(["RUN-0010", "RUN-0011", "RUN-0012"]);
  });

  it("suite_scenarios.sequence 순서를 그대로 batchSequence 로 옮긴다", () => {
    const planned = planRunBatch({
      targets: [target("s3", "세번째"), target("s1", "첫번째")],
      startSerial: 1,
      batchId: BATCH_ID,
    });
    expect(planned.map((run) => [run.scenarioId, run.batchSequence])).toEqual([
      ["s3", 1],
      ["s1", 2],
    ]);
  });

  it("스텝 수 스냅샷(totalSteps)을 실행 시점 값으로 고정한다", () => {
    const planned = planRunBatch({
      targets: [target("s1", "로그인", 5)],
      startSerial: 1,
      batchId: null,
    });
    expect(planned[0]?.totalSteps).toBe(5);
  });

  it("대상이 없으면 빈 배열 (호출 측이 400 으로 막는다)", () => {
    expect(planRunBatch({ targets: [], startSerial: 1, batchId: null })).toEqual([]);
  });
});
