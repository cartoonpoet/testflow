import type { MigrationInterface, QueryRunner } from "typeorm";

/** 004 — suites + suite_scenarios */
export class CreateSuites1758000000004 implements MigrationInterface {
  name = "CreateSuites1758000000004";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE suites (
        id          CHAR(36)     NOT NULL,
        project_id  CHAR(36)     NOT NULL,
        name        VARCHAR(200) NOT NULL,
        created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_suites PRIMARY KEY (id),
        CONSTRAINT fk_suites_project FOREIGN KEY (project_id)
          REFERENCES projects(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await q.query(`
      CREATE TABLE suite_scenarios (
        suite_id     CHAR(36)     NOT NULL,
        scenario_id  CHAR(36)     NOT NULL,
        sequence     INT UNSIGNED NOT NULL,
        CONSTRAINT pk_suite_scenarios PRIMARY KEY (suite_id, scenario_id),
        CONSTRAINT fk_suite_scenarios_suite FOREIGN KEY (suite_id)
          REFERENCES suites(id) ON DELETE CASCADE,
        CONSTRAINT fk_suite_scenarios_scenario FOREIGN KEY (scenario_id)
          REFERENCES scenarios(id) ON DELETE CASCADE,
        INDEX ix_suite_scenarios_seq (suite_id, sequence)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE suite_scenarios`);
    await q.query(`DROP TABLE suites`);
  }
}
