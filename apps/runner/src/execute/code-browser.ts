/**
 * 경로 D — `playwright test` 가 띄운 브라우저에 CDP 로 붙어 프레임을 뽑는다 (03-phases Task 4.1).
 *
 * PoC(`poc/r2/host.ts`)의 `watchBrowserPages` · `attachStream` · `throttleFrames` 를 **승격**한 파일이다
 * (계획서 재사용표). PoC 대비 제품에서 달라진 것은 네 가지다 —
 *
 * | # | PoC | 제품 |
 * |---|---|---|
 * | 1 | CDP 포트를 host 포트에서 파생 (`9400 + port % 500`) | **실행마다 빈 포트 할당**(`findFreeCdpPort`) — 동시 실행 충돌 방지 |
 * | 2 | 프레임을 `host.pushFrame` 으로 | **`LiveStreamSession`** 으로 (봉투·드롭은 `ws-server.ts` 가 담당) |
 * | 3 | `connectOverCDP` 1회 성공하면 끝 | **`disconnected` 를 감시해 재바인딩**(리스크 5 — worker 재시작) |
 * | 4 | 실패하면 측정이 실패 | **실패해도 실행은 계속된다**(Task 4.4 규칙) |
 *
 * ## ★ `record/screencast.ts` 는 무수정 import 다
 * PoC 가 세 경로(A/B/D) 전부에서 한 글자도 고치지 않고 썼다. `size` 를 **반드시 명시**한다 —
 * 생략하면 Playwright 가 800×800 으로 축소하고 캔버스 비율이 어긋난다(그 파일 상단 주석).
 * 15fps 스로틀도 `record/session.ts` 의 **`maxFrameRate()` 를 그대로 import** 한다.
 * 녹화와 실행이 같은 상한을 타야 대역폭 실측(2.28 Mbps)이 양쪽에서 같은 의미를 가진다.
 *
 * ## ★★ `input-bridge.ts` 를 붙이지 않는다
 * 코드 실행 화면은 **보기만** 한다. 원격 조작을 허용하면 사용자의 클릭이 테스트를 깨뜨리고,
 * 그 실패는 "시나리오 실패"로 기록된다. 그래서 이 파일에는 CDP **입력** 전송 경로가 없다.
 */
import { createServer } from "node:net";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { startScreencast } from "../record/screencast.js";
import type { ScreencastFrame, ScreencastHandle } from "../record/screencast.js";
import { maxFrameRate } from "../record/session.js";
import type { LiveStreamFrame, LiveStreamSession } from "./live-stream.js";

/**
 * screencast 프레임 크기. **`use.viewport` 와 같아야 한다**(`pw-config.ts` 가 `DEFAULT_VIEWPORT`
 * 를 넣는다). 어긋나면 브라우저가 축소 렌더해 글자가 뭉개진다.
 */
export const LIVE_STREAM_SIZE = { width: 1280, height: 800 } as const;
/** JPEG 품질. PoC 측정값(2.28 Mbps)이 이 값 기준이다. */
export const LIVE_STREAM_QUALITY = 60;

/** `connectOverCDP` 재시도 간격. 포트가 열리는 시점을 우리가 모른다(PoC 실증값). */
export const CDP_POLL_INTERVAL_MS = 200;
/** 첫 연결 한도. PoC 는 30초 안에 항상 성공했다. */
export const CDP_FIRST_CONNECT_TIMEOUT_MS = 30_000;
/**
 * ★ 재바인딩 한도 — 첫 연결보다 **짧다**.
 *
 * 브라우저가 끊기는 사유는 두 가지고 우리는 그것을 구분할 수 없다:
 * ① worker 재시작(새 브라우저가 곧 뜬다) ② 실행 종료(다시 안 뜬다).
 * ②에서 30초를 기다리면 run 이 끝난 뒤에도 폴링이 돌아 `/tmp` 정리·프로세스 종료가 늦어진다.
 * 8초면 테스트 타임아웃 후 worker 가 브라우저를 다시 띄우는 시간(실측 1~3초)의 두 배 이상이다.
 */
