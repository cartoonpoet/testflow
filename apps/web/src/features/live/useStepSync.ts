import { useCallback, useEffect, useRef, useState } from "react";
import { isTerminalRunStatus, type RunDetail } from "@testflow/contracts";
import {
  buildVideoTimeline,
  liveActiveSequence,
  stepAtVideoTime,
  videoTimeForStep,
  type VideoTimeline,
} from "./step-time";

/**
 * 스텝 목록을 **화면(라이브·영상)과 동기화**하는 훅. (라운드 5)
 *
 * ## 왜 훅 하나에 모았나
 * "useEffect 자제" 규율은 그대로다. 하지만 여기서 해야 하는 일 세 가지는 전부
 * **바깥 세계의 생명주기**다 — `<video>` 의 `timeupdate`, 사용자 스크롤 제스처,
 * DOM 스크롤 위치. 컴포넌트에 흩뿌리면 "지금 왜 스크롤이 움직였나"를 세 파일에서
 * 추적하게 된다. 그래서 이펙트를 이 파일에 가두고 화면에는 값과 콜백만 준다
 * (`useRunEvents` 와 같은 규율).
 *
 * ## ★ 자동 추적을 **언제 멈추고 언제 복귀하는가**
 *
 * | | |
 * |---|---|
 * | 멈춤 | 사용자가 목록에 **휠 · 터치 드래그 · 방향키/PageUp/Home** 을 쓴 순간 |
 * | 복귀 | "현재 스텝으로" 버튼을 누를 때 **뿐이다** |
 * | 복귀 후 | 다음 스텝부터 다시 따라간다 |
 *
 * ★ **`scroll` 이벤트로 판단하지 않는다.** 부드러운 스크롤(`behavior:"smooth"`)은
 *   우리가 건 것이어도 `scroll` 이벤트를 수십 번 뿜는다. 그걸 "사용자가 스크롤했다"로
 *   읽으면 **자동 추적이 첫 이동에서 스스로 꺼진다.** 제스처 이벤트(휠/터치/키)는
 *   사용자만 만들 수 있으므로 오판이 원리적으로 없다.
 *
 * ## ★ 페이지를 스크롤하지 않는다
 * `element.scrollIntoView()` 는 **모든 조상**을 스크롤한다 — 창까지 움직인다.
 * 그건 스크롤 하이재킹이다. 여기서는 목록 상자의 `scrollTop` 만 옮긴다
 * (`globals.css > tf-step-scroll` 이 그 상자에 높이 상한과 `overflow-y` 를 준다).
 *
 * ## ★ 목록이 늘어나도 튀지 않는다
 * 코드 실행은 `totalSteps` 가 실행 중에 **증가한다**(대기 행이 없다). 새 행은 언제나
 * **아래에** 붙으므로 현재 행의 `offsetTop` 이 바뀌지 않는다. 그리고 스크롤은
 * `activeSequence` 가 **바뀔 때만** 건다 — 행이 추가된 것만으로는 아무 일도 하지 않는다.
 *
 * ## `prefers-reduced-motion`
 * 스크롤할 때마다 `matchMedia` 를 읽어 `behavior` 를 고른다. CSS 의
 * `scroll-behavior: auto !important`(globals.css)는 **JS 가 명시한 `behavior` 를
 * 덮지 못한다** — 명시값이 CSS 보다 우선이다. 그래서 JS 에서도 직접 판단해야 한다.
 */
/**
 * 무엇이 `activeSequence` 를 정하고 있는가.
 *
 * | 값 | 뜻 |
 * |---|---|
 * | `video` | `<video>` 의 재생 시각이 정한다(끝난 실행을 다시 보는 중) |
 * | `live`  | 아직 **도는 중**인 실행의 진행 상태가 정한다 |
 * | `ended` | 실행은 끝났는데 **다시 볼 영상이 없다** — 마지막 스텝에서 굳어 있다 |
 *
 * ★ `ended` 를 따로 둔 이유는 진단이다. 라운드 6 이전에는 영상이 없는 끝난 실행도
 *   `live` 로 나와(`data-step-sync-mode="live"`) DOM 만 보면 **끝난 실행이 라이브 모드로
 *   멈춰 있는 것처럼** 읽혔다. 실제 실측에서 그 오독이 일어났다. 화면 동작은 `live` 와
 *   같지만(둘 다 run 상태가 강조를 정한다) **사실은 다른 상황이므로 이름도 달라야 한다.**
 */
export type StepSyncMode = "live" | "video" | "ended";

