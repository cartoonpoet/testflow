/**
 * 시나리오가 **어떤 실행 변수를 필요로 하는가**를 원본에서 찾아내는 **순수 함수**.
 *
 * ════════════════════════════════════════════════════════════════════
 * ★★ 이 스캐너는 **보안 경계가 아니다.** ★★
 *
 * `code-validation.ts` 와 **같은 성격**이다 — 정규식 스캐너이고, 정규식은 **우회된다**:
 *
 * ```ts
 * const key = "TESTFLOW_VAR_" + name;   // ← 잡히지 않는다
 * process.env[`TESTFLOW_VAR_${name}`];  // ← 잡히지 않는다 (키가 동적이다)
 * const e = process.env; e["TESTFLOW_VAR_pw"];  // ← 잡히지 않는다
 * ```
 *
 * 그 한계는 `run-variables.spec.ts` 에 **통과하는 테스트로 명시해 고정**돼 있다.
 * 이것을 "필요한 변수의 완전한 목록"으로 착각하면 안 된다.
 *
 * ★ 라운드 10 — **기본값**도 같은 성격이다. `?? "리터럴"` · `|| "리터럴"` 이
 * **환경변수 접근 바로 뒤**에 붙은 형태만 읽는다. 그 밖의 형태
 * (`?.trim() || "x"` · `x !== undefined ? x : "y"` · 상수 참조 `|| FALLBACK`)는
 * **"기본값 없음"으로 떨어진다** — 화면에서 **필수처럼 보인다.**
 * 그 방향이 **안전한 쪽**이다: 실제로는 기본값이 있는데 칸을 보여 주는 것은
 * "안 채워도 되는 칸을 하나 더 본다"로 끝나지만, 반대(기본값이 없는데 있다고
 * 판단해 접어 숨김)는 **사용자가 존재조차 모르는 칸 때문에 실행이 실패**한다.
 * 정규식이 흔들릴 때 어느 쪽으로 넘어질지를 **의도적으로 고른 것**이다.
 *
 * **이 함수는 실행 다이얼로그가 "무엇을 입력해야 하는지" 미리 알려 주는 UX 장치다.**
 * 못 잡은 변수는 사용자가 다이얼로그에서 **직접 추가**할 수 있어야 하고(웹의 「변수 추가」),
 * 반대로 여기서 잡힌 키가 실제로 안 쓰여도 **아무 해가 없다**(값을 안 넣으면 그만이다).
 * 실행의 진실은 언제나 Runner 가 넘기는 `TESTFLOW_VAR_*` 환경변수 / `{{키}}` 치환이다.
 * ════════════════════════════════════════════════════════════════════
 *
 * ## 왜 AST 파서를 쓰지 않는가
 * `code-validation.ts` 와 같은 이유다. TS 파서를 끌어들이면 런타임 의존성이 늘고
 * `.npmrc` 의 `minimum-release-age=1440` 게이트를 또 통과해야 하는데, **정확도를 올려도
 * 동적 조립은 여전히 못 잡는다**(값이 실행 시점에 정해지므로 원리적으로 불가능하다).
 * 얻는 것이 비용을 넘지 않는다.
 *
 * ## 왜 contracts 에 두는가
 * api(엔드포인트)와 web(표시)이 **같은 규칙**을 봐야 한다. 그리고 추출 규칙은
 * `codegen.ts`(`CODEGEN_VAR_ENV_PREFIX`)·`run.ts`(`isSecretVariableKey`)와 **같은 상수**를
 * 써야 어긋나지 않는다. Node 전용 API 를 쓰지 않는다 — 브라우저에서도 돌아야 한다.
 */
import { z } from "zod";
import { blankComments } from "./code-validation.js";
import { CODEGEN_VAR_ENV_PREFIX } from "./codegen.js";
import { isSecretVariableKey } from "./run.js";
import { ScenarioSourceTypeSchema } from "./scenario.js";

/* ────────────────────────────────────────────────────────────
 * 0. 변수가 **아닌** 키
 * ──────────────────────────────────────────────────────────── */

