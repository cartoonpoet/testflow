import { describe, expect, it } from "vitest";
import { belongings, type ScenarioDeleteTarget } from "./ScenarioDeleteDialog";

function target(patch: Partial<ScenarioDeleteTarget>): ScenarioDeleteTarget {
  return {
    id: "a",
    name: "로그인",
    code: "TC-GEN-001",
    sourceType: "steps",
    stepCount: 0,
    ...patch,
  };
}

describe("belongings — 확인 대화상자가 적는 '딸린 것'", () => {
  it("녹화 시나리오는 스텝 수를 적는다", () => {
    expect(belongings(target({ sourceType: "steps", stepCount: 7 }))).toBe("스텝 7개");
  });

  it("★ 코드 시나리오에 '스텝 0개' 라고 적지 않는다 — 언제나 0 이라 오해를 만든다", () => {
    const label = belongings(target({ sourceType: "code", stepCount: 0 }));
    expect(label).not.toContain("스텝");
    expect(label).toBe("코드 시나리오");
  });

  it("본문 유무를 아는 화면에서는 그것을 적는다", () => {
    expect(belongings(target({ sourceType: "code", hasCode: true }))).toBe("코드 본문 1건");
    expect(belongings(target({ sourceType: "code", hasCode: false }))).toBe("코드 본문 없음");
  });

  it("첨부 개수는 아는 화면에서만 적는다", () => {
    expect(belongings(target({ sourceType: "code", hasCode: true, attachmentCount: 3 }))).toBe(
      "코드 본문 1건 · 첨부 3개",
    );
    expect(belongings(target({ sourceType: "code", hasCode: true }))).not.toContain("첨부");
  });

  it("첨부가 0개인 것과 모르는 것을 구분한다", () => {
    expect(belongings(target({ sourceType: "code", hasCode: true, attachmentCount: 0 }))).toBe(
      "코드 본문 1건 · 첨부 0개",
    );
  });
});
