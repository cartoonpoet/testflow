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
 *
 * ★ 라운드 11 — 잘린 값은 **칸에 채우지도 않는다**(`variablePrefillValue`).
 *   `…` 를 붙여 보여 주는 것과 달리, 채우면 그 값이 **그대로 전송된다.**
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
 *
 * ★ 라운드 11 — `text` 는 **보여 주기 위해 다듬은** 문자열이다. 길이 상한으로 잘리거나
 *   (`truncatedText`) 제어문자가 공백으로 접히면(`toDisplayText`) **원문과 다르다.**
 *   그 사실을 `exactText` 로 알린다 — 화면이 이 값을 **칸에 채울지**(자동 바인딩)를
 *   가르는 유일한 근거다. 원문과 다른 값을 채우면 사용자가 모르는 값이 전송된다.
 */
export const RunVariableDefaultSchema = z.object({
  kind: RunVariableDefaultKindSchema,
  /** `literal` 일 때만 의미가 있다(`dynamic` 은 언제나 `""`). 빈 문자열도 **정상 값**이다. */
  text: z.string().max(MAX_DEFAULT_TEXT_LENGTH),
  /** `text` 가 `MAX_DEFAULT_TEXT_LENGTH` 로 잘렸는가. */
  truncatedText: z.boolean().default(false),
  /**
   * ★ 라운드 11 — `text` 가 코드의 리터럴과 **글자 그대로 같은가.**
   *
   * `false` 면 잘렸거나(`truncatedText`) 제어문자가 접힌 것이다. 두 경우 모두
   * **칸에 채우면 안 된다** — 채우면 원문과 다른 값이 그대로 실행에 쓰인다.
   * 구버전 응답에 이 필드가 없으면 `true` 로 떨어지는데, 그 경우에도
   * `truncatedText` 가 잘림은 막아 준다(제어문자 접힘만 남고, 그것은 실질적으로 없다).
   */
  exactText: z.boolean().default(true),
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
   * ★ 라운드 11 — **코드가 "이 변수는 반드시 있어야 한다"고 선언했는가.**
   *
   * 가이드가 권하는 **가드**(`extractCodeRequiredKeys`)에 그 키가 나오면 `true` 다.
   * 필수 판정의 **1차 기준**이고, `defaultValue === null`(기본값이 없다)이 2차다
   * (`isRequiredVariable`).
   *
   * 왜 1차인가: `.fill(process.env['TESTFLOW_VAR_username'] ?? '')` 의 `?? ''` 는
   * **타입 안전용**이지 "빈 문자열로 실행해도 된다"는 뜻이 아닌데, 기본값 스캐너는
   * 그 둘을 구분할 수 없다. 가드는 **사람이 명시적으로 적은 선언**이라 더 강한 신호다.
   *
   * 구버전 응답에 이 필드가 없으면 `false` 로 떨어진다 — 라운드 10 과 같은 판정이다.
   */
  required: z.boolean().default(false),
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
 * **필수 변수인가** — 사용자가 넣지 않으면 실행이 실패하는가.
 *
 * ★ 라운드 11 — 순서가 있다:
 *  1. **코드가 선언했는가**(`required` — 가드 패턴). 있으면 그것으로 끝이다.
 *  2. 없으면 **기본값이 없는가**(`defaultValue === null`) — 라운드 10 의 기준 그대로다.
 *
 * 1을 2보다 앞에 두는 이유: `?? ''` 는 `string | undefined` 를 `string` 으로 좁히는
 * **타입 안전 장치**로도 쓰이는데, 그 경우 "빈 문자열 기본값" 으로 읽혀 2가 선택으로
 * 떨어뜨린다(계정·비밀번호가 접힌 섹션으로 숨은 실제 사고). 가드는 사람이 적은 선언이라
 * 그보다 강하다. 반대로 가드가 없는 키의 판정은 **한 글자도 바뀌지 않는다.**
 */
export function isRequiredVariable(variable: RunVariable): boolean {
  return variable.required || variable.defaultValue === null;
}

/**
 * **선택 변수인가** — 비워 둬도 코드의 기본값이 대신 쓰이는가.
 *
 * 판정을 이 한 함수에 모은다. 화면이 `defaultValue !== null` 을 직접 쓰기 시작하면
 * "빈 문자열 기본값은 없는 것으로 치자" 같은 판단이 화면마다 새로 생긴다.
 */
export function isOptionalVariable(variable: RunVariable): boolean {
  return !isRequiredVariable(variable);
}

/**
 * 화면이 **"비우면 이 값이 쓰입니다"라고 말해도 되는** 기본값.
 *
 * 필수 칸(가드가 막는 칸)에는 **없다.** 가드는 `process.env[key]` 를 **직접** 보고
 * 비어 있으면 던지므로, 그 뒤에 붙은 `?? '기본값'` 은 **닿지 않는 코드**다.
 * 그것을 "비우면 이 값이 쓰입니다"로 보여 주면 거짓말이 된다.
 */
export function effectiveVariableDefault(variable: RunVariable): RunVariableDefault | null {
  return isOptionalVariable(variable) ? variable.defaultValue : null;
}

/**
 * ★ 라운드 11 — **칸에 미리 채울 값**(자동 바인딩). 채우면 안 되면 `null`.
 *
 * | 기본값 | 채우나 | 왜 |
 * |---|---|---|
 * | `literal` · 원문 그대로 | **채운다** | 사용자가 보고 고칠 수 있는 진짜 값이다 |
 * | `literal` · 빈 문자열 | 채운다(= 빈 칸) | `\|\| ""` 는 "비워 두는 것이 정상" 이라는 뜻이다 |
 * | `literal` · 잘림/변형 | **안 채운다** | 원문과 다른 값이 **사용자 모르게 전송된다** |
 * | `dynamic` | 안 채운다 | 실행 시점에 정해진다 — 채울 값이 존재하지 않는다 |
 * | 필수(가드) | 안 채운다 | 가드가 막는 값이다(위 `effectiveVariableDefault`) |
 *
 * ★ 잘린 값을 채우지 않는 것이 이 함수의 **존재 이유**다. placeholder 로 `…` 를
 *   붙여 보여 주는 것과 **칸에 넣어 전송하는 것**은 위험이 다르다.
 */
export function variablePrefillValue(variable: RunVariable): string | null {
  const fallback = effectiveVariableDefault(variable);
  if (fallback === null || fallback.kind !== "literal") return null;
  if (fallback.truncatedText || !fallback.exactText) return null;
  return fallback.text;
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
 *
 * ★ 라운드 11 — 다듬은 결과가 **원문과 다르면** `exactText: false` 다. 이 한 비트가
 *   자동 바인딩의 가부를 가른다(`variablePrefillValue`). 잘림과 제어문자 접힘을
 *   따로 세는 이유: 잘림은 화면 문구("…줄임")에도 쓰이고, 접힘은 문구는 달라도
 *   **채우면 안 된다**는 점만 같기 때문이다.
 */
function toDisplayText(value: string): {
  text: string;
  truncatedText: boolean;
  exactText: boolean;
} {
  // eslint-disable-next-line no-control-regex -- 제어문자를 **의도적으로** 지운다.
  const flattened = value.replace(/[\u0000-\u001f\u007f]+/g, " ");
  if (flattened.length <= MAX_DEFAULT_TEXT_LENGTH) {
    return { text: flattened, truncatedText: false, exactText: flattened === value };
  }
  return {
    text: flattened.slice(0, MAX_DEFAULT_TEXT_LENGTH),
    truncatedText: true,
    exactText: false,
  };
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
        found.set(key, { kind: "dynamic", text: "", truncatedText: false, exactText: true });
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
 * 2-c. **필수 선언(가드)** 스캔  (★ 라운드 11)
 * ──────────────────────────────────────────────────────────── */

/**
 * ════════════════════════════════════════════════════════════════════
 * ## 왜 이것이 필요한가 — `?? ''` 가 필수 판정을 흐린다
 *
 * 가이드가 권하는 코드는 이렇게 쓴다:
 *
 * ```ts
 * await page.getByRole('textbox', { name: '이메일' })
 *   .fill(process.env['TESTFLOW_VAR_username'] ?? '');
 * ```
 *
 * 여기서 `?? ''` 는 **`string | undefined` 를 `string` 으로 좁히는 타입 안전 장치**다.
 * 그런데 `extractCodeVariableDefaults()` 는 이것을 **"빈 문자열 기본값이 있다"** 로 읽고,
 * 라운드 10 의 규칙(기본값이 있으면 선택)이 **계정·비밀번호를 접힌 섹션으로 숨겼다.**
 * 추출기는 틀리지 않았다 — 그 패턴만 보고는 `|| ""`(= 첫 행을 쓴다는 **의미 있는** 빈
 * 기본값, `relatedDoc*Row`)와 구분할 방법이 없다.
 *
 * ## 그래서 **더 강한 신호**를 읽는다
 *
 * 같은 가이드가 그 바로 위에 **가드**를 쓰라고 권한다:
 *
 * ```ts
 * for (const key of ['TESTFLOW_VAR_username', 'TESTFLOW_VAR_password']) {
 *   if (!(process.env[key] ?? '')) {
 *     throw new Error(`실행 변수 ${key} 가 필요합니다. …`);
 *   }
 * }
 * ```
 *
 * 가드는 **사람이 "이 변수가 없으면 여기서 멈춘다"고 명시적으로 적은 것**이다.
 * `?? ''` 가 타입 때문에 붙는 것과 달리 **다른 뜻으로 쓰일 여지가 없다.**
 *
 * ## ★ 무엇을 가드로 보는가 — 정확히 두 가지 형태 + 하나의 호출
 *
 * | # | 형태 | 예 |
 * |---|---|---|
 * | G1 | `for (…키가 든 머리…) { …멈춘다… }` | 가이드의 배열 리터럴 순회 |
 * | G2 | `if (…키가 든 조건…) …멈춘다…` | `if (!process.env['TESTFLOW_VAR_x']) throw …` |
 * | G3 | `test.skip( …키… )` | `test.skip(!process.env['TESTFLOW_VAR_x'], '…')` |
 *
 * "멈춘다" = `throw` · `test.skip(` · `process.exit(`.
 *
 * **키는 반드시 머리(조건·순회 대상)에 있어야 한다.** 몸통에 있는 키는 세지 않는다 —
 * 그러지 않으면 `if (await dialogVisible()) { … fill(process.env['TESTFLOW_VAR_name'] ?? '기본') … if (bad) throw … }`
 * 같은 **평범한 블록**이 통째로 가드가 되어, 기본값이 멀쩡히 있는 변수까지 필수로 올라온다.
 *
 * ## ★ 일부러 **안 잡는** 형태와 그 근거
 *
 * ```ts
 * const KEYS = ['TESTFLOW_VAR_username'];        // 상수 참조 — 값 추적이 필요하다
 * for (const key of KEYS) { … }
 *
 * ['TESTFLOW_VAR_username'].forEach((k) => { … })  // 순회 형태가 호출로 숨는다
 *
 * const u = process.env['TESTFLOW_VAR_username'];
 * if (!u) throw new Error('…');                   // 조건에 키가 없다(변수로 한 단계 건넜다)
 *
 * expect(process.env['TESTFLOW_VAR_username']).toBeTruthy();  // 중단이 암묵적이다
 * ```
 *
 * 이것들을 쫓아가려면 **값 추적**(상수 전개·별칭 추적)이 필요한데, 그것은 정규식이 아니라
 * 인터프리터다(머리 주석의 "왜 AST 파서를 쓰지 않는가"와 같은 이유로 선을 긋는다).
 * 그리고 **놓쳐도 라운드 10 의 판정이 그대로 남는다** — 새로 나빠지는 것이 없다.
 * 반대로 넓게 잡으면 선택 변수가 필수로 올라와 "꼭 입력할 것 N개" 가 거짓이 된다.
 * 즉 여기서는 **좁게 잡는 쪽이 안전한 방향**이다(기본값 스캐너와 방향이 반대인데,
 * 그쪽은 "칸을 숨기는" 판정이고 이쪽은 "칸을 올리는" 판정이기 때문이다).
 * ════════════════════════════════════════════════════════════════════
 */

/** 가드가 "여기서 멈춘다" 고 말하는 토큰. */
const GUARD_ABORT_PATTERN = /\bthrow\b|\btest\s*\.\s*skip\s*\(|\bprocess\s*\.\s*exit\s*\(/;

/** 가드 머리 — `if (…)` · `for (…)`. 여는 괄호까지 먹는다. */
const GUARD_HEAD_PATTERN = /\b(?:if|for)\s*\(/g;

/** 조건부 skip 호출(G3). */
const GUARD_SKIP_CALL_PATTERN = /\btest\s*\.\s*skip\s*\(/g;

const BRACKET_PAIRS: Readonly<Record<string, string>> = { "(": ")", "{": "}", "[": "]" };

/**
 * 따옴표 리터럴 하나를 건너뛴다 — **닫는 따옴표의 인덱스**를 돌려준다.
 *
 * 괄호 짝 맞추기가 문자열 속 `)` · `}` 에 속지 않게 하기 위한 것이다
 * (`throw new Error('… } …')`). 백틱 안의 `${…}` 는 따로 다루지 않는다 —
 * 그 안에 백틱이 또 들어가는 코드는 실질적으로 없고, 틀려도 결과는
 * "가드가 아니다"(= 라운드 10 판정 유지)로 떨어진다.
 */
function skipStringLiteral(text: string, quoteIndex: number): number {
  const quote = text[quoteIndex];
  for (let i = quoteIndex + 1; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === quote) return i;
    // 줄을 넘는 따옴표는 깨진 코드다. 그 줄에서 끊어 스캐너가 본문 끝까지 새지 않게 한다.
    if (c === "\n" && quote !== "`") return i;
  }
  return text.length;
}

/** `text[openIndex]` 의 **짝이 맞는 닫는 괄호** 인덱스. 못 찾으면 `-1`. */
function matchBracket(text: string, openIndex: number): number {
  const open = text[openIndex] ?? "";
  const close = BRACKET_PAIRS[open];
  if (close === undefined) return -1;
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (c === "'" || c === '"' || c === "`") {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 머리 바로 뒤의 **몸통이 끝나는 인덱스**. 블록(`{…}`)이면 블록 전체,
 * 아니면 한 문장(`;` 또는 줄 끝)까지다 — `if (…) throw new Error('…');` 형태.
 */
function bodyEndAfter(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i] ?? "")) i += 1;
  if (i >= text.length) return -1;
  if (text[i] === "{") return matchBracket(text, i);
  for (; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (c === "'" || c === '"' || c === "`") {
      i = skipStringLiteral(text, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      const end = matchBracket(text, i);
      if (end < 0) return i;
      i = end;
      continue;
    }
    if (c === ";" || c === "\n") return i;
  }
  return text.length - 1;
}

/**
 * 코드 본문에서 **가드가 필수라고 선언한 키**들을 나타난 순서대로 뽑는다.
 * 주석은 `extractCodeVariableKeys` 와 **같은 사본**(`blankComments`)을 본다.
 */
export function extractCodeRequiredKeys(content: string): string[] {
  const scanned = blankComments(content);
  const keys: string[] = [];

  // G1 · G2 — 머리에 키가 있고 몸통이 멈추는 `if` · `for`.
  for (const match of scanned.matchAll(GUARD_HEAD_PATTERN)) {
    const parenStart = match.index + match[0].length - 1;
    const parenEnd = matchBracket(scanned, parenStart);
    if (parenEnd < 0) continue;
    const bodyEnd = bodyEndAfter(scanned, parenEnd + 1);
    if (bodyEnd < 0) continue;
    if (!GUARD_ABORT_PATTERN.test(scanned.slice(parenEnd + 1, bodyEnd + 1))) continue;
    keys.push(...extractCodeVariableKeys(scanned.slice(parenStart, parenEnd + 1)));
  }

  // G3 — `test.skip(조건, 메시지)`.
  for (const match of scanned.matchAll(GUARD_SKIP_CALL_PATTERN)) {
    const parenStart = match.index + match[0].length - 1;
    const parenEnd = matchBracket(scanned, parenStart);
    if (parenEnd < 0) continue;
    keys.push(...extractCodeVariableKeys(scanned.slice(parenStart, parenEnd + 1)));
  }

  return dedupe(keys);
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
  /*
   * ★ 라운드 11 — 가드가 **먼저**다. `defaultValue` 는 읽어 낸 그대로 싣는다(지우지
   *   않는다) — 지우면 "코드에 `?? ''` 가 있었다"는 사실이 응답에서 사라져, 나중에
   *   판정을 되짚을 수 없다. 필수/선택은 `isRequiredVariable()` 이 두 필드로 가른다.
   */
  const required = new Set(extractCodeRequiredKeys(code));

  const truncated = keys.length > MAX_DETECTED_VARIABLES;
  return {
    variables: keys.slice(0, MAX_DETECTED_VARIABLES).map((key) => ({
      key,
      isSecret: isSecretVariableKey(key),
      required: required.has(key),
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
