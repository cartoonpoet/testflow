import type { MigrationInterface, QueryRunner } from "typeorm";

/** 006 — step_results. `error_message` 는 반드시 Secret 마스킹 후 저장한다. */
export class CreateStepResults1758000000006 implements MigrationInterface {
  name = "CreateStepResults1758000000006";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE step_results (
        id             CHAR(36)     NOT NULL,
        run_id         CHAR(36)     NOT NULL,
        step_id        CHAR(36)     NULL,
        sequence       INT UNSIGNED NOT NULL,
        name_snapshot  VARCHAR(200) NOT NULL,
        action_type    VARCHAR(30)  NOT NULL,
        status         ENUM('pending','running','passed','failed','skipped') NOT NULL DEFAULT 'pending',
        started_at     DATETIME(3)  NULL,
        duration_ms    INT UNSIGNED NULL,
        error_message  TEXT         NULL,
        CONSTRAINT pk_step_results PRIMARY KEY (id),
        CONSTRAINT uq_step_results_seq UNIQUE (run_id, sequence),
        CONSTRAINT fk_step_results_run  FOREIGN KEY (run_id)  REFERENCES runs(id)       ON DELETE CASCADE,
        CONSTRAINT fk_step_results_step FOREIGN KEY (step_id) REFERENCES test_steps(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE step_results`);
  }
}
