import { describe, expect, it } from "vitest";
import {
  MAX_DEFAULT_TEXT_LENGTH,
  MAX_DETECTED_VARIABLES,
  RunVariableSchema,
  detectScenarioVariables,
  effectiveVariableDefault,
  extractCodeRequiredKeys,
  extractCodeVariableDefaults,
  extractCodeVariableKeys,
  extractStepVariableKeys,
  isOptionalVariable,
  variablePrefillValue,
  type RunVariable,
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
      { key: "lawyer_email", isSecret: false, required: false, defaultValue: null },
      { key: "lawyer_password", isSecret: true, required: false, defaultValue: null },
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
    // ★ `?? ""` 는 **빈 문자열 기본값**이다 — "기본값 없음" 이 아니다.
    const empty = { kind: "literal", text: "", truncatedText: false, exactText: true };
    expect(result.variables).toEqual([
      { key: "lawyer_email", isSecret: false, required: false, defaultValue: empty },
      { key: "lawyer_password", isSecret: true, required: false, defaultValue: empty },
      { key: "general_email", isSecret: false, required: false, defaultValue: empty },
      { key: "general_password", isSecret: true, required: false, defaultValue: empty },
      { key: "username", isSecret: false, required: false, defaultValue: empty },
      { key: "password", isSecret: true, required: false, defaultValue: empty },
    ]);
  });
});

/* ────────────────────────────────────────────────────────────
 * ★ 라운드 10 — 기본값
 * ──────────────────────────────────────────────────────────── */

describe("extractCodeVariableDefaults", () => {
  const defaultOf = (code: string, key: string) => extractCodeVariableDefaults(code).get(key);

  it("|| 뒤의 쌍따옴표 리터럴을 잡는다", () => {
    expect(defaultOf(`process.env["TESTFLOW_VAR_kw"] || "변호사"`, "kw")).toEqual({
      kind: "literal",
      text: "변호사",
      truncatedText: false,
      exactText: true,
    });
  });

  it("?? 와 홑따옴표도 잡는다", () => {
    expect(defaultOf(`const a = process.env['TESTFLOW_VAR_a'] ?? 'qa-tester';`, "a")).toEqual({
      kind: "literal",
      text: "qa-tester",
      truncatedText: false,
      exactText: true,
    });
  });

  it("점 접근 형태도 잡는다", () => {
    expect(defaultOf(`process.env.TESTFLOW_VAR_b || "x"`, "b")).toEqual({
      kind: "literal",
      text: "x",
      truncatedText: false,
      exactText: true,
    });
  });

  it("★ 빈 문자열 기본값은 **기본값이 있는 것**이다", () => {
    expect(defaultOf(`process.env["TESTFLOW_VAR_row"] || ""`, "row")).toEqual({
      kind: "literal",
      text: "",
      truncatedText: false,
      exactText: true,
    });
  });

  it("★ 치환이 든 템플릿 리터럴은 dynamic 이고 원문을 싣지 않는다", () => {
    expect(defaultOf("process.env[`X`]; process.env['TESTFLOW_VAR_n'] || `test-${Date.now()}`", "n")).toEqual({
      kind: "dynamic",
      text: "",
      truncatedText: false,
      exactText: true,
    });
  });

  it("치환이 **없는** 템플릿은 값을 아는 리터럴이다", () => {
    expect(defaultOf("process.env['TESTFLOW_VAR_t'] || `고정값`", "t")).toEqual({
      kind: "literal",
      text: "고정값",
      truncatedText: false,
      exactText: true,
    });
  });

  it("이스케이프를 사람이 읽는 문자열로 되돌린다", () => {
    expect(defaultOf(`process.env["TESTFLOW_VAR_e"] || "a\\"b\\u0041"`, "e")?.text).toBe('a"bA');
  });

  it("줄바꿈은 공백으로 접는다(칸에서 안 보이는 글자가 되지 않게)", () => {
    expect(defaultOf(`process.env["TESTFLOW_VAR_m"] || "a\\nb"`, "m")?.text).toBe("a b");
  });

  it("너무 긴 리터럴은 잘리고 truncatedText 로 알린다", () => {
    const long = "가".repeat(MAX_DEFAULT_TEXT_LENGTH + 10);
    const result = defaultOf(`process.env["TESTFLOW_VAR_l"] || "${long}"`, "l");
    expect(result?.text).toHaveLength(MAX_DEFAULT_TEXT_LENGTH);
    expect(result?.truncatedText).toBe(true);
  });

  it("같은 키가 여러 번이면 처음 것이 이긴다", () => {
    const code = `
      process.env["TESTFLOW_VAR_d"] || "첫번째";
      process.env["TESTFLOW_VAR_d"] || "두번째";
    `;
    expect(defaultOf(code, "d")?.text).toBe("첫번째");
  });

  it("주석 안의 기본값은 세지 않는다", () => {
    const code = `
      // process.env["TESTFLOW_VAR_g"] || "주석"
      const g = process.env["TESTFLOW_VAR_g"];
    `;
    expect(defaultOf(code, "g")).toBeUndefined();
  });

  /* ────────────────────────────────────────────────────────────
   * ★ 한계를 **통과하는 테스트로 고정**한다.
   *   아래는 실제로 기본값이 있는데도 "없음"으로 떨어진다 → 화면에서 **필수**로 보인다.
   *   그 방향이 안전하다(`run-variables.ts` 머리 주석).
   * ──────────────────────────────────────────────────────────── */
  describe("★ 잡지 못하는 형태 — 기본값 없음으로 떨어진다(안전한 방향)", () => {
    it("접근과 || 사이에 다른 것이 끼면 못 잡는다", () => {
      expect(defaultOf(`process.env["TESTFLOW_VAR_a"]?.trim() || "x"`, "a")).toBeUndefined();
    });

    it("상수 참조 기본값은 못 잡는다(값을 알 수 없다)", () => {
      expect(defaultOf(`process.env["TESTFLOW_VAR_b"] || FALLBACK`, "b")).toBeUndefined();
    });

    it("변수에 담았다가 나중에 || 하면 못 잡는다", () => {
      const code = `const c = process.env["TESTFLOW_VAR_c"]; const d = c || "x";`;
      expect(defaultOf(code, "c")).toBeUndefined();
    });

    it("삼항 연산자는 못 잡는다", () => {
      const code = `const e = process.env["TESTFLOW_VAR_e"] !== undefined ? process.env["TESTFLOW_VAR_e"] : "x";`;
      expect(defaultOf(code, "e")).toBeUndefined();
    });
  });
});

