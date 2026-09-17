/**
 * 라운드 2 PoC — 테스트 코드(`playwright test`) 실행의 라이브 스트리밍 / 호스트
 *
 * ⚠️ **PoC 전용 임시물이다. 제품 코드가 아니다.**
 *    `apps/runner/src/record/screencast.ts` 는 **무수정으로 재사용**한다(import 만 한다).
 *
 * 이 파일이 하는 일 — "Runner 프로세스" 역할이다.
 *   1. 정적 HTTP 서버 — 캔버스 클라이언트(`poc/r2/client/index.html`)와
 *      대상 페이지(`poc/fixtures/record-login.html`)를 서빙한다.
 *   2. WS `/r2/view`   — 캔버스 클라이언트가 붙는다. 프레임을 바이너리로 푸시한다.
 *      프레임 봉투는 라운드 1(`poc/poc-ws-server.ts`)의 **25바이트 헤더를 그대로** 쓴다.
 *   3. WS `/r2/ingest` — **경로 A** 에서 playwright test **worker 프로세스**가 붙어
 *      프레임을 밀어 넣는다(worker → host → viewer, 홉이 하나 더 붙는다).
 *   4. POST `/r2/event` — 커스텀 reporter 가 진행 이벤트를 NDJSON 으로 POST 한다.
 *   5. 경로 B 배선 — `chromium.launchServer()` + `--remote-debugging-port` 로 브라우저를
 *      **Runner 가 먼저** 띄우고, 같은 브라우저에 `connectOverCDP` 로 붙어
 *      `playwright test` 가 만든 page 를 **Runner 쪽에서 열거(enumerate)** 한다.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserServer, type Page } from "playwright";
import { WebSocket, WebSocketServer } from "ws";

import { startScreencast, type ScreencastHandle } from "../../src/record/screencast.js";
import { FRAME_HEADER_BYTES } from "../poc-ws-server.js";

/** 라운드 1 결론대로 15fps 로 상한을 둔다(`RECORD_MAX_FPS` 기본값과 같다). */
export const DEFAULT_MAX_FPS = 15;
export const STREAM_SIZE = { width: 1280, height: 800 } as const;
export const STREAM_QUALITY = 60;

/** ⚠️ 이 파일은 `dist-poc/poc/r2/host.js` 로 컴파일된다 → `poc/` 루트는 세 단계 위다. */
const POC_ROOT = resolve(fileURLToPath(new URL("../../../poc", import.meta.url)));

/* ── 프레임 봉투 (라운드 1과 동일 레이아웃) ─────────────────── */

export function encodeFrame(
  frameId: number,
  capturedAtMs: number,
  viewportWidth: number,
  viewportHeight: number,
  jpeg: Buffer,
): Buffer {
  const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
  header.writeUInt8(0x01, 0);
  header.writeUInt32BE(frameId >>> 0, 1);
  header.writeDoubleBE(capturedAtMs, 5);
  header.writeDoubleBE(Date.now(), 13);
  header.writeUInt16BE(viewportWidth, 21);
  header.writeUInt16BE(viewportHeight, 23);
  return Buffer.concat([header, jpeg]);
}

export function decodeFrameHeader(buf: Buffer): {
  capturedAtMs: number;
  viewportWidth: number;
  viewportHeight: number;
  jpeg: Buffer;
} | null {
  if (buf.byteLength < FRAME_HEADER_BYTES || buf.readUInt8(0) !== 0x01) return null;
  return {
    capturedAtMs: buf.readDoubleBE(5),
    viewportWidth: buf.readUInt16BE(21),
    viewportHeight: buf.readUInt16BE(23),
    jpeg: buf.subarray(FRAME_HEADER_BYTES),
  };
}

/* ── 정적 파일 ─────────────────────────────────────────────── */

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  const absolute = join(POC_ROOT, relative);
  if (!absolute.startsWith(POC_ROOT + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const info = await stat(absolute);
    if (!info.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(absolute).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
      "content-length": String(info.size),
    });
    createReadStream(absolute).pipe(res);
  } catch {
    res.writeHead(404).end("not found");
  }
}

/* ── 진행 이벤트 ───────────────────────────────────────────── */

/** reporter 가 POST 하는 원본 이벤트(가공 전). */
export interface ReporterEvent {
  readonly kind: string;
  readonly atMs: number;
  readonly [key: string]: unknown;
}

/* ── 호스트 ────────────────────────────────────────────────── */

export interface HostStats {
  framesProduced: number;
  framesSent: number;
  framesDroppedThrottle: number;
  framesDroppedBackpressure: number;
  framesDroppedNoViewer: number;
  bytesSent: number;
}

export interface R2Host {
  readonly port: number;
  readonly events: ReporterEvent[];
  httpUrl(path: string): string;
  viewerUrl(scale?: number): string;
  viewWsUrl(): string;
  ingestWsUrl(): string;
  eventsUrl(): string;
  targetUrl(): string;
  hasViewer(): boolean;
  /** 프레임 1장을 뷰어로 밀어 넣는다(드롭 정책 포함). */
  pushFrame(capturedAtMs: number, w: number, h: number, jpeg: Buffer): void;
  stats(): HostStats;
  resetStats(): void;
  close(): Promise<void>;
}

