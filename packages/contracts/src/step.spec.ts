import { describe, expect, it } from "vitest";
import {
  DraftStepSchema,
  LocatorTargetSchema,
  TestStepArraySchema,
  TestStepSchema,
  displayStepValue,
  locatorChain,
  toPublicLocatorTarget,
} from "./step.js";

/**
 * 02-context "DB 스키마 초안" 의 `target_json` 예시 주석을 그대로 옮긴 값.
 * 이 객체가 그대로 통과하지 않으면 계약이 문서와 어긋난 것이다.
 */
const CONTEXT_TARGET_EXAMPLE = {
  primary: { by: "role", role: "button", name: "로그인", exact: true },
  fallbacks: [
    { by: "label", value: "로그인" },
    { by: "text", value: "로그인" },
    { by: "testid", value: "login-submit" },
    { by: "css", value: "form > button.submit" },
  ],
  frameUrl: null,
  snapshot: { tag: "button", attrs: { type: "submit" } },
};

describe("LocatorTargetSchema", () => {
  it("02-context 의 role + fallback 4종 예시를 그대로 통과시킨다", () => {
    const parsed = LocatorTargetSchema.parse(CONTEXT_TARGET_EXAMPLE);
    expect(parsed.primary.by).toBe("role");
    expect(parsed.fallbacks).toHaveLength(4);
    expect(locatorChain(parsed)).toHaveLength(5);
  });

  it("알 수 없는 by 값은 거부한다", () => {
    const result = LocatorTargetSchema.safeParse({
      primary: { by: "unknown", value: "x" },
      fallbacks: [],
    });
    expect(result.success).toBe(false);
  });

  it("fallbacks 를 생략하면 빈 배열이 된다", () => {
    const parsed = LocatorTargetSchema.parse({ primary: { by: "testid", value: "submit" } });
    expect(parsed.fallbacks).toEqual([]);
  });

  it("toPublicLocatorTarget 은 css 후보를 전부 제거한다", () => {
    const parsed = LocatorTargetSchema.parse(CONTEXT_TARGET_EXAMPLE);
    const publicTarget = toPublicLocatorTarget(parsed);
    expect(JSON.stringify(publicTarget)).not.toContain("css");
    expect(publicTarget.fallbacks).toHaveLength(3);
    expect(publicTarget.primary?.by).toBe("role");
  });

  it("primary 가 css 뿐이면 public 변환 후 primary 가 null 이 된다", () => {
    const parsed = LocatorTargetSchema.parse({ primary: { by: "css", value: "div > a" } });
    const publicTarget = toPublicLocatorTarget(parsed);
    expect(publicTarget.primary).toBeNull();
    expect(JSON.stringify(publicTarget)).not.toContain("css");
  });
});

describe("TestStepSchema", () => {
  it("클릭 스텝을 통과시키고 options 기본값을 채운다", () => {
    const step = TestStepSchema.parse({
      sequence: 1,
      name: "'로그인' 버튼 클릭",
      actionType: "click",
      target: CONTEXT_TARGET_EXAMPLE,
    });
    expect(step.options.timeoutMs).toBe(10000);
    expect(step.options.optional).toBe(false);
  });

  it("goto 스텝은 target 없이 input 만으로 통과한다", () => {
    const step = TestStepSchema.parse({
      sequence: 1,
      name: "로그인 화면으로 이동",
      actionType: "goto",
      input: { value: "{{baseUrl}}/login" },
    });
    expect(step.input?.isSecret).toBe(false);
  });

  it("비밀번호 입력 스텝은 변수 참조 + isSecret 으로 표현된다", () => {
    const step = TestStepSchema.parse({
      sequence: 3,
      name: "비밀번호 입력",
      actionType: "fill",
      target: { primary: { by: "label", value: "비밀번호" } },
      input: { value: "{{testUser.password}}", isSecret: true },
    });
    expect(displayStepValue(step)).toBe("••••••••");
  });

  it("target 이 필요한 동작에 target 이 없으면 거부한다", () => {
    const result = TestStepSchema.safeParse({
      sequence: 1,
      name: "클릭",
      actionType: "click",
    });
    expect(result.success).toBe(false);
  });

  it("값이 필요한 동작에 input 이 없으면 거부한다", () => {
    const result = TestStepSchema.safeParse({
      sequence: 1,
      name: "URL 확인",
      actionType: "assert_url",
    });
    expect(result.success).toBe(false);
  });

  it("wait 동작에 options.waitMs 가 없으면 거부한다", () => {
    const result = TestStepSchema.safeParse({
      sequence: 1,
      name: "잠시 대기",
      actionType: "wait",
    });
    expect(result.success).toBe(false);
  });

  it("알 수 없는 actionType 은 거부한다", () => {
    const result = TestStepSchema.safeParse({
      sequence: 1,
      name: "x",
      actionType: "scroll",
    });
    expect(result.success).toBe(false);
  });
});

describe("TestStepArraySchema", () => {
  const base = {
    name: "'로그인' 버튼 클릭",
    actionType: "click" as const,
    target: { primary: { by: "testid" as const, value: "login" } },
  };

  it("sequence 가 1부터 연속이면 통과한다", () => {
    const parsed = TestStepArraySchema.parse([
      { ...base, sequence: 1 },
      { ...base, sequence: 2 },
    ]);
    expect(parsed).toHaveLength(2);
  });

  it("sequence 가 건너뛰면 거부한다", () => {
    const result = TestStepArraySchema.safeParse([
      { ...base, sequence: 1 },
      { ...base, sequence: 3 },
    ]);
    expect(result.success).toBe(false);
  });
});

describe("DraftStepSchema", () => {
  it("녹화 초안은 sequence 없이 통과한다", () => {
    const draft = DraftStepSchema.parse({
      name: "'아이디' 입력란에 값 입력",
      actionType: "fill",
      target: { primary: { by: "label", value: "아이디" } },
      input: { value: "qa@example.com" },
    });
    expect(draft.options.timeoutMs).toBe(10000);
  });
});
