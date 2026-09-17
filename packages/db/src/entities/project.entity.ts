import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import type { ScenarioEntity } from "./scenario.entity.js";
import type { SuiteEntity } from "./suite.entity.js";
import type { RunEntity } from "./run.entity.js";

/**
 * 프로젝트. MVP 에는 관리 화면이 없고 마이그레이션 시드 1건만 존재한다.
 *
 * ★ `baseUrl` 은 실행 다이얼로그의 **기본값(placeholder)** 용도다.
 *   실행 시 baseUrl 을 직접 입력받는 것이 주 경로다 (02-context "★ 사용자 최종 결정" (a)).
 *
 * ★ 변수·Secret 을 담는 `project_variables` 테이블은 **만들지 않는다**.
 *   계정·비밀번호는 실행 요청 body 로 받고 DB 에 평문 저장하지 않는다 (동 (c)).
 *
 * [AUTHZ] 회원제 전환 시: owner_user_id / organization_id NULL 컬럼 추가 + project_members 신설.
 *
 * 클래스 이름에 `Entity` 접미사를 붙인 이유: `@testflow/contracts` 가 같은 이름의
 * 타입(`Project`, `Scenario`, `TestStep` …)을 내보내므로 접미사 없이는 api/runner 에서 충돌한다.
 */
@Entity({ name: "projects" })
export class ProjectEntity {
  /** DB 상 실제 타입은 CHAR(36) 이다 (마이그레이션 001 참조). */
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "name", type: "varchar", length: 100 })
  name!: string;

  @Column({ name: "base_url", type: "varchar", length: 500 })
  baseUrl!: string;

  @Column({ name: "default_env_label", type: "varchar", length: 50, default: "스테이징" })
  defaultEnvLabel!: string;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime", precision: 3 })
  updatedAt!: Date;

  @OneToMany("ScenarioEntity", (scenario: ScenarioEntity) => scenario.project)
  scenarios!: Relation<ScenarioEntity[]>;

  @OneToMany("SuiteEntity", (suite: SuiteEntity) => suite.project)
  suites!: Relation<SuiteEntity[]>;

  @OneToMany("RunEntity", (run: RunEntity) => run.project)
  runs!: Relation<RunEntity[]>;
}