export async function startHost(options: { port?: number; maxBufferedBytes?: number } = {}): Promise<R2Host> {
  const maxBuffered = options.maxBufferedBytes ?? 256 * 1024;
  const events: ReporterEvent[] = [];
  const stats: HostStats = {
    framesProduced: 0,
    framesSent: 0,
    framesDroppedThrottle: 0,
    framesDroppedBackpressure: 0,
    framesDroppedNoViewer: 0,
    bytesSent: 0,
  };
  let viewer: WebSocket | null = null;
  let frameId = 0;

  const http: Server = createServer((req, res) => {
    if (req.method === "POST" && (req.url ?? "").startsWith("/r2/event")) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        for (const line of Buffer.concat(chunks).toString("utf8").split("\n")) {
          if (line.trim() === "") continue;
          try {
            events.push(JSON.parse(line) as ReporterEvent);
          } catch {
            /* PoC — 깨진 줄은 버린다 */
          }
        }
        res.writeHead(204).end();
      });
      return;
    }
    void serveStatic(req, res);
  });

  const viewWss = new WebSocketServer({ noServer: true });
  const ingestWss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/r2/view") {
      viewWss.handleUpgrade(req, socket, head, (ws) => viewWss.emit("connection", ws, req));
    } else if (path === "/r2/ingest") {
      ingestWss.handleUpgrade(req, socket, head, (ws) => ingestWss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  viewWss.on("connection", (socket) => {
    viewer = socket;
    socket.binaryType = "nodebuffer";
    socket.on("close", () => {
      if (viewer === socket) viewer = null;
    });
  });

  const pushFrame = (capturedAtMs: number, w: number, h: number, jpeg: Buffer): void => {
    stats.framesProduced += 1;
    const socket = viewer;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      stats.framesDroppedNoViewer += 1;
      return;
    }
    // ★ 드롭 정책 — 라운드 1과 같다. 밀린 프레임은 버린다(큐에 쌓지 않는다).
    if (socket.bufferedAmount > maxBuffered) {
      stats.framesDroppedBackpressure += 1;
      return;
    }
    frameId += 1;
    const payload = encodeFrame(frameId, capturedAtMs, w, h, jpeg);
    socket.send(payload, { binary: true });
    stats.framesSent += 1;
    stats.bytesSent += payload.byteLength;
  };

  // 경로 A — worker 가 밀어 넣는 프레임을 그대로 중계한다.
  ingestWss.on("connection", (socket) => {
    socket.binaryType = "nodebuffer";
    socket.on("message", (raw, isBinary) => {
      if (!isBinary) return;
      const decoded = decodeFrameHeader(raw as Buffer);
      if (decoded === null) return;
      pushFrame(decoded.capturedAtMs, decoded.viewportWidth, decoded.viewportHeight, decoded.jpeg);
    });
  });

  await new Promise<void>((done, fail) => {
    http.once("error", fail);
    http.listen(options.port ?? 0, "127.0.0.1", () => {
      done();
    });
  });
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("failed to bind r2 host");
  const port = address.port;
  const base = `127.0.0.1:${String(port)}`;

  return {
    port,
    events,
    httpUrl: (p) => `http://${base}${p.startsWith("/") ? p : `/${p}`}`,
    viewerUrl: (scale = 1) =>
      `http://${base}/r2/client/index.html?ws=ws://${base}/r2/view&scale=${String(scale)}`,
    viewWsUrl: () => `ws://${base}/r2/view`,
    ingestWsUrl: () => `ws://${base}/r2/ingest`,
    eventsUrl: () => `http://${base}/r2/event`,
    targetUrl: () => `http://${base}/fixtures/record-login.html`,
    hasViewer: () => viewer !== null && viewer.readyState === WebSocket.OPEN,
    pushFrame,
    stats: () => ({ ...stats }),
    resetStats: () => {
      stats.framesProduced = 0;
      stats.framesSent = 0;
      stats.framesDroppedThrottle = 0;
      stats.framesDroppedBackpressure = 0;
      stats.framesDroppedNoViewer = 0;
      stats.bytesSent = 0;
    },
    close: async () => {
      for (const socket of viewWss.clients) socket.terminate();
      for (const socket of ingestWss.clients) socket.terminate();
      await new Promise<void>((done) => {
        viewWss.close(() => done());
      });
      await new Promise<void>((done) => {
        ingestWss.close(() => done());
      });
      await new Promise<void>((done) => {
        http.close(() => done());
      });
    },
  };
}

/* ── 경로 B 배선 — Runner 가 브라우저를 소유한다 ────────────── */

export interface OwnedBrowser {
  readonly server: BrowserServer;
  /** `playwright test` 의 `use.connectOptions.wsEndpoint` 에 넣을 값. */
  readonly wsEndpoint: string;
  /** Runner 가 `connectOverCDP` 로 붙은 같은 브라우저. page 열거에 쓴다. */
  readonly cdpBrowser: Browser;
  readonly cdpPort: number;
  /** 새 page 가 생기면 호출된다(경로 B 의 핵심 — 테스트가 만든 page 를 우리가 잡는다). */
  onPage(handler: (page: Page) => void): void;
  listPages(): Page[];
  close(): Promise<void>;
}

