import { cn } from "cn";

/**
 * 시안 `.record-badge` 1:1 (Task 10.4).
 *
 * ```
 * color:var(--danger) · background:var(--danger-soft)
 * radius 8px · padding 6px 9px · font-size 10px · font-weight 850
 * ```
 *
 * ★ **기록 상태는 항상 노출한다**(01-clarify "UX 결정사항"). 녹화 중인지 아닌지를
 *   테스터가 헷갈리면 안 되는 화면이라, 꺼져 있을 때도 배지를 숨기지 않는다.
 *   시안이 준 문구는 `● 기록 종료` 이고, 녹화 중·연결 중은 같은 형태로 문구만 바꾼다.
 */
export type RecordBadgeState = "recording" | "connecting" | "stopped";

const LABEL = {
  recording: "기록 중",
  connecting: "연결 중",
  stopped: "기록 종료",
} as const satisfies Record<RecordBadgeState, string>;

export type RecordBadgeProps = {
  state: RecordBadgeState;
};

export function RecordBadge({ state }: RecordBadgeProps) {
  return (
    <span
      data-slot="record-badge"
      data-state={state}
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-[5px] rounded-badge px-[9px] py-[6px]",
        "bg-danger-soft text-[10px] font-850 text-danger",
      )}
    >
      {/* 시안의 `●`. 녹화 중에만 깜빡인다(prefers-reduced-motion 에서 globals.css 가 끈다). */}
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-[6px] w-[6px] rounded-full bg-danger",
          state === "recording" ? "animate-pulse" : "",
        )}
      />
      {LABEL[state]}
    </span>
  );
}
