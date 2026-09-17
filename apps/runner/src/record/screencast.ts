/**
 * 화면 전달 계층 — 프레임 송출 (03-phases Task 3.2)
 *
 * ★ 이 파일은 "화면 전달 계층"의 절반이다(나머지 절반은 `input-bridge.ts`).
 *   02-context "설계상 반드시 지켜야 할 제약" — PoC-1 이 실패해 1번(별도 창) 방식으로
 *   후퇴하더라도 **이 두 파일만 교체**하면 되도록, 수집 4단계(감지·Locator·변환·적재)는
 *   이 파일을 import 하지 않는다.
 *
 * ★ 드라이버가 2개다. `startScreencast` 의 **시그니처는 드라이버와 무관하게 동일**하며,
 *   그 사실을 `StartScreencast` 타입 별칭으로 못박는다(완료 기준: "내부 구현을 CDP 로 바꿔도
 *   export 시그니처가 변하지 않음이 타입으로 보장된다").
 *     - `"playwright"` (1안, 기본) — `page.screencast.start({ onFrame, quality, size })`.
 *                                    프레임 ack 를 우리가 관리하지 않아도 된다.
 *     - `"cdp"`        (2안, 후퇴)  — `Page.startScreencast` + `Page.screencastFrameAck`.
 *                                    ack 를 보내지 않으면 프레임이 멈춘다.
 *
 * ★ `size` 는 **반드시 명시**한다. 미지정 시 Playwright 가 뷰포트를 800×800 에 맞춰 축소하고,
 *   그러면 캔버스 ↔ 원격 뷰포트 좌표 변환이 통째로 틀어진다(02-context "화면 스트리밍").
 */
import type { CDPSession, Page } from "playwright";

/* ── 프레임 ─────────────────────────────────────────────────── */

/**
 * `onFrame` 이 받는 값.
 *
 * 앞 4개 필드는 Playwright `page.screencast` 의 `onFrame` 인자와 **필드명·타입이 같다**.
 * CDP 드라이버도 같은 모양으로 정규화해서 넘긴다.
 */
export interface ScreencastFrame {
  /** JPEG 바이너리. base64 로 바꾸지 마라 — 33% 오버헤드가 그대로 지연이 된다. */
  readonly data: Buffer;
  /** 드라이버가 준 원본 타임스탬프. 단위/기준점은 드라이버마다 다르다 → `capturedAtMs` 를 써라. */
  readonly timestamp: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  /**
   * 위 `timestamp` 를 **epoch 밀리초로 정규화**한 값. 왕복 지연 측정의 기준점이다.
   * 정규화에 실패하면(단조 시계 등) 프레임 수신 시각으로 대체하며, 그 사실은
   * `ScreencastHandle.timestampKind` 로 노출된다 — 측정값을 해석할 때 반드시 확인할 것.
   */
  readonly capturedAtMs: number;
}

export type TimestampKind =
  /** `timestamp` 가 epoch 초였다 (CDP `Page.screencastFrame` 의 metadata.timestamp 규약). */
  | "epoch-seconds"
  /** `timestamp` 가 epoch 밀리초였다. */
  | "epoch-millis"
  /** 판별 실패 — `capturedAtMs` 는 **수신 시각**이며 브라우저 내부 캡처 지연은 빠져 있다. */
  | "unknown-fallback"
  /** 아직 프레임이 한 장도 오지 않았다. */
  | "pending";

/** 좌표 역주입 정확도에 직결되는 값들. `pageScaleFactor` 가 1 이 아니면 좌표를 한 번 더 나눠야 한다. */
export interface PageScaleInfo {
  readonly pageScaleFactor: number;
  readonly scrollOffsetX: number;
  readonly scrollOffsetY: number;
  readonly offsetTop: number;
}

const IDENTITY_SCALE: PageScaleInfo = {
  pageScaleFactor: 1,
  scrollOffsetX: 0,
  scrollOffsetY: 0,
  offsetTop: 0,
};

/* ── 옵션 / 핸들 ────────────────────────────────────────────── */