export interface PageWatcher {
  onPage(handler: (page: Page) => void): void;
  listPages(): Page[];
  stop(): void;
}

/**
 * CDP 로 붙은 브라우저에서 **누가 만들었든** 모든 page 를 잡는다.
 *
 * `context.on("page")` 만으로는 CDP 연결 이전에 이미 있던 page 를 놓치고, Playwright 가
 * 새 BrowserContext 를 만들면(= 새 target group) 그 context 자체를 놓친다.
 * 그래서 이벤트 + 짧은 폴링을 **둘 다** 쓴다.
 */
export function watchBrowserPages(browser: Browser, pollMs = 100): PageWatcher {
  const handlers: ((page: Page) => void)[] = [];
  const seen = new Set<Page>();
  const watchedContexts = new Set<unknown>();
  const emit = (page: Page): void => {
    if (seen.has(page)) return;
    seen.add(page);
    for (const h of handlers) h(page);
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
  return {
    onPage: (handler) => {
      handlers.push(handler);
      for (const page of seen) handler(page);
      scan();
    },
    listPages: () => browser.contexts().flatMap((c) => c.pages()),
    stop: () => {
      clearInterval(poll);
    },
  };
}

/**
 * `launchServer` 로 브라우저를 띄우고 **같은 브라우저에 CDP 로도 붙는다.**
 *
 * ★ 핵심 — `launchServer` 의 wsEndpoint 는 Playwright 자체 프로토콜이라 다른 클라이언트가
 *   붙어도 서로의 context 를 못 본다(격리). 그래서 `--remote-debugging-port` 를 추가로 열고
 *   Runner 는 **CDP** 로 붙는다. CDP 는 브라우저의 모든 target 을 보므로
 *   `playwright test` 가 만든 page 도 열거된다.
 */
export async function launchOwnedBrowser(opts: { cdpPort: number; headless?: boolean }): Promise<OwnedBrowser> {
  const server = await chromium.launchServer({
    headless: opts.headless ?? true,
    args: [`--remote-debugging-port=${String(opts.cdpPort)}`, "--remote-debugging-address=127.0.0.1"],
  });
  const cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${String(opts.cdpPort)}`);
  const watcher = watchBrowserPages(cdpBrowser);

  return {
    server,
    wsEndpoint: server.wsEndpoint(),
    cdpBrowser,
    cdpPort: opts.cdpPort,
    onPage: watcher.onPage,
    listPages: watcher.listPages,
    close: async () => {
      watcher.stop();
      await cdpBrowser.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

/* ── fps 상한 래퍼 — screencast.ts 는 수정하지 않는다 ───────── */

export interface ThrottleStats {
  produced: number;
  passed: number;
  dropped: number;
  bytesProduced: number;
}

/**
 * `startScreencast` 의 `onFrame` 을 감싸 fps 상한을 건다.
 * 라운드 1 전달사항 2번(15fps 스로틀)을 **screencast.ts 를 고치지 않고** 구현한다.
 */
export function throttleFrames(
  maxFps: number,
  sink: (capturedAtMs: number, w: number, h: number, jpeg: Buffer) => void,
): { onFrame: (f: { data: Buffer; capturedAtMs: number; viewportWidth: number; viewportHeight: number }) => void; stats: () => ThrottleStats } {
  const minIntervalMs = maxFps > 0 ? 1000 / maxFps : 0;
  let lastSentAt = 0;
  const s: ThrottleStats = { produced: 0, passed: 0, dropped: 0, bytesProduced: 0 };
  return {
    onFrame: (f) => {
      s.produced += 1;
      s.bytesProduced += f.data.byteLength;
      const now = Date.now();
      if (minIntervalMs > 0 && now - lastSentAt < minIntervalMs) {
        s.dropped += 1;
        return;
      }
      lastSentAt = now;
      s.passed += 1;
      sink(f.capturedAtMs, f.viewportWidth, f.viewportHeight, f.data);
    },
    stats: () => ({ ...s }),
  };
}

export interface AttachedStream {
  readonly handle: ScreencastHandle;
  throttle(): ThrottleStats;
  stop(): Promise<void>;
}

/** 어떤 page 든 받아 스트리밍을 붙인다. screencast.ts 는 **무수정 재사용**. */
export async function attachStream(
  page: Page,
  host: Pick<R2Host, "pushFrame">,
  maxFps = DEFAULT_MAX_FPS,
): Promise<AttachedStream> {
  const t = throttleFrames(maxFps, (capturedAtMs, w, h, jpeg) => {
    host.pushFrame(capturedAtMs, w, h, jpeg);
  });
  const handle = await startScreencast(page, {
    size: STREAM_SIZE,
    quality: STREAM_QUALITY,
    trackPageScale: true,
    onFrame: t.onFrame,
  });
  return {
    handle,
    throttle: t.stats,
    stop: async () => {
      await handle.stop();
    },
  };
}
