import { createDataSourceOptions } from "@testflow/db";
import type { TypeOrmModuleOptions } from "@nestjs/typeorm";

/**
 * TypeORM 연결 옵션.
 *
 * `packages/db` 의 `createDataSourceOptions()` 를 **그대로** 재사용한다. API 와
 * 마이그레이션 CLI 가 서로 다른 옵션으로 붙으면 "마이그레이션은 됐는데 API 는 못 읽는"
 * 상태가 생긴다.
 *
 * - `synchronize:false` / `migrationsRun:false` 는 db 패키지에서 이미 고정돼 있다.
 * - `autoLoadEntities` 를 쓰지 않는다. 엔티티는 db 패키지의 **명시 배열 9개**다
 *   (03-phases Task 4.2).
 * - 이 함수가 읽는 `process.env` 는 `ConfigModule.forRoot` 가 이미 확정해 둔 값이다
 *   (`forRootAsync` + `inject: [ConfigService]` 로 순서를 보장한다).
 */
export function buildTypeOrmOptions(): TypeOrmModuleOptions {
  return {
    ...createDataSourceOptions(),
    autoLoadEntities: false,
  } as TypeOrmModuleOptions;
}