export const CDP_REBIND_TIMEOUT_MS = 8_000;
/**
 * 재바인딩 시도 횟수 상한.
 *
 * `stop()` 이 루프를 끝내므로 정상 경로에서는 필요 없지만, 브라우저가 붙는 즉시 죽는
 * 병적 상태에서 무한 루프가 되는 것을 막는다. `projects: 1` 이 전제이므로 브라우저 교체는
 * **테스트 경계에서만** 일어난다(04-gen-3 §1.6) — 테스트 20건보다 많은 교체는 정상이 아니다.
 */
export const CDP_MAX_REBINDS = 20;

/** 새 page 탐지 폴링 주기. 이벤트만으로는 놓친다(아래 `watchBrowserPages` 주석). */
export const PAGE_SCAN_INTERVAL_MS = 100;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/* ────────────────────────────────────────────────────────────
 * 빈 포트 할당
 * ──────────────────────────────────────────────────────────── */

/**
 * OS 가 비어 있다고 알려 준 포트를 그대로 쓴다.
 *
 * 직접 스캔하면 경합이 난다(`container.ts` 의 `findFreePort` 와 같은 규율).
 * **PoC 처럼 host 포트에서 파생시키면 동시 실행 2건이 같은 포트를 받는다** — 계획서가
 * 지목한 지점이다. `--remote-debugging-port` 는 한 브라우저만 바인딩하므로 충돌하면
 * 두 번째 실행의 스트림이 첫 번째 실행 화면을 보여 준다(조용히 틀린 화면이 나온다).
 */
export function findFreeCdpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        if (port === 0) reject(new Error("빈 CDP 포트를 찾지 못했습니다."));
        else resolve(port);
      });
    });
  });
}

/* ────────────────────────────────────────────────────────────
 * fps 스로틀 — screencast.ts 를 고치지 않고 `onFrame` 래퍼로 구현한다
 * ──────────────────────────────────────────────────────────── */

export interface ThrottleStats {
  produced: number;
  passed: number;
  dropped: number;
  bytesProduced: number;
}

export interface FrameThrottle {
  onFrame: (frame: ScreencastFrame) => void;
  stats(): ThrottleStats;
}

/**
 * PoC `throttleFrames()` 승격 — 60fps 원본을 상한까지 깎는다.
 *
 * 라운드 1 실측: 무제한 14.6~33.1 Mbps → 15fps 상한 2.28 Mbps(약 1/10).
 * `maxFps <= 0` 이면 제한하지 않는다(`RECORD_MAX_FPS=0` 의 의미 — `maxFrameRate()` 규약).
 */
export function throttleFrames(
  maxFps: number,
  sink: (frame: LiveStreamFrame) => void,
): FrameThrottle {
  const minIntervalMs = maxFps > 0 ? 1000 / maxFps : 0;
  let lastSentAt = 0;
  const stats: ThrottleStats = { produced: 0, passed: 0, dropped: 0, bytesProduced: 0 };
  return {
    onFrame: (frame) => {
      stats.produced += 1;
      stats.bytesProduced += frame.data.byteLength;
      const now = Date.now();
      if (minIntervalMs > 0 && now - lastSentAt < minIntervalMs) {
        stats.dropped += 1;
        return;
      }
      lastSentAt = now;
      stats.passed += 1;
      sink({
        data: frame.data,
        capturedAtMs: frame.capturedAtMs,
        viewportWidth: frame.viewportWidth,
        viewportHeight: frame.viewportHeight,
      });
    },
    stats: () => ({ ...stats }),
  };
}

/* ────────────────────────────────────────────────────────────
 * page 감시
 * ──────────────────────────────────────────────────────────── */

export interface PageWatcher {
  onPage(handler: (page: Page) => void): void;
  listPages(): Page[];
  stop(): void;
}

