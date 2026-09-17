import { describe, expect, it } from "vitest";
import { SECRET_MASK } from "@testflow/contracts";
import {
  describeStepDetail,
  describeTarget,
  formatSeconds,
  stepChipLabel,
  stepNumberLabel,
} from "./step-text";

describe("describeTarget", () => {
  it("role 후보를 업무 용어로 바꾼다", () => {
    expect(
      describeTarget({
        primary: { by: "role", role: "button", name: "로그인", exact: true },
        fallbacks: [],
      }),
    ).toBe("버튼 “로그인”");
  });

  it("★ testid / css 후보는 건너뛰고 role·label·text 를 찾는다", () => {
    expect(
      describeTarget({
        primary: { by: "testid", value: "confirm-a" },
        fallbacks: [
          { by: "css", value: "#confirm-a" },
          { by: "text", value: "확인" },
        ],
      }),
    ).toBe("“확인”");
  });

  it("★ 쓸 수 있는 후보가 없으면 선택자 대신 스냅샷 텍스트로 떨어진다", () => {
    expect(
      describeTarget({
        primary: { by: "testid", value: "confirm-a" },
        fallbacks: [{ by: "css", value: "#confirm-a" }],
        snapshot: { tag: "button", text: "확인" },
      }),
    ).toBe("“확인”");
  });

  it("★ 스냅샷도 없으면 선택자를 노출하지 않고 일반 명사로 끝낸다", () => {
    const text = describeTarget({
      primary: { by: "css", value: "#login-submit > span.foo" },
      fallbacks: [],
    });
    expect(text).toBe("대상 요소");
    expect(text).not.toContain("#login-submit");
  });

  it("primary 가 null 인 공개형 target(=원래 css 였던 것)도 안전하다", () => {
    expect(describeTarget({ primary: null, fallbacks: [] })).toBe("대상 요소");
  });
});

describe("describeStepDetail", () => {
  it("goto 는 변수 표기를 그대로 보여 준다", () => {
    expect(
      describeStepDetail({
        actionType: "goto",
        input: { value: "{{baseUrl}}/login", isSecret: false },
      }),
    ).toBe("{{baseUrl}}/login");
  });

  it("fill 은 `대상 · 값` 이다", () => {
    expect(
      describeStepDetail({
        actionType: "fill",
        target: { primary: { by: "label", value: "아이디" }, fallbacks: [] },
        input: { value: "{{testUser.email}}", isSecret: false },
      }),
    ).toBe("“아이디” 입력란 · {{testUser.email}}");
  });

  it("★ isSecret 값은 마스킹되고 원본이 문자열에 남지 않는다", () => {
    const detail = describeStepDetail({
      actionType: "fill",
      target: { primary: { by: "label", value: "비밀번호" }, fallbacks: [] },
      input: { value: "hunter2", isSecret: true },
    });
    expect(detail).toBe(`“비밀번호” 입력란 · ${SECRET_MASK}`);
    expect(detail).not.toContain("hunter2");
  });

  it("검증 3종 문장", () => {
    expect(
      describeStepDetail({
        actionType: "assert_visible",
        target: { primary: { by: "text", value: "오늘 실행" }, fallbacks: [] },
      }),
    ).toBe("“오늘 실행” 이(가) 화면에 표시됨");
    expect(
      describeStepDetail({
        actionType: "assert_url",
        input: { value: "{{baseUrl}}/dashboard", isSecret: false },
      }),
    ).toBe("URL 이 “{{baseUrl}}/dashboard”");
    expect(
      describeStepDetail({
        actionType: "assert_text",
        target: { primary: { by: "role", role: "heading", name: "대시보드" }, fallbacks: [] },
        input: { value: "오늘 실행", isSecret: false },
      }),
    ).toBe("제목 “대시보드” · 텍스트 “오늘 실행”");
  });

  it("wait 는 options.waitMs 를 초로 읽는다", () => {
    expect(
      describeStepDetail({ actionType: "wait", options: { timeoutMs: 10000, optional: false, waitMs: 1500 } }),
    ).toBe("1.5초 대기");
  });
});

describe("칩 · 번호", () => {
  it("칩 라벨은 contracts 사전을 그대로 쓴다", () => {
    expect(stepChipLabel("goto")).toBe("이동");
    expect(stepChipLabel("fill")).toBe("입력");
    expect(stepChipLabel("click")).toBe("클릭");
    expect(stepChipLabel("assert_visible")).toBe("확인");
  });

  it("번호는 2자리 0 채움이다", () => {
    expect(stepNumberLabel(1)).toBe("01");
    expect(stepNumberLabel(12)).toBe("12");
    expect(formatSeconds(5000)).toBe("5초");
  });
});
