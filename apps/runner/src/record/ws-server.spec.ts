import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LIVE_STREAM_TOKEN_KEY_PREFIX,
  RECORDING_TOKEN_KEY_PREFIX,
  liveStreamTokenKey,
  liveStreamTokenMemberKey,
  recordingTokenKey,
} from "@testflow/contracts";
import {
  FRAME_HEADER_BYTES,
  encodeFrame,
  hashRecordingToken,
  hashStreamToken,
  verifyRecordingToken,
  verifyStreamTokenHash,
} from "./ws-server.js";

/**
 * WS 서버의 **경계 두 개**를 테스트로 고정한다 (03-phases Task 4.2).
 *
 *  ① **토큰 키 공간 분리** — 녹화 토큰으로 실행 스트림에 붙을 수 없다(쟁점 3).
 *     경계 전부가 "어느 Redis 키에서 해시를 읽었는가" 하나다. 그래서 그 성질을
 *     여기서 **실제 키 문자열로** 고정한다. 키가 같아지는 리팩터링이 들어오면 여기서 깨진다.
 *  ② **프레임 봉투 25바이트** — 녹화와 실행이 같은 봉투를 쓴다. 바뀌면 웹 `frame.ts`
 *     디코더가 두 경로 **모두** 못 읽는다.
 *
 * 소켓 수락 경로(4401/4404)는 Redis·DB·실제 WS 가 필요해 단위 테스트가 아니라
 * 종단 실측으로 확인했다(`.pipeline/…/04-gen-4.md`).
 */

const ID = "11111111-2222-3333-4444-555555555555";
const sha256hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

describe("★ 토큰 키 공간 분리 — 녹화 토큰으로 실행 스트림에 붙을 수 없다", () => {
  it("두 키 접두사가 다르다", () => {
    expect(RECORDING_TOKEN_KEY_PREFIX).toBe("testflow:rec:token:");
    expect(LIVE_STREAM_TOKEN_KEY_PREFIX).toBe("testflow:run:token:");
    expect(recordingTokenKey(ID)).not.toBe(liveStreamTokenKey(ID));
  });

  it("★ id 가 같아도 서로의 해시를 보지 못한다(인메모리 Redis 대역으로 재현)", () => {
    // API 가 녹화 토큰만 발급한 상태를 만든다.
    const recToken = randomBytes(32).toString("base64url");
    const store = new Map<string, string>([[recordingTokenKey(ID), sha256hex(recToken)]]);

    // Runner 의 `/rec/` 경로: 녹화 키에서 읽는다 → 통과.
    expect(verifyStreamTokenHash(recToken, store.get(recordingTokenKey(ID)) ?? null)).toBe(true);

    // Runner 의 `/live/` 경로: **실행 키에서만** 읽는다 → 키가 없으므로 거부.
    expect(verifyStreamTokenHash(recToken, store.get(liveStreamTokenKey(ID)) ?? null)).toBe(false);
  });

  it("반대 방향도 막힌다 — 실행 토큰으로 녹화 세션에 붙을 수 없다", () => {
    const liveToken = randomBytes(32).toString("base64url");
    const store = new Map<string, string>([[liveStreamTokenKey(ID), sha256hex(liveToken)]]);
    expect(verifyStreamTokenHash(liveToken, store.get(liveStreamTokenKey(ID)) ?? null)).toBe(true);
    expect(verifyStreamTokenHash(liveToken, store.get(recordingTokenKey(ID)) ?? null)).toBe(false);
  });
});