/**
 * CDP 로 붙은 브라우저에서 **누가 만들었든** 모든 page 를 잡는다. PoC 승격(무변경).
 *
 * ★ `context.on("page")` **만으로는 부족하다** — PoC 실측:
 *   ① CDP 연결 **이전에** 이미 있던 page 를 놓친다,
 *   ② Playwright 가 새 `BrowserContext` 를 만들면(테스트마다 만든다) 그 context 자체를 놓친다.
 * 그래서 이벤트 + 짧은 폴링을 **둘 다** 쓴다. 폴링만 쓰면 최대 100ms 늦게 붙어 테스트
 * 시작 직후 프레임을 놓친다.
 */
export function watchBrowserPages(browser: Browser, pollMs = PAGE_SCAN_INTERVAL_MS): PageWatcher {
  const handlers: ((page: Page) => void)[] = [];
  const seen = new Set<Page>();
  const watchedContexts = new Set<unknown>();
  const emit = (page: Page): void => {
    if (seen.has(page)) return;
    seen.add(page);
    for (const handler of handlers) handler(page);
  };
  const scan = (): void => {
    for (const context of browser.contexts()) {
      if (!watchedContexts.has(context)) {
        watchedContexts.add(context);
        context.on("page", emit);
      }
      for (const page of context.pages()) emit(page);
    }
  };
  scan();
  const poll = setInterval(scan, pollMs);
  poll.unref();
  return {
    onPage: (handler) => {
      handlers.push(handler);
      for (const page of seen) handler(page);
      scan();
    },
    listPages: () => browser.contexts().flatMap((context) => context.pages()),
    stop: () => {
      clearInterval(poll);
    },
  };
}

/* ────────────────────────────────────────────────────────────
 * CDP 연결 (폴링)
 * ──────────────────────────────────────────────────────────── */

export interface CdpConnectOptions {
  port: number;
  timeoutMs: number;
  intervalMs?: number;
  /** `true` 를 돌려주면 즉시 포기한다(취소·실행 종료). */
  isStopped: () => boolean;
}

/**
 * `connectOverCDP` 가 성공할 때까지 폴링한다. 못 붙으면 `null` — **던지지 않는다.**
 *
 * 던지면 호출부가 `try` 를 두르는 것을 잊는 순간 실행이 스트림 때문에 죽는다.
 * 라이브는 관찰 수단이지 실행의 전제가 아니다(Task 4.4).
 */
export async function connectOverCdpWithRetry(options: CdpConnectOptions): Promise<Browser | null> {
  const interval = options.intervalMs ?? CDP_POLL_INTERVAL_MS;
  const deadline = Date.now() + options.timeoutMs;
  const endpoint = `http://127.0.0.1:${String(options.port)}`;
  for (;;) {
    if (options.isStopped()) return null;
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch {
      /* 포트가 아직 열리지 않았다 — 정상이다. */
    }
    if (Date.now() >= deadline) return null;
    await sleep(interval);
  }
}

/* ────────────────────────────────────────────────────────────
 * 부착 supervisor
 * ──────────────────────────────────────────────────────────── */

export interface CodeBrowserStats {
  /** screencast 가 붙은 page 누적 수. 테스트마다 1 이상 늘어난다(완료기준 4.1①). */
  pagesAttached: number;
  /** ★ 리스크 5 — 브라우저가 교체돼 CDP 를 다시 붙인 횟수. */
  rebinds: number;
  /** 재바인딩을 시도했지만 한도 내에 브라우저가 돌아오지 않은 횟수. */
  rebindFailures: number;
  /** 첫 연결에 성공했는가. `false` 면 라이브 화면이 없다(실행은 계속된다). */
  connected: boolean;
  framesProduced: number;
  framesPassed: number;
  framesThrottled: number;
  bytesProduced: number;
  lastError: string | null;
}

