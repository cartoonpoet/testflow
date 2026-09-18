import { describe, expect, it } from "vitest";
import {
  MAX_DETECTED_VARIABLES,
  detectScenarioVariables,
  extractCodeVariableKeys,
  extractStepVariableKeys,
} from "./run-variables.js";

describe("extractCodeVariableKeys", () => {
  it("대괄호 + 쌍따옴표 형태를 잡는다", () => {
    expect(extractCodeVariableKeys(`process.env["TESTFLOW_VAR_username"]`)).toEqual(["username"]);
  });

  it("홑따옴표도 잡는다", () => {
    expect(extractCodeVariableKeys(`process.env['TESTFLOW_VAR_lawyer_email']`)).toEqual([
      "lawyer_email",
    ]);
  });

  it("점 접근 형태를 잡는다", () => {
    expect(extractCodeVariableKeys("process.env.TESTFLOW_VAR_projectName")).toEqual([
      "projectName",
    ]);
  });

  it("process.env 바깥의 리터럴도 잡는다(가이드의 반복문 형태)", () => {
    const code = `for (const key of ['TESTFLOW_VAR_username', 'TESTFLOW_VAR_password']) {}`;
    expect(extractCodeVariableKeys(code)).toEqual(["username", "password"]);
  });

  it("점이 든 키를 한 덩어리로 잡는다", () => {
    expect(extractCodeVariableKeys(`process.env["TESTFLOW_VAR_testUser.email"]`)).toEqual([
      "testUser.email",
    ]);
  });

  it("나타난 순서를 지키고 중복을 없앤다", () => {
    const code = `
      const a = process.env["TESTFLOW_VAR_lawyer_email"] ?? "";
      const b = process.env["TESTFLOW_VAR_lawyer_password"] ?? "";
      const c = process.env["TESTFLOW_VAR_lawyer_email"] ?? "";
    `;
    expect(extractCodeVariableKeys(code)).toEqual(["lawyer_email", "lawyer_password"]);
  });

  it("주석 안의 TESTFLOW_VAR 는 세지 않는다", () => {
    const code = `
      // 실행 변수: process.env["TESTFLOW_VAR_ghost"]
      /* process.env["TESTFLOW_VAR_ghost2"] */
      const real = process.env["TESTFLOW_VAR_real"];
    `;
    expect(extractCodeVariableKeys(code)).toEqual(["real"]);
  });

  it("빈 본문은 빈 배열", () => {
    expect(extractCodeVariableKeys("")).toEqual([]);
  });

  /* ────────────────────────────────────────────────────────────
   * ★ 한계를 **통과하는 테스트로 고정**한다 (`code-validation.spec.ts` 와 같은 규율).
   *   아래 형태들은 잡히지 않는다. 이것은 버그가 아니라 설계다 —
   *   못 잡은 변수는 사용자가 실행 다이얼로그에서 직접 추가한다.
   * ──────────────────────────────────────────────────────────── */
  describe("★ 잡지 못하는 형태 (문서화된 한계)", () => {
    it("문자열 조립은 잡히지 않는다", () => {
      expect(extractCodeVariableKeys(`process.env["TESTFLOW_VAR_" + name]`)).toEqual([]);
    });

    it("템플릿 리터럴(동적 키)은 잡히지 않는다 — 틀린 이름을 보여 주느니 비운다", () => {
      expect(extractCodeVariableKeys("process.env[`TESTFLOW_VAR_${name}`]")).toEqual([]);
    });

    it("env 를 다른 이름에 담아 쓰면 잡히지 않는다", () => {
      expect(extractCodeVariableKeys("const e = process.env; e.TESTFLOW_VAR_x;")).toEqual([]);
    });
  });
});

