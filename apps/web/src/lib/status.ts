import type { RunStatus, ScenarioStatus } from "@testflow/contracts";
import type { StatusTone } from "@/components/ui";

/**
 * 상태 → 화면 표기 사전.
 *
 * 타입(`RunStatus` / `ScenarioStatus`)은 `@testflow/contracts` 것을 그대로 쓴다.
 * **한국어 라벨은 계약이 아니라 표기**라서 web 에 둔다.
 * (시나리오 라벨은 contracts 에 `SCENARIO_STATUS_LABEL` 로 이미 있어 그것을 쓴다.)
 *
 * ★ `satisfies Record<...>` 로 못박아 두면 계약에 상태가 추가될 때
 *   타입 에러로 먼저 드러난다 — 화면이 조용히 빈칸을 그리는 것보다 낫다.
 */
export const RUN_STATUS_LABEL = {
  queued: "대기",
  running: "실행 중",
  passed: "성공",
  failed: "실패",
  cancelled: "취소됨",
  timeout: "시간 초과",
  error: "오류",
} as const satisfies Record<RunStatus, string>;

export const RUN_STATUS_TONE = {
  queued: "gray",
  running: "gray",
  passed: "green",
  failed: "red",
  cancelled: "gray",
  timeout: "red",
  error: "red",
} as const satisfies Record<RunStatus, StatusTone>;

/**
 * 시안 `.run-symbol` 안에 들어가는 글자.
 * 성공 `✓` / 실패 `!` / 그 외 `·` — 시안이 쓰는 두 기호를 유지하고 중립 상태만 보탰다.
 */
export const RUN_STATUS_SYMBOL = {
  queued: "·",
  running: "▶",
  passed: "✓",
  failed: "!",
  cancelled: "·",
  timeout: "!",
  error: "!",
} as const satisfies Record<RunStatus, string>;

export const SCENARIO_STATUS_TONE = {
  draft: "gray",
  published: "green",
  archived: "gray",
} as const satisfies Record<ScenarioStatus, StatusTone>;

/** `chromium` → 시안 태그 표기 `Chrome`. MVP 는 chromium 하나뿐이다. */
export const BROWSER_LABEL = { chromium: "Chrome" } as const;

export function browserLabel(browser: keyof typeof BROWSER_LABEL): string {
  return BROWSER_LABEL[browser];
}
