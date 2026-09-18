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

export const RunVariableSchema = z.object({
  /** 코드의 `TESTFLOW_VAR_<key>` / 스텝의 `{{key}}` 에서 뗀 이름. */
  key: z.string().min(1).max(100),
  /**
   * `isSecretVariableKey(key)` 의 결과를 **그대로** 실어 준다.
   * 웹이 규칙을 다시 구현하지 않게 하기 위한 것이고, 웹은 이 값이 true 면
   * `type="password"` 로 그리고 **localStorage 에 값을 저장하지 않는다.**
   */
  isSecret: z.boolean(),
});
export type RunVariable = z.infer<typeof RunVariableSchema>;

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
 */
export function detectScenarioVariables(input: DetectVariablesInput): {
  variables: RunVariable[];
  truncated: boolean;
} {
  const keys = dedupe([
    ...extractCodeVariableKeys(input.code ?? ""),
    ...extractStepVariableKeys(input.steps ?? []),
  ]).filter((key) => !RUN_SCOPE_KEY_SET.has(key));

  const truncated = keys.length > MAX_DETECTED_VARIABLES;
  return {
    variables: keys.slice(0, MAX_DETECTED_VARIABLES).map((key) => ({
      key,
      isSecret: isSecretVariableKey(key),
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
