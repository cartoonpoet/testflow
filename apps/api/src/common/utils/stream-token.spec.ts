import { describe, expect, it } from "vitest";
import {
  LIVE_STREAM_TOKEN_TTL_SEC,
  RECORDING_TOKEN_TTL_SEC,
  liveStreamTokenKey,
  liveStreamTokenMemberKey,
  recordingTokenKey,
} from "@testflow/contracts";
import {
  generateStreamToken,
  hashStreamToken,
  issueStreamToken,
  matchesStreamTokenHash,
  revokeStreamToken,
  streamTokenKey,
  streamTokenTtlSec,
  verifyStreamToken,
} from "./stream-token.js";
import type { StreamTokenStore } from "./stream-token.js";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const RUN_ID = "99999999-8888-4777-8666-555555555555";

/** `SET key value EX ttl` / `GET` / `DEL` 만 쓰는 인메모리 가짜. TTL 은 값만 기록한다. */
function fakeStore(): StreamTokenStore & { dump(): Map<string, { value: string; ttl: number }> } {
  const map = new Map<string, { value: string; ttl: number }>();
  return {
    set(key, value, _mode, ttlSec) {
      map.set(key, { value, ttl: ttlSec });
      return Promise.resolve("OK");
    },
    get(key) {
      return Promise.resolve(map.get(key)?.value ?? null);
    },
    del(key) {
      map.delete(key);
      return Promise.resolve(1);
    },
    dump: () => map,
  };
}

describe("스트림 토큰 — 녹화·실행 공통 구현", () => {
  it("base64url 43자 (32바이트 엔트로피) 이고 매번 다르다", () => {
    const token = generateStreamToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(new Set(Array.from({ length: 50 }, () => generateStreamToken())).size).toBe(50);
  });

  it("저장되는 것은 평문이 아니라 sha256 hex 64자다", async () => {
    const store = fakeStore();
    const { token } = await issueStreamToken(store, "live", RUN_ID);

    const stored = store.dump().get(liveStreamTokenKey(RUN_ID));
    expect(stored?.value).toHaveLength(64);
    expect(stored?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.value).not.toBe(token);
    expect(stored?.value).toBe(hashStreamToken(token));
  });

  it("올바른 토큰만 통과하고, 폐기하면 즉시 막힌다", async () => {
    const store = fakeStore();
    const { token } = await issueStreamToken(store, "live", RUN_ID);

    expect(await verifyStreamToken(store, "live", RUN_ID, token)).toBe(true);
    expect(await verifyStreamToken(store, "live", RUN_ID, generateStreamToken())).toBe(false);

    await revokeStreamToken(store, "live", RUN_ID);
    expect(await verifyStreamToken(store, "live", RUN_ID, token)).toBe(false);
  });

  it("길이가 다른 해시에 대해 던지지 않고 false 를 돌려준다", () => {
    expect(matchesStreamTokenHash(generateStreamToken(), "deadbeef")).toBe(false);
    expect(matchesStreamTokenHash(generateStreamToken(), null)).toBe(false);
    expect(matchesStreamTokenHash(generateStreamToken(), "")).toBe(false);
  });
});

