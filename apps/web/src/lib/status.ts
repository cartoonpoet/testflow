import type { ArtifactType, RunStatus, ScenarioStatus } from "@testflow/contracts";
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

/**
 * 증적 종류 표기.
 *
 * ★ 시안 실행 정보는 **4종만** 말한다(스크린샷·영상·Trace·콘솔 로그 — FR-008).
 *   그런데 Runner 는 실제로 **5종**을 만든다(04-gen-6 실측: `network_log` 추가).
 *   화면에서 빼면 디스크에는 있는데 받을 길이 없는 증적이 되므로 목록에 넣는다.
 *   순서는 시안 4종을 먼저 두고 네트워크 로그를 마지막에 붙였다.
 */
export const ARTIFACT_TYPE_LABEL = {
  screenshot: "실패 스크린샷",
  video: "실행 영상",
  trace: "Playwright Trace",
  console_log: "콘솔 로그",
  network_log: "네트워크 로그",
} as const satisfies Record<ArtifactType, string>;

export const ARTIFACT_TYPE_ORDER: readonly ArtifactType[] = [
  "screenshot",
  "video",
  "trace",
  "console_log",
  "network_log",
];

/** 목록 정렬용 — 시안 순서 → 그 외. */
export function artifactTypeRank(type: ArtifactType): number {
  const index = ARTIFACT_TYPE_ORDER.indexOf(type);
  return index === -1 ? ARTIFACT_TYPE_ORDER.length : index;
}

/** `chromium` → 시안 태그 표기 `Chrome`. MVP 는 chromium 하나뿐이다. */
export const BROWSER_LABEL = { chromium: "Chrome" } as const;

export function browserLabel(browser: keyof typeof BROWSER_LABEL): string {
  return BROWSER_LABEL[browser];
}
