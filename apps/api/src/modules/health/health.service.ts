import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { Redis } from "ioredis";
import { RUNNER_HEARTBEAT_KEY_PREFIX } from "@testflow/contracts";
import { REDIS_CLIENT } from "../../common/redis/redis.module.js";

/**
 * `GET /api/health` 응답.
 *
 * 도메인 타입이 아니라 운영용 진단 응답이라 `@testflow/contracts` 에 두지 않았다
 * (web·runner 가 공유하지 않는다).
 */
export interface HealthResponse {
  status: "ok" | "degraded";
  db: "ok" | "down";
  redis: "ok" | "down";
  /** Runner 가 Redis 에 heartbeat 를 쓰기 전까지는 항상 `"down"` 이다(정상). */
  runner: "ok" | "down";
}

/** 의존 컴포넌트가 죽어 있을 때 health 자체가 매달리지 않도록 건 상한. */
const PROBE_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([this.probeDb(), this.probeRedis()]);
    // Runner 판정은 Redis 가 살아 있을 때만 의미가 있다.
    const runner = redis === "ok" ? await this.probeRunner() : "down";

    return {
      // Runner 미기동은 정상 상태다(03-phases Task 4.4 완료 기준).
      status: db === "ok" && redis === "ok" ? "ok" : "degraded",
      db,
      redis,
      runner,
    };
  }

  private async probeDb(): Promise<"ok" | "down"> {
    return this.probe(async () => {
      await this.dataSource.query("SELECT 1");
    });
  }

  private async probeRedis(): Promise<"ok" | "down"> {
    return this.probe(async () => {
      const pong = await this.redis.ping();
      if (pong !== "PONG") throw new Error(`unexpected PING reply: ${pong}`);
    });
  }

  /**
   * Runner heartbeat 키가 하나라도 있으면 `"ok"`.
   *
   * 키를 쓰는 쪽은 `apps/runner` 의 BullMQ Worker 다 (Gen-Phase 6 Task 6.7).
   * 접두사는 `@testflow/contracts` 의 `RUNNER_HEARTBEAT_KEY_PREFIX` 하나를 공유한다.
   * `KEYS` 대신 `SCAN` 을 쓴다(운영 Redis 를 블로킹하지 않기 위해).
   */
  private async probeRunner(): Promise<"ok" | "down"> {
    return this.probe(async () => {
      let cursor = "0";
      for (let i = 0; i < 10; i += 1) {
        const [next, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          `${RUNNER_HEARTBEAT_KEY_PREFIX}*`,
          "COUNT",
          100,
        );
        if (keys.length > 0) return;
        cursor = next;
        if (cursor === "0") break;
      }
      throw new Error("runner heartbeat not found");
    });
  }

  private async probe(fn: () => Promise<void>): Promise<"ok" | "down"> {
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("probe timeout")), PROBE_TIMEOUT_MS),
        ),
      ]);
      return "ok";
    } catch {
      return "down";
    }
  }
}
