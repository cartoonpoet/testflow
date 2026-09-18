import {
  generateStreamToken,
  hashStreamToken,
  matchesStreamTokenHash,
} from "../../common/utils/stream-token.js";

/**
 * ★ 녹화 세션 토큰 — 발급(API)과 검증(Runner)의 단일 규약.
 *
 * ## 라운드 2에서 바뀐 것 (03-phases Task 2.5)
 * 해시·비교 구현이 **`common/utils/stream-token.ts` 로 일반화**됐다. 실행 라이브 스트림
 * (`testflow:run:token:`)이 같은 규약을 써야 하는데 **복사하면 두 벌이 어긋난다**(쟁점 3).
 * 이 파일은 이제 녹화 경로의 **이름만 유지하는 얇은 위임**이다 —
 * **동작·키 접두사(`testflow:rec:token:`)·TTL(600초)은 한 글자도 바뀌지 않았다.**
 * `recording-token.spec.ts` 9건이 그 사실의 안전망이다(수정하지 않았다).
 *
 * Gen-Phase 7(Task 7.2)의 WS 서버는 여전히 아래 규약을 그대로 구현하면 된다. 규약 전문은
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
  return generateStreamToken();
}

export function hashRecordingToken(token: string): string {
  return hashStreamToken(token);
}

/**
 * 저장된 해시와 제시된 토큰을 비교한다.
 *
 * 길이가 다르면 `timingSafeEqual` 이 던지므로 먼저 걸러 낸다. 비교 자체는
 * 항상 타이밍 안전 경로를 탄다(토큰을 한 바이트씩 맞춰 보는 공격 차단).
 */
export function verifyRecordingToken(token: string, storedHash: string | null): boolean {
  return matchesStreamTokenHash(token, storedHash);
}
