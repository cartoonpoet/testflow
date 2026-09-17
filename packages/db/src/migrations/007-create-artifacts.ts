import type { MigrationInterface, QueryRunner } from "typeorm";

/** 007 — artifacts (FR-008). 영상·trace 는 run 단위(step_result_id NULL), 스크린샷은 스텝 단위. */
export class CreateArtifacts1758000000007 implements MigrationInterface {
  name = "CreateArtifacts1758000000007";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE artifacts (
        id              CHAR(36)     NOT NULL,
        run_id          CHAR(36)     NOT NULL,
        step_result_id  CHAR(36)     NULL,
        artifact_type   ENUM('screenshot','video','trace','console_log','network_log') NOT NULL,
        storage_key     VARCHAR(500) NOT NULL,
        content_type    VARCHAR(100) NOT NULL,
        size_bytes      BIGINT UNSIGNED NULL,
        created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_artifacts PRIMARY KEY (id),
        CONSTRAINT fk_artifacts_run  FOREIGN KEY (run_id)         REFERENCES runs(id)         ON DELETE CASCADE,
        CONSTRAINT fk_artifacts_step FOREIGN KEY (step_result_id) REFERENCES step_results(id) ON DELETE CASCADE,
        INDEX ix_artifacts_run_type (run_id, artifact_type)
        -- 보존 정책 자동 만료는 MVP 제외. 도입 시 expires_at DATETIME(3) 추가 + 배치 삭제
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE artifacts`);
  }
}
