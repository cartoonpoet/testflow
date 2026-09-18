import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 012 — 시나리오 첨부파일(테스트 데이터) 메타 테이블 (라운드 3).
 *
 * ## 왜 필요한가
 * 사용자의 실제 테스트 10건 중 8건이 `setInputFiles('테스트용 파일-1.docx')` 를 쓴다.
 * 코드 본문만 저장해서는 그 코드가 절대 돌지 않는다 — 실행 디렉토리에 **파일 실물**이
 * 있어야 한다. 그 실물의 메타데이터가 여기에 산다.
 *
 * ## 바이트는 DB 에 넣지 않는다
 * 파일 내용은 `ARTIFACT_ROOT/scenario-attachments/<scenarioId>/<attachmentId>.bin` 에
 * 디스크로 저장한다. `artifacts` 테이블이 이미 쓰는 **"메타는 DB · 바이트는 디스크"**
 * 규약과 같다. 개당 10MiB 짜리를 `MEDIUMBLOB` 으로 넣으면 `max_allowed_packet` 과
 * 버퍼풀을 정면으로 때린다 (엔티티 JSDoc 에 근거 3가지를 적었다).
 *
 * ## `scenarios` 의 컬럼이 아니라 별도 테이블인 이유
 * `scenario_codes`(011) 와 같은 논리다 — `scenarios` 는 목록이 페이지당 20행 읽는 뜨거운
 * 테이블이고 TypeORM `find()` 는 전 컬럼을 선택한다. 목록 쿼리가 이 테이블을 조인하지 않는다.
 *
 * ## ★ `filename` 은 **한글을 담는다**
 * `utf8mb4` 라 `테스트용 파일-1.docx` 가 그대로 들어간다. 이 이름은 Runner 작업 디렉토리에
 * **실제 파일로 쓰인다** — 사용자 코드에 적힌 이름과 한 글자도 달라서는 안 된다.
 * 경로 문자·제어문자는 API 의 `AttachmentFilenameSchema` 가 막고 Runner 가 한 번 더 막는다.
 *
 * ## ★ `(scenario_id, filename)` UNIQUE 를 두는 이유
 * 같은 이름이 2건이면 Runner 가 작업공간에 **무엇을 쓸지 정할 수 없다**(실행이
 * 비결정적이 된다). 같은 이름을 다시 올리면 **덮어쓰기**가 되도록 이 제약으로 강제한다.
 * 인덱스 길이는 `36 + 255*4 = 1056`바이트로 InnoDB DYNAMIC 의 3072 한도 안이다.
 *
 * DDL 스타일·제약 명명(`pk_`·`fk_`·`uq_`·`ix_`)·문자셋은 001~011 과 동일하다(ERDify 규약).
 */
export class CreateScenarioAttachments1758000000012 implements MigrationInterface {
  name = "CreateScenarioAttachments1758000000012";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE scenario_attachments (
        id           CHAR(36)     NOT NULL,
        scenario_id  CHAR(36)     NOT NULL,
        -- ★ 원본 파일명 그대로(한글·공백 포함). Runner 작업 디렉토리에 이 이름으로 쓰인다.
        filename     VARCHAR(255) NOT NULL,
        -- 다운로드 응답의 Content-Type. 헤더에 그대로 실리므로 토큰 문법만 저장한다.
        content_type VARCHAR(255) NOT NULL,
        size_bytes   INT UNSIGNED NOT NULL,
        -- scenario-attachments/<scenarioId>/<attachmentId>.bin — 사용자 문자열이 들어가지 않는다.
        storage_key  VARCHAR(500) NOT NULL,
        created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_scenario_attachments PRIMARY KEY (id),
        -- ★ 같은 이름 2건을 구조적으로 막는다(덮어쓰기가 된다).
        CONSTRAINT uq_scenario_attachments_name UNIQUE (scenario_id, filename),
        CONSTRAINT fk_scenario_attachments_scenario FOREIGN KEY (scenario_id)
          REFERENCES scenarios(id) ON DELETE CASCADE,
        INDEX ix_scenario_attachments_scenario (scenario_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    // ★ 테이블만 지운다. 디스크의 파일(`ARTIFACT_ROOT/scenario-attachments/**`)은 남는다 —
    //   마이그레이션 롤백이 사용자 데이터를 지우게 만들지 않는다(증적도 같은 규율이다).
    await q.query(`DROP TABLE scenario_attachments`);
  }
}