/**
 * ★ `baseUrl` · `envLabel` 은 **사용자 변수가 아니다.**
 *
 * 둘 다 실행 요청의 **자기 필드**에서 오고(`CreateRunRequest.baseUrl` / `.envLabel`),
 * Runner 가 `buildVariableTable()` 에서 사용자 변수 **뒤에** 덮어쓴다
 * (`apps/runner/src/execute/variables.ts`). 코드 시나리오에서도 `baseUrl` 은
 * `TESTFLOW_VAR_baseUrl` 이 아니라 `TESTFLOW_BASE_URL`(`CODEGEN_BASE_URL_ENV`)로 간다.
 *
 * 즉 이 키들을 "입력해야 할 변수"로 보여 주면 **이미 위에 칸이 있는 값을 또 묻는 것**이고,
 * 사용자가 거기 다른 값을 넣어도 무시된다 — 거짓말이 되는 칸이다. 그래서 제외한다.
 * (`codegen.ts` 의 `RUN_SCOPE_KEYS` 와 같은 목록이다.)
 */
export const RUN_SCOPE_VARIABLE_KEYS = ["baseUrl", "envLabel"] as const;

const RUN_SCOPE_KEY_SET: ReadonlySet<string> = new Set(RUN_SCOPE_VARIABLE_KEYS);

/**
 * 한 시나리오에서 보여 주는 변수 칸의 상한.
 *
 * `CreateRunRequest.variables` 자체에는 개수 제한이 없다 — 이것은 **화면 보호값**이다.
 * 정규식이 무언가를 크게 오탐했을 때 다이얼로그가 칸 수백 개로 덮이지 않게 한다.
 * 잘렸다는 사실은 `truncated` 로 **반드시 알린다**(조용히 자르지 않는다).
 */
export const MAX_DETECTED_VARIABLES = 50;

/* ────────────────────────────────────────────────────────────
 * 1. 계약
 * ──────────────────────────────────────────────────────────── */

/**
 * 기본값 **표시용** 상한. 코드에 적힌 리터럴이 이보다 길면 잘라서 싣는다
 * (placeholder 한 줄에 들어갈 수 있는 길이를 한참 넘는다). 잘렸다는 사실은
 * `truncatedText` 로 알린다 — 잘린 문자열을 **정확한 기본값처럼** 보여 주지 않는다.
 */
export const MAX_DEFAULT_TEXT_LENGTH = 120;

export const RUN_VARIABLE_DEFAULT_KINDS = ["literal", "dynamic"] as const;
export const RunVariableDefaultKindSchema = z.enum(RUN_VARIABLE_DEFAULT_KINDS);
export type RunVariableDefaultKind = z.infer<typeof RunVariableDefaultKindSchema>;

/**
 * 코드에서 읽어 낸 **기본값**.
 *
 * | kind | 뜻 | 예 |
 * |---|---|---|
 * | `literal` | 값을 **정확히 안다** | `\|\| "변호사"` → `text: "변호사"` |
 * | `literal` | **빈 문자열도 값이다** | `\|\| ""` → `text: ""` |
 * | `dynamic` | 기본값은 **있지만** 실행 시점에 정해진다 | ``\|\| `test-${Date.now()}` `` |
 *
 * ★ **`kind:"literal"` + `text:""` 와 "기본값 없음(`null`)" 은 전혀 다르다.**
 *   `relatedDocLegalAdviceRow` 처럼 `|| ""` 로 쓰는 값은 "이름 대신 첫 행을 쓴다" 는
 *   **의미 있는 기본값**이다. 빈 문자열을 "없음" 으로 뭉개면 그 칸이 필수로 올라와
 *   사용자가 채워야 할 것처럼 보인다 — 실제로는 비워 두는 것이 정상 동작이다.
 *   그래서 이 구분은 `text` 의 길이가 아니라 **`defaultValue === null` 인가**로 한다.
 *
 * ★ `dynamic` 의 리터럴 텍스트는 **싣지 않는다.** `` `test-${Date.now()}` `` 의
 *   원문을 그대로 보여 주면 사용자는 그 문자열이 그대로 들어간다고 읽는다 — 거짓말이다.
 */
export const RunVariableDefaultSchema = z.object({
  kind: RunVariableDefaultKindSchema,
  /** `literal` 일 때만 의미가 있다(`dynamic` 은 언제나 `""`). 빈 문자열도 **정상 값**이다. */
  text: z.string().max(MAX_DEFAULT_TEXT_LENGTH),
  /** `text` 가 `MAX_DEFAULT_TEXT_LENGTH` 로 잘렸는가. */
  truncatedText: z.boolean().default(false),
});
export type RunVariableDefault = z.infer<typeof RunVariableDefaultSchema>;

