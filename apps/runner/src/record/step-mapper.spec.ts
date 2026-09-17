import { describe, expect, it } from "vitest";
import { ACTION_CHIP_LABEL } from "@testflow/contracts";
import type { LocatorTarget } from "@testflow/contracts";
import {
  chipLabel,
  describeEvent,
  mergeConsecutiveFills,
  shortenUrl,
  toDraftStep,
} from "./step-mapper.js";
import type { RecordedAction } from "./step-mapper.js";

const target = (name: string): LocatorTarget => ({
  primary: { by: "role", role: "button", name, exact: true },
  fallbacks: [{ by: "text", value: name, exact: true }],
  frameUrl: null,
  snapshot: { tag: "button" },
});

const action = (patch: Partial<RecordedAction>): RecordedAction => ({
  kind: "click",
  target: target("로그인"),
  role: "button",
  accessibleName: "로그인",
  label: null,
  tag: "button",
  inputType: null,
  url: "http://localhost/login",
  at: 0,
  ...patch,
});

describe("describeEvent — 업무 문장", () => {
  it("role=button / name=로그인 → \"'로그인' 버튼 클릭\"", () => {
    expect(describeEvent(action({}))).toBe("'로그인' 버튼 클릭");
  });

  it("label=아이디 입력 → \"'아이디' 입력란에 값 입력\"", () => {
    const sentence = describeEvent(
      action({
        kind: "fill",
        role: "textbox",
        label: "아이디",
        accessibleName: "아이디",
        tag: "input",
        inputType: "text",
        value: "qa@example.com",
      }),
    );
    expect(sentence).toBe("'아이디' 입력란에 값 입력");
  });

  it("비밀번호 필드(role 없음)도 '입력란'으로 부른다", () => {
    const sentence = describeEvent(
      action({
        kind: "fill",
        role: null,
        label: "비밀번호",
        accessibleName: "비밀번호",
        tag: "input",
        inputType: "password",
        value: "{{password}}",
        isSecret: true,
      }),
    );
    expect(sentence).toBe("'비밀번호' 입력란에 값 입력");
  });

  it("select / check / uncheck / press 문장", () => {
    expect(
      describeEvent(
        action({ kind: "select", role: "combobox", label: "국가", tag: "select", value: "kr" }),
      ),
    ).toBe("'국가' 선택란에서 값 선택");
    expect(
      describeEvent(action({ kind: "check", role: "checkbox", label: "약관 동의", tag: "input" })),
    ).toBe("'약관 동의' 체크박스 선택");
    expect(
      describeEvent(action({ kind: "uncheck", role: "checkbox", label: "약관 동의", tag: "input" })),
    ).toBe("'약관 동의' 체크박스 선택 해제");
    expect(
      describeEvent(
        action({ kind: "press", role: "textbox", label: "아이디", tag: "input", value: "Enter" }),
      ),
    ).toBe("'아이디' 입력란에서 Enter 키 입력");
  });

  it("goto 는 URL 을 짧게 줄여 문장을 만든다", () => {
    expect(describeEvent({ kind: "goto", url: "{{baseUrl}}/login", at: 0 })).toBe(
      "'/login' 페이지로 이동",
    );
    expect(shortenUrl("http://127.0.0.1:5000/a/b?c=1")).toBe("/a/b?c=1");
  });
});

describe("toDraftStep — TestStep 계약 준수", () => {
  it("click 초안은 target 을 그대로 싣고 input 은 두지 않는다", () => {
    const draft = toDraftStep(action({}));
    expect(draft).not.toBeNull();
    expect(draft?.actionType).toBe("click");
    expect(draft?.name).toBe("'로그인' 버튼 클릭");
    expect(draft?.target?.primary).toEqual({ by: "role", role: "button", name: "로그인", exact: true });
    expect(draft?.input ?? null).toBeNull();
    expect(draft?.options.timeoutMs).toBe(10_000);
  });

  it("비밀번호 fill 은 값 대신 {{password}} + isSecret 으로만 남는다", () => {
    const draft = toDraftStep(
      action({
        kind: "fill",
        role: null,
        label: "비밀번호",
        tag: "input",
        inputType: "password",
        value: "{{password}}",
        isSecret: true,
      }),
    );
    expect(draft?.input).toEqual({ value: "{{password}}", isSecret: true });
    expect(JSON.stringify(draft)).not.toContain("hunter2");
  });

  it("goto 초안은 target 없이 input.value 에 URL 을 담는다", () => {
    const draft = toDraftStep({ kind: "goto", url: "{{baseUrl}}/login", at: 0 });
    expect(draft?.actionType).toBe("goto");
    expect(draft?.target ?? null).toBeNull();
    expect(draft?.input).toEqual({ value: "{{baseUrl}}/login", isSecret: false });
  });
});

describe("칩 라벨 — contracts 단일 소스", () => {
  it("시안 4종 칩과 1:1 로 대응한다", () => {
    expect(chipLabel("goto")).toBe("이동");
    expect(chipLabel("fill")).toBe("입력");
    expect(chipLabel("click")).toBe("클릭");
    expect(chipLabel("assert_visible")).toBe("확인");
    // ★ 표를 여기서 재정의하지 않는다는 사실 자체를 검사한다.
    expect(chipLabel("select")).toBe(ACTION_CHIP_LABEL.select);
  });
});

describe("mergeConsecutiveFills — 2차 디바운스", () => {
  it("같은 대상 연속 fill 은 마지막 값 하나로 접힌다", () => {
    const make = (value: string) =>
      toDraftStep(
        action({ kind: "fill", role: "textbox", label: "아이디", tag: "input", value }),
      );
    const steps = [make("q"), make("qa"), make("qa@example.com")].filter((s) => s !== null);
    const merged = mergeConsecutiveFills(steps);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.input?.value).toBe("qa@example.com");
  });

  it("대상이 다르면 접지 않는다", () => {
    const id = toDraftStep(action({ kind: "fill", role: "textbox", label: "아이디", tag: "input", value: "a" }));
    const pw = toDraftStep({
      ...action({ kind: "fill", role: null, label: "비밀번호", tag: "input", inputType: "password" }),
      target: {
        primary: { by: "label", value: "비밀번호", exact: true },
        fallbacks: [],
        frameUrl: null,
        snapshot: { tag: "input" },
      },
      value: "{{password}}",
      isSecret: true,
    });
    const merged = mergeConsecutiveFills([id, pw].filter((s) => s !== null));
    expect(merged).toHaveLength(2);
  });
});
