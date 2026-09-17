import { Global, Inject, Module } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { buildRedisOptions } from "../config/redis.config.js";

/** DI 토큰. `@Inject(REDIS_CLIENT) private readonly redis: Redis` 로 받는다. */
export const REDIS_CLIENT = "REDIS_CLIENT";

/**
 * 공용 Redis 클라이언트.
 *
 * BullMQ 는 자체 연결을 따로 만들지만(`BullModule`), health 체크·녹화 세션 토큰·
 * 실행 이벤트 pub/sub 은 일반 명령용 클라이언트가 필요하다.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis => new Redis(buildRedisOptions()),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