export type ScreencastDriver = "playwright" | "cdp";

export interface ScreencastOptions {
  /** 프레임 1장마다 호출된다. Promise 를 돌려주면 그만큼 백프레셔가 걸린다. */
  onFrame: (frame: ScreencastFrame) => void | Promise<void>;
  /** ★ 필수로 취급한다. 생략하면 `DEFAULT_SCREENCAST_SIZE` 가 들어간다. */
  size?: { width: number; height: number };
  /** JPEG 품질(1~100). 낮출수록 대역폭이 준다. */
  quality?: number;
  /** 기본 `"playwright"`. 환경변수 `TESTFLOW_SCREENCAST_DRIVER` 로도 바꿀 수 있다. */
  driver?: ScreencastDriver;
  /** CDP 드라이버 전용 — N 프레임마다 1장만 보낸다(대역폭 절약). */
  everyNthFrame?: number;
  /**
   * `pageScaleFactor`/`scrollOffset` 추적을 위한 보조 CDP 세션을 붙인다.
   * playwright 드라이버에서도 이 값이 필요하면 켠다(02-context 의 "CDP 세션을 보조로" 훅).
   */
  trackPageScale?: boolean;
  /** 같은 API 로 영상 파일도 얻는다(`page.screencast` 전용, CDP 드라이버에서는 무시된다). */
  path?: string;
}

export interface ScreencastHandle {
  readonly driver: ScreencastDriver;
  readonly size: { width: number; height: number };
  /** `capturedAtMs` 가 어떻게 계산됐는지. 측정값 해석에 반드시 필요하다. */
  readonly timestampKind: TimestampKind;
  /** 마지막으로 알려진 페이지 스케일(동기). 추적이 꺼져 있으면 항등값이다. */
  getPageScale(): PageScaleInfo;
  /** CDP `Page.getLayoutMetrics` 로 지금 값을 다시 읽는다. 보조 세션이 없으면 항등값. */
  refreshPageScale(): Promise<PageScaleInfo>;
  /** 송출한 프레임 수 / 인코딩된 총 바이트. */
  stats(): { frames: number; bytes: number };
  stop(): Promise<void>;
}

/**
 * ★ 완료 기준의 핵심 — 드라이버를 바꿔도 이 타입은 변하지 않는다.
 *   구현체(`startScreencast`)에 이 타입을 붙여 두면 시그니처 변경이 컴파일 에러가 된다.
 */
export type StartScreencast = (page: Page, options: ScreencastOptions) => Promise<ScreencastHandle>;

/** `DEFAULT_VIEWPORT`(@testflow/contracts) 와 같은 값. 여기서 contracts 를 끌어오면 순환이 생겨 상수로 둔다. */
export const DEFAULT_SCREENCAST_SIZE = { width: 1280, height: 800 } as const;
export const DEFAULT_SCREENCAST_QUALITY = 60;

/* ── 타임스탬프 정규화 ──────────────────────────────────────── */

/** 드라이버마다 단위가 달라(초/밀리초/단조시계) 첫 프레임에서 한 번 판별한다. */
function detectTimestampKind(timestamp: number, nowMs: number): Exclude<TimestampKind, "pending"> {
  if (Number.isFinite(timestamp)) {
    if (Math.abs(timestamp * 1000 - nowMs) < 60_000) return "epoch-seconds";
    if (Math.abs(timestamp - nowMs) < 60_000) return "epoch-millis";
  }
  return "unknown-fallback";
}

function toCapturedAtMs(kind: TimestampKind, timestamp: number, nowMs: number): number {
  if (kind === "epoch-seconds") return timestamp * 1000;
  if (kind === "epoch-millis") return timestamp;
  return nowMs;
}

/* ── 보조 CDP 세션 (pageScaleFactor / scrollOffset) ─────────── */

async function readLayoutMetrics(cdp: CDPSession): Promise<PageScaleInfo> {
  const metrics = await cdp.send("Page.getLayoutMetrics");
  const visual = metrics.visualViewport;
  return {
    pageScaleFactor: visual.scale,
    scrollOffsetX: visual.pageX,
    scrollOffsetY: visual.pageY,
    offsetTop: visual.offsetY,
  };
}

