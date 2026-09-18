/**
 * 녹화 스텝(`test_steps`) → Playwright 코드(`.spec.ts`) 내보내기 — **순수 함수**.
 *
 * ════════════════════════════════════════════════════════════════════
 * 왜 `packages/contracts` 에 두는가
 *
 * 입력이 `TestStep`(계약)이고 출력이 `validateScenarioCode()`(같은 패키지)를 통과해야 하는
 * 문자열이다. 두 계약 사이의 **변환**이라 계약 옆에 있어야 한다. web 이 이 함수를 직접
 * 부르고(모달·다운로드), 나중에 API 가 서버 측 내보내기를 열더라도 **같은 함수**를 쓴다.
 * 두 벌이 되는 순간 "화면에 보인 코드"와 "내려받은 코드"가 달라진다.
 * ════════════════════════════════════════════════════════════════════
 *
 * ## ★ 비밀번호를 코드에 평문으로 박지 않는다
 *
 * 라운드 1은 **애초에 평문을 수집하지 않는다** — `test_steps.input_json.value` 에는
 * `{{password}}` 같은 **변수 참조만** 들어간다(실제 값은 실행 요청 body 의 `variables` 로만
 * 들어오고 DB 에 남지 않는다). 그래서 낼 평문 자체가 없다.
 *
 * 그럼에도 **모든** `{{키}}` 를 `process.env["TESTFLOW_VAR_<키>"]` 참조로 낸다:
 *
 * - Runner 의 `code-workspace.ts` 가 실행 요청의 `variables` 를 **정확히 그 이름**
 *   (`TESTFLOW_VAR_<KEY>`)으로 테스트 프로세스에 넘긴다. 즉 내보낸 코드를 **코드 시나리오로
 *   다시 넣고 같은 `variables` 로 실행하면 녹화 실행과 동일하게 동작**한다(왕복).
 * - `isSecret` 여부로 표기를 가르지 않는다. 가르면 "secret 이 아닌 값은 평문으로 나간다"는
 *   경로가 생기고, 그 판정이 한 번만 틀려도 비밀번호가 파일로 새어 나간다.
 *   **한 가지 방식만 두는 쪽이 안전하다.**
 *
 * ## `{{baseUrl}}` 만 예외다
 *
 * `goto` 의 `{{baseUrl}}` 접두사는 **떼고 상대 경로로** 낸다 — 생성 config 의 `use.baseURL` 이
 * 실행 요청의 `baseUrl` 로 이미 채워지므로(`pw-config.ts` `PW_ENV.baseUrl`) `page.goto("/login")`
 * 이 녹화 실행과 같은 주소로 간다. `assert_url` 처럼 문자열 비교에 쓰이는 자리에서는 뗄 수 없어
 * `process.env["TESTFLOW_BASE_URL"]` 참조로 낸다(Runner 가 같은 이름으로 넘긴다).
 *
 * ## 이번 범위 밖 (의도적으로 하지 않는 것)
 *
 * - **`frameUrl` → `frameLocator()` 변환.** 녹화가 남기는 것은 frame 의 **URL** 이고
 *   `frameLocator()` 가 받는 것은 **선택자**다. URL → 선택자 역산은 추측이 되고, 추측한 코드가
 *   조용히 top frame 을 집으면 사용자는 "왜 안 되는지" 알 수 없다.
 *   → **주석으로 표시**하고 top frame 기준 코드를 낸다. 사용자가 직접 고칠 수 있게 사실을 적는다.
 * - **fallback 후보 체인.** Playwright 에는 "1순위가 실패하면 2순위" 가 없다.
 *   → primary 로 코드를 내고 fallback 목록은 **주석**으로 남긴다(정보를 버리지 않는다).
 * - **`optional` 스텝의 정확한 재현.** 해석기는 실패 시 `skipped` 로 기록하고 계속 간다.
 *   → `try { … } catch { … }` 로 낸다. 상태가 `skipped` 로 남지는 않는다(코드 실행에는 그 상태가 없다).
 */
import {
  ACTION_CHIP_LABEL,
  DEFAULT_STEP_TIMEOUT_MS,
  type ActionType,
  type LocatorCandidate,
  type LocatorTarget,
  type TestStep,
} from "./step.js";

