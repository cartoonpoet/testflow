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
  isTerminalRunStatus,
  liveStreamTokenKey,
  liveStreamTokenMemberKey,
  recordingTokenKey,
} from "@testflow/contracts";
import type { RunStatus } from "@testflow/contracts";
import { RecordingSessionEntity, RunEntity } from "@testflow/db";
import type { RunnerConfig } from "../env.js";
import type {
  LiveStreamFrame,
  LiveStreamRegistry,
  LiveStreamSession,
  LiveStreamSink,
} from "../execute/live-stream.js";
import { IDLE_CHECK_MS, RecordingSession } from "./session.js";
import type { SessionSink } from "./session.js";

/**
 * 녹화 WS 서버 + 세션 토큰 검증 (03-phases Task 7.2)
 *
 * ## ★ 라운드 2 — 같은 서버에 실행 라이브 스트림 경로(`/live/:runId`)를 더했다
 * 경로 2개, 포트 1개다(03-phases 쟁점 3). **봉투(`encodeFrame`) · 드롭 상한
 * (`MAX_BUFFERED_BYTES`) · 핸드셰이크 후 close 규약을 같은 코드로 공유한다** —
 * 분리하면 그 셋이 두 벌이 되고, 어긋나는 순간 한쪽 화면만 조용히 깨진다.
 * 분리되는 것은 **세션 레지스트리**와 **Redis 토큰 키 공간**뿐이다.
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

/**
 * ★ 라이브 세션이 아직 열리지 않았을 때 기다리는 시간 (실측으로 발견한 경합 — 04-gen-4 이슈).
 *
 * `GET /api/runs/:id/live` 는 **종료되지 않은** run 에 토큰을 준다 — `queued` 도 포함된다.
 * 그런데 스트림 세션은 Runner 가 그 job 을 집어 `runStarted()` 한 뒤에 열린다. 즉
 * **토큰을 받고 즉시 붙으면 세션이 아직 없다.** 실측에서 그것이 `4404` 로 나왔고,
 * 화면은 "끝난 실행"과 구분할 수 없어 라이브를 영영 못 보게 된다.
 *
 * 그래서 세션이 없으면 **run 이 아직 살아 있는 동안만** 기다린다. run 이 종료 상태면
 * 즉시 4404 다(끝난 실행에 스트림을 열어 주지 않는다는 규약 그대로).
 * 15초는 concurrency 상한 때문에 큐에서 잠깐 기다리는 경우를 덮고, 그보다 긴 대기는
 * 화면이 다시 요청하는 것이 맞다(토큰 TTL 이 120초다).
 */
const LIVE_SESSION_WAIT_MS = 15_000;
const LIVE_SESSION_POLL_MS = 100;
/** run 상태를 다시 읽는 주기. 매 폴링마다 DB 를 때리지 않는다. */
const LIVE_RUN_RECHECK_MS = 1_000;

const REC_PATH = /^\/rec\/([0-9a-fA-F-]{36})$/u;
const LIVE_PATH = /^\/live\/([0-9a-fA-F-]{36})$/u;

/* ── 토큰 검증 ─────────────────────────────────────────────── */

export function hashStreamToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * `sha256(token)` 과 Redis 에 저장된 해시를 **타이밍 안전 비교**한다.
 * `timingSafeEqual` 은 길이가 다르면 던지므로 먼저 걸러 `false` 를 돌려준다.
 *
 * ★ 이 함수는 **키 공간을 모른다** — 어느 키에서 `stored` 를 읽었는지가 경계 전부다.
 *   녹화는 `recordingTokenKey()`, 실행은 `liveStreamTokenKey()` 로 읽는다. 그래서
 *   **녹화 토큰으로 `/live/` 에 붙으면 `stored` 가 `null` 이 되어 반드시 실패한다.**
 */
