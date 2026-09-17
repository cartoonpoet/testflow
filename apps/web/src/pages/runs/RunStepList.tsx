import { cn } from "cn";
import { ACTION_CHIP_LABEL, type StepResult } from "@testflow/contracts";
import { StepStatusIcon } from "@/components";
import { Skeleton } from "@/components/ui";
import { EMPTY_MARK, formatDurationMs } from "@/lib";

/**
 * 시안 `.execution` / `.exec-row` 1:1 (화면 4 좌측 스텝 리스트).
 *
 *   .execution  background white / border 1px var(--line) / radius 16px / padding 10px
 *   .exec-row   grid 32px 1fr 70px / gap 10px / align-items center
 *               padding 13px / border-radius 10px
 *   .exec-row.active   background #f0f7f4 (--color-exec-active)
 *   .exec-copy strong  12px          .exec-copy span  10px var(--muted) / margin-top 2px
 *   .exec-time  text-align right / 10px / 모노
 *
 * 열 정의는 `globals.css` 의 `@utility tf-exec-row` 에 있다(시안 그리드는 한 곳에만 둔다).
 *
 * ★ 부가 문장은 **스텝 입력값이 아니라 상태**로 만든다. `StepResult` 에는 입력값이 없고
 *   (계약상 `nameSnapshot` · `actionType` 뿐) 있더라도 비밀번호가 실릴 수 있는 자리다.
 *   실패 스텝만 서버가 이미 마스킹한 `errorMessage` 를 그대로 보여 준다 —
 *   **화면에서 다시 가공하지 않는다**(04-gen-6).
 */
export type RunStepListProps = {
  steps: readonly StepResult[];
};

export function RunStepList({ steps }: RunStepListProps) {
  return (
    <div
      data-slot="execution"
      className="rounded-panel border border-line bg-panel p-[10px]"
    >
      {steps.map((step) => (
        <RunStepRow key={step.id} step={step} />
      ))}
    </div>
  );
}

function RunStepRow({ step }: { step: StepResult }) {
  const failed = step.status === "failed";

  return (
    <div
      data-slot="exec-row"
      data-status={step.status}
      data-sequence={step.sequence}
      className={cn(
        "tf-exec-row rounded-btn p-[13px]",
        step.status === "running" && "bg-exec-active",
        failed && "bg-danger-soft",
      )}
    >
      <StepStatusIcon status={step.status} sequence={step.sequence} />

      <div className="min-w-0">
        <strong className="block truncate text-[12px]">{step.nameSnapshot}</strong>
        <span
          className={cn(
            "mt-[2px] block text-[10px] leading-[1.5]",
            failed ? "text-danger" : "text-muted",
          )}
        >
          {describeStepState(step)}
        </span>
      </div>

      <span className="text-right font-mono text-[10px] text-muted">
        {step.durationMs === null ? EMPTY_MARK : formatDurationMs(step.durationMs)}
      </span>
    </div>
  );
}

/** 상태별 부가 문장. 시안의 "이전 단계 완료 후 실행됩니다" 문구를 그대로 쓴다. */
export function describeStepState(step: StepResult): string {
  const action = ACTION_CHIP_LABEL[step.actionType];
  switch (step.status) {
    case "pending":
      return "이전 단계 완료 후 실행됩니다";
    case "running":
      return `${action} 동작을 실행하는 중입니다`;
    case "passed":
      return `${action} 동작을 마쳤습니다`;
    case "skipped":
      return "앞 단계가 끝나지 않아 실행되지 않았습니다";
    case "failed":
      return step.errorMessage ?? `${action} 동작이 실패했습니다`;
    default:
      return "";
  }
}

/** 상세 로딩 스켈레톤. 실제 행과 열 수·패딩을 맞춘다(Gen-Phase 9 규율). */
export function RunStepListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-panel border border-line bg-panel p-[10px]">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="tf-exec-row p-[13px]">
          <Skeleton className="h-[25px] w-[25px] rounded-full" />
          <div>
            <Skeleton className="h-[12px] w-[46%]" />
            <Skeleton className="mt-[6px] h-[10px] w-[28%]" />
          </div>
          <Skeleton className="h-[10px] w-[34px] justify-self-end" />
        </div>
      ))}
    </div>
  );
}