/* ────────────────────────────────────────────────────────────
 * 0. 상수
 * ──────────────────────────────────────────────────────────── */

/**
 * `{{키}}` 가 나가는 환경변수 접두사.
 *
 * ★ Runner `code-workspace.ts` 의 `TESTFLOW_VAR_ENV_PREFIX` 와 **같은 값**이어야 한다.
 *   그쪽은 runner 내부 상수라 여기서 import 할 수 없다(contracts 가 runner 에 의존할 수 없다).
 *   값이 어긋나면 내보낸 코드가 변수를 못 읽는다 — `codegen.spec.ts` 가 문자열로 고정한다.
 */
export const CODEGEN_VAR_ENV_PREFIX = "TESTFLOW_VAR_";

/** 실행 요청 `baseUrl` 이 실리는 환경변수 이름. Runner `PW_ENV.baseUrl` 과 같은 값. */
export const CODEGEN_BASE_URL_ENV = "TESTFLOW_BASE_URL";

/** `{{baseUrl}}` / `{{envLabel}}` — 사용자 변수가 아니라 run 스냅샷이다(`variables.ts`). */
const RUN_SCOPE_KEYS = new Set(["baseUrl", "envLabel"]);

/** `variables.ts` 의 `PLACEHOLDER` 와 같은 형태. 점이 든 키(`testUser.email`)도 한 덩어리다. */
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export type CodegenOptions = {
  /** `test("…")` 의 제목. 보통 시나리오 이름. 비우면 `"녹화 시나리오"`. */
  testName?: string;
  /** 헤더 주석에 적을 시나리오 코드(`TC-0007`). */
  scenarioCode?: string;
  /** 헤더 주석에 적을 생성 시각(ISO). 호출부가 넘긴다 — 순수 함수를 유지하기 위해 내부에서 시계를 읽지 않는다. */
  generatedAt?: string;
};

/* ────────────────────────────────────────────────────────────
 * 1. 리터럴 만들기
 * ──────────────────────────────────────────────────────────── */

/** `{{키}}` 한 개를 무엇으로 낼 것인가. */
function envExpression(key: string): string {
  if (key === "baseUrl") return `process.env[${JSON.stringify(CODEGEN_BASE_URL_ENV)}] ?? ""`;
  return `process.env[${JSON.stringify(`${CODEGEN_VAR_ENV_PREFIX}${key}`)}] ?? ""`;
}

/** 템플릿 리터럴 안의 고정 문자열 부분을 안전하게 만든다. */
function escapeTemplateChunk(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

/**
 * 스텝 값(`input.value`) → JS 표현식 문자열.
 *
 * `{{키}}` 가 없으면 평범한 문자열 리터럴, 있으면 **템플릿 리터럴**이다.
 * 값 전체가 `{{키}}` 하나뿐이면 괄호로 감싼 표현식만 낸다(불필요한 템플릿을 만들지 않는다).
 */
export function renderStepValue(value: string): string {
  PLACEHOLDER.lastIndex = 0;
  const whole = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value);
  if (whole) return `(${envExpression((whole[1] ?? "").trim())})`;

  if (!/\{\{\s*[^{}]+?\s*\}\}/.test(value)) return JSON.stringify(value);

  let out = "`";
  let cursor = 0;
  PLACEHOLDER.lastIndex = 0;
  let match: RegExpExecArray | null = PLACEHOLDER.exec(value);
  while (match !== null) {
    out += escapeTemplateChunk(value.slice(cursor, match.index));
    out += `\${${envExpression((match[1] ?? "").trim())}}`;
    cursor = match.index + match[0].length;
    match = PLACEHOLDER.exec(value);
  }
  out += escapeTemplateChunk(value.slice(cursor));
  return `${out}\``;
}