describe("extractStepVariableKeys", () => {
  it("input.value 의 {{키}} 를 잡는다", () => {
    const steps = [{ input: { value: "{{username}}", isSecret: false } }];
    expect(extractStepVariableKeys(steps)).toEqual(["username"]);
  });

  it("target 안쪽의 {{키}} 도 잡는다", () => {
    const steps = [{ target: { primary: { by: "label", value: "{{fieldLabel}}" } } }];
    expect(extractStepVariableKeys(steps)).toEqual(["fieldLabel"]);
  });

  it("공백과 점이 든 키를 다룬다", () => {
    const steps = [{ input: { value: "{{ testUser.email }}" } }];
    expect(extractStepVariableKeys(steps)).toEqual(["testUser.email"]);
  });

  it("한 값 안의 여러 변수를 순서대로 잡는다", () => {
    const steps = [{ input: { value: "{{a}}-{{b}}-{{a}}" } }];
    expect(extractStepVariableKeys(steps)).toEqual(["a", "b"]);
  });

  it("스텝이 없으면 빈 배열", () => {
    expect(extractStepVariableKeys([])).toEqual([]);
  });
});

describe("detectScenarioVariables", () => {
  it("baseUrl · envLabel 은 변수 목록에서 제외한다", () => {
    const result = detectScenarioVariables({
      code: `process.env["TESTFLOW_VAR_baseUrl"]; process.env["TESTFLOW_VAR_envLabel"]; process.env["TESTFLOW_VAR_keep"];`,
      steps: [{ input: { value: "{{baseUrl}}/login" } }],
    });
    expect(result.variables.map((v) => v.key)).toEqual(["keep"]);
  });

  it("비밀 키를 isSecret 으로 표시한다", () => {
    const result = detectScenarioVariables({
      code: `process.env["TESTFLOW_VAR_lawyer_email"]; process.env["TESTFLOW_VAR_lawyer_password"];`,
    });
    expect(result.variables).toEqual([
      { key: "lawyer_email", isSecret: false },
      { key: "lawyer_password", isSecret: true },
    ]);
  });

  it("코드와 스텝을 합치고 중복을 없앤다", () => {
    const result = detectScenarioVariables({
      code: `process.env["TESTFLOW_VAR_username"];`,
      steps: [{ input: { value: "{{username}}" } }, { input: { value: "{{projectName}}" } }],
    });
    expect(result.variables.map((v) => v.key)).toEqual(["username", "projectName"]);
    expect(result.truncated).toBe(false);
  });

  it("상한을 넘으면 자르고 truncated 로 알린다", () => {
    const code = Array.from(
      { length: MAX_DETECTED_VARIABLES + 5 },
      (_, i) => `process.env["TESTFLOW_VAR_k${String(i)}"];`,
    ).join("\n");
    const result = detectScenarioVariables({ code });
    expect(result.variables).toHaveLength(MAX_DETECTED_VARIABLES);
    expect(result.truncated).toBe(true);
  });

  it("아무것도 없으면 빈 목록", () => {
    expect(detectScenarioVariables({})).toEqual({ variables: [], truncated: false });
  });

  it("★ 계정 3쌍(6키) 시나리오가 6개 전부 잡힌다", () => {
    const code = `
      const lawyerEmail = process.env["TESTFLOW_VAR_lawyer_email"] ?? "";
      const lawyerPassword = process.env["TESTFLOW_VAR_lawyer_password"] ?? "";
      const generalEmail = process.env["TESTFLOW_VAR_general_email"] ?? "";
      const generalPassword = process.env["TESTFLOW_VAR_general_password"] ?? "";
      const username = process.env["TESTFLOW_VAR_username"] ?? "";
      const password = process.env["TESTFLOW_VAR_password"] ?? "";
    `;
    const result = detectScenarioVariables({ code });
    expect(result.variables).toEqual([
      { key: "lawyer_email", isSecret: false },
      { key: "lawyer_password", isSecret: true },
      { key: "general_email", isSecret: false },
      { key: "general_password", isSecret: true },
      { key: "username", isSecret: false },
      { key: "password", isSecret: true },
    ]);
  });
});
