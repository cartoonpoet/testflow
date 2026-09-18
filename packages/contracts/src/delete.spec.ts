import { describe, expect, it } from "vitest";
import {
  BULK_DELETE_MAX,
  BulkDeleteRequestSchema,
  BulkDeleteResultSchema,
  bulkDeleteSummary,
} from "./delete.js";

const ID = "0407001b-e36c-489a-baff-e51e54ffcb42";

describe("BulkDeleteRequestSchema", () => {
  it("uuid 배열 1건 이상을 받는다", () => {
    expect(BulkDeleteRequestSchema.safeParse({ ids: [ID] }).success).toBe(true);
  });

  it("빈 배열은 거부한다 — 아무것도 고르지 않고 부른 요청이다", () => {
    expect(BulkDeleteRequestSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it("uuid 가 아니면 거부한다(경로 조작 값이 그대로 흘러들지 않는다)", () => {
    expect(BulkDeleteRequestSchema.safeParse({ ids: ["../../etc/passwd"] }).success).toBe(false);
  });

  it(`상한 ${String(BULK_DELETE_MAX)}건을 넘기면 거부한다`, () => {
    const ids = Array.from({ length: BULK_DELETE_MAX + 1 }, () => ID);
    expect(BulkDeleteRequestSchema.safeParse({ ids }).success).toBe(false);
  });
});

describe("BulkDeleteResultSchema", () => {
  it("부분 성공을 표현한다 — deleted 와 skipped 가 함께 온다", () => {
    const parsed = BulkDeleteResultSchema.safeParse({
      requested: 2,
      deleted: [ID],
      skipped: [{ id: ID, reason: "in_progress", message: "진행 중입니다." }],
    });
    expect(parsed.success).toBe(true);
  });

  it("모르는 skip 이유는 거부한다", () => {
    const parsed = BulkDeleteResultSchema.safeParse({
      requested: 1,
      deleted: [],
      skipped: [{ id: ID, reason: "because", message: "x" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("bulkDeleteSummary", () => {
  it("전부 지웠으면 건너뛴 건수를 말하지 않는다", () => {
    expect(
      bulkDeleteSummary({ requested: 3, deleted: [ID, ID, ID], skipped: [] }, "실행 이력"),
    ).toBe("실행 이력 3건을 삭제했습니다.");
  });

  it("건너뛴 것이 있으면 그 건수를 함께 말한다", () => {
    expect(
      bulkDeleteSummary(
        {
          requested: 2,
          deleted: [ID],
          skipped: [{ id: ID, reason: "in_progress", message: "진행 중입니다." }],
        },
        "시나리오",
      ),
    ).toBe("시나리오 1건을 삭제했습니다. 1건은 건너뛰었습니다.");
  });

  it("하나도 못 지운 경우에도 0건이라고 분명히 말한다(조용히 성공한 척하지 않는다)", () => {
    expect(
      bulkDeleteSummary(
        {
          requested: 1,
          deleted: [],
          skipped: [{ id: ID, reason: "not_found", message: "이미 삭제되었습니다." }],
        },
        "실행 이력",
      ),
    ).toBe("실행 이력 0건을 삭제했습니다. 1건은 건너뛰었습니다.");
  });
});
