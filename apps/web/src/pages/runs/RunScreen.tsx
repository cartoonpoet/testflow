import { useState } from "react";
import { cn } from "cn";
import { isTerminalRunStatus, type Artifact, type RunDetail } from "@testflow/contracts";
import { findStep, LiveStage, type StepSyncHandle } from "@/features/live";
import { RUN_STATUS_LABEL } from "@/lib";

/**
 * 실행 화면(라이브) **전폭 무대** — 라운드 3.
 *
 * 화면 4 의 배치를 다음과 같이 바꿨다.
 *
 * ```
 * before (시안 그대로)                after (라운드 3)
 * ┌──────────────┬────────┐          ┌───────────────────────────┐
 * │              │ 라이브 │          │        라 이 브           │  ← 전폭 · 최대 1280px
 * │  스텝 리스트 │ 360px  │          ├──────────────┬────────────┤
 * │              │ 실행정보│          │  스텝 리스트 │ 실행정보   │  ← 시안 1fr 360px 유지
 * │              │ 증적   │          │              │ 증적       │
 * └──────────────┴────────┘          └──────────────┴────────────┘
 * ```
 *
 * 라이브가 없는 경로(`sourceType === "steps"` 녹화 실행)는 **이 컴포넌트를 아예
 * 렌더하지 않는다.** 스트림이 오지 않는 자리에 전폭 빈 상자를 세우면
 * "고장났다"로 읽힌다 — 그 경로는 지금까지처럼 우측 패널의 브라우저 목업에
 * 스크린샷·안내만 담는다(`RunSidePanel`).
 */
export type RunScreenProps = {
  run: RunDetail;
  artifacts: readonly Artifact[];
  /** ★ 라운드 5 — 스텝 목록과 이 무대를 잇는 손잡이(`RunDetail` 이 만든다). */
  sync: StepSyncHandle;
};

export function RunLiveScreen({ run, artifacts, sync }: RunScreenProps) {
  const video = artifacts.find((artifact) => artifact.type === "video");
  const ended = isTerminalRunStatus(run.status);

  /*
   * ★ **화면을 열었을 때** 이미 끝나 있었는가.
   *
   * `ended` 를 그대로 쓰면 보고 있던 실행이 끝나는 순간 영상으로 튕겨 나간다 —
   * 라운드 2가 "자동 전환하지 않는다"로 막은 바로 그 동작이다. `useState` 의 지연 초기값은
   * **첫 렌더에서만** 계산되므로 이 값은 마운트 시점의 사실로 고정된다.
   * (`useRef` 가 아니다 — 렌더 중 ref 접근은 `react-hooks/refs` 가 막는다.)
   * 이 컴포넌트는 `run` 이 로드된 뒤에만 렌더된다 — `RunDetail` 참조.
   */
  const [openedEnded] = useState(() => ended);

  return (
    <LiveStage
      runId={run.id}
      enabled={!ended}
      videoUrl={video?.url}
      autoVideo={openedEnded}
      videoRef={sync.videoRef}
      url={run.summary.baseUrl}
      fallback={
        <RunScreenStill
          artifacts={artifacts}
          code
          emptyText={emptyScreenText(run, video !== undefined)}
        />
      }
      progress={<RunLiveProgress run={run} sync={sync} />}
    />
  );
}

/**
 * ★ 상태별 문구 — **실행 중에 "화면이 아직 없습니다"를 띄우지 않는다.**
 *
 * 라운드 3까지는 프레임이 없으면 언제나 "표시할 실행 화면이 아직 없습니다 …"였다.
 * 실행이 **한창 돌고 있는데도** 그 문구가 떠서, 사용자에게는 "고장났다"로 읽혔다
 * (라운드 4 진단의 눈에 보이는 증상이 정확히 이것이다).
 */
function emptyScreenText(run: RunDetail, hasVideo: boolean): string {
  if (run.status === "queued") {
    return "실행이 큐에서 대기 중입니다. Runner 가 이 실행을 가져가면 이 자리에 실제 브라우저 화면이 그려집니다.";
  }
  if (!isTerminalRunStatus(run.status)) {
    return "실행 중입니다. 실행 화면을 불러오는 중이며, 화면이 준비되는 대로 이 자리에 그려집니다.";
  }
  if (hasVideo) {
    return "실행이 끝났습니다. 우측 위 “영상으로 보기”로 이 실행을 다시 볼 수 있습니다.";
  }
  return "실행이 끝났습니다. 이 실행에는 다시 볼 화면 증적이 남아 있지 않습니다.";
}

/**
 * 확대 중 캔버스 하단에 겹치는 **진행 스트립**.
 *
 * 확대하면 스텝 리스트가 화면 밖으로 나간다. 그렇다고 스텝 리스트를 통째로 겹치면
 * 정작 키운 화면을 다시 가린다. 그래서 **한 줄에 들어가는 것만** 남겼다 —
 * 상태 · N/M · 지금 도는 스텝 이름 · 진행바.
 *
 * ★ 라운드 5 — 여기가 **확대 모드의 스텝 동기화**다. 보여 주는 스텝을
 *   `run.steps` 의 마지막이 아니라 `sync.activeSequence` 에서 가져온다. 그래야
 *   영상을 돌릴 때 이 줄도 같이 움직인다(축소 상태의 목록과 같은 값을 읽는다).
 */