export function verifyStreamTokenHash(token: string | null, stored: string | null): boolean {
  if (token === null || token === "" || stored === null || stored === "") return false;
  const actual = Buffer.from(hashStreamToken(token), "utf8");
  const expected = Buffer.from(stored, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** 녹화 경로의 기존 이름. **동작은 한 글자도 바뀌지 않았다**(같은 해시·같은 비교). */
export const hashRecordingToken = hashStreamToken;
export const verifyRecordingToken = verifyStreamTokenHash;

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
  /**
   * 실행 라이브 스트림 레지스트리(라운드 2). **없으면 `/live/` 경로가 열리지 않는다** —
   * 녹화만 쓰는 배치에서 쓸모 없는 경로를 노출하지 않기 위해 옵셔널이다.
   */
  liveStreams?: LiveStreamRegistry;
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
  const liveStreams = options.liveStreams ?? null;
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
    const token = url.searchParams.get("token");

    const recording = REC_PATH.exec(url.pathname);
    if (recording !== null) {
      const sessionId = (recording[1] ?? "").toLowerCase();
      // ★ 핸드셰이크를 끝낸 **뒤에** close code 를 보낸다. 업그레이드 전에 끊으면
      //   클라이언트는 4401 인지 네트워크 오류인지 구분할 수 없다.
      wss.handleUpgrade(req, socket, head, (ws) => {
        void admit(ws, sessionId, token);
      });
      return;
    }

    const live = LIVE_PATH.exec(url.pathname);
    if (live !== null && liveStreams !== null) {
      const runId = (live[1] ?? "").toLowerCase();
      // 같은 규약을 쓴다 — 핸드셰이크 뒤 close code.
      wss.handleUpgrade(req, socket, head, (ws) => {
        void admitLive(ws, runId, token);
      });
      return;
    }

    socket.destroy();
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

  /* ── 실행 라이브 스트림 `/live/:runId` (라운드 2 Task 4.2) ──────────────
   *
   * ★★ **단방향이다.** C→S 메시지를 받지 않는다 — 들어온 것은 **무시**한다.
   *    `input-bridge` 를 붙이지 않는다: 코드 실행 화면은 "보기만" 하고, 원격 조작을
   *    허용하면 사용자의 클릭이 테스트를 깨뜨리고 그 실패가 "시나리오 실패"로 기록된다.
   *    (계약에도 `Live*` 클라이언트 메시지 타입이 **일부러 없다** — contracts `events.ts` 주석.)
   *
   * 녹화와 공유하는 것: 봉투(`encodeFrame`) · 드롭 상한(`MAX_BUFFERED_BYTES`) ·
   * 핸드셰이크 후 close code 규약 · `binaryType`.
   * 분리되는 것: 토큰 키 공간(`liveStreamTokenKey`)과 세션 레지스트리(`LiveStreamRegistry`).
   * ────────────────────────────────────────────────────────────────── */
  /** `runs.status` 를 읽는다. 행이 없으면 `null`(= 붙을 대상이 없다). */
  async function runStatusOf(runId: string): Promise<RunStatus | null> {
    const row = await dataSource
      .getRepository(RunEntity)
      .findOne({ where: { id: runId }, select: { id: true, status: true } })
      .catch(() => null);
    return row === null ? null : (row.status as RunStatus);
  }

  /**
   * 세션이 열릴 때까지 기다린다. **run 이 종료 상태가 되면 즉시 포기한다.**
   *
   * `queued → running` 전이 구간의 경합을 덮는 유일한 지점이다(`LIVE_SESSION_WAIT_MS` 주석).
   */
  async function waitForLiveSession(
    registry: LiveStreamRegistry,
    runId: string,
    socketAlive: () => boolean,
  ): Promise<LiveStreamSession | null> {
    const immediate = registry.get(runId);
    if (immediate !== undefined) return immediate;

    const deadline = Date.now() + LIVE_SESSION_WAIT_MS;
    let nextRecheckAt = 0;
    for (;;) {
      if (!socketAlive()) return null;
      const found = registry.get(runId);
      if (found !== undefined) return found;

      if (Date.now() >= nextRecheckAt) {
        nextRecheckAt = Date.now() + LIVE_RUN_RECHECK_MS;
        const status = await runStatusOf(runId);
        // 행이 없거나 이미 끝난 실행이면 기다릴 이유가 없다.
        if (status === null || isTerminalRunStatus(status)) return null;
      }
      if (Date.now() >= deadline) return null;
      await new Promise((done) => setTimeout(done, LIVE_SESSION_POLL_MS));
    }
  }

  /**
   * ★ 라운드 4 — 같은 run 의 **여러 토큰**을 허용한다(다중 뷰어).
   *
   * 단일 슬롯(`liveStreamTokenKey`)은 그대로 먼저 본다 — 기존 동작·기존 테스트가 그대로다.
   * 거기서 어긋나면 **해시별 키**(`liveStreamTokenMemberKey`)를 한 번 더 본다. 이것이
   * 없으면 두 번째 탭이 토큰을 받는 순간 첫 탭의 재접속이 4401 이 된다.
   *
   * ★ 해시별 키는 **존재 여부만** 본다. 값이 아니라 **키 이름 자체가 sha256(token)** 이라
   *   제시한 토큰을 해시해야만 그 키에 닿을 수 있다(추측 불가는 그대로다). 비교 대상이
   *   비밀값이 아니므로 타이밍 안전 비교가 필요 없다.
   */
  async function liveTokenAccepted(
    runId: string,
    token: string | null,
    stored: string | null,
  ): Promise<boolean> {
    if (verifyStreamTokenHash(token, stored)) return true;
    if (token === null || token === "") return false;
    const exists = await redis
      .exists(liveStreamTokenMemberKey(runId, hashStreamToken(token)))
      .catch(() => 0);
    return exists === 1;
  }

  async function admitLive(ws: WebSocket, runId: string, token: string | null): Promise<void> {
    if (liveStreams === null) {
      ws.close(WS_CLOSE_SESSION_GONE, "live stream is not enabled");
      return;
    }

    // ★ 실행 스트림 키 공간에서만 읽는다. 녹화 토큰(`testflow:rec:token:`)은 여기서
    //   절대 보이지 않는다 — 그것이 키 공간 분리의 전부다(쟁점 3).
    const stored = await redis.get(liveStreamTokenKey(runId)).catch(() => null);
    if (!(await liveTokenAccepted(runId, token, stored))) {
      log(`run ${runId} 라이브 접속 거부 — 토큰 불일치/부재 (close ${String(WS_CLOSE_UNAUTHORIZED)})`);
      ws.close(WS_CLOSE_UNAUTHORIZED, "invalid live stream token");
      return;
    }

    // ★ 세션이 아직 없을 수 있다(run 이 큐에 있는 동안 토큰이 발급된다 — 실측 경합).
    //   run 이 살아 있는 동안만 기다린다. 종료된 run 이면 즉시 4404 다.
    const session = await waitForLiveSession(liveStreams, runId, () => ws.readyState === WebSocket.OPEN);
    if (session === null) {
      log(`run ${runId} 라이브 접속 거부 — 스트림 세션 없음 (close ${String(WS_CLOSE_SESSION_GONE)})`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(WS_CLOSE_SESSION_GONE, "live stream session is gone");
      }
      return;
    }

    let frameId = 0;
    let droppedBackpressure = 0;
    const sink: LiveStreamSink = {
      frame: (frame: LiveStreamFrame) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // ★ 드롭 정책 — 녹화와 **같은 상한, 같은 판단**이다. 최신 프레임이 언제나 옳다.
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
      finish: () => {
        // ★ **정상 종료(1000)**. 비정상 code 를 주면 웹의 close 분류가 "오류"로 읽고
        //   캔버스를 지운다. 마지막 프레임을 남겨야 한다(쟁점 3 / Task 4.4 규칙).
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, "run finished");
        }
      },
    };

    ws.binaryType = "nodebuffer";
    /*
     * ★ 라운드 4 — **기존 뷰어를 끊지 않는다.** 04-gen-4 결정 7의 "최신이 이긴다"(sink 1개)
     *   를 되돌렸다: 두 탭에서 같은 run 을 열면 먼저 연 탭이 조용히 끊겼기 때문이다.
     *   `attach()` 안에서 **캐시된 마지막 프레임이 즉시 이 소켓으로** 나간다 —
     *   화면이 정지한 순간에 붙어도 검은 캔버스가 되지 않는 지점이 거기다.
     */
    session.attach(sink);
    log(`run ${runId} 라이브 뷰어 접속 — 현재 뷰어 ${String(session.viewerCount)}명`);

    // ★ 단방향 — 받은 메시지를 파싱조차 하지 않는다.
    ws.on("message", () => undefined);

    ws.on("close", () => {
      session.detach(sink);
      log(
        `run ${runId} 라이브 뷰어 종료 — 백프레셔 드롭 ${String(droppedBackpressure)}건. ` +
          `남은 뷰어 ${String(session.viewerCount)}명(다른 뷰어는 계속 받는다)`,
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

  log(
    `WS 서버 기동 — ws://0.0.0.0:${String(port)}/rec/:sessionId?token=… ` +
      (liveStreams === null
        ? "(라이브 스트림 비활성)"
        : `· ws://0.0.0.0:${String(port)}/live/:runId?token=… (단방향)`),
  );

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
