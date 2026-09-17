import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Redis } from "ioredis";
import { DataSource } from "typeorm";
import {
  RecorderClientMessageSchema,
  RecordingControlMessageSchema,
  WS_CLOSE_SESSION_GONE,
  WS_CLOSE_UNAUTHORIZED,
  recordingTokenKey,
} from "@testflow/contracts";
import { RecordingSessionEntity } from "@testflow/db";
import type { RunnerConfig } from "../env.js";
import { IDLE_CHECK_MS, RecordingSession } from "./session.js";
import type { SessionSink } from "./session.js";

/**
 * 녹화 WS 서버 + 세션 토큰 검증 (03-phases Task 7.2)
 *
 * ## 왜 Runner 직결인가 (API 미중계)
 * API 를 WS 중계로 끼우면 프레임마다 홉이 하나 더 늘어 **지연이 배가된다.** 프레임 왕복
 * 지연이 이 기능의 유일한 성패 요인이다 (02-context "구조상 쟁점 1건").
 * 그래서 API 는 세션 행 생성·종료와 **단명 토큰 발급**만 하고, 화면·입력은 이 서버가 맡는다.
 * nginx 뒤에서는 `/rec/` 경로만 이 포트로 프록시한다.
 *
 * ## 토큰 검증 (04-gen-5 "녹화 세션 토큰 설계 ★" 그대로)
 * - API 가 `randomBytes(32)` 를 base64url 로 발급하고 Redis 에는 **SHA-256 hex 만** 둔다.
 * - Runner 는 `sha256(token)` 을 **타이밍 안전 비교**한다. 불일치·부재 → close **4401**.
 * - 토큰이 살아 있어도 DB 세션이 `live` 가 아니면 → close **4404**.
 *   (`stop`/`DELETE` 는 토큰을 지우지만, Redis 가 재시작해 키만 사라진 경우의 반대 상황도 있다.)
 *
 * ## 프레임 봉투 · 드롭 정책은 PoC-1 것을 **그대로** 가져왔다
 * `apps/runner/poc/poc-ws-server.ts` 의 `FRAME_HEADER_BYTES = 25` 봉투와
 * `bufferedAmount` 감시 드롭이 30초 구간 손실 0건으로 측정된 부분이다. 바꾸면 그 측정이
 * 무효가 되고, PoC 클라이언트(`poc/client/index.html`)와도 호환이 깨진다.
 */

/* ── 프레임 봉투 (PoC-1 과 동일 — 바꾸면 클라이언트가 못 읽는다) ──
 *  offset  size  field
 *       0     1  0x01 (frame)
 *       1     4  frameId          (u32 BE)
 *       5     8  capturedAtMs     (f64 BE)
 *      13     8  serverSendAtMs   (f64 BE)
 *      21     2  viewportWidth    (u16 BE)
 *      23     2  viewportHeight   (u16 BE)
 *      25     -  JPEG bytes
 * ───────────────────────────────────────────────────────────── */
export const FRAME_HEADER_BYTES = 25;

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

/** 소켓이 이 이상 밀려 있으면 프레임을 버린다. 최신 프레임이 언제나 옳다. */
const MAX_BUFFERED_BYTES = 256 * 1024;

const REC_PATH = /^\/rec\/([0-9a-fA-F-]{36})$/u;

/* ── 토큰 검증 ─────────────────────────────────────────────── */

export function hashRecordingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * `sha256(token)` 과 Redis 에 저장된 해시를 **타이밍 안전 비교**한다.
 * `timingSafeEqual` 은 길이가 다르면 던지므로 먼저 걸러 `false` 를 돌려준다.
 */