export type StepSyncHandle = {
  /** 지금 강조하고 따라갈 스텝. 없으면 `null`. */
  readonly activeSequence: number | null;
  /** 무엇이 `activeSequence` 를 정하고 있는가. */
  readonly mode: StepSyncMode;
  /** 자동 추적 중인가. `false` 면 사용자가 스크롤해서 멈춘 상태다. */
  readonly following: boolean;
  /** "현재 스텝으로" — 추적을 다시 켜고 즉시 현재 스텝으로 옮긴다. */
  readonly resume: () => void;
  /** 스텝 목록 스크롤 상자에 붙일 콜백 ref. */
  readonly listRef: (element: HTMLDivElement | null) => void;
  /** `<video>` 에 붙일 콜백 ref. 영상 모드가 아니면 호출되지 않는다. */
  readonly videoRef: (element: HTMLVideoElement | null) => void;
  /** 스텝을 눌렀을 때 영상을 그 지점으로 보낸다. 영상 모드가 아니면 `undefined`. */
  readonly seekToStep: ((sequence: number) => void) | undefined;
  /** 영상 모드일 때 화면에 밝힐 오차(초). 아니면 `null`. */
  readonly toleranceSec: number | null;
};

/**
 * 지금 무엇이 강조 스텝을 정하는가.
 *
 * ★ `ended` 는 **`live` 와 같은 값을 쓰지만 이름이 다르다.** 끝난 실행에 영상이 없으면
 *   강조는 마지막 스텝에서 멈추는 것이 맞고(그 이상 알 수 있는 것이 없다), 그것을
 *   `live` 라고 부르면 DOM 을 보는 사람이 "왜 끝난 실행이 라이브지"를 먼저 의심하게 된다.
 *   실제로 라운드 6 진단에서 `timeout` 으로 끝난 실행이 `data-step-sync-mode="live"` 로
 *   남아 그 오독이 일어났다.
 *
 * 훅 밖으로 뺀 이유는 **단위 테스트**다 — 이 레포에는 훅 렌더 하네스가 없고
 * (새 의존성을 넣지 않는다) 판단 자체는 순수 함수라 그대로 검증할 수 있다.
 */
export function stepSyncMode(run: RunDetail | undefined, videoAttached: boolean): StepSyncMode {
  if (videoAttached) return "video";
  if (run !== undefined && isTerminalRunStatus(run.status)) return "ended";
  return "live";
}

