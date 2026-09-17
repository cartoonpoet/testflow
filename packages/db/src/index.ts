/**
 * `@testflow/db` — TypeORM DataSource + 엔티티 + 마이그레이션.
 *
 * API 와 Runner 양쪽이 DB 에 쓴다(runner 가 step_results·artifacts 를 기록한다).
 * 그래서 엔티티를 이 패키지에 모아 공유한다 (ERDify 규약).
 */
export * from "./data-source.js";
export * from "./entities/index.js";
export * from "./migrations/index.js";

/**
 * ★ 로컬 DB 가드(`assertLocalDatabase`)를 재노출한다.
 *
 * 원래는 마이그레이션 CLI 전용이었지만 **API 부팅(`ConfigModule`)에서도 같은 가드가
 * 필요하다** — `@nestjs/config` 역시 이미 설정된 환경변수를 `.env` 로 덮어쓰지 않으므로
 * 셸의 회사 공용 `DB_HOST` 가 그대로 API 에 먹힌다(04-gen-2 전달사항 4번).
 * 가드 로직은 한 군데(`cli/guard.ts`)에만 두고 두 진입점이 공유한다.
 */
export * from "./cli/guard.js";
