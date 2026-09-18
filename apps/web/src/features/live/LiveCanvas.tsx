import { useState } from "react";
import type * as React from "react";
import { cn } from "cn";
import type { RunStatus } from "@testflow/contracts";
import { useFrameRenderer } from "@/features/recorder";
import { useLiveStream } from "@/hooks/useLiveStream";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE } from "@/lib";

/**
 * 코드 실행의 **라이브 화면** (Task 5.4). 시안 `.browser-screen` 자리에 들어간다.
 *
 * ## 무엇을 재사용하는가
 * 프레임 디코드(`frame.ts`)·렌더 루프와 드롭 정책(`useFrameRenderer`)은
 * 녹화 클라이언트 것을 **그대로** 쓴다. 복사하지 않는다 — 봉투 25바이트와 드롭 정책이
 * 두 벌이 되는 순간 한쪽 화면만 조용히 깨진다(03-phases 쟁점 3).
 *
 * ## 무엇을 붙이지 않는가
 * `useInputBridge`/`useImeBridge` 를 **붙이지 않는다.** 코드 실행 화면은 보기만 한다.
 * 캔버스에 마우스·키 핸들러가 아예 없으므로 C→S 메시지가 발생할 경로가 없다.
 *
 * ## ★ 캔버스를 절대 비우지 않는다
 * 실행이 끝나는 순간 캔버스가 비면 사용자는 "화면이 죽었다"로 읽는다.
 * 마지막 프레임은 **실패 직전 화면**이라 가장 정보가 많다. 그래서
 * `useFrameRenderer().reset()` 을 **부르지 않고**, `ended` 에는 배지만 덮는다.
 *
 * ## 영상 전환 — **보고 있던 실행**은 수동, **이미 끝난 실행**은 자동 ★
 * 라운드 2는 "자동 전환하지 않는다"로 정했다. 그 근거는 **실행 중 → 종료 순간**의 것이다:
 * 마지막 화면을 보고 있는데 영상이 처음으로 되감기면 사용자가 잃는 것이 있다.
 *
 * 하지만 **이미 끝난 run 을 새로 여는 경우는 반대다.** 라이브는 404 라 캔버스가 영영 비고,
 * 사용자가 "영상으로 보기"를 찾아 누르기 전까지 아무것도 볼 수 없다. 그래서 두 경우를
 * `autoVideo` 로 가른다 — **열었을 때 이미 종료 상태였는가**(`RunScreen` 이 판단한다).
 * 사용자가 한 번이라도 토글하면 그 선택이 언제나 이긴다.
 */
export type LiveCanvasProps = {
  runId: string | undefined;
  /** 코드 실행이고 아직 끝나지 않았을 때만 true. 그때만 WS 를 연다. */
  enabled: boolean;
  /** 영상 증적 URL. 있으면 "영상으로 보기" 버튼이 나온다. */
  videoUrl?: string | undefined;
  /**
   * ★ 영상이 있으면 **처음부터 영상 모드**로 연다. 화면을 연 시점에 run 이 이미 끝나
   * 있었을 때만 true 다(실행 중에 끝난 경우는 false — 마지막 프레임을 지키기 위해서).
   */
  autoVideo?: boolean;
  /**
   * ★ 라운드 5 — `<video>` 엘리먼트를 바깥에 알려 주는 콜백 ref.
   *
   * 스텝 목록은 이 무대의 **형제**(`RunDetail` 이 공통 부모)라 시간축을 읽으려면
   * 엘리먼트가 위로 올라가야 한다. `useState` 를 담은 콜백 ref 라 영상 모드를
   * 껐다 켤 때마다 `null` → 엘리먼트로 정확히 갱신된다(`useStepSync` 참조).
   */
  videoRef?: (element: HTMLVideoElement | null) => void;
  /** 프레임이 한 장도 없을 때 대신 그릴 것 — 실패 스크린샷 또는 중립 안내. */
  fallback: React.ReactNode;
  /**
   * 캔버스 우상단에 "영상으로 보기" **왼쪽**에 끼워 넣을 버튼(확대/축소 등).
   *
   * 확대 버튼을 `LiveStage` 가 자기 자리에 절대배치하면 이 버튼과 좌표가 겹친다.
   * 겹침을 막으려고 양쪽이 각자 offset 을 계산하면 둘 중 하나만 고쳐도 어긋난다 →
   * **우상단 배치는 여기 한 줄에만** 두고, 바깥은 내용만 넘긴다.
   */
  topRight?: React.ReactNode;
  /** 확대 모드에서 캔버스 하단에 겹쳐 띄울 진행 표시. */
  footer?: React.ReactNode;
};

