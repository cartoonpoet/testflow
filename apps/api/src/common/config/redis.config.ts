/**
 * Redis 연결 설정 (BullMQ 큐 · 실행 이벤트 pub/sub · Runner heartbeat 공용).
 *
 * ★ 반환 타입을 ioredis 의 `RedisOptions` 로 선언하지 않는다.
 *   bullmq 6 는 **자체 `RedisOptions` 인터페이스**를 들고 있어서 ioredis 6 의 타입을
 *   그대로 넘기면 union 매칭에 실패한다(`RedisConnectionClient` 쪽으로 좁혀져
 *   "connect/duplicate 가 없다"는 에러가 난다). 두 패키지가 공통으로 받아들이는
 *   **평범한 객체 타입**을 직접 정의해 양쪽에 넘긴다.
 *
 * `process.env` 는 `ConfigModule.forRoot` 가 확정한 뒤의 값이다.
 */
export interface RedisConnectionConfig {
  host: string;
  port: number;
  /** BullMQ Worker 요구사항. 같은 Redis 를 공유하므로 클라이언트도 동일하게 맞춘다. */
  maxRetriesPerRequest: null;
  /** health 체크가 Redis 다운 시 영원히 매달리지 않도록 재시도 간격에 상한을 둔다. */
  retryStrategy: (times: number) => number;
}

export function buildRedisOptions(): RedisConnectionConfig {
  return {
    host: process.env["REDIS_HOST"] ?? "127.0.0.1",
    port: Number(process.env["REDIS_PORT"] ?? 6379),
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  };
}