export interface CodeBrowserAttachment {
  stats(): CodeBrowserStats;
  /** 멱등. 실행이 어떤 경로로 끝나도 `finally` 에서 부른다. */
  stop(): Promise<void>;
}

export interface StartCodeBrowserOptions {
  cdpPort: number;
  session: LiveStreamSession;
  log: (message: string) => void;
  maxFps?: number;
  firstConnectTimeoutMs?: number;
  rebindTimeoutMs?: number;
  pageScanMs?: number;
  maxRebinds?: number;
}

/**
 * 스트림 부착을 시작한다. **동기로 즉시 돌려주고 실제 작업은 백그라운드**에서 돈다.
 *
 * ★ 호출부가 `await` 하지 않는 것이 설계다 — CDP 포트가 열릴 때까지 최대 30초인데,
 *   그것을 기다리면 **스트림이 실행을 붙잡는다.** 실행은 이 함수가 무엇을 하든 진행된다.
 *
 * ## ★ 리스크 5 — worker 재시작 시 CDP 재바인딩
 * 테스트 타임아웃 등으로 worker 가 재시작되면 **브라우저 프로세스가 교체된다**(PoC 가
 * `workerIndex 0→1` 로 관측했고, 재바인딩 여부는 **미검증**으로 넘긴 항목이다).
 * 새 브라우저는 같은 `--remote-debugging-port` 로 뜨지만 우리 `Browser` 객체는 죽은
 * 소켓을 들고 있다. 그래서 `disconnected` 를 감시해 **처음부터 다시 폴링**한다.
 * 재바인딩에 실패하면 **스트림만 포기하고 실행은 계속한다** — 뷰어에는 `{t:"error"}` 로만 알린다.
 */
