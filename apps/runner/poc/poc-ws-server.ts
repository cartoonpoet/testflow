/**
 * PoC 전용 WS 서버 (03-phases Task 3.4)
 *
 * ⚠️ **이 파일은 PoC 전용 임시물이다. 제품 코드가 아니다.**
 *    Gen-Phase 7(Task 7.1~7.2, `apps/runner/src/record/session.ts`)에서 정식 세션 서버로
 *    승격되며 그때 이 파일은 삭제된다. 인증(단명 토큰)·세션 수명주기·유휴 타임아웃·다중 세션은
 *    전부 빠져 있다.
 *
 * 하는 일 3가지
 *   1. `screencast.ts` 의 프레임을 **WS 바이너리로 그대로** 푸시한다(base64 금지 — 33% 오버헤드).
 *   2. 클라이언트 JSON 메시지를 `RecorderClientMessageSchema` 로 검증해 `input-bridge.ts` 에 넘긴다.
 *   3. PoC 클라이언트/더미 페이지를 서빙하는 정적 HTTP 서버를 겸한다.
 *
 * ★ 메시지 포맷은 `@testflow/contracts` 의 `RecorderServerMessage`/`RecorderClientMessage` 를 쓴다.
 *   PoC 전용 포맷을 새로 만들지 않는다(Gen-Phase 7 승격 시 재작성 방지).
 *   프레임만 JSON 이 아니라 바이너리 봉투로 나가며, 봉투 필드는 `FrameMessage` 와 1:1 이다
 *   (+ 측정 전용으로 `serverSendAtMs` 1개를 덧붙였다 — 아래 `encodeFrame` 주석 참조).
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { FrameMessageSchema, RecorderClientMessageSchema } from "@testflow/contracts";
import type { Page } from "playwright";
import { WebSocket, WebSocketServer } from "ws";

import { createInputBridge, type InputBridge, type InputDriver } from "../src/record/input-bridge.js";
import {
  startScreencast,
  type ScreencastDriver,
  type ScreencastHandle,
} from "../src/record/screencast.js";

const POC_ROOT = resolve(fileURLToPath(new URL("../../poc", import.meta.url)));

/* ── 프레임 봉투 ────────────────────────────────────────────────
 *  offset  size  field
 *       0     1  0x01 (frame)
 *       1     4  frameId          (u32 BE)
 *       5     8  capturedAtMs     (f64 BE)  ← FrameMessage.timestamp 를 epoch ms 로 정규화한 값
 *      13     8  serverSendAtMs   (f64 BE)  ← ★ 측정 전용. 전송 구간과 캡처 구간을 나눠 보기 위함
 *      21     2  viewportWidth    (u16 BE)  ← FrameMessage.viewportWidth
 *      23     2  viewportHeight   (u16 BE)  ← FrameMessage.viewportHeight
 *      25     -  JPEG bytes                 ← FrameMessage.jpeg (Uint8Array)
 * ───────────────────────────────────────────────────────────── */
export const FRAME_HEADER_BYTES = 25;

