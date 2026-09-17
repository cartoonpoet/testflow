import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bullmq";
import { CONFIG_MODULE_OPTIONS } from "./common/config/env.js";
import { buildTypeOrmOptions } from "./common/config/typeorm.config.js";
import { buildRedisOptions } from "./common/config/redis.config.js";
import { RedisModule } from "./common/redis/redis.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { ScenariosModule } from "./modules/scenarios/scenarios.module.js";

/**
 * 루트 모듈.
 *
 * ## 커스텀 exception filter 를 만들지 않는다
 * 서비스에서 Nest 기본 예외(`NotFoundException` / `BadRequestException` / …)를 그대로
 * 던지고 Nest 기본 필터가 `{statusCode, message, error}` 응답을 만든다 (ERDify 규약,
 * 02-context "에러 처리"). → `src/common/filters/` 디렉토리는 **존재하지 않는다.**
 *
 * ## 등록 순서가 중요하다
 * `ConfigModule.forRoot` 가 `.env` 를 읽고 회사 DB 가드를 돌린 **뒤에야** TypeORM /
 * BullMQ 팩토리가 실행돼야 한다. `forRootAsync` + `inject: [ConfigService]` 가 그 순서를
 * 보장한다(팩토리가 ConfigService 를 실제로 쓰지 않아도 의존성 자체가 순서를 만든다).
 */
@Module({
  imports: [
    ConfigModule.forRoot(CONFIG_MODULE_OPTIONS),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (_config: ConfigService) => buildTypeOrmOptions(),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (_config: ConfigService) => ({ connection: buildRedisOptions() }),
    }),

    RedisModule,

    // ── 도메인 모듈 (Gen-Phase 4 범위) ─────────────────────
    HealthModule,
    ProjectsModule,
    ScenariosModule,

    // ── Gen-Phase 5 에서 추가될 모듈 ───────────────────────
    //   RunsModule        (Task 5.1 · 5.2 SSE)
    //   ArtifactsModule   (Task 5.3)
    //   RecordingsModule  (Task 5.4)
    //   SuitesModule      (Task 5.5)
    //   DashboardModule   (Task 5.6)
    // 아직 만들지 않는다 — 빈 모듈을 미리 두면 "구현된 것처럼" 보인다.
  ],
})
export class AppModule {}
