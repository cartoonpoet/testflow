import { SECRET_MASK } from "@testflow/contracts";

/**
 * Runner 쪽 Secret 마스킹.
 *
 * ## ★ 왜 `apps/api/src/common/utils/mask.ts` 를 그대로 쓰지 않는가
 * "마스킹은 `mask.ts` 단일 함수" 가 전 Gen-Phase 공통 규율이다. 그런데 그 파일은
 * `apps/api` 워크스페이스 안에 있고 **`apps/runner` 는 `apps/api` 를 의존하지 않는다**
 * (앱끼리는 서로를 import 하지 않는다 — 공유물은 `packages/*` 로 간다).
 * 규율을 지키려면 `mask.ts` 를 `packages/contracts` 로 옮겨야 하는데,
 * 이번 Gen-Phase 의 제약이 **`mask.ts` 를 손대지 말 것**이다.
 *
 * → 그래서 Runner 가 실제로 필요로 하는 **문자열 경로 하나만** 같은 규칙으로 구현했다.
 *   (`error_message` 는 언제나 문자열이다. 객체·배열 재귀 순회가 필요한 쪽은 API 의
 *   응답·SSE 경로이고 그건 이미 `mask.ts` 가 한다.)
 *   아래 3가지 규칙은 `mask.ts` 와 **한 글자도 다르지 않게** 맞췄다:
 *     1. 치환 문자열 = `SECRET_MASK`(contracts 가 단일 소스)
 *     2. 3자 미만 값은 치환하지 않는다(짧은 값은 문서 전체를 갉아먹는다)
 *     3. 긴 값부터 치환한다(부분 문자열이 먼저 지워져 긴 값이 남는 사고 방지)
 *
 * **다음 Gen-Phase 권고**: `mask.ts` 를 `packages/contracts/src/mask.ts` 로 승격하고
 * api·runner 가 같은 파일을 import 하게 만들면 이 파일은 사라진다.
 */

/** 이 길이 미만은 치환하지 않는다 (`mask.ts` 와 동일). */
const MIN_MASKABLE_LENGTH = 3;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPatterns(secretValues: readonly string[]): RegExp[] {
  const unique = [...new Set(secretValues.filter((v) => v.length >= MIN_MASKABLE_LENGTH))];
  unique.sort((a, b) => b.length - a.length);
  return unique.map((value) => new RegExp(escapeRegExp(value), "g"));
}

/**
 * 문자열 안의 Secret **값**을 `••••••••` 로 치환한다.
 *
 * ★ 이것이 DB(`step_results.error_message` / `runs.error_message`)에 값이 남는 것을 막는
 *   **유일한 방어선**이다. SSE 는 API 가 한 번 더 마스킹하지만 **DB 에 쓰는 경로는 API 를
 *   거치지 않는다.** Playwright 에러 메시지에는 입력값이 그대로 실려 나온다:
 *   `locator.fill: Timeout 10000ms exceeded. Call log: waiting for locator("input[value='hunter2']")`
 */
export function maskSecretText(text: string, secretValues: readonly string[] = []): string {
  let result = text;
  for (const pattern of buildPatterns(secretValues)) {
    result = result.replace(pattern, SECRET_MASK);
  }
  return result;
}

/** 에러 객체 → 마스킹된 메시지 문자열. DB·이벤트에 넣기 직전에 쓴다. */
export function maskErrorMessage(error: unknown, secretValues: readonly string[] = []): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return maskSecretText(raw, secretValues);
}
