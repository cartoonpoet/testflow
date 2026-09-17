import { SECRET_MASK } from "@testflow/contracts";

/**
 * ★ Secret 마스킹 — **이 파일의 `maskSecrets()` 가 유일한 마스킹 함수다.**
 *
 * ## 호출 지점 3곳 (03-phases Task 4.3 / 전 Gen-Phase 공통 규율)
 *  1. **API 응답** — 실행 상세·스텝 응답 등 사용자에게 나가는 JSON
 *     (`runs.service`, `runs.sse`, `scenarios.service` …).
 *  2. **서버 로그** — 에러를 `console.error` / Nest `Logger` 로 남기기 직전.
 *  3. **`step_results.error_message` / `runs.error_message` 저장 직전**
 *     (`apps/runner` Gen-Phase 6 Task 6.4).
 *
 * ## 왜 필요한가 — Playwright 에러에 입력값이 그대로 실린다
 * ```
 * locator.fill: Timeout 10000ms exceeded.
 * Call log: waiting for locator("input[value='hunter2']")
 * ```
 * 이 문자열이 그대로 DB·로그·SSE 로 흐르면 **비밀번호가 영구 저장된다.**
 * 값 기반 필터(`secretValues`)가 없으면 키 이름 기반 필터만으로는 절대 못 잡는다
 * (에러 메시지에는 "password" 라는 키가 없다).
 *
 * ## AES 암호화(`crypto.ts`)는 만들지 않는다
 * 계정·비밀번호를 DB 에 저장하지 않기로 확정했으므로 복호화 대상 자체가 없다
 * (02-context "★ 사용자 최종 결정" (c)). 남은 요구사항은 **노출 차단**뿐이고
 * 그것이 이 파일이다.
 */

/** 키 이름만으로 Secret 으로 판정하는 패턴. */
const SECRET_KEY_PATTERN =
  /(password|passwd|pwd|secret|token|credential|authorization|api[-_]?key|private[-_]?key)/i;

/**
 * 이 길이 미만의 값은 값 기반 치환에서 제외한다.
 *
 * 변수 값이 `"a"` 같이 짧으면 문서의 모든 `a` 가 `••••••••` 로 바뀌어
 * 에러 메시지가 통째로 읽을 수 없게 된다. 짧은 비밀번호는 어차피 존재하지 않는다.
 */
const MIN_MASKABLE_LENGTH = 3;

/** 순환 참조·과도한 중첩 방어(Playwright 에러 객체는 자기 참조를 갖는다). */
const MAX_DEPTH = 12;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskString(text: string, patterns: RegExp[]): string {
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, SECRET_MASK);
  }
  return result;
}

/**
 * 입력을 재귀 순회하며 Secret 을 `••••••••` 로 치환한 **새 값**을 돌려준다.
 * 원본은 변형하지 않는다.
 *
 * 두 가지 규칙을 동시에 적용한다.
 *  - **값 기반**: `secretValues` 에 들어 있는 문자열이 어디에 박혀 있든 치환한다.
 *    (Playwright 에러 메시지 대응 — 이쪽이 핵심이다)
 *  - **키 기반**: 키 이름이 `password|pwd|secret|token|...` 이면 값 전체를 치환한다.
 *
 * @param input        문자열 · 배열 · 평범한 객체 · Error. 그 외 타입은 그대로 통과한다.
 * @param secretValues 마스킹할 평문 값들(실행 요청 body 의 Secret 변수 값 등).
 *                     `collectSecretValues()`(contracts) 의 결과를 그대로 넘기면 된다.
 *
 * @example
 * maskSecrets("locator resolved to input[value='hunter2']", ["hunter2"])
 * // → "locator resolved to input[value='••••••••']"
 */
export function maskSecrets(input: unknown, secretValues: readonly string[] = []): unknown {
  const patterns = buildPatterns(secretValues);
  return walk(input, patterns, 0, new WeakSet());
}

/**
 * 키 이름 기반 마스킹만 수행한다. `maskSecrets(obj, [])` 와 같다.
 * 마스킹할 평문 값 목록을 모를 때(예: 임의의 요청 body 로깅) 쓴다.
 */
export function maskByKey(input: unknown): unknown {
  return maskSecrets(input, []);
}

/**
 * 에러를 로그·DB 에 남기기 직전에 쓰는 편의 함수. 항상 문자열을 돌려준다.
 * `runs.error_message` / `step_results.error_message` 저장 경로용.
 */
export function maskErrorMessage(error: unknown, secretValues: readonly string[] = []): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : safeStringify(error);
  return maskString(raw, buildPatterns(secretValues));
}

function buildPatterns(secretValues: readonly string[]): RegExp[] {
  const unique = [...new Set(secretValues.filter((v) => v.length >= MIN_MASKABLE_LENGTH))];
  // 긴 값부터 치환해야 부분 문자열이 먼저 지워져 긴 값이 남는 사고가 없다.
  unique.sort((a, b) => b.length - a.length);
  return unique.map((value) => new RegExp(escapeRegExp(value), "g"));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function walk(value: unknown, patterns: RegExp[], depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return "[depth-limit]";

  if (typeof value === "string") return maskString(value, patterns);
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: maskString(value.message, patterns),
      stack: value.stack === undefined ? undefined : maskString(value.stack, patterns),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, patterns, depth + 1, seen));
  }

  // Date / Buffer 등은 순회하지 않고 그대로 둔다(문자열이 아니라 노출 위험이 없다).
  if (value instanceof Date || ArrayBuffer.isView(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY_PATTERN.test(key)
      ? maskKeyedValue(child)
      : walk(child, patterns, depth + 1, seen);
  }
  return output;
}

/** 키 이름이 Secret 으로 판정된 경우. 값이 무엇이든 통째로 가린다. */
function maskKeyedValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(() => SECRET_MASK);
  return SECRET_MASK;
}