function encodeFrame(
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

/* ── 정적 파일 ─────────────────────────────────────────────── */

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  const absolute = join(POC_ROOT, relative);
  // 경로 순회 방어 — PoC 라도 열어 두지 않는다.
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

/* ── 서버 ───────────────────────────────────────────────────── */

export interface PocServerOptions {
  /** 스트리밍 대상(원격) 페이지. */
  page: Page;
  /** 0 이면 임의의 빈 포트를 잡는다. */
  port?: number;
  quality?: number;
  size?: { width: number; height: number };
  screencastDriver?: ScreencastDriver;
  inputDriver?: InputDriver;
  everyNthFrame?: number;
  /** 이 값을 넘으면 프레임을 버린다(드롭 정책). 기본 256KiB. */
  maxBufferedBytes?: number;
}

export interface PocServerStats {
  framesProduced: number;
  framesSent: number;
  framesDroppedBackpressure: number;
  framesDroppedNoClient: number;
  bytesSent: number;
  contractCheck: "ok" | "failed" | "pending";
  contractError: string | null;
}

export interface PocServer {
  readonly port: number;
  readonly screencast: ScreencastHandle;
  readonly input: InputBridge;
  httpUrl(path: string): string;
  wsUrl(): string;
  stats(): PocServerStats;
  resetStats(): void;
  close(): Promise<void>;
}

export async function startPocServer(options: PocServerOptions): Promise<PocServer> {
  const maxBuffered = options.maxBufferedBytes ?? 256 * 1024;
  const size = options.size ?? { width: 1280, height: 800 };

  const http: Server = createServer((req, res) => {
    void serveStatic(req, res);
  });
  const wss = new WebSocketServer({ server: http, path: "/rec/poc" });

  let client: WebSocket | null = null;
  let frameId = 0;
  const stats: PocServerStats = {
    framesProduced: 0,
    framesSent: 0,
    framesDroppedBackpressure: 0,
    framesDroppedNoClient: 0,
    bytesSent: 0,
    contractCheck: "pending",
    contractError: null,
  };

  await new Promise<void>((done, fail) => {
    http.once("error", fail);
    http.listen(options.port ?? 0, "127.0.0.1", () => {
      done();
    });
  });
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("failed to bind poc server");
  const port = address.port;

  /* 입력 역주입 */
  const screencastRef: { handle: ScreencastHandle | null } = { handle: null };
  const input = await createInputBridge(options.page, {
    ...(options.inputDriver === undefined ? {} : { driver: options.inputDriver }),
    pageScaleProvider: () =>
      screencastRef.handle?.getPageScale() ?? {
        pageScaleFactor: 1,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
        offsetTop: 0,
      },
  });

  wss.on("connection", (socket) => {
    client = socket;
    socket.binaryType = "nodebuffer";
    socket.on("message", (raw, isBinary) => {
      if (isBinary) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = RecorderClientMessageSchema.safeParse(parsed);
      if (!result.success) {
        // 계약 위반은 조용히 넘기지 않는다 — RecorderErrorMessage 로 알린다.
        socket.send(
          JSON.stringify({ t: "error", code: "BAD_MESSAGE", message: result.error.message.slice(0, 300) }),
        );
        return;
      }
      void input.dispatch(result.data).catch((error: unknown) => {
        socket.send(
          JSON.stringify({ t: "error", code: "DISPATCH_FAILED", message: String(error).slice(0, 300) }),
        );
      });
    });
    socket.on("close", () => {
      if (client === socket) client = null;
    });
  });

  /* 페이지 이동 알림 — NavMessage (contracts) */
  options.page.on("framenavigated", (frame) => {
    if (frame !== options.page.mainFrame()) return;
    client?.send(JSON.stringify({ t: "nav", url: frame.url() }));
  });

  /* 프레임 송출 */
  const handle = await startScreencast(options.page, {
    size, // ★ 생략 금지
    quality: options.quality ?? 60,
    ...(options.screencastDriver === undefined ? {} : { driver: options.screencastDriver }),
    ...(options.everyNthFrame === undefined ? {} : { everyNthFrame: options.everyNthFrame }),
    trackPageScale: true,
    onFrame: (frame) => {
      stats.framesProduced += 1;

      // 첫 프레임만 contracts 스키마로 검증한다(프레임마다 zod 를 돌리면 그 자체가 지연이 된다).
      if (stats.contractCheck === "pending") {
        const check = FrameMessageSchema.safeParse({
          t: "frame",
          jpeg: new Uint8Array(frame.data),
          timestamp: frame.capturedAtMs,
          viewportWidth: frame.viewportWidth,
          viewportHeight: frame.viewportHeight,
        });
        stats.contractCheck = check.success ? "ok" : "failed";
        stats.contractError = check.success ? null : check.error.message.slice(0, 300);
      }

      const socket = client;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        stats.framesDroppedNoClient += 1;
        return;
      }
      // ★ 드롭 정책 — 소켓이 밀려 있으면 이 프레임을 버린다.
      //   프레임을 큐에 쌓으면 지연이 단조 증가해 "느린 화면"이 된다. 최신 프레임이 언제나 옳다.
      if (socket.bufferedAmount > maxBuffered) {
        stats.framesDroppedBackpressure += 1;
        return;
      }
      frameId += 1;
      const payload = encodeFrame(
        frameId,
        frame.capturedAtMs,
        frame.viewportWidth,
        frame.viewportHeight,
        frame.data,
      );
      socket.send(payload, { binary: true });
      stats.framesSent += 1;
      stats.bytesSent += payload.byteLength;
    },
  });
  screencastRef.handle = handle;

  return {
    port,
    screencast: handle,
    input,
    httpUrl: (path) => `http://127.0.0.1:${String(port)}${path.startsWith("/") ? path : `/${path}`}`,
    wsUrl: () => `ws://127.0.0.1:${String(port)}/rec/poc`,
    stats: () => ({ ...stats }),
    resetStats: () => {
      stats.framesProduced = 0;
      stats.framesSent = 0;
      stats.framesDroppedBackpressure = 0;
      stats.framesDroppedNoClient = 0;
      stats.bytesSent = 0;
    },
    close: async () => {
      await handle.stop();
      await input.close();
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((done) => {
        wss.close(() => {
          done();
        });
      });
      await new Promise<void>((done) => {
        http.close(() => {
          done();
        });
      });
    },
  };
}