export const RunVariableSchema = z.object({
  /** 코드의 `TESTFLOW_VAR_<key>` / 스텝의 `{{key}}` 에서 뗀 이름. */
  key: z.string().min(1).max(100),
  /**
   * `isSecretVariableKey(key)` 의 결과를 **그대로** 실어 준다.
   * 웹이 규칙을 다시 구현하지 않게 하기 위한 것이고, 웹은 이 값이 true 면
   * `type="password"` 로 그리고 **localStorage 에 값을 저장하지 않는다.**
   */
  isSecret: z.boolean(),
  /**
   * ★ 라운드 10 — 코드에 적힌 기본값. **없으면 `null`**(= 사용자가 넣어야 하는 값).
   *
   * 화면은 이 필드 하나로 **필수/선택**을 가른다(`isOptionalVariable()`).
   * 스텝(`{{키}}`) 시나리오는 **언제나 `null`** 이다 — 아래 `extractStepVariableKeys` 참조.
   *
   * 기존 응답(구버전 캐시)에 이 필드가 없어도 `null` 로 떨어지게 `.default(null)` 이다.
   * 그 경우 전부 "필수" 로 보인다 — 안전한 방향이다(머리 주석).
   */
  defaultValue: RunVariableDefaultSchema.nullable().default(null),
});
export type RunVariable = z.infer<typeof RunVariableSchema>;

/**
 * **선택 변수인가** — 비워 둬도 코드의 기본값이 대신 쓰이는가.
 *
 * 판정을 이 한 함수에 모은다. 화면이 `defaultValue !== null` 을 직접 쓰기 시작하면
 * "빈 문자열 기본값은 없는 것으로 치자" 같은 판단이 화면마다 새로 생긴다.
 */
export function isOptionalVariable(variable: RunVariable): boolean {
  return variable.defaultValue !== null;
}

/** `GET /api/scenarios/:id/variables` 응답. */
export const ScenarioVariablesResponseSchema = z.object({
  scenarioId: z.uuid(),
  sourceType: ScenarioSourceTypeSchema,
  /** 원본에 나타난 **순서**다(알파벳 정렬이 아니다 — 코드를 읽는 순서가 더 자연스럽다). */
  variables: z.array(RunVariableSchema),
  /** `MAX_DETECTED_VARIABLES` 를 넘어 잘렸는가. */
  truncated: z.boolean(),
});
export type ScenarioVariablesResponse = z.infer<typeof ScenarioVariablesResponseSchema>;

/* ────────────────────────────────────────────────────────────
 * 2. 코드 시나리오 스캔
 * ──────────────────────────────────────────────────────────── */

/**
 * 스캔하는 형태 **2종**.
 *
 * | # | 형태 | 예 |
 * |---|---|---|
 * | 1 | 따옴표 리터럴 안의 `TESTFLOW_VAR_<key>` | `process.env["TESTFLOW_VAR_a"]` · `['TESTFLOW_VAR_a','TESTFLOW_VAR_b']` |
 * | 2 | 점 접근 `process.env.TESTFLOW_VAR_<key>` | `process.env.TESTFLOW_VAR_a` |
 *
 * 1번을 `process.env[…]` 로 좁히지 **않는다.** 가이드가 권하는
 * `for (const key of ['TESTFLOW_VAR_username','TESTFLOW_VAR_password'])` 같은
 * **실제로 쓰이는 형태**가 그 밖에 있기 때문이다. 리터럴에 그 접두사를 적어 두고
 * 안 쓰는 코드는 사실상 없고, 있어도 빈 칸 하나가 더 뜰 뿐이다(위 머리 주석 참조).
 *
 * 백틱은 **일부러 뺐다.** `` `TESTFLOW_VAR_${name}` `` 은 키가 동적이라 이름을 알 수 없는데,
 * 백틱을 받아 주면 `TESTFLOW_VAR_` 까지만 읽고 **틀린 키**를 보여 주게 된다.
 * 잘못된 이름을 보여 주느니 못 잡았다고 하는 편이 낫다(사용자가 직접 추가할 수 있다).
 */
