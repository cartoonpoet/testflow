import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 프로젝트 관리 화면이 없으므로 기본 프로젝트 1건을 시드로 넣는다.
 * ID 를 고정해 둬야 revert 가 정확히 이 행만 지운다.
 */
export const DEFAULT_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

/**
 * 009 — 기본 프로젝트 시드
 *
 * ★ `base_url` 은 실행 다이얼로그의 **기본값(placeholder)** 일 뿐이다.
 *   실행 시 baseUrl 을 직접 입력받는 것이 주 경로다 (02-context "★ 사용자 최종 결정" (a)).
 *   그래서 일부러 example.com 을 넣는다 — 운영 URL 을 코드에 박지 않는다.
 *
 * 비회원제라 CreateUserID/UpdateUserID 개념은 이 프로젝트에 없다.
 */
export class SeedDefaultProject1758000000009 implements MigrationInterface {
  name = "SeedDefaultProject1758000000009";

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO projects (id, name, base_url, default_env_label) VALUES (?, ?, ?, ?)`,
      [DEFAULT_PROJECT_ID, "기본 프로젝트", "https://staging.example.com", "스테이징"],
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM projects WHERE id = ?`, [DEFAULT_PROJECT_ID]);
  }
}
