import { describe, expect, it } from "vitest";
import {
  CODEGEN_BASE_URL_ENV,
  CODEGEN_VAR_ENV_PREFIX,
  codegenFilename,
  referencedVariableKeys,
  renderLocator,
  renderStepValue,
  stepsToPlaywrightCode,
} from "./codegen.js";
import { validateScenarioCode } from "./code-validation.js";
import { DEFAULT_STEP_OPTIONS, TestStepArraySchema, type TestStep } from "./step.js";

/**
 * ★ 라운드 1 `04-gen-7.md` "실제 녹화 결과" 표의 **7스텝 전문**.
 *
 * 값을 지어내지 않았다 — `nth:1` / `nth:2` 로 좁힌 "삭제" 버튼 3개,
 * `{{password}}`(`isSecret`), `{{baseUrl}}` 접두 goto 까지 실측 그대로다.
 * 이 배열이 바뀌면 그것은 녹화 계약이 바뀐 것이므로 여기서 먼저 깨져야 한다.
 */
const RECORDED_7: TestStep[] = TestStepArraySchema.parse([
  {
    sequence: 1,
    name: "'/fixtures/record-login.html' 페이지로 이동",
    actionType: "goto",
    input: { value: "{{baseUrl}}/fixtures/record-login.html", isSecret: false },
    options: DEFAULT_STEP_OPTIONS,
  },
  {
    sequence: 2,
    name: "'아이디' 입력란에 값 입력",
    actionType: "fill",
    target: {
      primary: { by: "role", role: "textbox", name: "아이디", exact: true },
      fallbacks: [
        { by: "label", value: "아이디", exact: true },
        { by: "css", value: "#username" },
      ],
    },
    input: { value: "qa-tester", isSecret: false },
    options: DEFAULT_STEP_OPTIONS,
  },
  {
    sequence: 3,
    name: "'비밀번호' 입력란에 값 입력",
    actionType: "fill",
    target: {
      primary: { by: "label", value: "비밀번호", exact: true },
      fallbacks: [{ by: "css", value: "#password" }],
    },
    input: { value: "{{password}}", isSecret: true },
    options: DEFAULT_STEP_OPTIONS,
  },
  {
    sequence: 4,
    name: "'로그인' 버튼 클릭",
    actionType: "click",
    target: {
      primary: { by: "role", role: "button", name: "로그인", exact: true },
      fallbacks: [
        { by: "text", value: "로그인", exact: true },
        { by: "css", value: "#login-submit" },
      ],
    },
    options: DEFAULT_STEP_OPTIONS,
  },
  {
    sequence: 5,
    name: "'확인' 버튼 클릭",
    actionType: "click",
    target: {
      primary: { by: "testid", value: "confirm-a" },
      fallbacks: [
        { by: "role", role: "button", name: "확인", exact: true, nth: 0 },
        { by: "text", value: "확인", exact: true, nth: 0 },
      ],
    },
    options: DEFAULT_STEP_OPTIONS,
  },
  {
    sequence: 6,
    name: "'삭제' 버튼 클릭",
    actionType: "click",
    target: {
      primary: { by: "role", role: "button", name: "삭제", exact: true, nth: 1 },
      fallbacks: [{ by: "text", value: "삭제", exact: true, nth: 1 }],
    },
    options: DEFAULT_STEP_OPTIONS,
  },
  {
    sequence: 7,
    name: "'삭제' 버튼 클릭",
    actionType: "click",
    target: {
      primary: { by: "role", role: "button", name: "삭제", exact: true, nth: 2 },
      fallbacks: [{ by: "text", value: "삭제", exact: true, nth: 2 }],
    },
    options: DEFAULT_STEP_OPTIONS,
  },
]);