const CODE_VAR_PATTERNS: readonly RegExp[] = [
  new RegExp(`(['"])${CODEGEN_VAR_ENV_PREFIX}([^'"\`\\s\\\\]+)\\1`, "g"),
  new RegExp(`\\bprocess\\s*\\.\\s*env\\s*\\.\\s*${CODEGEN_VAR_ENV_PREFIX}([A-Za-z0-9_$]+)`, "g"),
];

/**
 * 코드 본문에서 `TESTFLOW_VAR_<key>` 의 `<key>` 들을 **나타난 순서대로** 뽑는다.
 *
 * 주석은 `blankComments()` 로 지운 사본을 스캔한다 — 가이드가 코드 맨 위에 적어 두는
 * `// 실행 변수: TESTFLOW_VAR_username, …` 같은 **설명 주석**이 칸을 만들면 안 된다.
 */
export function extractCodeVariableKeys(content: string): string[] {
  const scanned = blankComments(content);
  // 같은 키가 여러 번·여러 패턴에 걸리므로 위치로 정렬한 뒤 중복을 없앤다.
  const hits: { index: number; key: string }[] = [];

  for (const pattern of CODE_VAR_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(scanned);
    while (match !== null) {
      // 패턴 1은 그룹 2(그룹 1이 따옴표), 패턴 2는 그룹 1이 키다.
      const key = (match[2] ?? match[1] ?? "").trim();
      if (isUsableKey(key)) hits.push({ index: match.index, key });
      match = pattern.exec(scanned);
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return dedupe(hits.map((hit) => hit.key));
}

/* ────────────────────────────────────────────────────────────
 * 2-b. 기본값 스캔  (★ 라운드 10)
 * ──────────────────────────────────────────────────────────── */

/**
 * **환경변수 접근 바로 뒤에 붙은 `??` · `||` 리터럴**만 읽는다.
 *
 * ```ts
 * process.env["TESTFLOW_VAR_keyword"] || "변호사"       // literal "변호사"
 * process.env['TESTFLOW_VAR_row']     ?? ''             // literal ""      ← 빈 문자열도 기본값이다
 * process.env.TESTFLOW_VAR_name       || `t-${x}`       // dynamic
 * process.env["TESTFLOW_VAR_label"]   || `고정문자열`    // literal (치환이 없는 템플릿)
 * ```
 *
 * **잡지 않는 형태**(→ 기본값 없음 → 화면에서 필수로 보인다. 머리 주석의 "안전한 방향"):
 * ```ts
 * process.env["TESTFLOW_VAR_a"]?.trim() || "x"   // 접근과 || 사이에 다른 것이 끼었다
 * process.env["TESTFLOW_VAR_b"] || FALLBACK      // 상수 참조 — 값을 알 수 없다
 * process.env["TESTFLOW_VAR_c"] || process.env["Y"] || "z"
 * const d = process.env["TESTFLOW_VAR_d"]; const e = d || "x";
 * ```
 * 마지막 두 개는 **기본값이 실제로 있는데도** 필수로 보인다 — 칸 하나를 더 보는 비용이다.
 * 반대로 넘어지면(없는데 있다고 접어 버리면) 실행이 실패한다.
 *
 * 같은 키가 서로 다른 기본값으로 여러 번 나오면 **처음 것**을 쓴다
 * (`extractCodeVariableKeys` 가 순서를 지키는 것과 같은 규칙이다).
 */
const CODE_VAR_DEFAULT_PATTERN = new RegExp(
  // ① process.env["TESTFLOW_VAR_x"] · process.env.TESTFLOW_VAR_x
  `\\bprocess\\s*\\.\\s*env\\s*(?:` +
    `\\[\\s*(['"])${CODEGEN_VAR_ENV_PREFIX}([^'"\`\\s\\\\]+)\\1\\s*\\]` +
    `|\\.\\s*${CODEGEN_VAR_ENV_PREFIX}([A-Za-z0-9_$]+)` +
    `)` +
    // ② 바로 뒤의 ?? 또는 ||
    `\\s*(?:\\?\\?|\\|\\|)\\s*` +
    // ③ 문자열 리터럴 3종
    `(?:"((?:[^"\\\\\\n]|\\\\.)*)"|'((?:[^'\\\\\\n]|\\\\.)*)'|\`((?:[^\`\\\\]|\\\\[\\s\\S])*)\`)`,
  "g",
);

/** 템플릿 리터럴 안에 **치환이 있는가**(`${…}`). 이스케이프된 `\${` 는 치환이 아니다. */
const TEMPLATE_SUBSTITUTION = /(^|[^\\])\$\{/;

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/**
 * 소스에 적힌 리터럴을 **사람이 읽는 문자열**로 되돌린다.
 * `"\\uAC00"` 같은 것을 그대로 보여 주면 기본값을 오해한다.
 * 모르는 이스케이프(`\q`)는 JS 와 같게 **그 문자 자체**로 떨어뜨린다.
 */
function unescapeLiteral(raw: string): string {
  return raw.replace(
    /\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g,
    (_match, braced?: string, four?: string, hex?: string, other?: string) => {
      const code = braced ?? four ?? hex;
      if (code !== undefined) {
        const point = Number.parseInt(code, 16);
        // 서러게이트/범위 밖은 되돌리지 않고 원문을 남긴다(깨진 문자를 만들지 않는다).
        return point <= 0x10ffff ? String.fromCodePoint(point) : _match;
      }
      const ch = other ?? "";
      return SIMPLE_ESCAPES[ch] ?? ch;
    },
  );
}

/**
 * placeholder 한 줄에 실어도 되는 형태로 다듬는다.
 * 줄바꿈·탭 같은 제어문자는 공백 한 칸으로 접는다(칸 안에서 보이지 않는 글자가 되면
 * "기본값이 빈 문자열" 과 구분이 안 된다).
 */
function toDisplayText(value: string): { text: string; truncatedText: boolean } {
  // eslint-disable-next-line no-control-regex -- 제어문자를 **의도적으로** 지운다.
  const flattened = value.replace(/[\u0000-\u001f\u007f]+/g, " ");
  if (flattened.length <= MAX_DEFAULT_TEXT_LENGTH) {
    return { text: flattened, truncatedText: false };
  }
  return { text: flattened.slice(0, MAX_DEFAULT_TEXT_LENGTH), truncatedText: true };
}

/**
 * 코드 본문에서 `키 → 기본값` 을 뽑는다. **나타난 순서대로, 처음 것이 이긴다.**
 * 주석은 `extractCodeVariableKeys` 와 **같은 사본**(`blankComments`)을 본다 —
 * 주석 속 예시가 기본값을 만들면 안 된다.
 */
export function extractCodeVariableDefaults(content: string): Map<string, RunVariableDefault> {
  const scanned = blankComments(content);
  const found = new Map<string, RunVariableDefault>();

  CODE_VAR_DEFAULT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = CODE_VAR_DEFAULT_PATTERN.exec(scanned);
  while (match !== null) {
    const key = (match[2] ?? match[3] ?? "").trim();
    const double = match[4];
    const single = match[5];
    const template = match[6];

    if (isUsableKey(key) && !found.has(key)) {
      if (template !== undefined && TEMPLATE_SUBSTITUTION.test(template)) {
        // 값을 알 수 없다 — 원문을 보여 주면 그 문자열이 들어간다고 오해한다.
        found.set(key, { kind: "dynamic", text: "", truncatedText: false });
      } else {
        const raw = double ?? single ?? template ?? "";
        const display = toDisplayText(unescapeLiteral(raw));
        found.set(key, { kind: "literal", ...display });
      }
    }
    match = CODE_VAR_DEFAULT_PATTERN.exec(scanned);
  }

  return found;
}

/* ────────────────────────────────────────────────────────────
 * 3. 녹화(steps) 시나리오 스캔
 * ──────────────────────────────────────────────────────────── */

/** `variables.ts` 의 `PLACEHOLDER` · `codegen.ts` 와 **같은 형태**. 점이 든 키도 한 덩어리다. */
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * 스캔 대상 스텝. `TestStep` 을 그대로 받지 않고 **세 칸만** 본다 —
 * 엔티티(`test_steps`)든 API 형(`ApiTestStep`)이든 같은 함수를 쓸 수 있게 하기 위해서다.
 */
export type VariableScanStep = {
  target?: unknown;
  input?: unknown;
  options?: unknown;
};

/**
 * 스텝들의 `{{키}}` 를 **나타난 순서대로** 뽑는다.
 *
 * ★ 라운드 10 — 여기서 나온 키는 **언제나 "기본값 없음"(필수)** 이다. 추측이 아니라
 *   Runner 의 동작이다: `apps/runner/src/execute/variables.ts` 의 `resolveText()` 가
 *   치환표에 없는 `{{키}}` 를 만나면 `VariableResolutionError` 로 **그 자리에서 실패**한다
 *   (`??` 같은 대체 문법이 스텝에는 아예 없다). 즉 비워 두면 반드시 실패하므로
 *   필수로 올리는 것이 맞다.
 *
 * 세 칸을 통째로 `JSON.stringify` 해서 스캔한다. 필드를 하나씩 열거하지 않는 이유:
 * 값이 들어갈 수 있는 자리가 `input.value` 하나가 아니고(`target` 의 locator 값,
 * `options` 의 확장 필드), 열거는 **스키마가 늘 때마다 조용히 뒤처진다**.
 * JSON 이스케이프는 `{{` `}}` 를 건드리지 않으므로 형태가 그대로 보존된다.
 */
export function extractStepVariableKeys(steps: readonly VariableScanStep[]): string[] {
  const keys: string[] = [];
  for (const step of steps) {
    const serialized = JSON.stringify([step.target ?? null, step.input ?? null, step.options ?? null]);
    PLACEHOLDER.lastIndex = 0;
    for (const match of serialized.matchAll(PLACEHOLDER)) {
      const key = (match[1] ?? "").trim();
      if (isUsableKey(key)) keys.push(key);
    }
  }
  return dedupe(keys);
}

/* ────────────────────────────────────────────────────────────
 * 4. 합치기
 * ──────────────────────────────────────────────────────────── */

export type DetectVariablesInput = {
  /** 코드 시나리오 본문. 없으면 빈 문자열/`undefined`. */
  code?: string | null;
  /** 녹화 시나리오 스텝. 없으면 빈 배열. */
  steps?: readonly VariableScanStep[];
};

/**
 * 코드·스텝 양쪽을 스캔해 `RunVariable[]` 로 만든다.
 *
 * ★ `sourceType` 으로 갈래를 나누지 **않는다.** 둘 다 스캔하고 합친다 —
 *   갈래를 나누면 "코드 시나리오인데 스텝이 남아 있는" 과도기 데이터에서 한쪽을 놓친다.
 *   없는 쪽은 빈 배열이라 결과가 달라지지 않는다.
 *
 * ★ 라운드 10 — 기본값은 **코드에서만** 온다(스텝에는 개념이 없다.
 *   `extractStepVariableKeys` 주석). 코드와 스텝에 같은 키가 있으면 코드의 기본값을
 *   쓴다 — 코드 쪽은 실제로 `??` 가 살아나지만, 그 키가 스텝에도 쓰였다면
 *   스텝 치환이 먼저 실패한다… 는 것은 **과도기 데이터에서만 가능한 조합**이라
 *   여기서 더 복잡한 판정을 만들지 않는다(`sourceType` 하나만 실제로 읽힌다).
 */
export function detectScenarioVariables(input: DetectVariablesInput): {
  variables: RunVariable[];
  truncated: boolean;
} {
  const code = input.code ?? "";
  const keys = dedupe([
    ...extractCodeVariableKeys(code),
    ...extractStepVariableKeys(input.steps ?? []),
  ]).filter((key) => !RUN_SCOPE_KEY_SET.has(key));

  const defaults = extractCodeVariableDefaults(code);

  const truncated = keys.length > MAX_DETECTED_VARIABLES;
  return {
    variables: keys.slice(0, MAX_DETECTED_VARIABLES).map((key) => ({
      key,
      isSecret: isSecretVariableKey(key),
      defaultValue: defaults.get(key) ?? null,
    })),
    truncated,
  };
}

/* ────────────────────────────────────────────────────────────
 * 5. 보조
 * ──────────────────────────────────────────────────────────── */

/**
 * 실행 요청에 실을 수 있는 키인가.
 *
 * 상한 100 은 `CreateRunRequestSchema.variables` 의 키 상한과 **같은 값**이다 —
 * 여기서 더 긴 키를 보여 주면 입력해도 서버가 400 으로 막는다.
 * `=` · NUL 은 Runner 의 `buildVariableEnv()` 가 버리는 문자다(환경변수 블록이 깨진다).
 */
function isUsableKey(key: string): boolean {
  return key !== "" && key.length <= 100 && !key.includes("=") && !key.includes("\0");
}

function dedupe(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}