export function LiveCanvas({
  runId,
  enabled,
  videoUrl,
  autoVideo = false,
  videoRef,
  fallback,
  topRight,
  footer,
}: LiveCanvasProps) {
  /*
   * 평평하게 받는다. `renderer.remote.w` 처럼 **ref 를 들고 있는 객체를 통해** 값을 읽으면
   * `react-hooks/refs` 가 "렌더 중 ref 접근"으로 본다(`StreamCanvas` 가 props 를
   * 평평하게 받는 것과 같은 이유 — 그 파일 주석 참조).
   */
  const { canvasRef, remote, handleFrame } = useFrameRenderer();
  const live = useLiveStream(runId, { enabled, onFrame: handleFrame });
  /*
   * `null` = 사용자가 아직 고르지 않았다 → `autoVideo` 를 따른다.
   * `useState(autoVideo)` 로 두면 안 된다 — 영상 URL 은 증적 쿼리가 늦게 채우므로
   * 마운트 시점에는 `autoVideo` 가 아직 의미를 갖기 전이고, 초기값은 다시 계산되지 않는다.
   */
  const [videoChoice, setVideoChoice] = useState<boolean | null>(null);

  const watching = (videoChoice ?? autoVideo) && videoUrl !== undefined;
  const canvasVisible = live.hasFrame && !watching;

  return (
    <div
      data-slot="live-canvas"
      data-live-connection={live.connection}
      data-live-phase={live.phase}
      data-live-frame={live.hasFrame ? "true" : "false"}
      data-live-reconnect={String(live.reconnectAttempt)}
      data-live-view={watching ? "video" : "canvas"}
      className="relative aspect-[16/10] overflow-hidden bg-browser-screen"
    >
      {/*
        ★ 프레임이 없을 때도 캔버스를 **언마운트하지 않는다**(`hidden` 으로 숨기기만 한다).
          언마운트하면 지금까지 그린 픽셀이 사라져 "마지막 프레임 유지" 가 깨진다.
          `display:none` 은 캔버스 백버퍼를 지우지 않는다.
      */}
      <canvas
        ref={canvasRef}
        width={remote.w}
        height={remote.h}
        aria-label="실행 중인 브라우저 화면"
        data-testid="live-canvas"
        className={cn(
          /*
           * ★ `object-contain` — 종횡비 보증. 바깥 상자는 `aspect-[16/10]` 이고
           *   프레임도 1280×800(=16:10)이라 지금은 두 값이 같지만, Runner 의 뷰포트가
           *   바뀌면(`frame.width/height` 가 헤더로 온다) 상자와 프레임 비가 어긋난다.
           *   그때 `h-full w-full` 만 있으면 **화면이 눌려 그려진다.** 레터박스가 정답이다.
           */
          "block h-full w-full bg-browser object-contain",
          canvasVisible ? "" : "hidden",
        )}
      />

      {/*
        ★ 인라인 재생. 다운로드가 아니다 — `controls` 로 재생·탐색이 되고, 탐색은
          `GET /api/artifacts/:id` 의 **Range(206) 응답**이 받쳐 준다(없으면 진행 바가
          움직이지 않는다). `preload="metadata"` 로 길이만 먼저 읽어 진행 바를 살린다.
      */}
      {watching ? (
        <video
          ref={videoRef}
          data-testid="live-video"
          data-slot="live-video"
          src={videoUrl}
          controls
          preload="metadata"
          playsInline
          className="block h-full w-full bg-browser object-contain"
        />
      ) : null}

      {live.hasFrame || watching ? null : (
        <div className="grid h-full place-items-center p-[35px] max-mobile:p-[20px]">
          {fallback}
        </div>
      )}

      {/*
        ★ 상태별 문구 — "화면이 아직 없습니다" 를 **실행 중에 띄우지 않는다**(라운드 4 버그).
          첫 프레임 전에는 "실행 화면을 준비하는 중"(= 아직 page 가 없다),
          첫 프레임 이후의 전환 구간에만 "다음 테스트 준비 중"(= 테스트 사이)이다.
      */}
      {live.showBetweenTests && !watching ? (
        <Overlay data-slot="live-between-tests">
          <span className="animate-pulse-dot inline-block h-[7px] w-[7px] rounded-full bg-run-state" />
          {live.hasFrame ? "다음 테스트 준비 중…" : "실행 화면을 준비하는 중…"}
        </Overlay>
      ) : null}

      {/*
        ★ 연결 오버레이는 **이미 그림이 있을 때만** 띄운다.
          프레임이 한 장도 없을 때는 아래 `fallback` 이 run 상태에 맞는 문구를
          이미 말하고 있다(대기 중 / 실행 중 / 종료됨). 그 위에 "연결하는 중"을 덮으면
          같은 순간에 두 가지 설명이 겹쳐 어느 쪽이 사실인지 알 수 없게 된다.
          반대로 그림이 있는데 끊긴 경우에는 이 오버레이가 유일한 신호다.
      */}
      {live.phase === "connecting" && live.hasFrame && !watching ? (
        <Overlay data-slot="live-connecting">
          {live.reconnectAttempt > 0
            ? `실행 화면에 다시 연결하는 중… (${String(live.reconnectAttempt)}회)`
            : "실행 화면에 연결하는 중…"}
        </Overlay>
      ) : null}

      {live.phase === "ended" && live.hasFrame && !watching ? (
        <EndedBadge status={live.endedStatus} />
      ) : null}

      {live.notice === null ? null : (
        <div
          data-slot="live-notice"
          className="absolute inset-x-0 bottom-0 flex items-center gap-[10px] bg-overlay px-[12px] py-[8px] text-[10px] leading-[1.5] text-white"
        >
          <span className="min-w-0">{live.notice}</span>
          {/*
            자동 재시도를 하지 않는다 — 토큰은 1회용이고, 재발급이 곧 이전 토큰 무효화다.
            run 이 큐에서 15초 넘게 기다린 경우(04-gen-4 이슈 1)에 여기가 회복 경로다.
          */}
          {enabled ? (
            <button
              type="button"
              data-testid="live-retry"
              className="shrink-0 rounded-btn border border-line bg-panel px-[9px] py-[5px] text-[10px] font-bold text-ink"
              onClick={live.retry}
            >
              다시 연결
            </button>
          ) : null}
        </div>
      )}

      {/*
        확대 모드에서만 오는 진행 스트립. **레이아웃 높이를 먹지 않게** 겹친다 —
        높이를 먹으면 16:10 무대의 폭 계산(`tf-live-stage-expanded`)이 그만큼 줄어든다.

        ★ 라운드 5 — **영상 모드에서도 띄운다.** 확대하면 스텝 목록이 화면 밖으로
          나가는데, 영상만 보이고 "지금 몇 번째 스텝인지"가 사라지면 확대 모드에서만
          동기화가 끊기는 꼴이다. 다만 바닥에는 `<video controls>` 의 재생 바가 있으므로
          그 위(`bottom-[56px]`)로 올린다 — 겹치면 재생 바를 못 누른다. 값은 Chromium
          기본 컨트롤 높이(약 40px)에 그 위로 깔리는 그라데이션 여유를 더한 실측값이다.
      */}
      {footer == null ? null : (
        <div
          data-slot="live-footer"
          data-over-video={watching ? "true" : "false"}
          className={cn(
            "absolute inset-x-0 bg-live-strip px-[14px] py-[9px] text-white",
            watching ? "bottom-[56px]" : "bottom-0",
          )}
        >
          {footer}
        </div>
      )}

      {topRight == null && videoUrl === undefined ? null : (
        <div className="absolute right-[10px] top-[10px] flex items-center gap-[8px]">
          {topRight}
          {videoUrl === undefined ? null : (
            <button
              type="button"
              data-testid="live-video-toggle"
              onClick={() => {
                setVideoChoice(!watching);
              }}
              className={cn(
                "rounded-btn border border-line bg-panel px-[10px] py-[6px] text-[10px] font-bold text-ink",
                "transition-colors duration-150 hover:border-btn-hover-line hover:bg-btn-hover-bg",
                "focus-visible:border-brand focus-visible:shadow-focus-ring focus-visible:outline-none",
              )}
            >
              {watching ? "실행 화면으로" : "영상으로 보기"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 캔버스 위에 덮는 안내. 클릭을 가로채지 않는다(아래 영상 컨트롤을 막으면 안 된다). */
function Overlay({
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      {...props}
      className="pointer-events-none absolute inset-0 grid place-items-center bg-overlay p-[20px]"
    >
      <span className="flex items-center gap-[8px] rounded-btn bg-dark-panel px-[14px] py-[9px] text-[11px] font-750 text-white">
        {children}
      </span>
    </div>
  );
}

/** ★ 마지막 프레임 **위에** 덮는 상태 배지. 프레임을 지우지 않는다. */
function EndedBadge({ status }: { status: RunStatus | null }) {
  const tone = status === null ? "gray" : RUN_STATUS_TONE[status];
  const label = status === null ? "실행 종료" : `실행 ${RUN_STATUS_LABEL[status]}`;

  return (
    <div
      data-slot="live-ended-badge"
      data-tone={tone}
      className="pointer-events-none absolute left-[10px] top-[10px] flex items-center gap-[6px] rounded-btn bg-dark-panel px-[11px] py-[7px] text-[10px] font-750 text-white"
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-[6px] w-[6px] shrink-0 rounded-full",
          tone === "green" && "bg-success",
          tone === "red" && "bg-danger",
          tone === "gray" && "bg-dot-gray",
        )}
      />
      {label} · 마지막 화면
    </div>
  );
}