/** 이 본문이 참조하는 `{{키}}` 전량(중복 제거, 등장 순서). run 스냅샷 키는 뺀다. */
export function referencedVariableKeys(steps: readonly TestStep[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const value = step.input?.value ?? "";
    PLACEHOLDER.lastIndex = 0;
    for (const match of value.matchAll(PLACEHOLDER)) {
      const key = (match[1] ?? "").trim();
      if (key === "" || RUN_SCOPE_KEYS.has(key) || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/* ────────────────────────────────────────────────────────────
 * 2. Locator
 * ──────────────────────────────────────────────────────────── */

/**
 * 후보 1개 → `page.getBy…(…)` 표현식. 03-phases 쟁점 7 의 표 그대로다.
 *
 * | `by` | 출력 |
 * |---|---|
 * | `role` | `page.getByRole("button", { name: "로그인", exact: true })` |
 * | `label` | `page.getByLabel("아이디", { exact: true })` |
 * | `text` | `page.getByText("로그인", { exact: true })` |
 * | `testid` | `page.getByTestId("confirm-a")` |
 * | `css` | `page.locator("#login-submit")` |
 *
 * `nth` 가 있으면 뒤에 `.nth(n)` 를 붙인다.
 */
export function renderLocator(candidate: LocatorCandidate, root = "page"): string {
  const suffix = candidate.nth === undefined ? "" : `.nth(${String(candidate.nth)})`;

  switch (candidate.by) {
    case "role": {
      const options: string[] = [];
      if (candidate.name !== undefined && candidate.name !== "") {
        options.push(`name: ${JSON.stringify(candidate.name)}`);
      }
      if (candidate.exact === true) options.push("exact: true");
      const args =
        options.length === 0
          ? JSON.stringify(candidate.role)
          : `${JSON.stringify(candidate.role)}, { ${options.join(", ")} }`;
      return `${root}.getByRole(${args})${suffix}`;
    }
    case "label": {
      const args =
        candidate.exact === true
          ? `${JSON.stringify(candidate.value)}, { exact: true }`
          : JSON.stringify(candidate.value);
      return `${root}.getByLabel(${args})${suffix}`;
    }
    case "text": {
      const args =
        candidate.exact === true
          ? `${JSON.stringify(candidate.value)}, { exact: true }`
          : JSON.stringify(candidate.value);
      return `${root}.getByText(${args})${suffix}`;
    }
    case "testid":
      return `${root}.getByTestId(${JSON.stringify(candidate.value)})${suffix}`;
    case "css":
      return `${root}.locator(${JSON.stringify(candidate.value)})${suffix}`;
    default: {
      // ★ exhaustiveness. `LOCATOR_BY` 가 늘면 여기서 컴파일이 깨진다.
      const exhaustive: never = candidate;
      throw new Error(`알 수 없는 locator 입니다: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** primary 외의 정보(fallback·frame)를 버리지 않고 주석으로 남긴다. */
function locatorNotes(target: LocatorTarget): string[] {
  const notes: string[] = [];
  if (target.frameUrl !== null && target.frameUrl !== undefined && target.frameUrl !== "") {
    notes.push(
      `iframe 안의 요소입니다 (${target.frameUrl}). ` +
        `아래 코드는 최상위 문서 기준이라 그대로는 찾지 못할 수 있습니다 — frameLocator() 로 감싸 주세요.`,
    );
  }
  if (target.fallbacks.length > 0) {
    notes.push(
      `대체 후보(Playwright 에는 순위 개념이 없어 주석으로만 남깁니다): ` +
        target.fallbacks.map((c) => renderLocator(c)).join(" · "),
    );
  }
  return notes;
}

/* ────────────────────────────────────────────────────────────
 * 3. 스텝 → 문장
 * ──────────────────────────────────────────────────────────── */

function timeoutOption(step: TestStep): string {
  return `{ timeout: ${String(step.options.timeoutMs || DEFAULT_STEP_TIMEOUT_MS)} }`;
}

/** 정규식 메타문자를 막는다. `assert_url` 이 "포함" 비교라 RegExp 로 낼 수밖에 없다. */
function escapeRegExpLiteral(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `{{baseUrl}}` 접두사를 떼고 상대 경로로 만든다. 붙어 있지 않으면 그대로 돌려준다. */
function stripBaseUrlPrefix(value: string): string {
  const trimmed = value.trim();
  const match = /^\{\{\s*baseUrl\s*\}\}(.*)$/.exec(trimmed);
  if (!match) return trimmed;
  const rest = match[1] ?? "";
  if (rest === "") return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/**
 * 스텝 1개 → 본문 문장들(들여쓰기 없음). 호출부가 들여쓴다.
 *
 * `switch` 는 `ActionType` 12종을 전부 다루고 마지막 `never` 로 누락을 컴파일 에러로 만든다
 * (`interpreter.ts` 와 같은 규율 — 계약에 동작이 늘면 양쪽이 같이 알려 준다).
 */
function renderStepBody(step: TestStep): string[] {
  const action: ActionType = step.actionType;
  const value = step.input?.value ?? "";
  const target = step.target ?? null;
  const locator = target === null ? null : renderLocator(target.primary);
  const timeout = timeoutOption(step);

  switch (action) {
    case "goto": {
      const stripped = stripBaseUrlPrefix(value);
      return [`await page.goto(${renderStepValue(stripped)});`];
    }
    case "wait":
      return [`await page.waitForTimeout(${String(step.options.waitMs ?? 1000)});`];
    case "assert_url": {
      // 해석기(`assertUrl`)는 **포함** 비교다. 문자열을 그대로 넘기면 Playwright 는 완전 일치로
      // 보므로 의미가 달라진다 → RegExp 로 낸다.
      const hasVariable = /\{\{\s*[^{}]+?\s*\}\}/.test(value);
      const pattern = hasVariable
        ? renderStepValue(value)
        : JSON.stringify(escapeRegExpLiteral(value));
      return [
        ...(hasVariable
          ? ["// 변수 값은 정규식 메타문자로 이스케이프되지 않습니다 — 필요하면 직접 고쳐 주세요."]
          : []),
        `await expect(page).toHaveURL(new RegExp(${pattern}), ${timeout});`,
      ];
    }
    case "click":
      return [`await ${String(locator)}.click(${timeout});`];
    case "hover":
      return [`await ${String(locator)}.hover(${timeout});`];
    case "fill":
      return [`await ${String(locator)}.fill(${renderStepValue(value)}, ${timeout});`];
    case "select":
      return [`await ${String(locator)}.selectOption(${renderStepValue(value)}, ${timeout});`];
    case "press":
      return [`await ${String(locator)}.press(${renderStepValue(value)}, ${timeout});`];
    case "check":
      return [`await ${String(locator)}.check(${timeout});`];
    case "uncheck":
      return [`await ${String(locator)}.uncheck(${timeout});`];
    case "assert_visible":
      return [`await expect(${String(locator)}).toBeVisible(${timeout});`];
    case "assert_text":
      // 해석기(`assertText`)도 **포함** 비교다 → `toHaveText` 가 아니라 `toContainText`.
      return [`await expect(${String(locator)}).toContainText(${renderStepValue(value)}, ${timeout});`];
    default: {
      const exhaustive: never = action;
      throw new Error(`지원하지 않는 동작입니다: ${String(exhaustive)}`);
    }
  }
}

/* ────────────────────────────────────────────────────────────
 * 4. 진입점
 * ──────────────────────────────────────────────────────────── */

/**
 * 파일명으로 쓸 수 있게 다듬는다. 계약(`ScenarioCodeFilenameSchema`)의
 * `[A-Za-z0-9._-]+\.spec\.ts` 를 만족한다.
 *
 * ★ 경로 문자를 지우는 것만으로는 부족하다 — `"../../etc/passwd"` 에서 `/` 만 지우면
 *   `"....etcpasswd"` 가 남아 **점으로 시작하는 파일명**이 된다. 선두의 `.`/`-` 도 떨군다
 *   (숨김 파일·옵션처럼 보이는 이름을 만들지 않는다). 이 함수는 브라우저의 다운로드 이름과
 *   업로드 후 `PUT …/code` 의 `filename` 양쪽에 쓰인다.
 */
export function codegenFilename(scenarioCode?: string): string {
  const base = (scenarioCode ?? "")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^[.-]+/, "")
    .toLowerCase();
  return base === "" ? "recorded.spec.ts" : `${base}.spec.ts`;
}

/**
 * 녹화 스텝 배열 → `.spec.ts` 본문.
 *
 * 출력 구조:
 * ```ts
 * import { expect, test } from "@playwright/test";      // ← import 는 이 1줄뿐이다
 *
 * test("<시나리오 이름>", async ({ page }) => {
 *   // 2. 입력 — 아이디 입력
 *   await page.getByLabel("아이디").fill(process.env["TESTFLOW_VAR_userId"] ?? "", { timeout: 10000 });
 *   …
 * });
 * ```
 *
 * ★ **`test.step()` 으로 감싸지 않는다** — 감싸면 화면의 단계 이름이 녹화 스텝 이름 그대로
 *   보존되는 대신, Runner 의 `toActionType()` 이 한국어 제목을 분류하지 못해 **전 단계가
 *   `wait`(대기)로 떨어진다.** 라운드 1 화면의 동작 칩(이동/입력/클릭/확인)이 통째로 망가진다.
 *   감싸지 않으면 Playwright 가 `Navigate` / `Click` / `Fill "***"` / `Expect "toContainText"` 를
 *   제목으로 보내고 매핑이 정상 동작한다. **원래 스텝 이름은 바로 위 주석으로 보존**한다.
 *   (이 판단의 근거를 지우지 마라 — 되돌리면 조용히 전부 "대기" 가 된다.)
 *
 * ★ 반환 문자열은 `validateScenarioCode()` 를 **issue 0건**으로 통과해야 한다
 *   (import 1종 · `test(` 존재). `codegen.spec.ts` 가 그것을 고정한다.
 */
export function stepsToPlaywrightCode(steps: readonly TestStep[], opts: CodegenOptions = {}): string {
  const testName = (opts.testName ?? "").trim() === "" ? "녹화 시나리오" : (opts.testName ?? "").trim();
  const varKeys = referencedVariableKeys(steps);

  const header: string[] = [
    "// TestFlow 가 녹화 스텝에서 생성한 Playwright 코드입니다.",
    ...(opts.scenarioCode === undefined || opts.scenarioCode === ""
      ? []
      : [`// 시나리오: ${opts.scenarioCode} · ${testName}`]),
    ...(opts.generatedAt === undefined || opts.generatedAt === ""
      ? []
      : [`// 생성: ${opts.generatedAt}`]),
    "//",
    "// ★ 값은 코드에 들어 있지 않습니다. 실행 요청의 변수(variables)가 환경변수로 주입됩니다.",
    ...(varKeys.length === 0
      ? ["//   (이 시나리오는 참조하는 변수가 없습니다)"]
      : varKeys.map((key) => `//   ${CODEGEN_VAR_ENV_PREFIX}${key}`)),
    `//   ${CODEGEN_BASE_URL_ENV}  — 실행 요청의 기준 주소(use.baseURL 로도 들어갑니다)`,
    "//",
    "// TestFlow 밖에서 직접 돌릴 때는 위 환경변수를 셸에서 넣어 주세요.",
    "// 비밀번호를 이 파일에 적지 마세요 — 코드 본문은 DB 에 평문으로 저장됩니다.",
  ];

  const body: string[] = [];
  for (const step of steps) {
    const notes = step.target === null || step.target === undefined ? [] : locatorNotes(step.target);
    const chip = ACTION_CHIP_LABEL[step.actionType];
    body.push(`  // ${String(step.sequence)}. ${chip} — ${step.name}`);
    for (const note of notes) body.push(`  // ⚠ ${note}`);

    const statements = renderStepBody(step);

    if (step.options.optional) {
      // 해석기는 `optional` 스텝이 실패해도 계속 간다(스텝은 `skipped`).
      // 코드 실행에는 `skipped` 상태가 없어 **계속 진행**만 재현한다.
      body.push("  // 실패해도 계속 진행하는 단계입니다(녹화 시나리오의 '선택' 옵션).");
      body.push("  try {");
      for (const line of statements) body.push(`    ${line}`);
      body.push("  } catch {");
      body.push("    // 의도적으로 무시합니다.");
      body.push("  }");
    } else {
      for (const line of statements) body.push(`  ${line}`);
    }
    body.push("");
  }

  if (body.length > 0) body.pop();

  return [
    ...header,
    "",
    'import { expect, test } from "@playwright/test";',
    "",
    `test(${JSON.stringify(testName)}, async ({ page }) => {`,
    ...(body.length === 0 ? ["  // 내보낼 단계가 없습니다."] : body),
    "});",
    "",
  ].join("\n");
}
