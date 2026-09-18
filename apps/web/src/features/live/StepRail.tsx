import type * as React from "react";
import { cn } from "cn";
import type { StepResult } from "@testflow/contracts";
import type { StepSyncHandle } from "./useStepSync";

/**
 * ★ 라운드 7 — **무대 옆(또는 위)에 붙는 스텝 레일.**
 *
 * ## 무엇을 고치는가
 * 09 가 라이브 무대를 전폭으로 올리고(`360px → 1094px`, 28.1% → 85.5%) 스텝 목록을
 * **아래로** 내렸다. 그 결과 1440×900 에서는 요약바 + 무대(684px)가 화면을 다 먹어
 * 목록이 접힌 채로 시작한다 — 영상을 보려면 스크롤을 내려야 하고, 내리면 영상이
 * 화면 위로 사라진다. 사용자의 불편("동영상 보면서 같이 볼 순 없어서")이 정확히 이것이다.
 *
 * ## 왜 "무대를 줄여서 옆에 두기" 가 아닌가
 * 1440×900 의 본문 실사용 폭은 1148px 이다. 여기서 320px 열을 떼면 무대는 810px =
 * 1280 대비 **63.3%** 로 주저앉는다. 그건 09 §2.2 가 수치로 기각한 "안 B"(60.2%,
 * *"12px 글자가 7.2px. 아직 읽히지 않는다"*)와 같은 자리다. **같은 실패를 반복하지 않는다.**
 *
 * → 그래서 레일은 **레이아웃을 밀지 않는다.**
 *   - 1680px 미만: 캔버스 **위에 겹친다.** 무대 표시 크기는 85.5% **그대로**다.
 *   - 1680px 이상: 겹치지 않고 **옆의 열**이 된다. 본문이 1440px 에서 멈추므로 열 모드는
 *     무대를 조금 깎지만(1920 이상에서 100% → 92.3%), 09 가 "읽힌다"고 못박은
 *     **85.5% 하한 위**를 언제나 지킨다. 브레이크포인트 1680px 이 바로 그 하한에서 나온 값이다.
 *   - 1050px 이하: 감춘다. 시안대로 1단으로 접히며 아래 전체 목록이 바로 이어진다.
 *   (폭 공식과 브레이크포인트 근거는 `globals.css > tf-live-stage` 주석)
 *
 * ## 스크롤도 이펙트도 없다
 * 전체 목록(`RunStepList`)은 33개를 늘어놓고 **자동 추적 스크롤**을 건다. 레일은 반대다 —
 * 현재 스텝을 **가운데 둔 창**(`RAIL_WINDOW`개)을 렌더할 뿐이라 활성 행이 언제나 보이고,
 * 스크롤을 옮길 일이 없어 이펙트가 하나도 필요 없다. 잘려 나간 앞뒤 개수는 숨기지 않고
 * 위아래 꼬리표로 적는다.
 *
 * ## #12 의 동작을 그대로 쓴다
 * 강조 대상·영상 seek·오차 안내는 전부 같은 `StepSyncHandle` 에서 온다. 레일은 상태를
 * 하나도 갖지 않으므로 아래 목록과 **어긋날 수가 없다**(같은 값을 두 곳에 그릴 뿐이다).
 */
export type StepRailProps = {
  steps: readonly StepResult[];
  sync: StepSyncHandle;
  /** 요약바와 같은 값. 코드 실행은 실행 중에 늘어난다. */
  totalSteps: number;
  /** 레일을 닫는다. */
  onClose: () => void;
};

/** 한 번에 보여 줄 행 수. 1440×900 무대(684px)의 레일 높이 622px 에 여유 있게 들어간다. */
export const RAIL_WINDOW = 9;

