import { cn } from "cn";
import type { RunDetail } from "@testflow/contracts";
import { RUN_STATUS_LABEL, browserLabel, formatClockTime, formatDurationMs } from "@/lib";

/**
 * 시안 `.run-summary` 1:1 (화면 4 상단 다크 요약바).
 *
 *   background #18302a (--color-dark-panel) / color white / border-radius 17px
 *   padding 21px / margin-bottom 15px / flex space-between
 *   h2 18px / p 11px #a8bbb5 (--color-run-summary-ink)
 *   .run-state  flex gap 9px / color #76d3b0 (--color-run-state) / font-weight 850
 *   .pulse      9×9 원 + box-shadow 파동 애니메이션 1.5s infinite
 *   @760px      align-items flex-start + gap 16px (세로로 접힘)
 *
 * ★ `pulse` 는 **실행 중일 때만** 돈다. 끝난 실행에서도 점이 뛰면 "아직 돌고 있다"는
 *   거짓 신호가 된다. `prefers-reduced-motion` 은 globals.css 가 전역으로 끈다
 *   (04-gen-8 이 시안 블록을 그대로 이식했다) — 점 자체는 남고 파동만 사라진다.
 */
export type RunSummaryBarProps = {
  run: RunDetail;
  /** 취소 신호를 보냈지만 Runner 가 아직 확정하지 않은 상태. */
  cancelPending?: boolean;
};

export function RunSummaryBar({ run, cancelPending = false }: RunSummaryBarProps) {
  const { summary } = run;
  const isRunning = run.status === "running" || run.status === "queued";

  const headline = cancelPending
    ? `${summary.envLabel} 환경 — 취소 중`
    : isRunning
      ? `${summary.envLabel} 환경에서 ${run.status === "queued" ? "대기 중" : "실행 중"}`
      : `${summary.envLabel} 환경 실행 ${RUN_STATUS_LABEL[run.status]}`;

  return (
    <div
      data-slot="run-summary"
      data-status={run.status}
      className={cn(
        "mb-[15px] flex items-center justify-between rounded-run-summary bg-dark-panel p-[21px] text-white",
        "max-mobile:flex-col max-mobile:items-start max-mobile:gap-[16px]",
      )}
    >
      <div>
        <h2 className="mb-[5px] text-[18px]">{headline}</h2>
        <p className="m-0 text-[11px] text-run-summary-ink">
          {browserLabel(summary.browser)} · Runner {summary.runnerId ?? "배정 대기"} · 시작{" "}
          {formatClockTime(summary.startedAt)}
          {run.durationMs === null ? "" : ` · ${formatDurationMs(run.durationMs)}`}
        </p>
      </div>

      <div
        data-slot="run-state"
        className="flex items-center gap-[9px] font-850 text-run-state"
      >
        {isRunning && !cancelPending ? (
          <span
            aria-hidden="true"
            data-slot="pulse"
            className="h-[9px] w-[9px] rounded-full bg-run-state animate-pulse-dot"
          />
        ) : null}
        <span data-slot="run-progress">
          {String(summary.currentStep)} / {String(summary.totalSteps)} 단계
        </span>
      </div>
    </div>
  );
}