describe("★ 필수 / 선택 가르기", () => {
  /** 실제 `project-save` 시나리오와 같은 모양 — 기본값 있는 것과 없는 것이 섞여 있다. */
  const CODE = `
    const username = process.env["TESTFLOW_VAR_username"];
    const password = process.env["TESTFLOW_VAR_password"];
    if (!username || !password) throw new Error("계정이 필요합니다");
    const recipientSearchKeyword = process.env["TESTFLOW_VAR_recipientSearchKeyword"] || "변호사";
    const relatedDocLegalAdviceRow = process.env["TESTFLOW_VAR_relatedDocLegalAdviceRow"] || "";
    const newProjectName = process.env["TESTFLOW_VAR_newProjectName"] || \`test-\${Date.now()}\`;
  `;

  it("기본값이 없는 것만 필수다", () => {
    const { variables } = detectScenarioVariables({ code: CODE });
    expect(variables.filter((v) => !isOptionalVariable(v)).map((v) => v.key)).toEqual([
      "username",
      "password",
    ]);
    expect(variables.filter(isOptionalVariable).map((v) => v.key)).toEqual([
      "recipientSearchKeyword",
      "relatedDocLegalAdviceRow",
      "newProjectName",
    ]);
  });

  it("빈 문자열 기본값도 **선택**이다", () => {
    const { variables } = detectScenarioVariables({ code: CODE });
    const row = variables.find((v) => v.key === "relatedDocLegalAdviceRow");
    expect(row?.defaultValue).toEqual({
      kind: "literal",
      text: "",
      truncatedText: false,
      exactText: true,
    });
    expect(isOptionalVariable(row as never)).toBe(true);
  });

  it("★ 녹화(steps) 의 {{키}} 는 전부 필수다 — 스텝에는 기본값 개념이 없다", () => {
    const { variables } = detectScenarioVariables({
      steps: [{ input: { value: "{{username}}" } }, { input: { value: "{{keyword}}" } }],
    });
    expect(variables.every((v) => v.defaultValue === null)).toBe(true);
    expect(variables.some(isOptionalVariable)).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────
 * ★ 라운드 11 — 가드(필수 선언) · 자동 바인딩
 * ──────────────────────────────────────────────────────────── */

describe("extractCodeRequiredKeys", () => {
  it("★ 가이드의 배열 리터럴 순회 가드를 잡는다", () => {
    const code = `
      for (const key of ['TESTFLOW_VAR_username', 'TESTFLOW_VAR_password']) {
        if (!(process.env[key] ?? '')) {
          throw new Error(\`실행 변수 \${key} 가 필요합니다.\`);
        }
      }
    `;
    expect(extractCodeRequiredKeys(code)).toEqual(["username", "password"]);
  });

  it("개별 if 가드도 잡는다(블록 · 한 줄 둘 다)", () => {
    const code = `
      if (!process.env["TESTFLOW_VAR_a"]) throw new Error("a 가 필요합니다");
      if (!(process.env['TESTFLOW_VAR_b'] ?? '')) { throw new Error('b'); }
    `;
    expect(extractCodeRequiredKeys(code)).toEqual(["a", "b"]);
  });

  it("throw 말고 test.skip · process.exit 로 멈춰도 가드다", () => {
    const code = `
      if (!process.env["TESTFLOW_VAR_a"]) test.skip();
      if (!process.env["TESTFLOW_VAR_b"]) process.exit(1);
    `;
    expect(extractCodeRequiredKeys(code)).toEqual(["a", "b"]);
  });

  it("조건부 test.skip 호출의 인자도 읽는다", () => {
    const code = `test.skip(!process.env["TESTFLOW_VAR_a"], "계정이 없습니다");`;
    expect(extractCodeRequiredKeys(code)).toEqual(["a"]);
  });

  it("문자열 안의 괄호·중괄호에 속지 않는다", () => {
    const code = `
      if (!process.env["TESTFLOW_VAR_a"]) throw new Error("괄호 ) 와 중괄호 } 가 든 메시지");
      const b = process.env["TESTFLOW_VAR_b"] ?? "x";
    `;
    expect(extractCodeRequiredKeys(code)).toEqual(["a"]);
  });

  it("주석 안의 가드는 세지 않는다", () => {
    const code = `// if (!process.env["TESTFLOW_VAR_ghost"]) throw new Error("x");`;
    expect(extractCodeRequiredKeys(code)).toEqual([]);
  });

  describe("★ 일부러 좁게 잡는다 — 아래는 가드로 보지 않는다", () => {
    it("멈추지 않는 if 는 가드가 아니다", () => {
      const code = `if (process.env["TESTFLOW_VAR_debug"]) { await page.screenshot(); }`;
      expect(extractCodeRequiredKeys(code)).toEqual([]);
    });

    it("★ 몸통에만 있는 키는 세지 않는다(평범한 블록이 통째로 가드가 되면 안 된다)", () => {
      const code = `
        if (await dialogVisible()) {
          await page.fill('#name', process.env["TESTFLOW_VAR_name"] ?? '기본');
          if (bad) throw new Error('x');
        }
      `;
      expect(extractCodeRequiredKeys(code)).toEqual([]);
    });

    it("상수 배열을 거치면 못 잡는다(값 추적이 필요하다)", () => {
      const code = `
        const KEYS = ['TESTFLOW_VAR_username'];
        for (const key of KEYS) { if (!process.env[key]) throw new Error('x'); }
      `;
      expect(extractCodeRequiredKeys(code)).toEqual([]);
    });

    it("변수에 담았다가 검사하면 못 잡는다", () => {
      const code = `
        const u = process.env["TESTFLOW_VAR_username"];
        if (!u) throw new Error("계정이 필요합니다");
      `;
      expect(extractCodeRequiredKeys(code)).toEqual([]);
    });

    it("forEach 순회는 못 잡는다", () => {
      const code = `['TESTFLOW_VAR_username'].forEach((k) => { if (!process.env[k]) throw new Error('x'); });`;
      expect(extractCodeRequiredKeys(code)).toEqual([]);
    });
  });
});

describe("★ 라운드 11 — project-save 형태(가드 + ?? '')", () => {
  /**
   * 배포본에서 **계정·비밀번호가 접힌 섹션으로 숨은** 바로 그 모양이다.
   * `?? ''` 는 타입 안전용이고, 필수라는 사실은 **가드**가 말한다.
   */
  const CODE = `
    test('법무 프로젝트 조회', async ({ page }) => {
      for (const key of ['TESTFLOW_VAR_username', 'TESTFLOW_VAR_password']) {
        if (!(process.env[key] ?? '')) {
          throw new Error(\`실행 변수 \${key} 가 필요합니다.\`);
        }
      }
      const projectName = process.env['TESTFLOW_VAR_projectName'] ?? 'project-save-';
      const keyword = process.env['TESTFLOW_VAR_keyword'] || '변호사';
      const row = process.env['TESTFLOW_VAR_relatedDocLegalAdviceRow'] || '';
      const newName = process.env['TESTFLOW_VAR_newProjectName'] || \`test-\${Date.now()}\`;
      await page.getByRole('textbox', { name: '이메일' }).fill(process.env['TESTFLOW_VAR_username'] ?? '');
      await page.getByRole('textbox', { name: '비밀번호' }).fill(process.env['TESTFLOW_VAR_password'] ?? '');
    });
  `;

  const detected = detectScenarioVariables({ code: CODE }).variables;
  const find = (key: string) => detected.find((v) => v.key === key) as RunVariable;

  it("★ 계정·비밀번호가 필수로 올라온다 — `?? ''` 가 있어도", () => {
    expect(detected.filter((v) => !isOptionalVariable(v)).map((v) => v.key)).toEqual([
      "username",
      "password",
    ]);
  });

  it("★ `?? ''` 는 응답에서 지우지 않는다 — 판정을 되짚을 수 있어야 한다", () => {
    expect(find("username").required).toBe(true);
    expect(find("username").defaultValue).toEqual({
      kind: "literal",
      text: "",
      truncatedText: false,
      exactText: true,
    });
  });

  it("필수 칸에는 **채울 값도 보여 줄 기본값도 없다**(가드가 그 코드에 닿지 못한다)", () => {
    expect(effectiveVariableDefault(find("password"))).toBeNull();
    expect(variablePrefillValue(find("password"))).toBeNull();
  });

  it("나머지는 선택이고 리터럴 기본값이 칸에 채워진다", () => {
    expect(detected.filter(isOptionalVariable).map((v) => v.key)).toEqual([
      "projectName",
      "keyword",
      "relatedDocLegalAdviceRow",
      "newProjectName",
    ]);
    expect(variablePrefillValue(find("projectName"))).toBe("project-save-");
    expect(variablePrefillValue(find("keyword"))).toBe("변호사");
  });

  it("빈 문자열 기본값은 채워도 빈 칸이다(그게 정직하다)", () => {
    expect(variablePrefillValue(find("relatedDocLegalAdviceRow"))).toBe("");
  });

  it("★ 템플릿 기본값은 채우지 않는다 — 채울 값이 존재하지 않는다", () => {
    expect(find("newProjectName").defaultValue?.kind).toBe("dynamic");
    expect(variablePrefillValue(find("newProjectName"))).toBeNull();
  });
});

describe("★ variablePrefillValue — 잘리거나 변형된 기본값은 절대 채우지 않는다", () => {
  const detect = (code: string, key: string) =>
    detectScenarioVariables({ code }).variables.find((v) => v.key === key) as RunVariable;

  it("★ 길이 상한을 넘은 기본값은 채우지 않는다(원문과 다른 값이 전송된다)", () => {
    const long = "가".repeat(MAX_DEFAULT_TEXT_LENGTH + 10);
    const variable = detect(`process.env["TESTFLOW_VAR_l"] || "${long}"`, "l");
    expect(variable.defaultValue?.truncatedText).toBe(true);
    expect(variable.defaultValue?.exactText).toBe(false);
    expect(variablePrefillValue(variable)).toBeNull();
    // 그래도 **선택**이다 — 비우면 코드의 긴 값이 그대로 쓰인다.
    expect(isOptionalVariable(variable)).toBe(true);
  });

  it("★ 제어문자가 접힌 기본값도 채우지 않는다(원문은 줄바꿈이었다)", () => {
    const variable = detect(`process.env["TESTFLOW_VAR_m"] || "a\\nb"`, "m");
    expect(variable.defaultValue?.text).toBe("a b");
    expect(variable.defaultValue?.truncatedText).toBe(false);
    expect(variable.defaultValue?.exactText).toBe(false);
    expect(variablePrefillValue(variable)).toBeNull();
  });

  it("상한 안의 평범한 리터럴은 그대로 채운다", () => {
    const variable = detect(`process.env["TESTFLOW_VAR_n"] || "문채원 (cwmoon)"`, "n");
    expect(variable.defaultValue?.exactText).toBe(true);
    expect(variablePrefillValue(variable)).toBe("문채원 (cwmoon)");
  });
});

describe("★ 라운드 11 — 구버전 응답 호환", () => {
  it("required · exactText 가 없는 응답도 파싱되고 판정이 라운드 10 과 같다", () => {
    const parsed = RunVariableSchema.parse({
      key: "keyword",
      isSecret: false,
      defaultValue: { kind: "literal", text: "변호사" },
    });
    expect(parsed.required).toBe(false);
    expect(parsed.defaultValue?.exactText).toBe(true);
    expect(isOptionalVariable(parsed)).toBe(true);
    expect(variablePrefillValue(parsed)).toBe("변호사");
  });
});
