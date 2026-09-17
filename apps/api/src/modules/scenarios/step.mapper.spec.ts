import { describe, expect, it } from "vitest";
import type { TestStep } from "@testflow/contracts";
import { parseAdvancedFlag, toApiStep } from "./step.mapper.js";

const cssPrimaryStep: TestStep = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  scenarioId: "bbbbbbbb-0000-4000-8000-000000000002",
  sequence: 1,
  name: "로그인 버튼 클릭",
  actionType: "click",
  target: {
    // ★ primary 자체가 css 인 경우 — fallbacks 만 필터하면 못 막는다.
    primary: { by: "css", value: "form > button.submit" },
    fallbacks: [
      { by: "text", value: "로그인" },
      { by: "css", value: "#login" },
    ],
    frameUrl: null,
    snapshot: null,
  },
  input: null,
  options: { timeoutMs: 10000, optional: false },
};

describe("toApiStep — CSS Selector 비노출", () => {
  it("기본 응답에는 'css' 문자열이 전혀 없다", () => {
    const json = JSON.stringify(toApiStep(cssPrimaryStep, false));
    expect(json).not.toContain("css");
    expect(json).not.toContain("form > button.submit");
  });

  it("primary 가 css 였으면 null 이 되고 public 한 fallback 만 남는다", () => {
    const result = toApiStep(cssPrimaryStep, false) as { target: { primary: unknown; fallbacks: unknown[] } };
    expect(result.target.primary).toBeNull();
    expect(result.target.fallbacks).toEqual([{ by: "text", value: "로그인" }]);
  });

  it("?advanced=1 일 때만 원본 LocatorTarget 을 낸다", () => {
    const json = JSON.stringify(toApiStep(cssPrimaryStep, true));
    expect(json).toContain("css");
    expect(json).toContain("form > button.submit");
  });
});

describe("parseAdvancedFlag", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["0", false],
    ["yes", false],
    [undefined, false],
  ])("advanced=%s → %s", (input, expected) => {
    expect(parseAdvancedFlag(input)).toBe(expected);
  });
});
