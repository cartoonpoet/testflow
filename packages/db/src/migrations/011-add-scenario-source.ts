import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 011 — 코드 시나리오 (라운드 2 Gen-Phase 1 / 03-phases 쟁점 1)
 *
 * 세 가지를 한다.
 *
 * ### ① `scenarios.source_type` 추가 — 기존 행은 `steps` 로 백필된다
 * `NOT NULL DEFAULT 'steps'` 로 추가하므로 **기존 행 전부가 `steps` 로 채워진다.**
 * 별도 `UPDATE` 를 돌리지 않는 이유: MySQL 8 의 `ADD COLUMN … NOT NULL DEFAULT`는
 * **INSTANT** 알고리즘으로 끝난다. 뒤에 no-op `UPDATE` 를 붙이면 테이블을 통째로 다시 쓰게 되어
 * 그 이점을 스스로 버린다. (백필 여부는 적용 후 `SELECT source_type, COUNT(*)` 로 확인한다.)
 *
 * ### ② `scenario_codes` 신규 테이블 — 코드 본문 1:1
 * `scenarios` 에 `MEDIUMTEXT` 를 붙이지 않는다. TypeORM `find()` 가 전 컬럼을 선택하므로
 * 목록 화면(페이지당 20행, 라운드 1 실측 p95 6.3ms)이 코드 본문을 통째로 끌고 오게 된다.
 *
 * **확장 지점**: PK 는 `scenario_id` 가 아니라 자체 `id` 이고, 1:1 은
 * `uq_scenario_codes_scenario` UNIQUE **하나로만** 강제한다. 다중 파일이 필요해지면
 * 그 제약을 `(scenario_id, filename)` 으로 바꾸는 마이그레이션 하나로 1:N 이 된다.
 *
 * ### ③ `runs.source_type` 스냅샷 컬럼
 * 화면이 "이 실행은 코드 실행인가"를 알아야 라이브 뷰를 열지, 대기 행을 그릴지 판단한다.
 * `scenarios` 를 조인하지 않고 **실행 시점 스냅샷**으로 두는 이유는 라운드 1의
 * `scenario_name`·`base_url` 스냅샷과 같다 — **시나리오가 삭제돼도 이력이 남아야 한다**
 * (`runs.scenario_id` 는 NULL 이 될 수 있다). 03-phases Task 2.6 의 권고를 따랐다.
 * 이 컬럼을 채우고 응답에 노출하는 배선은 Gen-Phase 2 Task 2.6 이 한다.
 *
 * DDL 스타일·제약 명명(`pk_`·`fk_`·`uq_`)·문자셋은 001~010 과 동일하다(ERDify 규약).
 */
export class AddScenarioSource1758000000011 implements MigrationInterface {
  name = "AddScenarioSource1758000000011";

  async up(q: QueryRunner): Promise<void> {
    // ① 기존 행은 DEFAULT 로 'steps' 백필된다.
    await q.query(`
      ALTER TABLE scenarios
        ADD COLUMN source_type ENUM('steps','code') NOT NULL DEFAULT 'steps' AFTER status
    `);

    // ② 코드 본문 1:1 테이블.
    await q.query(`
      CREATE TABLE scenario_codes (
        id           CHAR(36)     NOT NULL,
        scenario_id  CHAR(36)     NOT NULL,
        -- Runner 작업 디렉토리에 실제 파일로 쓰인다. 경로 문자는 API 가 막는다.
        filename     VARCHAR(255) NOT NULL,
        content      MEDIUMTEXT   NOT NULL,
        -- UTF-8 바이트 수. 본문을 읽지 않고 크기를 알기 위한 비정규화 컬럼.
        size_bytes   INT UNSIGNED NOT NULL,
        created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_scenario_codes PRIMARY KEY (id),
        -- ★ 1:1 은 이 제약 하나로만 강제한다. 1:N 으로 넓히려면 (scenario_id, filename) 로 바꾸면 된다.
        CONSTRAINT uq_scenario_codes_scenario UNIQUE (scenario_id),
        CONSTRAINT fk_scenario_codes_scenario FOREIGN KEY (scenario_id)
          REFERENCES scenarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // ③ 실행 시점 스냅샷 — 시나리오가 삭제돼도 남는다.
    await q.query(`
      ALTER TABLE runs
        ADD COLUMN source_type ENUM('steps','code') NOT NULL DEFAULT 'steps' AFTER browser
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    // up() 의 역순. FK 를 가진 테이블을 먼저 지운다.
    await q.query(`ALTER TABLE runs DROP COLUMN source_type`);
    await q.query(`DROP TABLE scenario_codes`);
    await q.query(`ALTER TABLE scenarios DROP COLUMN source_type`);
  }
}
