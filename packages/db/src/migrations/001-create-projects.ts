import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 001 — projects
 *
 * ★ 02-context DDL 초안에 있던 `project_variables` 테이블은 **만들지 않는다.**
 *   계정·비밀번호는 실행 요청 body 로 받고 DB 에 저장하지 않기로 확정했다
 *   (02-context "★ 사용자 최종 결정" (c)). AES 암호화 컬럼도 함께 사라졌다.
 */
export class CreateProjects1758000000001 implements MigrationInterface {
  name = "CreateProjects1758000000001";

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE projects (
        id                 CHAR(36)     NOT NULL,
        name               VARCHAR(100) NOT NULL,
        base_url           VARCHAR(500) NOT NULL,
        default_env_label  VARCHAR(50)  NOT NULL DEFAULT '스테이징',
        created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        CONSTRAINT pk_projects PRIMARY KEY (id)
        -- [AUTHZ] 회원제 전환 시: owner_user_id CHAR(36) NULL, organization_id CHAR(36) NULL 추가
        --         + project_members(project_id, user_id, role) 테이블 신설
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE projects`);
  }
}
