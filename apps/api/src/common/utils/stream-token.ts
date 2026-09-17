import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  RECORDING_TOKEN_TTL_SEC,
  LIVE_STREAM_TOKEN_TTL_SEC,
  recordingTokenKey,
  liveStreamTokenKey,
} from "@testflow/contracts";

/**
 * ★ WS 스트림 단명 토큰 — **녹화 세션과 실행 라이브 스트림의 공통 구현.**
 *
 * 04-gen-5 의 녹화 토큰 설계(`sha256` + `timingSafeEqual` + Redis 해시 저장 + 즉시 폐기)를
 * 그대로 쓰되, **복사하지 않고 여기 한 벌만 둔다**(03-phases 쟁점 3).
 * 해시/비교가 두 벌이 되면 한쪽만 고쳐졌을 때 조용히 규약이 어긋난다.
 *
 * 규약:
 *  - 토큰 = `randomBytes(32)` 의 base64url (43자). **추측 불가**. `?token=` 에 그대로 실린다.
 *  - Redis 에는 `sha256(token)` 의 **hex 만** TTL 과 함께 둔다. 평문은 응답으로만 나간다.
 *  - 검증 = `GET` 해서 `sha256(제시된 토큰)` 과 **타이밍 안전 비교**. 불일치·부재 → close 4401.
 *  - 폐기 = 키 `DEL`. 즉시 재접속이 막힌다(HMAC 으로는 불가능한 성질).
 *
 * ## ★ 키 공간 분리 (쟁점 3) — 이 파일의 핵심
 * 두 경로가 같은 코드를 타지만 **Redis 키 접두사와 TTL 은 다르다.**
 *
 * | keyspace | 접두사 | TTL | 발급 주체 |
 * |---|---|---|---|
 * | `recording` | `testflow:rec:token:` | 600초 | `POST /api/scenarios/:id/recordings` |
 * | `live`      | `testflow:run:token:` | 120초 | `GET /api/runs/:id/live` |
 *
 * 그 결과 **녹화 토큰으로 실행 스트림에 붙을 수 없다** — 검증이 `keyspace` 를 인자로 받아
 * 그 공간의 키만 읽기 때문이다. id 가 같아도(UUID 라 실제로는 같을 수 없지만) 공간이 다르면
 * 서로의 해시를 보지 못한다. `stream-token.spec.ts` 가 이 성질을 테스트로 고정한다.
 *
 * 비회원제라 **사용자 인증과 무관**하다. 증명하는 것은 "이 스트림에 붙어도 되는가" 하나다.
 */

export const STREAM_TOKEN_KEYSPACES = ["recording", "live"] as const;
export type StreamTokenKeyspace = (typeof STREAM_TOKEN_KEYSPACES)[number];

/** 키 규약·TTL 은 전부 `@testflow/contracts` 에 있다. 여기서 문자열을 새로 만들지 않는다. */
const KEYSPACE = {
  recording: { key: recordingTokenKey, ttlSec: RECORDING_TOKEN_TTL_SEC },
  live: { key: liveStreamTokenKey, ttlSec: LIVE_STREAM_TOKEN_TTL_SEC },
} as const satisfies Record<
  StreamTokenKeyspace,
  { key: (id: string) => string; ttlSec: number }
>;

/**
 * Redis 클라이언트 중 이 모듈이 실제로 쓰는 명령만.
 *
 * `ioredis` 의 `Redis` 를 그대로 받지 않는 이유: 단위 테스트에서 인메모리 가짜를 끼워
 * **키 공간 분리를 실제로 검증**하기 위해서다(`ioredis` 타입 전체를 흉내 낼 수는 없다).
 */
export interface StreamTokenStore {
  set(key: string, value: string, mode: "EX", ttlSec: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

/** base64url 43자. `?token=` 쿼리스트링에 그대로 실을 수 있다(URL 안전). */
export function generateStreamToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashStreamToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * 저장된 해시와 제시된 토큰을 비교한다(순수 함수 — Redis 를 모른다).
 *
 * 길이가 다르면 `timingSafeEqual` 이 던지므로 먼저 걸러 낸다. 비교 자체는
 * 항상 타이밍 안전 경로를 탄다(토큰을 한 바이트씩 맞춰 보는 공격 차단).
 */
export function matchesStreamTokenHash(token: string, storedHash: string | null): boolean {
  if (storedHash === null || storedHash.length === 0) return false;
  const actual = Buffer.from(hashStreamToken(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  if (actual.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(actual, expected);
}

/** 해당 keyspace 의 Redis 키. 접두사를 직접 조립하는 코드를 다른 곳에 두지 마라. */
export function streamTokenKey(keyspace: StreamTokenKeyspace, id: string): string {
  return KEYSPACE[keyspace].key(id);
}

export function streamTokenTtlSec(keyspace: StreamTokenKeyspace): number {
  return KEYSPACE[keyspace].ttlSec;
}

export interface IssuedStreamToken {
  /** 평문. **응답으로만 나간다.** 어디에도 저장하지 않는다. */
  token: string;
  /** ISO8601. 응답의 `expiresAt`. */
  expiresAt: string;
}

/** 토큰을 발급하고 해시만 TTL 과 함께 Redis 에 둔다. */
export async function issueStreamToken(
  store: StreamTokenStore,
  keyspace: StreamTokenKeyspace,
  id: string,
): Promise<IssuedStreamToken> {
  const ttlSec = streamTokenTtlSec(keyspace);
  const token = generateStreamToken();
  await store.set(streamTokenKey(keyspace, id), hashStreamToken(token), "EX", ttlSec);
  return {
    token,
    expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
}

/**
 * 제시된 토큰이 **그 keyspace 의 그 id** 에 발급된 것인지 검증한다.
 *
 * ★ 녹화 토큰을 `keyspace: "live"` 로 검증하면 반드시 false 다 — 다른 키를 읽기 때문이다.
 */
export async function verifyStreamToken(
  store: StreamTokenStore,
  keyspace: StreamTokenKeyspace,
  id: string,
  token: string,
): Promise<boolean> {
  const stored = await store.get(streamTokenKey(keyspace, id));
  return matchesStreamTokenHash(token, stored);
}

/** 즉시 폐기. 키를 지우는 순간 WS 재접속이 막힌다. */
export async function revokeStreamToken(
  store: StreamTokenStore,
  keyspace: StreamTokenKeyspace,
  id: string,
): Promise<void> {
  await store.del(streamTokenKey(keyspace, id));
}