describe("★ 키 공간 분리 (03-phases 쟁점 3)", () => {
  it("keyspace 마다 접두사와 TTL 이 contracts 값 그대로다", () => {
    expect(streamTokenKey("recording", SESSION_ID)).toBe(`testflow:rec:token:${SESSION_ID}`);
    expect(streamTokenKey("live", RUN_ID)).toBe(`testflow:run:token:${RUN_ID}`);
    expect(streamTokenKey("recording", SESSION_ID)).toBe(recordingTokenKey(SESSION_ID));
    expect(streamTokenKey("live", RUN_ID)).toBe(liveStreamTokenKey(RUN_ID));

    expect(streamTokenTtlSec("recording")).toBe(RECORDING_TOKEN_TTL_SEC);
    expect(streamTokenTtlSec("live")).toBe(LIVE_STREAM_TOKEN_TTL_SEC);
    expect(RECORDING_TOKEN_TTL_SEC).toBe(600);
    expect(LIVE_STREAM_TOKEN_TTL_SEC).toBe(120);
  });

  it("★ 녹화 토큰으로 실행 스트림에 붙을 수 없다", async () => {
    const store = fakeStore();
    // 같은 id 로 녹화 토큰만 발급한다 (id 충돌이라는 최악의 가정).
    const { token } = await issueStreamToken(store, "recording", RUN_ID);

    expect(await verifyStreamToken(store, "recording", RUN_ID, token)).toBe(true);
    // ★ 실행 스트림 공간에는 그 해시가 없다 → 반드시 거부.
    expect(await verifyStreamToken(store, "live", RUN_ID, token)).toBe(false);
  });

  it("★ 실행 토큰으로 녹화 세션에 붙을 수도 없다 (반대 방향)", async () => {
    const store = fakeStore();
    const { token } = await issueStreamToken(store, "live", SESSION_ID);

    expect(await verifyStreamToken(store, "live", SESSION_ID, token)).toBe(true);
    expect(await verifyStreamToken(store, "recording", SESSION_ID, token)).toBe(false);
  });

  it("한쪽을 폐기해도 다른 쪽은 살아 있다 (두 키가 독립이다)", async () => {
    const store = fakeStore();
    const rec = await issueStreamToken(store, "recording", RUN_ID);
    const live = await issueStreamToken(store, "live", RUN_ID);

    await revokeStreamToken(store, "recording", RUN_ID);

    expect(await verifyStreamToken(store, "recording", RUN_ID, rec.token)).toBe(false);
    expect(await verifyStreamToken(store, "live", RUN_ID, live.token)).toBe(true);
  });

  it("발급 시 TTL 이 keyspace 값으로 들어간다", async () => {
    const store = fakeStore();
    await issueStreamToken(store, "recording", SESSION_ID);
    await issueStreamToken(store, "live", RUN_ID);

    expect(store.dump().get(recordingTokenKey(SESSION_ID))?.ttl).toBe(600);
    expect(store.dump().get(liveStreamTokenKey(RUN_ID))?.ttl).toBe(120);
  });

  it("expiresAt 은 TTL 만큼 미래다", async () => {
    const store = fakeStore();
    const before = Date.now();
    const { expiresAt } = await issueStreamToken(store, "live", RUN_ID);
    const delta = new Date(expiresAt).getTime() - before;

    expect(delta).toBeGreaterThanOrEqual(LIVE_STREAM_TOKEN_TTL_SEC * 1000 - 50);
    expect(delta).toBeLessThanOrEqual(LIVE_STREAM_TOKEN_TTL_SEC * 1000 + 5000);
  });
});

/**
 * ★ 라운드 4 — 같은 run 의 토큰이 **여러 개 공존**한다 (다중 뷰어).
 *
 * 단일 슬롯만 있던 라운드 2에서는 두 번째 탭이 `GET /api/runs/:id/live` 를 부르는 순간
 * 첫 탭의 토큰이 무효가 됐다. 두 탭에서 같은 run 을 열면 먼저 연 쪽이 **4401** 을 맞는다.
 */
describe("★ 라이브 토큰 — 다중 뷰어 (라운드 4)", () => {
  it("발급하면 해시별 키도 함께 생긴다", async () => {
    const store = fakeStore();
    const { token } = await issueStreamToken(store, "live", RUN_ID);
    const memberKey = liveStreamTokenMemberKey(RUN_ID, hashStreamToken(token));

    expect(store.dump().get(memberKey)?.value).toBe("1");
    expect(store.dump().get(memberKey)?.ttl).toBe(LIVE_STREAM_TOKEN_TTL_SEC);
  });

  it("★ 두 번 발급해도 **앞선 토큰의 해시별 키가 살아 있다**", async () => {
    const store = fakeStore();
    const first = await issueStreamToken(store, "live", RUN_ID);
    const second = await issueStreamToken(store, "live", RUN_ID);

    // 단일 슬롯은 최신 것으로 회전한다(기존 동작 그대로).
    expect(store.dump().get(liveStreamTokenKey(RUN_ID))?.value).toBe(
      hashStreamToken(second.token),
    );
    // 그러나 앞선 토큰도 자기 키로 살아 있다 — 첫 탭이 끊기지 않는 근거다.
    expect(
      store.dump().get(liveStreamTokenMemberKey(RUN_ID, hashStreamToken(first.token))),
    ).toBeDefined();
  });

  it("해시별 키는 여전히 실행 키 공간 접두사다 — 녹화와 섞이지 않는다", () => {
    const key = liveStreamTokenMemberKey(RUN_ID, "a".repeat(64));
    expect(key.startsWith(liveStreamTokenKey(RUN_ID))).toBe(true);
    expect(key.startsWith(recordingTokenKey(RUN_ID))).toBe(false);
  });

  it("★ 녹화 발급은 해시별 키를 만들지 않는다(녹화 경로 무변경)", async () => {
    const store = fakeStore();
    await issueStreamToken(store, "recording", SESSION_ID);
    const extra = [...store.dump().keys()].filter((key) => key !== recordingTokenKey(SESSION_ID));
    expect(extra).toEqual([]);
  });
});
