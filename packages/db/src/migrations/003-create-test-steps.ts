import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 003 — test_steps
 *
 * `target_json` 형태는 `@testflow/contracts` 의 `LocatorTargetSchema` 가 단일 소스다.
 * FR-004 의 role → label → text → testid → (fallback) css 우선순위를 **순위 배열**로 담는다.
 *
 * {
 *   "primary":   {"by":"role",  "role":"button", "name":"로그인", "exact":true},
 *   "fallbacks":[{"by":"label", "value":"로그인"},
 *                {"by":"text",  "value":"로그인"},
 *                {"by":"testid","value":"login-submit"},
 *                {"by":"css",   "value":"form > button.submit"}],   -- 고급 설정에서만 노출
 *   "frameUrl": null,
 *   "snapshot": {"tag":"button","attrs":{...}}                       -- 실패 진단용
 * }
 */
export class CreateTestSteps1758000000003 implements MigrationInterface {
  name = "CreateTestSteps1758000000003";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE test_steps (
        id            CHAR(36)     NOT NULL,
        scenario_id   CHAR(36)     NOT NULL,
        sequence      INT UNSIGNED NOT NULL,
        name          VARCHAR(200) NOT NULL,
        action_type   ENUM('goto','click','fill','select','check','uncheck',
                           'press','hover','assert_visible','assert_text','assert_url','wait')
                      NOT NULL,
        target_json   JSON         NULL,
        input_json    JSON         NULL,
        options_json  JSON         NULL,
        created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_test_steps PRIMARY KEY (id),
        CONSTRAINT uq_test_steps_seq UNIQUE (scenario_id, sequence),
        CONSTRAINT fk_test_steps_scenario FOREIGN KEY (scenario_id)
          REFERENCES scenarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE test_steps`);
  }
}
