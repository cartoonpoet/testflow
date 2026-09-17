import "reflect-metadata";
import { DataSource } from "typeorm";
import type { DataSourceOptions } from "typeorm";
import { entities } from "./entities/index.js";
import { migrations } from "./migrations/index.js";

/**
 * MySQL 8.4 DataSource.
 *
 * 규율 (ERDify 차용):
 * - `synchronize: false` 고정. 스키마 변경은 **전부 마이그레이션**으로만 한다.
 * - `migrationsRun: false`. 기동 시 자동 실행하지 않는다(명시적으로 CLI 로 돌린다).
 * - 엔티티·마이그레이션은 glob 이 아니라 **명시 배열**로 등록한다.
 *
 * ★ env 는 bracket 접근이다 (`noPropertyAccessFromIndexSignature`).
 * ★ 기본 포트가 3307 인 이유: 개발 머신의 3306 을 다른 프로젝트 MySQL 이 점유하고 있다
 *   (04-gen-1 이슈 6번).
 */
export const DEFAULT_DB_PORT = 3307;

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

export function createDataSourceOptions(
  overrides: Partial<DataSourceOptions> = {},
): DataSourceOptions {
  const base = {
    type: "mysql",
    host: env("DB_HOST", "127.0.0.1"),
    port: Number(env("DB_PORT", String(DEFAULT_DB_PORT))),
    username: env("DB_USER", "root"),
    password: env("DB_PW", "testflow_local"),
    database: env("DB_NAME", "testflow"),
    charset: "utf8mb4_0900_ai_ci",
    timezone: "Z",
    // 스키마 자동 동기화 금지. 이 값을 true 로 바꾸는 PR 은 반려 대상이다.
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: "typeorm_migrations",
    entities: [...entities],
    migrations: [...migrations],
    logging: env("DB_LOGGING", "false") === "true" ? ["query", "error"] : ["error"],
    // 날짜를 문자열이 아니라 Date 로 받는다(mysql2 기본 동작 유지).
    supportBigNumbers: true,
    bigNumberStrings: true,
  } satisfies DataSourceOptions;

  return { ...base, ...overrides } as DataSourceOptions;
}

/** 애플리케이션/CLI 공용 DataSource. 생성만 하고 연결은 하지 않는다. */
export const AppDataSource = new DataSource(createDataSourceOptions());
