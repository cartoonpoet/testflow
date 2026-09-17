import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import { SCENARIO_SOURCE_TYPES, SCENARIO_STATUSES } from "@testflow/contracts";
import type { ScenarioSourceType, ScenarioStatus } from "@testflow/contracts";
import type { ProjectEntity } from "./project.entity.js";
import type { TestStepEntity } from "./test-step.entity.js";

/**
 * 시나리오. 시안 목록 화면 6열(시나리오/기능/상태/최근 결과/수정일/작성자)의 원본이다.
 *
 * [AUTHZ] 비회원제라 `created_by` 가 없다. `authorName` 은 자유 입력 텍스트다.
 */
@Entity({ name: "scenarios" })
@Index("ix_scenarios_project_status", ["projectId", "status"])
@Index("ix_scenarios_feature", ["projectId", "feature"])
export class ScenarioEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "project_id", type: "char", length: 36 })
  projectId!: string;

  /** 자동 채번. 예: `TC-AUTH-001` (`uq_scenarios_code`: project_id + code 유일) */
  @Column({ name: "code", type: "varchar", length: 40 })
  code!: string;

  @Column({ name: "name", type: "varchar", length: 200 })
  name!: string;

  @Column({ name: "feature", type: "varchar", length: 80, nullable: true })
  feature!: string | null;

  @Column({ name: "status", type: "enum", enum: SCENARIO_STATUSES, default: "draft" })
  status!: ScenarioStatus;

  /**
   * 원본 종류. `steps`(녹화 → `test_steps`) / `code`(코드 → `scenario_codes`).
   *
   * 마이그레이션 011 이 기존 행을 전부 `steps` 로 백필한다.
   * ★ 생성 후 변경하지 않는다 — 스텝과 코드가 동시에 존재하면 실행 규칙이 두 벌이 된다.
   */
  @Column({ name: "source_type", type: "enum", enum: SCENARIO_SOURCE_TYPES, default: "steps" })
  sourceType!: ScenarioSourceType;

  @Column({ name: "version", type: "int", unsigned: true, default: 1 })
  version!: number;

  @Column({ name: "author_name", type: "varchar", length: 50, nullable: true })
  authorName!: string | null;

  /**
   * 목록 '최근 결과' 조회 성능을 위한 비정규화 컬럼.
   * runs 와 상호 참조가 되므로 FK 는 걸지 않는다(순환 제약 회피).
   */
  @Column({ name: "last_run_id", type: "char", length: 36, nullable: true })
  lastRunId!: string | null;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime", precision: 3 })
  updatedAt!: Date;

  @ManyToOne("ProjectEntity", (project: ProjectEntity) => project.scenarios, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "project_id" })
  project!: Relation<ProjectEntity>;

  @OneToMany("TestStepEntity", (step: TestStepEntity) => step.scenario)
  steps!: Relation<TestStepEntity[]>;
}
