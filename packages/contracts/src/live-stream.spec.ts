import { describe, expect, it } from "vitest";
import {
  LIVE_STREAM_STATES,
  LiveStreamServerMessageSchema,
  WS_CLOSE_SESSION_GONE,
  WS_CLOSE_UNAUTHORIZED,
} from "./events.js";
import {
  LIVE_STREAM_TOKEN_KEY_PREFIX,
  LIVE_STREAM_TOKEN_TTL_SEC,
  LiveStreamInfoSchema,
  RECORDING_TOKEN_KEY_PREFIX,
  liveStreamTokenKey,
  recordingTokenKey,
} from "./recording.js";

const RUN_ID = "3bab4b44-1111-4111-8111-111111111111";

describe("라이브 스트림 토큰 키 공간", () => {
  it("★ 녹화 키 공간과 분리돼 있다 — 녹화 토큰으로 실행 스트림에 붙을 수 없다", () => {
    expect(LIVE_STREAM_TOKEN_KEY_PREFIX).toBe("testflow:run:token:");
    expect(RECORDING_TOKEN_KEY_PREFIX).toBe("testflow:rec:token:");
    expect(liveStreamTokenKey(RUN_ID)).not.toBe(recordingTokenKey(RUN_ID));
  });

  it("키는 접두사 + runId 다", () => {
    expect(liveStreamTokenKey(RUN_ID)).toBe(`testflow:run:token:${RUN_ID}`);
  });

  it("TTL 은 양수이고 녹화 토큰보다 짧다(한 번 쓰고 버리는 토큰이다)", () => {
    expect(LIVE_STREAM_TOKEN_TTL_SEC).toBeGreaterThan(0);
    expect(LIVE_STREAM_TOKEN_TTL_SEC).toBeLessThan(600);
  });

  it("close code 는 녹화와 같은 상수를 쓴다", () => {
    expect(WS_CLOSE_UNAUTHORIZED).toBe(4401);
    expect(WS_CLOSE_SESSION_GONE).toBe(4404);
  });
});

describe("LiveStreamServerMessageSchema", () => {
  it("상태 3종을 통과시킨다", () => {
    expect(LIVE_STREAM_STATES).toEqual(["live", "between-tests", "ended"]);
    for (const state of LIVE_STREAM_STATES) {
      expect(LiveStreamServerMessageSchema.safeParse({ t: "state", state }).success).toBe(true);
    }
  });

  it("ended 에는 runStatus 를 실을 수 있다", () => {
    const parsed = LiveStreamServerMessageSchema.parse({
      t: "state",
      state: "ended",
      runStatus: "failed",
    });
    expect(parsed).toEqual({ t: "state", state: "ended", runStatus: "failed" });
  });

  it("error 메시지를 통과시킨다", () => {
    expect(
      LiveStreamServerMessageSchema.safeParse({ t: "error", code: "gone", message: "끝난 실행입니다." })
        .success,
    ).toBe(true);
  });

  /** ★ 단방향 증명 — 입력 메시지가 이 union 에 들어올 수 없다. */
  it("★ 입력(mouse/key/ime/resize) 메시지는 거부된다 — 이 스트림은 단방향이다", () => {
    for (const t of ["mouse", "wheel", "key", "ime", "resize"]) {
      expect(LiveStreamServerMessageSchema.safeParse({ t, x: 1, y: 2 }).success).toBe(false);
    }
  });

  it("알 수 없는 상태는 거부된다", () => {
    expect(LiveStreamServerMessageSchema.safeParse({ t: "state", state: "paused" }).success).toBe(false);
  });
});

describe("LiveStreamInfoSchema", () => {
  it("wsUrl 과 expiresAt 을 가진다", () => {
    const parsed = LiveStreamInfoSchema.parse({
      wsUrl: `ws://127.0.0.1:4100/live/${RUN_ID}?token=abc`,
      expiresAt: "2026-09-18T00:02:00.000Z",
    });
    expect(parsed.wsUrl).toContain("/live/");
  });
});
