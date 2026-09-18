import { cn } from "cn";
import {
  ACTION_CHIP_LABEL,
  type ScenarioSourceType,
  type StepResult,
} from "@testflow/contracts";
import { StepStatusIcon } from "@/components";
import { Skeleton } from "@/components/ui";
import type { StepSyncHandle } from "@/features/live";
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
  /**
   * 라운드 2 — 실행 원본. `code` 면 **대기(`pending`) 행이 아예 없다.**
   * 코드 실행은 `step_results` 를 미리 시딩할 수 없어(03-phases 쟁점 2) 스텝이
   * 실행되면서 하나씩 도착한다. 기본값을 `steps` 로 둬서 **녹화 실행 표시는 그대로**다.
   */
  sourceType?: ScenarioSourceType;
  /** 아직 끝나지 않은 실행인가. 코드 실행의 "다음 단계 대기" 행 표시에만 쓴다. */
  active?: boolean;
  /**
   * ★ 라운드 5 — 지금 화면(라이브 또는 영상)이 가리키는 스텝. 강조 + 자동 추적 대상이다.
   * 생략하면 이 목록은 라운드 4 까지와 **완전히 같이** 동작한다(추적도 강조도 없다).
   */
  sync?: StepSyncHandle;
};

export function RunStepList({
  steps,
  sourceType = "steps",
  active = false,
  sync,
}: RunStepListProps) {
  const code = sourceType === "code";
  const video = sync?.mode === "video";
  const seek = sync?.seekToStep;

  return (
    <div data-slot="execution-shell" className="relative">
      <div
        data-slot="execution"
        data-source-type={sourceType}
        data-active-sequence={sync?.activeSequence ?? ""}
        data-following={sync === undefined ? "" : sync.following ? "true" : "false"}
        ref={sync?.listRef}
        className="tf-step-scroll rounded-panel border border-line bg-panel p-[10px]"
      >
        {steps.map((step) => (
          <RunStepRow
            key={step.id}
            step={step}
            code={code}
            activeSequence={sync?.activeSequence ?? null}
            video={video}
            onSeek={seek}
          />
        ))}

        {/*
          ★ 시안의 "대기 번호" 3-상태 중 **대기 행이 없는** 코드 실행의 대체 표시.

          대기 행이 없다고 아무것도 두지 않으면, 마지막 스텝이 끝난 직후 화면이
          "다 끝났다"로 보인다(실제로는 다음 스텝을 찾는 중이다). 번호를 지어내지 않고
          **번호 없는 한 줄**로 "아직 더 온다"만 말한다 — 시안 토큰(`--color-wait*`) 그대로다.
        */}
        {code && active ? (
          <div
            data-slot="exec-row"
            data-status="awaiting"
            className="tf-exec-row rounded-btn p-[13px]"
          >
            <span
              aria-hidden="true"
              className="grid h-[25px] w-[25px] place-items-center rounded-full bg-wait text-[11px] text-wait-ink"
            >
              ⋯
            </span>
            <div className="min-w-0">
              <strong className="block truncate text-[12px] text-muted">
                다음 단계를 기다리는 중입니다
              </strong>
              <span className="mt-[2px] block text-[10px] leading-[1.5] text-muted">
                코드 실행은 단계가 실행되면서 하나씩 나타납니다. 전체 단계 수는 미리 알 수 없습니다.
              </span>
            </div>
            <span className="text-right font-mono text-[10px] text-muted">{EMPTY_MARK}</span>
          </div>
        ) : null}
      </div>

      {/*
        ★ 복귀 수단. **스크롤 상자 바깥에** 둔다 — 안에 두면 같이 스크롤돼서
          정작 필요한 순간(사용자가 저 멀리 올려 둔 상태)에 화면에 없다.
      */}
      {sync !== undefined && !sync.following ? (
        <button
          type="button"
          data-testid="step-follow-resume"
          onClick={sync.resume}
          className={cn(
            "absolute bottom-[14px] left-1/2 -translate-x-1/2 rounded-btn",
            "border border-line bg-panel px-[12px] py-[7px] text-[10px] font-bold text-ink shadow-panel",
            "transition-colors duration-150 hover:border-btn-hover-line hover:bg-btn-hover-bg",
            "focus-visible:border-brand focus-visible:shadow-focus-ring focus-visible:outline-none",
          )}
        >
          ↓ 현재 스텝으로
        </button>
      ) : null}

      {/*
        ★★ 오차를 숨기지 않는다. 영상 시간축은 **추정**이다(`step-time.ts` 참조).
          정확한 것처럼 보이게 만들면, 스텝을 눌렀는데 엉뚱한 데로 갔을 때
          사용자는 화면이 아니라 **자기 기억을 의심한다.**
      */}
      {video && sync?.toleranceSec !== null && sync !== undefined ? (
        <p
          data-slot="step-seek-notice"
          className="m-0 mt-[8px] text-[10px] leading-[1.5] text-muted"
        >
          스텝을 누르면 영상의 해당 지점으로 이동합니다. 영상 시작 시각과 실행 기록의
          기준점이 달라 위치는 <strong>대략적인 값</strong>입니다(오차 약 ±
          {String(sync.toleranceSec)}초).
        </p>
      ) : null}
    </div>
  );
}

