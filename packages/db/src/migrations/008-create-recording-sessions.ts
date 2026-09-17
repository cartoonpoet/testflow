import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 008 — recording_sessions (FR-002)
 *
 * Redis 에 둘 수도 있으나, 세션 중단 시 스텝 초안이 사라지면 테스터 작업이 통째로 날아간다.
 * **초안 보존이 목적이므로 DB 에 둔다.**
 */
export class CreateRecordingSessions1758000000008 implements MigrationInterface {
  name = "CreateRecordingSessions1758000000008";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE recording_sessions (
        id            CHAR(36)     NOT NULL,
        scenario_id   CHAR(36)     NOT NULL,
        status        ENUM('live','stopped','expired','error') NOT NULL DEFAULT 'live',
        start_url     VARCHAR(500) NOT NULL,
        viewport_w    INT UNSIGNED NOT NULL DEFAULT 1280,
        viewport_h    INT UNSIGNED NOT NULL DEFAULT 800,
        runner_id     VARCHAR(60)  NULL,
        draft_steps   JSON         NULL,
        started_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        last_seen_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        stopped_at    DATETIME(3)  NULL,
        CONSTRAINT pk_recording_sessions PRIMARY KEY (id),
        CONSTRAINT fk_recording_sessions_scenario FOREIGN KEY (scenario_id)
          REFERENCES scenarios(id) ON DELETE CASCADE,
        INDEX ix_recording_sessions_status (status, last_seen_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE recording_sessions`);
  }
}
