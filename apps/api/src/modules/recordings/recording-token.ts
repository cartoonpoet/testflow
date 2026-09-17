import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ★ 녹화 세션 토큰 — 발급(API)과 검증(Runner)의 단일 규약.
 *
 * Gen-Phase 7(Task 7.2)의 WS 서버가 **이 파일의 `hashRecordingToken` 과
 * `verifyRecordingToken` 을 그대로 구현**해야 한다. 규약 전문은
 * `@testflow/contracts` 의 `RECORDING_TOKEN_KEY_PREFIX` JSDoc 에 있다.
 *
 * 요약:
 *  - 토큰 = `randomBytes(32)` 의 base64url (43자). **추측 불가**.
 *  - Redis 에는 `sha256(token)` 의 hex 만 `testflow:rec:token:<sessionId>` 로 TTL 과 함께 둔다.
 *  - 검증 = `GET` 해서 `sha256(제시된 토큰)` 과 **타이밍 안전 비교**. 불일치·부재 → close 4401.
 *  - 폐기 = 키 `DEL`. `stop`/`DELETE` 즉시 접속이 막힌다(HMAC 으로는 불가능한 성질).
 *
 * 비회원제라 **사용자 인증과 무관**하다. 증명하는 것은 "이 세션에 붙어도 되는가" 하나다.
 */

/** base64url 43자. `?token=` 쿼리스트링에 그대로 실을 수 있다(URL 안전). */
export function generateRecordingToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRecordingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * 저장된 해시와 제시된 토큰을 비교한다.
 *
 * 길이가 다르면 `timingSafeEqual` 이 던지므로 먼저 걸러 낸다. 비교 자체는
 * 항상 타이밍 안전 경로를 탄다(토큰을 한 바이트씩 맞춰 보는 공격 차단).
 */
export function verifyRecordingToken(token: string, storedHash: string | null): boolean {
  if (storedHash === null || storedHash.length === 0) return false;
  const actual = Buffer.from(hashRecordingToken(token), "hex");
  const expected = Buffer.from(storedHash, "hex");
  if (actual.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(actual, expected);
}