/* ── 구현 ───────────────────────────────────────────────────── */

export const startScreencast: StartScreencast = async (page, options) => {
  const size = options.size ?? DEFAULT_SCREENCAST_SIZE;
  const quality = options.quality ?? DEFAULT_SCREENCAST_QUALITY;
  const driver: ScreencastDriver =
    options.driver ?? (process.env["TESTFLOW_SCREENCAST_DRIVER"] === "cdp" ? "cdp" : "playwright");

  let timestampKind: TimestampKind = "pending";
  let pageScale: PageScaleInfo = IDENTITY_SCALE;
  let frames = 0;
  let bytes = 0;
  let stopped = false;

  // CDP 드라이버는 스크린캐스트 자체가 CDP 이므로 세션이 어차피 필요하다.
  const needsCdp = driver === "cdp" || options.trackPageScale === true;
  const cdp: CDPSession | null = needsCdp ? await page.context().newCDPSession(page) : null;
  if (cdp && options.trackPageScale === true) {
    pageScale = await readLayoutMetrics(cdp);
  }

  const deliver = async (raw: {
    data: Buffer;
    timestamp: number;
    viewportWidth: number;
    viewportHeight: number;
  }): Promise<void> => {
    if (stopped) return;
    const nowMs = Date.now();
    if (timestampKind === "pending") timestampKind = detectTimestampKind(raw.timestamp, nowMs);
    frames += 1;
    bytes += raw.data.byteLength;
    await options.onFrame({
      data: raw.data,
      timestamp: raw.timestamp,
      viewportWidth: raw.viewportWidth,
      viewportHeight: raw.viewportHeight,
      capturedAtMs: toCapturedAtMs(timestampKind, raw.timestamp, nowMs),
    });
  };

  if (driver === "playwright") {
    /* ── 1안: 공식 API. ack 관리가 없다. ── */
    await page.screencast.start({
      quality,
      size, // ★ 생략 금지 (800×800 축소 방지)
      ...(options.path === undefined ? {} : { path: options.path }),
      onFrame: (frame) => deliver(frame),
    });
  } else {
    /* ── 2안: CDP 직접. ★ ack 를 보내지 않으면 프레임이 멈춘다. ── */
    if (!cdp) throw new Error("cdp driver requires a CDP session");
    cdp.on("Page.screencastFrame", (event) => {
      // ack 를 먼저 보낸다 — 프레임 흐름을 끊지 않기 위해서다.
      // 백프레셔가 필요해지면 deliver 이후로 옮긴다(그만큼 fps 가 떨어진다).
      void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
      const meta = event.metadata;
      pageScale = {
        pageScaleFactor: meta.pageScaleFactor,
        scrollOffsetX: meta.scrollOffsetX,
        scrollOffsetY: meta.scrollOffsetY,
        offsetTop: meta.offsetTop,
      };
      void deliver({
        data: Buffer.from(event.data, "base64"),
        timestamp: meta.timestamp ?? Date.now() / 1000,
        viewportWidth: size.width,
        viewportHeight: size.height,
      }).catch(() => undefined);
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality,
      maxWidth: size.width,
      maxHeight: size.height,
      everyNthFrame: options.everyNthFrame ?? 1,
    });
  }

  return {
    driver,
    size,
    get timestampKind() {
      return timestampKind;
    },
    getPageScale: () => pageScale,
    refreshPageScale: async () => {
      if (!cdp) return pageScale;
      pageScale = await readLayoutMetrics(cdp);
      return pageScale;
    },
    stats: () => ({ frames, bytes }),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (driver === "playwright") {
        await page.screencast.stop().catch(() => undefined);
      } else if (cdp) {
        await cdp.send("Page.stopScreencast").catch(() => undefined);
      }
      if (cdp) await cdp.detach().catch(() => undefined);
    },
  };
};