export function useStepSync(run: RunDetail | undefined): StepSyncHandle {
  /*
   * ref 가 아니라 **state** 로 엘리먼트를 들고 있다. 콜백 ref → setState 라
   * 엘리먼트가 붙고 떨어질 때마다 아래 이펙트들이 정확히 다시 걸린다
   * (`ref.current` 를 이펙트 의존성에 넣을 수 없는 문제를 피한다).
   */
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  /*
   * ★ `<video>` 만 state 가 아니라 **ref + 붙었는가 플래그**다.
   *
   *   `seekToStep` 은 `video.currentTime = t` 로 엘리먼트를 **고쳐 쓴다.** state 에 담긴
   *   값을 고치는 것은 `react-hooks/immutability` 가 막는다(그 규칙이 옳다 — state 는
   *   불변으로 다뤄야 한다). DOM 엘리먼트는 애초에 가변 객체이므로 ref 가 제자리다.
   *
   *   대신 렌더 중에는 `ref.current` 를 읽을 수 없으므로(`react-hooks/refs`)
   *   "붙어 있는가"만 state 로 따로 든다. `<video>` 는 토글될 때 반드시 언마운트를
   *   거치므로(`{watching ? <video/> : null}`) 이 플래그가 엘리먼트 교체를 빠짐없이 잡는다.
   */
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [videoAttached, setVideoAttached] = useState(false);
  const [following, setFollowing] = useState(true);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState<number | undefined>(undefined);
  /** 복귀 버튼이 "같은 스텝"에서도 동작해야 한다 — 스크롤 이펙트를 깨우는 티켓이다. */
  const [resumeTicket, setResumeTicket] = useState(0);

  const steps = run?.steps ?? EMPTY_STEPS;
  const mode = stepSyncMode(run, videoAttached);

  const timeline: VideoTimeline | null =
    mode === "video" ? buildVideoTimeline(steps, videoDuration) : null;

  const activeSequence =
    mode === "video" && timeline !== null
      ? stepAtVideoTime(timeline, videoTime)
      : run === undefined
        ? null
        : liveActiveSequence(run);

  /* ── 영상 시간축 구독 ────────────────────────────────────────
   * `timeupdate` 는 초당 4~66회로 성기게 온다(브라우저 재량). 그래서 `seeking`·`seeked`
   * 도 같이 듣는다 — 사용자가 진행 바를 끌 때 `timeupdate` 만으로는 강조가 늦게 따라온다.
   * ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    const video = videoElementRef.current;
    if (!videoAttached || video === null) {
      // 영상 모드를 끄면 시간축도 버린다 — 다음에 켤 때 옛 시각이 한 프레임 비친다.
      setVideoDuration(undefined);
      setVideoTime(0);
      return;
    }

    const readTime = () => {
      setVideoTime(video.currentTime);
    };
    const readMeta = () => {
      const { duration } = video;
      setVideoDuration(Number.isFinite(duration) && duration > 0 ? duration : undefined);
      setVideoTime(video.currentTime);
    };

    // 이미 메타데이터가 있는 상태로 붙는 경우(토글 왕복)를 위해 한 번 읽는다.
    readMeta();

    video.addEventListener("timeupdate", readTime);
    video.addEventListener("seeking", readTime);
    video.addEventListener("seeked", readTime);
    video.addEventListener("loadedmetadata", readMeta);
    video.addEventListener("durationchange", readMeta);
    return () => {
      video.removeEventListener("timeupdate", readTime);
      video.removeEventListener("seeking", readTime);
      video.removeEventListener("seeked", readTime);
      video.removeEventListener("loadedmetadata", readMeta);
      video.removeEventListener("durationchange", readMeta);
    };
  }, [videoAttached]);

  /* ── ★ 사용자 제스처 = 추적 정지 ──────────────────────────── */
  useEffect(() => {
    if (listElement === null) return;

    const stop = () => {
      setFollowing(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) stop();
    };

    // `passive` — 우리는 막지 않고 **관찰만** 한다. 스크롤 성능을 깎지 않는다.
    listElement.addEventListener("wheel", stop, { passive: true });
    listElement.addEventListener("touchmove", stop, { passive: true });
    listElement.addEventListener("keydown", onKeyDown);
    return () => {
      listElement.removeEventListener("wheel", stop);
      listElement.removeEventListener("touchmove", stop);
      listElement.removeEventListener("keydown", onKeyDown);
    };
  }, [listElement]);

  /* ── ★ 현재 스텝을 따라간다 ──────────────────────────────── */
  useEffect(() => {
    if (!following || listElement === null || activeSequence === null) return;

    const row = listElement.querySelector<HTMLElement>(
      `[data-sequence="${String(activeSequence)}"]`,
    );
    if (row === null) return;

    // 상자 가운데에 놓는다 — 앞뒤 스텝이 같이 보여야 "어디까지 왔는지"가 읽힌다.
    const top = row.offsetTop - (listElement.clientHeight - row.offsetHeight) / 2;
    const behavior = scrollBehavior();
    /*
     * 진단 속성을 **이펙트가 직접 쓴다**(렌더 상태로 만들면 스크롤 한 번에 리렌더가 한 번
     * 더 붙는다). React 가 모르는 `data-*` 라 다음 렌더가 지우지 않는다.
     * 이 한 줄 덕에 `prefers-reduced-motion` 분기를 **실제 브라우저에서** 읽어 확인할 수
     * 있다 — headless Chromium 은 부드러운 스크롤 자체를 돌리지 않아 움직임으로는
     * 구분이 되지 않는다(12-step-sync.md §6).
     */
    listElement.setAttribute("data-follow-behavior", behavior);
    listElement.scrollTo({ top: Math.max(0, top), behavior });
    /*
     * ★ 의존성에 `steps.length` 가 **없다.** 행이 늘어난 것만으로 스크롤을 걸면
     *   33스텝 실행에서 스텝이 하나 도착할 때마다 상자가 들썩인다. 움직일 이유는
     *   "현재 스텝이 바뀌었다" 하나뿐이다.
     */
  }, [following, listElement, activeSequence, resumeTicket]);

  const resume = useCallback(() => {
    setFollowing(true);
    setResumeTicket((ticket) => ticket + 1);
  }, []);

  const seekToStep = useCallback(
    (sequence: number) => {
      const video = videoElementRef.current;
      if (video === null) return;
      const at = videoTimeForStep(buildVideoTimeline(steps, videoDuration), sequence);
      if (at === null) return;
      video.currentTime = at;
      setVideoTime(at);
      // 스텝을 눌렀다는 것은 "여기를 보겠다"는 뜻이다 — 추적을 되살린다.
      setFollowing(true);
      setResumeTicket((ticket) => ticket + 1);
    },
    [steps, videoDuration],
  );

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoElementRef.current = element;
    setVideoAttached(element !== null);
  }, []);

  return {
    activeSequence,
    mode,
    following,
    resume,
    listRef: setListElement,
    videoRef: attachVideo,
    seekToStep: timeline === null ? undefined : seekToStep,
    toleranceSec: timeline?.toleranceSec ?? null,
  };
}

const EMPTY_STEPS: RunDetail["steps"] = [];

const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

/**
 * `prefers-reduced-motion: reduce` 면 **즉시 이동**한다.
 *
 * 렌더가 아니라 스크롤 직전에 읽는다 — 사용자가 OS 설정을 바꾸면 다음 스크롤부터
 * 바로 반영된다(구독을 만들 이유가 없다).
 */
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "auto";
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