describe("stepsToPlaywrightCode — ★ 왕복 조건", () => {
  const code = stepsToPlaywrightCode(RECORDED_7, {
    testName: "로그인 후 삭제",
    scenarioCode: "TC-0007",
  });

  it("★ 생성 코드가 validateScenarioCode 를 issue 0건으로 통과한다", () => {
    expect(validateScenarioCode(code)).toEqual([]);
  });

  it("import 는 @playwright/test 1줄뿐이다", () => {
    const importLines = code.split("\n").filter((line) => line.trimStart().startsWith("import "));
    expect(importLines).toEqual(['import { expect, test } from "@playwright/test";']);
  });

  it("test( 블록이 정확히 1개다", () => {
    expect(code.match(/^test\(/gm)).toHaveLength(1);
    expect(code).toContain('test("로그인 후 삭제", async ({ page }) => {');
  });
});

describe("stepsToPlaywrightCode — ★ 비밀번호 평문 0건", () => {
  it("{{password}} 는 process.env 참조로 나간다", () => {
    const code = stepsToPlaywrightCode(RECORDED_7);
    expect(code).toContain(`process.env["${CODEGEN_VAR_ENV_PREFIX}password"] ?? ""`);
    // 변수 표기 자체가 코드에 남으면 그 문자열이 그대로 입력된다(라운드 1 `variables.ts` 근거).
    expect(code).not.toContain("{{password}}");
  });

  it("★ 비밀 값은 코드에 평문으로 박히지 않는다 — 실행 시 주입된 값만 쓴다", () => {
    // 라운드 1은 애초에 평문 비밀번호를 수집하지 않는다(`{{password}}` 만 DB 에 남는다).
    // 그래도 회귀 감시용으로 고정한다 — 이 단언이 깨지면 수집 정책이 바뀐 것이다.
    const code = stepsToPlaywrightCode(RECORDED_7);
    expect(code).not.toContain("hunter2");
    // 비밀번호 스텝(#3)은 env 참조로만 나간다.
    expect(code).toContain(
      'await page.getByLabel("비밀번호", { exact: true }).fill((process.env["TESTFLOW_VAR_password"] ?? ""), { timeout: 10000 });',
    );
    // 반면 비밀이 아닌 값(아이디)은 DB 에 이미 평문이고 화면에도 보이므로 그대로 나간다 — 의도된 차이다.
    expect(code).toContain('.fill("qa-tester", { timeout: 10000 });');
  });

  it("헤더 주석이 필요한 환경변수 이름을 전부 알려 준다", () => {
    const code = stepsToPlaywrightCode(RECORDED_7);
    expect(code).toContain(`//   ${CODEGEN_VAR_ENV_PREFIX}password`);
    expect(code).toContain(`//   ${CODEGEN_BASE_URL_ENV}`);
  });

  it("referencedVariableKeys 는 run 스냅샷 키(baseUrl)를 제외한다", () => {
    expect(referencedVariableKeys(RECORDED_7)).toEqual(["password"]);
  });
});

describe("renderLocator — 쟁점 7 표 그대로", () => {
  it("role", () => {
    expect(renderLocator({ by: "role", role: "button", name: "로그인", exact: true })).toBe(
      'page.getByRole("button", { name: "로그인", exact: true })',
    );
  });
  it("role — name 이 없으면 옵션 객체를 만들지 않는다", () => {
    expect(renderLocator({ by: "role", role: "textbox" })).toBe('page.getByRole("textbox")');
  });
  it("label", () => {
    expect(renderLocator({ by: "label", value: "아이디", exact: true })).toBe(
      'page.getByLabel("아이디", { exact: true })',
    );
  });
  it("text", () => {
    expect(renderLocator({ by: "text", value: "로그인", exact: true })).toBe(
      'page.getByText("로그인", { exact: true })',
    );
  });
  it("testid", () => {
    expect(renderLocator({ by: "testid", value: "confirm-a" })).toBe(
      'page.getByTestId("confirm-a")',
    );
  });
  it("css", () => {
    expect(renderLocator({ by: "css", value: "#login-submit" })).toBe(
      'page.locator("#login-submit")',
    );
  });

  it("★ nth 가 있으면 .nth(n) 이 붙는다", () => {
    expect(renderLocator({ by: "role", role: "button", name: "삭제", exact: true, nth: 1 })).toBe(
      'page.getByRole("button", { name: "삭제", exact: true }).nth(1)',
    );
    expect(renderLocator({ by: "testid", value: "row", nth: 0 })).toBe(
      'page.getByTestId("row").nth(0)',
    );
  });
});

describe("stepsToPlaywrightCode — 실측 7스텝의 출력", () => {
  const code = stepsToPlaywrightCode(RECORDED_7);

  it("★ nth:1 / nth:2 스텝이 .nth(1) / .nth(2) 로 나온다", () => {
    expect(code).toContain('page.getByRole("button", { name: "삭제", exact: true }).nth(1).click(');
    expect(code).toContain('page.getByRole("button", { name: "삭제", exact: true }).nth(2).click(');
  });

  it("{{baseUrl}} 접두 goto 는 상대 경로가 된다 (use.baseURL 이 채워 준다)", () => {
    expect(code).toContain('await page.goto("/fixtures/record-login.html");');
  });

  it("fallback 후보를 버리지 않고 주석으로 남긴다", () => {
    expect(code).toContain('대체 후보(Playwright 에는 순위 개념이 없어 주석으로만 남깁니다): page.getByLabel("아이디", { exact: true }) · page.locator("#username")');
  });

  it("원래 스텝 이름이 주석으로 보존된다", () => {
    expect(code).toContain("// 3. 입력 — '비밀번호' 입력란에 값 입력");
  });

  it("스텝 타임아웃이 그대로 실린다", () => {
    expect(code).toContain("{ timeout: 10000 }");
  });
});

describe("stepsToPlaywrightCode — 동작 12종 매핑", () => {
  const one = (step: Partial<TestStep> & Pick<TestStep, "actionType">): string =>
    stepsToPlaywrightCode(
      TestStepArraySchema.parse([
        { sequence: 1, name: "s", options: DEFAULT_STEP_OPTIONS, ...step },
      ]),
    );

  const target = { primary: { by: "css" as const, value: "#x" }, fallbacks: [] };

  it("wait → waitForTimeout", () => {
    expect(one({ actionType: "wait", options: { ...DEFAULT_STEP_OPTIONS, waitMs: 1500 } })).toContain(
      "await page.waitForTimeout(1500);",
    );
  });
  it("hover / check / uncheck / press / select", () => {
    expect(one({ actionType: "hover", target })).toContain('page.locator("#x").hover(');
    expect(one({ actionType: "check", target })).toContain('page.locator("#x").check(');
    expect(one({ actionType: "uncheck", target })).toContain('page.locator("#x").uncheck(');
    expect(one({ actionType: "press", target, input: { value: "Enter", isSecret: false } })).toContain(
      'page.locator("#x").press("Enter", { timeout: 10000 });',
    );
    expect(one({ actionType: "select", target, input: { value: "stg", isSecret: false } })).toContain(
      'page.locator("#x").selectOption("stg", { timeout: 10000 });',
    );
  });
  it("assert_visible → toBeVisible", () => {
    expect(one({ actionType: "assert_visible", target })).toContain(
      'await expect(page.locator("#x")).toBeVisible({ timeout: 10000 });',
    );
  });
  it("★ assert_text 는 포함 비교다 → toContainText (toHaveText 가 아니다)", () => {
    const code = one({ actionType: "assert_text", target, input: { value: "로그인 성공", isSecret: false } });
    expect(code).toContain('toContainText("로그인 성공", { timeout: 10000 });');
    expect(code).not.toContain("toHaveText");
  });
  it("★ assert_url 도 포함 비교다 → RegExp 로 낸다 (메타문자 이스케이프)", () => {
    const code = one({ actionType: "assert_url", input: { value: "/dashboard?a=1", isSecret: false } });
    expect(code).toContain('await expect(page).toHaveURL(new RegExp("/dashboard\\\\?a=1"), { timeout: 10000 });');
  });
  it("optional 스텝은 try/catch 로 감싼다", () => {
    const code = one({ actionType: "click", target, options: { ...DEFAULT_STEP_OPTIONS, optional: true } });
    expect(code).toContain("  try {");
    expect(code).toContain("  } catch {");
  });
});

describe("renderStepValue", () => {
  it("변수가 없으면 평범한 문자열 리터럴", () => {
    expect(renderStepValue("qa-tester")).toBe('"qa-tester"');
  });
  it("값 전체가 변수 하나면 괄호 표현식", () => {
    expect(renderStepValue("{{password}}")).toBe('(process.env["TESTFLOW_VAR_password"] ?? "")');
  });
  it("공백이 든 표기도 같은 키로 본다", () => {
    expect(renderStepValue("{{ testUser.email }}")).toBe(
      '(process.env["TESTFLOW_VAR_testUser.email"] ?? "")',
    );
  });
  it("섞여 있으면 템플릿 리터럴", () => {
    expect(renderStepValue("id-{{seq}}-end")).toBe(
      '`id-${process.env["TESTFLOW_VAR_seq"] ?? ""}-end`',
    );
  });
  it("★ 템플릿 안의 백틱·${ 를 이스케이프한다 (코드 주입 방지)", () => {
    expect(renderStepValue("`${alert(1)}`{{k}}")).toBe(
      '`\\`\\${alert(1)}\\`${process.env["TESTFLOW_VAR_k"] ?? ""}`',
    );
  });
  it("baseUrl 은 TESTFLOW_BASE_URL 을 본다", () => {
    expect(renderStepValue("{{baseUrl}}")).toBe(`(process.env["${CODEGEN_BASE_URL_ENV}"] ?? "")`);
  });
});

describe("codegenFilename", () => {
  it("시나리오 코드를 파일명 규약에 맞춘다", () => {
    expect(codegenFilename("TC-0007")).toBe("tc-0007.spec.ts");
  });
  it("★ 경로 문자와 선두 점이 제거된다", () => {
    expect(codegenFilename("../../etc/passwd")).toBe("etcpasswd.spec.ts");
    expect(codegenFilename("/etc/passwd")).toBe("etcpasswd.spec.ts");
  });
  it("비어 있거나 전부 걸러지면 기본 이름", () => {
    expect(codegenFilename()).toBe("recorded.spec.ts");
    expect(codegenFilename("../")).toBe("recorded.spec.ts");
    expect(codegenFilename("한글만")).toBe("recorded.spec.ts");
  });
});

describe("stepsToPlaywrightCode — 경계", () => {
  it("스텝 0개여도 유효한 코드가 나온다", () => {
    const code = stepsToPlaywrightCode([]);
    expect(validateScenarioCode(code)).toEqual([]);
    expect(code).toContain("// 내보낼 단계가 없습니다.");
  });
  it("frameUrl 은 주석으로 경고한다 (frameLocator 변환은 범위 밖)", () => {
    const code = stepsToPlaywrightCode(
      TestStepArraySchema.parse([
        {
          sequence: 1,
          name: "프레임 안 클릭",
          actionType: "click",
          target: {
            primary: { by: "css", value: "#x" },
            fallbacks: [],
            frameUrl: "https://example.com/embed",
          },
          options: DEFAULT_STEP_OPTIONS,
        },
      ]),
    );
    expect(code).toContain("// ⚠ iframe 안의 요소입니다 (https://example.com/embed).");
  });
});
