import type * as React from "react";
import { cn } from "cn";
import { LiveCanvas, type LiveCanvasProps } from "./LiveCanvas";
import { useExpand } from "./useExpand";

/**
 * 라이브 화면 **무대** (라운드 3) — 다크 크롬 바 + 캔버스 + 확대 모드.
 *
 * ## 왜 만들었나 — 360px 패널에서는 화면이 읽히지 않았다 ★
 * 라운드 2 까지 라이브 캔버스는 시안 `.run-layout { 1fr 360px }` 의 **360px 쪽**에 있었다.
 * 시안이 거기에 둔 것은 **정적 브라우저 목업**(그림)이라 줄여도 잃을 정보가 없었지만,
 * 라운드 2 가 그 자리를 **1280×800 실제 스트림**으로 바꾸면서 전제가 무너졌다.
 *
 *   360 / 1280 = **28.1%** → 프레임 안의 12px 글자가 3.4px 로 그려진다. 읽을 수 없다.
 *
 * 그래서 라이브만 2단 그리드 **밖으로 꺼내** 본문 전폭으로 올린다(`tf-live-stage`).
 * 폭 산정 근거는 `globals.css` 의 해당 유틸 주석에 있다.
 *
 * ## 확대 모드는 DOM 을 옮기지 않는다 ★
 * `position: fixed` 로 **같은 엘리먼트를** 뷰포트에 띄운다. 포털(= Radix `Dialog`)을
 * 쓰지 않는 이유는 `useExpand` 주석에 적었다 — 캔버스 픽셀과 1회용 라이브 토큰이
 * 리마운트를 못 견딘다.
 *
 * ## 시안 요소 중 남긴 것 / 버린 것
 * - **남김**: 다크 크롬 바(점 3개 + URL). 지금 어느 주소를 보고 있는지 알려 주는
 *   유일한 표시라, 화면이 커질수록 오히려 더 필요하다.
 * - **버림(확대 중)**: 그 크롬 바를 감춘다. 42px 을 캔버스에 돌려주면 폭이 67px 늘어난다
 *   (16:10 이라 높이 1px 은 폭 1.6px 이다). 확대 모드의 목적이 정확히 그 픽셀이다.
 */
export type LiveStageProps = Omit<LiveCanvasProps, "topRight" | "footer"> & {
  /** 크롬 바 URL 칸에 넣을 대상 주소. 스킴은 이 컴포넌트가 뗀다. */
  url: string;
  /** 확대 중 캔버스 하단에 겹쳐 보여 줄 스텝 진행 표시. */
  progress?: React.ReactNode;
};

export function LiveStage({ url, progress, ...canvas }: LiveStageProps) {
  const { expanded, toggle } = useExpand();

  return (
    <div
      data-slot="live-stage"
      data-expanded={expanded ? "true" : "false"}
      className={cn("mb-[15px]", expanded && "tf-live-backdrop")}
      {...(expanded
        ? { role: "dialog" as const, "aria-modal": true, "aria-label": "실행 화면 확대" }
        : {})}
    >
      <div className={expanded ? "tf-live-stage-expanded" : "tf-live-stage"}>
        <div className="overflow-hidden rounded-panel bg-browser shadow-panel">
          {/*
            시안 `.browser-bar` 그대로. 확대 중에는 `hidden` 으로 **감추기만** 한다 —
            조건부 렌더로 지우면 형제 인덱스가 밀려 아래 `LiveCanvas` 가 리마운트될 수 있고,
            그건 캔버스 픽셀과 소켓을 잃는 것과 같다.
          */}
          <div
            data-slot="browser-bar"
            className={cn(
              "flex h-[42px] items-center gap-[6px] bg-browser-bar px-[13px]",
              expanded && "hidden",
            )}
          >
            <i className="h-[8px] w-[8px] rounded-full bg-browser-dot" />
            <i className="h-[8px] w-[8px] rounded-full bg-browser-dot" />
            <i className="h-[8px] w-[8px] rounded-full bg-browser-dot" />
            <div className="ml-[8px] flex h-[24px] flex-1 items-center overflow-hidden rounded-[6px] bg-browser-url px-[10px] text-[9px] text-browser-url-ink">
              <span className="truncate">{stripScheme(url)}</span>
            </div>
          </div>

          <LiveCanvas
            {...canvas}
            footer={expanded ? progress : undefined}
            topRight={
              <button
                type="button"
                data-testid="live-expand"
                aria-expanded={expanded}
                onClick={toggle}
                className={cn(
                  "rounded-btn border border-line bg-panel px-[10px] py-[6px] text-[10px] font-bold text-ink",
                  "transition-colors duration-150 hover:border-btn-hover-line hover:bg-btn-hover-bg",
                  "focus-visible:border-brand focus-visible:shadow-focus-ring focus-visible:outline-none",
                )}
              >
                {expanded ? "축소 (Esc)" : "크게 보기"}
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}

/** 시안 URL 바는 `staging.example.com/login` 처럼 스킴을 뺀다. */
function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