describe("verifyStreamTokenHash", () => {
  it("올바른 토큰을 통과시킨다", () => {
    const token = "abc123";
    expect(verifyStreamTokenHash(token, hashStreamToken(token))).toBe(true);
  });

  it("틀린 토큰·빈 토큰·키 부재를 전부 거부한다", () => {
    const stored = hashStreamToken("right");
    expect(verifyStreamTokenHash("wrong", stored)).toBe(false);
    expect(verifyStreamTokenHash("", stored)).toBe(false);
    expect(verifyStreamTokenHash(null, stored)).toBe(false);
    // 만료 = 키 부재. Redis TTL 이 지나면 `GET` 이 null 이다.
    expect(verifyStreamTokenHash("right", null)).toBe(false);
    expect(verifyStreamTokenHash("right", "")).toBe(false);
  });

  it("길이가 다른 해시에서 던지지 않는다(timingSafeEqual 보호)", () => {
    expect(() => verifyStreamTokenHash("x", "deadbeef")).not.toThrow();
    expect(verifyStreamTokenHash("x", "deadbeef")).toBe(false);
  });

  it("평문 토큰이 저장돼 있으면 거부한다(해시만 저장한다는 규약)", () => {
    expect(verifyStreamTokenHash("abc123", "abc123")).toBe(false);
  });

  it("★ 녹화 경로의 기존 이름이 같은 동작을 유지한다(리팩터링 안전망)", () => {
    const token = "same-token";
    expect(hashRecordingToken(token)).toBe(hashStreamToken(token));
    expect(hashRecordingToken(token)).toBe(sha256hex(token));
    expect(verifyRecordingToken(token, hashRecordingToken(token))).toBe(true);
    expect(verifyRecordingToken("other", hashRecordingToken(token))).toBe(false);
  });
});

describe("프레임 봉투 — 녹화와 실행이 공유한다", () => {
  it("헤더는 25바이트이고 레이아웃이 그대로다", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]);
    const encoded = encodeFrame(7, 1_700_000_123_456, 1280, 800, jpeg);

    expect(FRAME_HEADER_BYTES).toBe(25);
    expect(encoded.byteLength).toBe(FRAME_HEADER_BYTES + jpeg.byteLength);
    expect(encoded.readUInt8(0)).toBe(0x01);
    expect(encoded.readUInt32BE(1)).toBe(7);
    expect(encoded.readDoubleBE(5)).toBe(1_700_000_123_456);
    expect(encoded.readUInt16BE(21)).toBe(1280);
    expect(encoded.readUInt16BE(23)).toBe(800);
    expect(encoded.subarray(FRAME_HEADER_BYTES)).toEqual(jpeg);
  });

  it("serverSendAtMs 가 채워진다(왕복 지연 분해용)", () => {
    const before = Date.now();
    const encoded = encodeFrame(1, before, 100, 100, Buffer.alloc(1));
    const sendAt = encoded.readDoubleBE(13);
    expect(sendAt).toBeGreaterThanOrEqual(before);
    expect(sendAt).toBeLessThanOrEqual(Date.now());
  });
});

/**
 * ★ 라운드 4 — 해시별 키의 성질 (다중 뷰어).
 *
 * Runner 는 단일 슬롯을 먼저 보고, 어긋나면 `liveStreamTokenMemberKey` 의 **존재 여부**를
 * 본다. 그 키 이름 자체가 `sha256(token)` 이라, 토큰을 모르면 키에 닿을 수 없다.
 */
describe("★ 라이브 토큰 — 해시별 키 (라운드 4)", () => {
  it("키 이름이 sha256(token) 을 포함한다 — 평문은 어디에도 없다", () => {
    const token = "live-token-abc";
    const key = liveStreamTokenMemberKey(ID, sha256hex(token));
    expect(key).toContain(sha256hex(token));
    expect(key).not.toContain(token);
  });

  it("다른 토큰은 다른 키를 만든다(추측 불가는 그대로다)", () => {
    expect(liveStreamTokenMemberKey(ID, sha256hex("a"))).not.toBe(
      liveStreamTokenMemberKey(ID, sha256hex("b")),
    );
  });

  it("★ 녹화 키 공간과 섞이지 않는다", () => {
    const key = liveStreamTokenMemberKey(ID, sha256hex("x"));
    expect(key.startsWith(liveStreamTokenKey(ID))).toBe(true);
    expect(key.startsWith(recordingTokenKey(ID))).toBe(false);
  });
});