export function RunLiveProgress({ run, sync }: { run: RunDetail; sync: StepSyncHandle }) {
  const { summary } = run;
  const isRunning = run.status === "running" || run.status === "queued";
  const active = findStep(run.steps, sync.activeSequence);

  return (
    <div
      data-slot="live-progress"
      data-progress-sequence={sync.activeSequence ?? ""}
      className="flex items-center gap-[12px] text-[11px]"
    >
      <span className="flex shrink-0 items-center gap-[7px] font-850 text-run-state">
        {isRunning ? (
          <span
            aria-hidden="true"
            data-slot="pulse"
            className="h-[7px] w-[7px] rounded-full bg-run-state animate-pulse-dot"
          />
        ) : null}
        {isRunning ? RUN_STATUS_LABEL[run.status] : `실행 ${RUN_STATUS_LABEL[run.status]}`}
      </span>

      <span data-slot="live-progress-count" className="shrink-0 font-750">
        {/*
          ★ 영상 모드에서는 좌변이 `summary.currentStep`(= 실행이 끝난 시점의 값)이면
            영상을 되감아도 숫자가 굳어 있다. 그때는 강조 중인 스텝 번호가 좌변이다.
        */}
        {String(
          sync.mode === "video" ? (sync.activeSequence ?? 0) : summary.currentStep,
        )}{" "}
        / {String(summary.totalSteps)} 단계
      </span>

      {/*
        진행바를 넣지 않았다 — 바로 왼쪽의 `N / M 단계` 와 같은 값을 두 번 그리는
        꼴이고, 코드 실행은 M 이 실행 중에 커져서(03-phases 쟁점 2) 바가 뒤로
        물러나는 것처럼 보인다. 스트립은 한 줄이라 중복을 둘 자리가 없다.
      */}
      <span className="min-w-0 flex-1 truncate text-run-summary-ink">
        {active?.nameSnapshot ?? "단계 정보 대기 중"}
      </span>
    </div>
  );
}

/**
 * 라이브 프레임이 한 장도 없을 때 대신 그릴 것.
 *
 * `RunSidePanel` 의 브라우저 목업과 라이브 무대가 **같은 판단을 두 번** 하지 않도록
 * 여기 한 곳에 둔다. 우선순위는 라운드 2 그대로다 — 실패 스크린샷 > 중립 안내.
 */
export function RunScreenStill({
  artifacts,
  code,
  emptyText,
}: {
  artifacts: readonly Artifact[];
  code: boolean;
  /** 보여 줄 것이 하나도 없을 때의 문구. 생략하면 경로별 기본 문구를 쓴다. */
  emptyText?: string;
}) {
  const screenshot = latestScreenshot(artifacts);
  if (screenshot === undefined) return <NoScreenView code={code} text={emptyText} />;

  return (
    <img
      data-slot="run-screenshot"
      src={screenshot.url}
      alt={`실패 스텝 ${String(screenshot.stepSequence ?? 0)} 스크린샷`}
      className="max-h-full max-w-full rounded-[6px] border border-fake-line object-contain"
    />
  );
}

/**
 * 보여 줄 화면이 하나도 없을 때의 **중립 안내**.
 *
 * ★ 라운드 1의 정적 가짜 로그인 화면(시안 `.fake-login`)을 대신한다.
 *   그 목업은 실제 실행 화면으로 오해되기 쉬웠고, 라운드 2에서 코드 실행에는
 *   **진짜 화면이 오기 때문에** 두 가지가 나란히 있으면 어느 쪽이 진짜인지 알 수 없다.
 *   그래서 목업을 지우고 "무엇이 없는지"만 적는다.
 */
function NoScreenView({ code, text }: { code: boolean; text?: string }) {
  /*
   * 전폭 무대(코드 실행)에서는 상자가 1000px 급이라 11px 문구가 미아처럼 보인다.
   * 우측 360px 목업(녹화 실행)에서는 반대로 13px 이 상자를 꽉 채운다.
   * 같은 문구지만 **놓이는 상자 크기가 3배 다르므로** 타이포를 따로 준다.
   */
  return (
    <div className={cn("w-full text-center", code ? "max-w-[460px]" : "max-w-[280px]")}>
      <div
        aria-hidden="true"
        className={cn(
          "mx-auto grid place-items-center rounded-full bg-wait text-wait-ink",
          code ? "h-[52px] w-[52px] text-[20px]" : "h-[38px] w-[38px] text-[15px]",
        )}
      >
        ◇
      </div>
      <p
        className={cn(
          "m-0 mt-[12px] leading-[1.6] text-fake-ink",
          code ? "text-[13px]" : "text-[11px]",
        )}
      >
        {text ??
          (code
            ? "표시할 실행 화면이 아직 없습니다. 실행이 시작되면 이 자리에 실제 브라우저 화면이 그려집니다."
            : "녹화 기반 실행은 실행 화면이 스트리밍되지 않습니다. 실행이 끝나면 영상 증적을 이 자리에서 다시 볼 수 있습니다.")}
      </p>
    </div>
  );
}

function latestScreenshot(artifacts: readonly Artifact[]): Artifact | undefined {
  return [...artifacts]
    .filter((artifact) => artifact.type === "screenshot")
    .sort((a, b) => (a.stepSequence ?? 0) - (b.stepSequence ?? 0))
    .at(-1);
}
