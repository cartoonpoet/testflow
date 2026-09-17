/**
 * 화면 표기용 순수 포매터.
 *
 * 규율 2가지.
 *  1. **`now` 를 인자로 받는다.** 컴포넌트 안에서 `new Date()` 를 부르면 테스트가 불가능하고
 *     StrictMode 이중 렌더에서 값이 흔들린다. 기본값만 `new Date()` 로 둔다.
 *  2. **없는 값을 지어내지 않는다.** 시안의 "지난주 대비 +2.4%" 같은 비교 지표는
 *     API 가 주지 않으므로 여기서 계산하지 않는다(04-gen-9 "이슈/결정사항" 참조).
 */

/** 값이 없을 때 쓰는 표기. 시안 테이블의 `—` 와 같다. */
export const EMPTY_MARK = "—";

/**
 * 실행 소요 시간. 시안 지표 카드 표기(`2m 14s`)를 그대로 따른다.
 * 1분 미만은 초만, 1시간 이상은 `1h 02m`.
 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return EMPTY_MARK;
  if (ms < 1000) return `${String(Math.max(0, Math.round(ms)))}ms`;

  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${String(hours)}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${String(minutes)}m ${pad2(seconds)}s`;
  return `${String(seconds)}s`;
}

/** 0~1 비율 → `89.6%`. 소수 자리수는 기본 1자리. */
export function formatRatioPercent(ratio: number, digits = 1): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  return `${(clamped * 100).toFixed(digits)}%`;
}

/** 0~100 값 → `71.4%`. readiness 의 `percent` 는 이미 0~100 이다. */
export function formatPercentValue(percent: number, digits = 1): string {
  const clamped = Math.min(100, Math.max(0, percent));
  return `${clamped.toFixed(digits)}%`;
}

/** 진행바 폭. 0~100 범위로 자른 뒤 CSS 길이 문자열로 만든다. */
export function toBarWidth(percent: number): string {
  return `${String(Math.min(100, Math.max(0, Math.round(percent))))}%`;
}

/**
 * 최근 실행 목록의 경과 시간. 시안 표기(`방금 전` / `8분 전` / `1시간 전`)를 따른다.
 * 하루가 넘어가면 `9월 15일` 로 떨어진다.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(iso);
  if (date === null) return EMPTY_MARK;

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "곧";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${String(minutes)}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}시간 전`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}일 전`;

  return formatMonthDay(date);
}

/**
 * 시나리오 목록의 "수정일". 시안 표기(`오늘 14:32` / `어제` / `9월 15일`)를 따른다.
 */
export function formatDateLabel(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(iso);
  if (date === null) return EMPTY_MARK;

  const dayDiff = calendarDayDiff(date, now);
  if (dayDiff === 0) return `오늘 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (dayDiff === 1) return "어제";
  return formatMonthDay(date);
}

/** `9월 15일`. 해가 다르면 `2025년 9월 15일`. */
export function formatMonthDay(date: Date, now: Date = new Date()): string {
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());
  if (date.getFullYear() === now.getFullYear()) return `${month}월 ${day}일`;
  return `${String(date.getFullYear())}년 ${month}월 ${day}일`;
}

/** 시나리오 셀 보조 텍스트 — 시안 `TC-AUTH-001 · 5개 스텝`. */
export function formatScenarioMeta(code: string, stepCount: number): string {
  return `${code} · ${String(stepCount)}개 스텝`;
}

/* ── 내부 ───────────────────────────────────────────────── */

function toDate(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 시각이 아니라 **달력 날짜** 기준 차이. `23:59 → 00:01` 을 "어제"로 보기 위함이다. */
function calendarDayDiff(date: Date, now: Date): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
