import { describe, expect, it } from "vitest";
import {
  PW_STEP_VALUE_MASK,
  isUserVisiblePwStep,
  stripStepValue,
  toActionType,
} from "./pw-step-title.js";
import type { ActionType } from "./step.js";

/**
 * ════════════════════════════════════════════════════════════════════
 * ★ **매핑 회귀 테스트** — 이 파일이 Playwright 버전업으로부터 코드 실행 경로를 지키는
 *   유일한 장치다 (03-phases 리스크 4번).
 *
 *   step 제목은 API 이름이 아니라 **사람이 읽는 라벨**이다(`locator.click` 이 아니라 `Click`).
 *   Playwright 가 라벨 문구를 바꾸면 `toActionType()` 은 **조용히 전부 `wait` 로 떨어진다** —
 *   실행은 계속 성공하고, 화면의 동작 칩만 전부 "대기"가 된다. 아무도 눈치채지 못한다.
 *   그래서 ① 실측 제목 전량을 표로 고정하고 ② 미분류 비율에 상한을 둔다.
 *
 *   아래 제목 문자열은 PoC `--mode c/d` 실행 로그에서 **실측한 것**이다
 *   (r2-poc-live-stream.md "진행 이벤트 매핑"). 문서를 보고 추측한 것이 아니다.
 * ════════════════════════════════════════════════════════════════════
 */
const MEASURED_TITLES: readonly (readonly [title: string, expected: ActionType])[] = [
  // ── pw:api (PoC codegen-login / codegen-multi spec 이 실제로 만든 제목) ──
  ["Navigate", "goto"],
  ["Click", "click"],
  ["Double click", "click"],
  ['Fill "hong.gildong"', "fill"],
  ['Fill "s3cr3t-pw"', "fill"],
  ['Type "abc"', "fill"],
  ["Set input files", "fill"],
  ["Select option", "select"],
  ["Check", "check"],
  ["Uncheck", "uncheck"],
  ["Press", "press"],
  ["Hover", "hover"],
  ["Wait for timeout", "wait"],
  // ── expect (matcher 이름이 인용부호 안에 온다) ──
  ['Expect "toHaveText"', "assert_text"],
  ['Expect "toContainText"', "assert_text"],
  ['Expect "toHaveValue"', "assert_text"],
  ['Expect "toBeVisible"', "assert_visible"],
  ['Expect "toBeAttached"', "assert_visible"],
  ['Expect "toBeEnabled"', "assert_visible"],
  ['Expect "toHaveURL"', "assert_url"],
];

describe("toActionType — 실측 제목 회귀표", () => {
  it.each(MEASURED_TITLES)("%s → %s", (title, expected) => {
    expect(toActionType(title)).toBe(expected);
  });

  it("실측 제목 12종 이상을 고정한다", () => {
    expect(MEASURED_TITLES.length).toBeGreaterThanOrEqual(12);
  });

  /**
   * ★ 미분류 상한. `wait` 로 기대하는 제목(`Wait for timeout`)만 `wait` 여야 한다.
   *   Playwright 가 라벨을 바꾸면 이 비율이 치솟고 **이 테스트가 먼저 깨진다.**
   */
  it("미분류(wait) 비율이 기준(15%)을 넘지 않는다", () => {
    const expectedWait = MEASURED_TITLES.filter(([, action]) => action === "wait").length;
    const actualWait = MEASURED_TITLES.filter(([title]) => toActionType(title) === "wait").length;
    expect(actualWait).toBe(expectedWait);
    expect(actualWait / MEASURED_TITLES.length).toBeLessThanOrEqual(0.15);
  });

  it("모르는 제목은 지어내지 않고 wait 로 떨어뜨린다", () => {
    expect(toActionType("Some brand new label")).toBe("wait");
  });

  it("대소문자에 의존하지 않는다", () => {
    expect(toActionType("navigate")).toBe("goto");
    expect(toActionType("CLICK")).toBe("click");
  });
});

describe("stripStepValue — 입력 계열만 벗긴다 (PoC 발견 ①)", () => {
  it("Fill 의 비밀번호를 벗긴다", () => {
    expect(stripStepValue('Fill "s3cr3t-pw"')).toBe(`Fill ${PW_STEP_VALUE_MASK}`);
  });

  it("Fill 의 아이디도 벗긴다", () => {
    expect(stripStepValue('Fill "hong.gildong"')).toBe('Fill "***"');
  });

  it.each(['Type "s3cr3t"', 'Set input files "/tmp/a.png"'])("입력 계열 %s 을 벗긴다", (title) => {
    expect(stripStepValue(title)).toContain('"***"');
    expect(stripStepValue(title)).not.toContain("s3cr3t");
  });

  it("★ Expect 의 인용부호는 matcher 이름이라 **지우지 않는다**", () => {
    expect(stripStepValue('Expect "toHaveText"')).toBe('Expect "toHaveText"');
    expect(stripStepValue('Expect "toBeVisible"')).toBe('Expect "toBeVisible"');
    expect(stripStepValue('Expect "toHaveURL"')).toBe('Expect "toHaveURL"');
  });

  it("값이 없는 제목은 그대로 둔다", () => {
    expect(stripStepValue("Click")).toBe("Click");
    expect(stripStepValue("Navigate")).toBe("Navigate");
  });

  it("한 제목에 인용부호가 여러 개여도 전부 벗긴다", () => {
    expect(stripStepValue('Fill "a" and "b"')).toBe('Fill "***" and "***"');
  });

  it("마스킹 후에도 ActionType 매핑이 유지된다 (마스킹 → 매핑 순서 무관)", () => {
    const masked = stripStepValue('Fill "s3cr3t-pw"');
    expect(toActionType(masked)).toBe("fill");
  });
});

describe("isUserVisiblePwStep — hook/fixture 도배 방지", () => {
  it.each(["pw:api", "expect", "test.step"])("depth 0 의 %s 는 보여 준다", (category) => {
    expect(isUserVisiblePwStep(category, 0)).toBe(true);
  });

  it.each(["hook", "fixture", "attach", "pw:api:other"])("%s 카테고리는 거른다", (category) => {
    expect(isUserVisiblePwStep(category, 0)).toBe(false);
  });

  it("depth > 0 인 중첩 step 은 카테고리와 무관하게 거른다", () => {
    expect(isUserVisiblePwStep("pw:api", 1)).toBe(false);
    expect(isUserVisiblePwStep("expect", 2)).toBe(false);
  });
});