export function StepRail({ steps, sync, totalSteps, onClose }: StepRailProps) {
  const { start, end } = railWindow(steps, sync.activeSequence, RAIL_WINDOW);
  const visible = steps.slice(start, end);
  const seek = sync.seekToStep;

  return (
    <aside
      data-slot="step-rail"
      data-rail-count={visible.length}
      data-rail-active={sync.activeSequence ?? ""}
      aria-label="테스트 순서"
      className="tf-step-rail"
    >
      <header className="flex shrink-0 items-center gap-[8px] border-b border-dark-panel px-[11px] py-[9px]">
        <strong className="min-w-0 flex-1 truncate text-[11px] font-850 text-white">
          테스트 순서
        </strong>
        <span className="shrink-0 font-mono text-[10px] text-run-summary-ink">
          {String(sync.activeSequence ?? 0)} / {String(totalSteps)}
        </span>
        <button
          type="button"
          data-testid="step-rail-close"
          aria-label="스텝 목록 숨기기"
          onClick={onClose}
          className={cn(
            "shrink-0 rounded-btn px-[6px] py-[2px] text-[11px] leading-none text-run-summary-ink",
            "transition-colors duration-150 hover:text-white",
            "focus-visible:shadow-focus-ring focus-visible:outline-none",
          )}
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-[6px]">
        {start > 0 ? <RailEdge>↑ 앞 {String(start)}개</RailEdge> : null}

        {visible.length === 0 ? (
          <p className="m-0 px-[8px] py-[12px] text-[10px] leading-[1.6] text-run-summary-ink">
            아직 보고된 단계가 없습니다. 실행이 진행되면 여기에 순서대로 쌓입니다.
          </p>
        ) : null}

        {visible.map((step) => (
          <RailRow
            key={step.id}
            step={step}
            active={sync.activeSequence === step.sequence}
            onSeek={seek}
          />
        ))}

        {end < steps.length ? (
          <RailEdge>↓ 뒤 {String(steps.length - end)}개</RailEdge>
        ) : null}
      </div>

      {/*
        ★ 오차를 여기서도 숨기지 않는다. 아래 전체 목록에는 같은 안내가 한 문단으로
          붙어 있지만(`RunStepList`), 레일만 보고 스텝을 누르는 사람이 그 문단을
          읽었다는 보장이 없다. 좁은 자리라 한 줄로 줄였다.
      */}
      {seek === undefined || sync.toleranceSec === null ? null : (
        <p
          data-slot="rail-seek-notice"
          className="m-0 shrink-0 border-t border-dark-panel px-[11px] py-[7px] text-[9px] leading-[1.5] text-run-summary-ink"
        >
          누르면 영상이 그 지점으로 이동합니다 (오차 약 ±{String(sync.toleranceSec)}초)
        </p>
      )}
    </aside>
  );
}

function RailEdge({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 px-[8px] py-[5px] text-center text-[9px] text-run-summary-ink">
      {children}
    </p>
  );
}

function RailRow({
  step,
  active,
  onSeek,
}: {
  step: StepResult;
  active: boolean;
  onSeek: ((sequence: number) => void) | undefined;
}) {
  const failed = step.status === "failed";
  const className = cn(
    "flex w-full items-center gap-[8px] rounded-btn px-[7px] py-[7px] text-left",
    active && "bg-dark-panel",
    onSeek !== undefined &&
      "transition-colors duration-150 hover:bg-dark-panel focus-visible:shadow-focus-ring focus-visible:outline-none",
  );

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full font-mono text-[9px]",
          failed
            ? "bg-danger text-white"
            : active
              ? "bg-run-state text-dark-panel"
              : "bg-dark-panel text-run-summary-ink",
        )}
      >
        {String(step.sequence)}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[10px] leading-[1.5]",
          active ? "font-750 text-white" : "text-run-summary-ink",
          failed && "text-danger",
        )}
      >
        {step.nameSnapshot}
      </span>
    </>
  );

  const attributes = {
    "data-slot": "rail-row",
    "data-sequence": step.sequence,
    "data-status": step.status,
    "data-active": active ? "true" : "false",
  } as const;

  /*
   * 전체 목록과 같은 규율 — 누를 데가 없으면 버튼으로 만들지 않는다. 그러지 않으면
   * 레일이 탭 순서에 9개를 더 끼워 넣고 스크린리더가 "버튼"을 9번 읽는다.
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
 * 현재 스텝을 **가운데**에 둔 창의 [start, end).
 *
 * 순수 함수라 단위 테스트가 가능하다(레포에 훅 렌더 하네스가 없다 — `stepSyncMode` 와 같은 판단).
 * 활성 스텝이 없으면(`null`) **뒤쪽**을 보여 준다 — 라이브에서 스텝이 아직 안 왔을 때
 * 사용자가 기다리는 것은 방금 도착한 마지막 줄이지 1번 줄이 아니다.
 */
export function railWindow(
  steps: readonly { sequence: number }[],
  activeSequence: number | null,
  size: number,
): { start: number; end: number } {
  if (steps.length <= size) return { start: 0, end: steps.length };

  const index = steps.findIndex((step) => step.sequence === activeSequence);
  if (index < 0) return { start: steps.length - size, end: steps.length };

  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(0, index - half), steps.length - size);
  return { start, end: start + size };
}