export function startCodeBrowser(options: StartCodeBrowserOptions): CodeBrowserAttachment {
  const { cdpPort, session, log } = options;
  const maxFps = options.maxFps ?? maxFrameRate();
  const pageScanMs = options.pageScanMs ?? PAGE_SCAN_INTERVAL_MS;
  const maxRebinds = options.maxRebinds ?? CDP_MAX_REBINDS;

  const stats: CodeBrowserStats = {
    pagesAttached: 0,
    rebinds: 0,
    rebindFailures: 0,
    connected: false,
    framesProduced: 0,
    framesPassed: 0,
    framesThrottled: 0,
    bytesProduced: 0,
    lastError: null,
  };

  let stopped = false;
  const handles = new Set<ScreencastHandle>();
  let watcher: PageWatcher | null = null;
  let browser: Browser | null = null;

  const isStopped = (): boolean => stopped;

  const attachPage = async (page: Page): Promise<void> => {
    if (stopped) return;
    const throttle = throttleFrames(maxFps, (frame) => {
      session.pushFrame(frame);
    });

    let detached = false;
    const detach = (): void => {
      if (detached) return;
      detached = true;
      // ★ page 1건당 정확히 1회. 두 번 부르면 `attachedPages` 가 음수로 새고
      //   `between-tests` 가 조기 발행돼 화면에 오버레이가 깜빡인다.
      session.pageDetached();
      const passed = throttle.stats();
      stats.framesProduced += passed.produced;
      stats.framesPassed += passed.passed;
      stats.framesThrottled += passed.dropped;
      stats.bytesProduced += passed.bytesProduced;
    };

    try {
      const handle = await startScreencast(page, {
        // ★ `size` 생략 금지 — 미지정 시 800×800 축소.
        size: { width: LIVE_STREAM_SIZE.width, height: LIVE_STREAM_SIZE.height },
        quality: LIVE_STREAM_QUALITY,
        trackPageScale: true,
        onFrame: throttle.onFrame,
      });
      handles.add(handle);
      session.pageAttached();
      stats.pagesAttached += 1;
      page.once("close", () => {
        handles.delete(handle);
        detach();
      });
    } catch (error) {
      // page 가 붙기 직전에 닫히면 여기로 온다 — 정상적인 경합이다. 실행과 무관하다.
      stats.lastError = trim(error);
    }
  };

  const waitForDisconnect = (target: Browser): Promise<void> =>
    new Promise<void>((done) => {
      if (!target.isConnected()) {
        done();
        return;
      }
      target.once("disconnected", () => {
        done();
      });
      // `stop()` 이 먼저 올 수도 있다 — 그때는 아래 루프가 `stopped` 로 빠져나간다.
      const poll = setInterval(() => {
        if (stopped || !target.isConnected()) {
          clearInterval(poll);
          done();
        }
      }, 250);
      poll.unref();
    });

  const teardownRound = async (): Promise<void> => {
    watcher?.stop();
    watcher = null;
    for (const handle of [...handles]) {
      await handle.stop().catch(() => undefined);
      handles.delete(handle);
    }
    if (browser !== null) {
      await browser.close().catch(() => undefined);
      browser = null;
    }
  };

  const supervise = async (): Promise<void> => {
    for (let round = 0; !stopped && round <= maxRebinds; round += 1) {
      const timeoutMs =
        round === 0
          ? (options.firstConnectTimeoutMs ?? CDP_FIRST_CONNECT_TIMEOUT_MS)
          : (options.rebindTimeoutMs ?? CDP_REBIND_TIMEOUT_MS);

      const connected = await connectOverCdpWithRetry({
        port: cdpPort,
        timeoutMs,
        isStopped,
      });

      if (connected === null) {
        if (round === 0) {
          // ★ 첫 연결 실패 — 라이브 화면이 없다. 그래도 **실행은 계속된다.**
          //   `stopped` 여도 알린다: 한 번도 못 붙었다는 사실을 뷰어가 알아야
          //   "화면이 안 나온다"의 원인을 짐작할 수 있다(있는 척하지 않는다).
          stats.lastError = `connectOverCDP(127.0.0.1:${String(cdpPort)}) ${String(timeoutMs)}ms 내 실패`;
          log(`  [live] CDP 부착 실패 — 라이브 화면 없이 실행을 계속한다 (${stats.lastError})`);
          session.error(
            "CDP_ATTACH_FAILED",
            "실행 화면에 연결하지 못했습니다. 실행은 계속되며 결과와 증적은 정상적으로 기록됩니다.",
          );
          return;
        }
        if (stopped) return;
        stats.rebindFailures += 1;
        log(`  [live] CDP 재바인딩 실패(${String(timeoutMs)}ms) — 브라우저가 돌아오지 않았다`);
        return;
      }

      browser = connected;
      if (round === 0) {
        stats.connected = true;
        log(`  [live] CDP 부착 성공 — 127.0.0.1:${String(cdpPort)} (${String(maxFps)}fps 상한)`);
      } else {
        stats.rebinds += 1;
        log(`  [live] CDP 재바인딩 성공 #${String(stats.rebinds)} — 브라우저가 교체됐다(worker 재시작)`);
      }

      watcher = watchBrowserPages(connected, pageScanMs);
      watcher.onPage((page) => {
        void attachPage(page);
      });

      await waitForDisconnect(connected);
      // 이번 라운드의 page 들은 브라우저와 함께 사라졌다 — 상태를 접는다.
      for (const handle of [...handles]) {
        handles.delete(handle);
        await handle.stop().catch(() => undefined);
      }
      watcher.stop();
      watcher = null;
      browser = null;
      if (stopped) return;
      log("  [live] CDP 연결이 끊겼다 — 브라우저 교체를 가정하고 재바인딩을 시도한다");
    }
  };

  // ★ 백그라운드. 이 promise 를 기다리지 않는다. 예외도 실행으로 새지 않는다.
  void supervise().catch((error: unknown) => {
    stats.lastError = trim(error);
    log(`  [live] 스트림 supervisor 오류(실행에는 영향 없음): ${stats.lastError}`);
  });

  return {
    stats: () => ({ ...stats }),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await teardownRound();
    },
  };
}

function trim(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}