export function verifyRecordingToken(token: string | null, stored: string | null): boolean {
  if (token === null || token === "" || stored === null || stored === "") return false;
  const actual = Buffer.from(hashRecordingToken(token), "utf8");
  const expected = Buffer.from(stored, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/* ── 서버 ───────────────────────────────────────────────────── */

export interface RecordingWsServerOptions {
  config: RunnerConfig;
  redis: Redis;
  /** 구독 전용 연결(제어 채널). 구독 모드 연결로는 다른 명령을 보낼 수 없어 분리한다. */
  subscriber: Redis;
  dataSource: DataSource;
  log: (message: string) => void;
  /** 0 이면 임의의 빈 포트를 잡는다(테스트용). 기본은 `RUNNER_WS_PORT`. */
  port?: number;
}

export interface RecordingWsServer {
  readonly port: number;
  sessionCount(): number;
  session(sessionId: string): RecordingSession | undefined;
  close(): Promise<void>;
}

export async function startRecordingWsServer(
  options: RecordingWsServerOptions,
): Promise<RecordingWsServer> {
  const { config, redis, subscriber, dataSource, log } = options;
  const sessions = new Map<string, RecordingSession>();
  const opening = new Map<string, Promise<RecordingSession>>();

  const http: Server = createServer((_req, res) => {
    // 이 포트는 WS 전용이다. 정적 서빙을 겸하지 않는다(PoC 서버와 다른 점).
    res.writeHead(426, { "content-type": "text/plain; charset=utf-8" });
    res.end("upgrade required");
  });
  const wss = new WebSocketServer({ noServer: true });

  http.on("upgrade", (req, socket: Duplex, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const matched = REC_PATH.exec(url.pathname);
    if (matched === null) {
      socket.destroy();
      return;
    }
    const sessionId = (matched[1] ?? "").toLowerCase();
    const token = url.searchParams.get("token");

    // ★ 핸드셰이크를 끝낸 **뒤에** close code 를 보낸다. 업그레이드 전에 끊으면
    //   클라이언트는 4401 인지 네트워크 오류인지 구분할 수 없다.
    wss.handleUpgrade(req, socket, head, (ws) => {
      void admit(ws, sessionId, token);
    });
  });

  await new Promise<void>((done, fail) => {
    http.once("error", fail);
    http.listen(options.port ?? config.wsPort, () => {
      done();
    });
  });
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("녹화 WS 서버 바인딩 실패");
  const port = address.port;

  async function admit(ws: WebSocket, sessionId: string, token: string | null): Promise<void> {
    const stored = await redis.get(recordingTokenKey(sessionId)).catch(() => null);
    if (!verifyRecordingToken(token, stored)) {
      log(`세션 ${sessionId} 접속 거부 — 토큰 불일치/부재 (close ${String(WS_CLOSE_UNAUTHORIZED)})`);
      ws.close(WS_CLOSE_UNAUTHORIZED, "invalid recording token");
      return;
    }

    const row = await dataSource
      .getRepository(RecordingSessionEntity)
      .findOne({ where: { id: sessionId } })
      .catch(() => null);
    if (!row || row.status !== "live") {
      log(`세션 ${sessionId} 접속 거부 — 세션 상태 ${row?.status ?? "없음"} (close ${String(WS_CLOSE_SESSION_GONE)})`);
      ws.close(WS_CLOSE_SESSION_GONE, "recording session is gone");
      return;
    }

    let session: RecordingSession;
    try {
      session = await ensureSession(row);
    } catch (error) {
      log(
        `세션 ${sessionId} 브라우저 기동 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      ws.send(JSON.stringify({ t: "error", code: "SESSION_OPEN_FAILED", message: "브라우저를 열지 못했습니다." }));
      ws.close(WS_CLOSE_SESSION_GONE, "failed to open browser");
      return;
    }

    let frameId = 0;
    let droppedBackpressure = 0;
    const sink: SessionSink = {
      frame: (frame) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // ★ 드롭 정책 — 소켓이 밀려 있으면 이 프레임을 버린다(PoC-1 과 동일).
        if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
          droppedBackpressure += 1;
          return;
        }
        frameId += 1;
        ws.send(
          encodeFrame(frameId, frame.capturedAtMs, frame.viewportWidth, frame.viewportHeight, frame.data),
          { binary: true },
        );
      },
      message: (message) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(message));
      },
    };

    ws.binaryType = "nodebuffer";
    session.attach(sink);
    log(`세션 ${sessionId} 클라이언트 접속`);

    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = RecorderClientMessageSchema.safeParse(parsed);
      if (!result.success) {
        // 계약 위반을 조용히 넘기지 않는다 — 클라이언트가 틀린 것을 알아야 고친다.
        sink.message({ t: "error", code: "BAD_MESSAGE", message: result.error.message.slice(0, 300) });
        return;
      }
      void session.dispatch(result.data).catch((error: unknown) => {
        sink.message({
          t: "error",
          code: "DISPATCH_FAILED",
          message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        });
      });
    });

    ws.on("close", () => {
      session.detach(sink);
      log(
        `세션 ${sessionId} 클라이언트 종료 — 백프레셔 드롭 ${String(droppedBackpressure)}건. ` +
          `브라우저는 유휴 타임아웃까지 유지한다(재접속 허용).`,
      );
    });
  }

  /** 같은 세션에 동시에 두 번 붙어도 브라우저가 두 개 뜨지 않게 기동을 직렬화한다. */
  async function ensureSession(row: RecordingSessionEntity): Promise<RecordingSession> {
    const existing = sessions.get(row.id);
    if (existing) return existing;
    const inFlight = opening.get(row.id);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<RecordingSession> => {
      const session = new RecordingSession({
        sessionId: row.id,
        scenarioId: row.scenarioId,
        startUrl: row.startUrl,
        viewport: { w: row.viewportW, h: row.viewportH },
        config,
        dataSource,
        log,
      });
      await session.open();
      sessions.set(row.id, session);
      log(`세션 ${row.id} 브라우저 기동 — ${row.startUrl || "(빈 시작 URL)"}`);
      return session;
    })();

    opening.set(row.id, promise);
    try {
      return await promise;
    } finally {
      opening.delete(row.id);
    }
  }

  async function endSession(sessionId: string, reason: "stopped" | "disposed" | "expired"): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    await session.close(reason);
  }

  /* ── 제어 채널 (API → Runner) ────────────────────────────
   * API 는 WS 를 중계하지 않으므로 `stop`/`DELETE` 를 알릴 다른 통로가 없다.
   * 세션마다 채널이 달라 패턴 구독을 쓴다(구독 전에 신호가 오는 경합을 피한다).
   * 구독자가 없어도 토큰은 이미 폐기됐고 유휴 타임아웃이 최종 방어선이다. */
  await subscriber.psubscribe("rec:*:control");
  subscriber.on("pmessage", (pattern: string, _channel: string, payload: string) => {
    if (pattern !== "rec:*:control") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const result = RecordingControlMessageSchema.safeParse(parsed);
    if (!result.success) return;
    const { t, sessionId } = result.data;
    log(`세션 ${sessionId} 제어 신호 수신: ${t}`);
    void endSession(sessionId, t === "stop" ? "stopped" : "disposed");
  });

  /* ── 유휴 타임아웃 청소 ───────────────────────────────── */
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions) {
      if (!session.isIdle(now)) continue;
      log(`세션 ${sessionId} 유휴 타임아웃 — 브라우저를 폐기하고 status 를 expired 로 바꾼다.`);
      void endSession(sessionId, "expired");
    }
  }, IDLE_CHECK_MS);
  sweeper.unref();

  log(`녹화 WS 서버 기동 — ws://0.0.0.0:${String(port)}/rec/:sessionId?token=…`);

  return {
    port,
    sessionCount: () => sessions.size,
    session: (sessionId) => sessions.get(sessionId),
    close: async () => {
      clearInterval(sweeper);
      for (const socket of wss.clients) socket.terminate();
      await Promise.all([...sessions.keys()].map((id) => endSession(id, "expired")));
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
