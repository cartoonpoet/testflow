import type { MigrationInterface, QueryRunner } from "typeorm";

/** 002 — scenarios */
export class CreateScenarios1758000000002 implements MigrationInterface {
  name = "CreateScenarios1758000000002";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE scenarios (
        id           CHAR(36)     NOT NULL,
        project_id   CHAR(36)     NOT NULL,
        code         VARCHAR(40)  NOT NULL,
        name         VARCHAR(200) NOT NULL,
        feature      VARCHAR(80)  NULL,
        status       ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
        version      INT UNSIGNED NOT NULL DEFAULT 1,
        -- [AUTHZ] created_by(FK) 대체 자유 텍스트. 회원제 전환 시 created_by CHAR(36) 추가.
        author_name  VARCHAR(50)  NULL,
        -- 목록 '최근 결과' 비정규화. runs 와 상호 참조라 FK 는 걸지 않는다.
        last_run_id  CHAR(36)     NULL,
        created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_scenarios PRIMARY KEY (id),
        CONSTRAINT uq_scenarios_code UNIQUE (project_id, code),
        CONSTRAINT fk_scenarios_project FOREIGN KEY (project_id)
          REFERENCES projects(id) ON DELETE CASCADE,
        INDEX ix_scenarios_project_status (project_id, status),
        INDEX ix_scenarios_feature (project_id, feature)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE scenarios`);
  }
}