function RunStepRow({
  step,
  code,
  activeSequence,
  video,
  onSeek,
}: {
  step: StepResult;
  code: boolean;
  activeSequence: number | null;
  video: boolean;
  onSeek: ((sequence: number) => void) | undefined;
}) {
  const failed = step.status === "failed";
  const isActive = activeSequence === step.sequence;

  const className = cn(
    "tf-exec-row w-full rounded-btn p-[13px] text-left",
    /*
     * 라이브에서는 `running` 이 곧 현재 스텝이라 지금까지의 표시가 그대로다.
     * 영상에서는 **전부 `passed`** 라 상태로는 현재를 가릴 수 없다 — 그래서
     * `isActive` 가 같은 배경을 진다. 두 모드가 같은 색을 쓰는 것이 핵심이다
     * (사용자가 "지금 여기"를 두 가지 색으로 배우게 하지 않는다).
     */
    (step.status === "running" || (video && isActive)) && "bg-exec-active",
    failed && "bg-danger-soft",
    onSeek !== undefined &&
      "cursor-pointer transition-colors duration-150 hover:bg-btn-hover-bg focus-visible:shadow-focus-ring focus-visible:outline-none",
  );

  const body = (
    <>
      <StepStatusIcon status={step.status} sequence={step.sequence} />

      <div className="min-w-0">
        <strong className="block truncate text-[12px]">{step.nameSnapshot}</strong>
        <span
          className={cn(
            "mt-[2px] block text-[10px] leading-[1.5]",
            failed ? "text-danger" : "text-muted",
          )}
        >
          {describeStepState(step, code)}
        </span>
      </div>

      <span className="text-right font-mono text-[10px] text-muted">
        {step.durationMs === null ? EMPTY_MARK : formatDurationMs(step.durationMs)}
      </span>
    </>
  );

  const attributes = {
    "data-slot": "exec-row",
    "data-status": step.status,
    "data-sequence": step.sequence,
    "data-active": isActive ? "true" : "false",
  } as const;

  /*
   * 영상이 있을 때만 행이 **버튼**이 된다. 누를 데가 없는데 버튼으로 두면
   * 키보드 탭이 33번 헛돌고 스크린리더가 33개의 "버튼"을 읽는다.
   */
  if (onSeek === undefined) {
    return (
      <div {...attributes} className={className}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      {...attributes}
      aria-label={`${String(step.sequence)}번째 스텝 ${step.nameSnapshot} 지점으로 영상 이동`}
      onClick={() => {
        onSeek(step.sequence);
      }}
      className={className}
    >
      {body}
    </button>
  );
}

/**
 * 상태별 부가 문장. 시안의 "이전 단계 완료 후 실행됩니다" 문구를 그대로 쓴다.
 *
 * ★ `code === true` 의 `running` 만 문구가 다르다. 코드 실행의 진행 중 행은
 *   `step.started` 로만 만들어지는 **임시 행**이라 `actionType` 이 아직 없다
 *   (`lib/run-events.ts` 의 `placeholderStep` 주석). 없는 동작 이름을 지어내지 않는다.
 *   `step.finished` 가 오면 진짜 `actionType` 이 들어와 아래 문구들이 그대로 쓰인다.
 */
export function describeStepState(step: StepResult, code = false): string {
  const action = ACTION_CHIP_LABEL[step.actionType];
  switch (step.status) {
    case "pending":
      return "이전 단계 완료 후 실행됩니다";
    case "running":
      return code ? "실행 중입니다" : `${action} 동작을 실행하는 중입니다`;
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
