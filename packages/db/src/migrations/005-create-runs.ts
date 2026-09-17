import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 005 — runs
 *
 * ★ `variables` 컬럼이 없다. 실행 변수(계정·비밀번호)는 Redis 큐 페이로드에만 존재하고
 *   DB 에는 남기지 않는다 (02-context "★ 사용자 최종 결정" (c) 파생 영향).
 *   나중에 "어떤 키를 썼는가"를 남길 필요가 생기면 Secret 값이 `'***'` 로 치환된
 *   `variables_masked JSON NULL` 컬럼을 추가하는 마이그레이션을 새로 만든다.
 *
 * 스위트 실행은 부모 run 없이 `batch_id` 로 묶는다 → step_results 구조를
 * 단일 시나리오 실행과 동일하게 유지할 수 있다.
 */
export class CreateRuns1758000000005 implements MigrationInterface {
  name = "CreateRuns1758000000005";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE runs (
        id             CHAR(36)     NOT NULL,
        run_code       VARCHAR(30)  NOT NULL,
        project_id     CHAR(36)     NOT NULL,
        scenario_id    CHAR(36)     NULL,
        suite_id       CHAR(36)     NULL,
        batch_id       CHAR(36)     NULL,
        scenario_name  VARCHAR(200) NOT NULL,
        env_label      VARCHAR(50)  NOT NULL,
        base_url       VARCHAR(500) NOT NULL,
        browser        VARCHAR(20)  NOT NULL DEFAULT 'chromium',
        status         ENUM('queued','running','passed','failed','cancelled','timeout','error')
                       NOT NULL DEFAULT 'queued',
        runner_id      VARCHAR(60)  NULL,
        total_steps    INT UNSIGNED NOT NULL DEFAULT 0,
        passed_steps   INT UNSIGNED NOT NULL DEFAULT 0,
        failed_seq     INT UNSIGNED NULL,
        error_message  TEXT         NULL,
        queued_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        started_at     DATETIME(3)  NULL,
        finished_at    DATETIME(3)  NULL,
        duration_ms    INT UNSIGNED NULL,
        CONSTRAINT pk_runs PRIMARY KEY (id),
        CONSTRAINT uq_runs_code UNIQUE (run_code),
        CONSTRAINT fk_runs_project  FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE CASCADE,
        CONSTRAINT fk_runs_scenario FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE SET NULL,
        CONSTRAINT fk_runs_suite    FOREIGN KEY (suite_id)    REFERENCES suites(id)    ON DELETE SET NULL,
        INDEX ix_runs_project_queued (project_id, queued_at DESC),
        INDEX ix_runs_scenario (scenario_id, queued_at DESC),
        INDEX ix_runs_batch (batch_id)
        -- [AUTHZ] 회원제 전환 시: triggered_by CHAR(36) NULL 추가 (누가 실행했는가)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE runs`);
  }
}
