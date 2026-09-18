import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import type { Relation } from "typeorm";
import { BROWSERS, RUN_STATUSES, SCENARIO_SOURCE_TYPES } from "@testflow/contracts";
import type { Browser, RunStatus, ScenarioSourceType } from "@testflow/contracts";
import type { ProjectEntity } from "./project.entity.js";
import type { ScenarioEntity } from "./scenario.entity.js";
import type { SuiteEntity } from "./suite.entity.js";
import type { StepResultEntity } from "./step-result.entity.js";

/**
 * 실행 1건.
 *
 * ★ `variables` 컬럼이 **없다.** 계정·비밀번호를 포함한 실행 변수는 DB 에 저장하지 않고
 *   Redis 큐 페이로드에만 존재하며 실행 완료 후 만료된다
 *   (02-context "★ 사용자 최종 결정" (c) 파생 영향).
 *
 * `scenarioName` / `baseUrl` 은 실행 시점 스냅샷이다. 시나리오를 편집·삭제해도
 * "그때 무엇을 실행했는지"가 그대로 남아야 하기 때문에 정규화보다 재현성을 택했다.
 *
 * [AUTHZ] 회원제 전환 시: triggered_by CHAR(36) NULL 추가.
 */
@Entity({ name: "runs" })
@Unique("uq_runs_code", ["runCode"])
@Index("ix_runs_project_queued", ["projectId", "queuedAt"])
@Index("ix_runs_scenario", ["scenarioId", "queuedAt"])
@Index("ix_runs_batch", ["batchId"])
export class RunEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 시안 표시용. 예: `RUN-2431` */
  @Column({ name: "run_code", type: "varchar", length: 30 })
  runCode!: string;

  @Column({ name: "project_id", type: "char", length: 36 })
  projectId!: string;

  /** 시나리오가 삭제돼도 이력은 남긴다 → ON DELETE SET NULL */
  @Column({ name: "scenario_id", type: "char", length: 36, nullable: true })
  scenarioId!: string | null;

  @Column({ name: "suite_id", type: "char", length: 36, nullable: true })
  suiteId!: string | null;

  /** 스위트 1회 실행 = 같은 batch_id 를 가진 run N 건. 부모 run 은 만들지 않는다. */
  @Column({ name: "batch_id", type: "char", length: 36, nullable: true })
  batchId!: string | null;

  @Column({ name: "scenario_name", type: "varchar", length: 200 })
  scenarioName!: string;

  @Column({ name: "env_label", type: "varchar", length: 50 })
  envLabel!: string;

  /** 실행 시점 값 고정(재현성). 실행 다이얼로그에서 직접 입력받은 값이다. */
  @Column({ name: "base_url", type: "varchar", length: 500 })
  baseUrl!: string;

  @Column({ name: "browser", type: "varchar", length: 20, default: BROWSERS[0] })
  browser!: Browser;

  /**
   * 실행 시점 **스냅샷** — 이 실행이 녹화 스텝을 돌린 것인지 사용자 코드를 돌린 것인지.
   *
   * `scenarios` 를 조인하지 않는 이유는 `scenarioName`·`baseUrl` 과 같다:
   * **시나리오가 삭제돼도 이력이 남아야 한다**(`scenario_id` 는 NULL 이 될 수 있다).
   * 화면이 이 값으로 "라이브 뷰를 열지 / 대기 행을 그릴지"를 가른다.
   * 채우기·응답 노출 배선은 Gen-Phase 2 Task 2.6 이 한다(마이그레이션 011 이 컬럼을 이미 만든다).
   */
  @Column({ name: "source_type", type: "enum", enum: SCENARIO_SOURCE_TYPES, default: "steps" })
  sourceType!: ScenarioSourceType;

  @Column({ name: "status", type: "enum", enum: RUN_STATUSES, default: "queued" })
  status!: RunStatus;

  @Column({ name: "runner_id", type: "varchar", length: 60, nullable: true })
  runnerId!: string | null;

  @Column({ name: "total_steps", type: "int", unsigned: true, default: 0 })
  totalSteps!: number;

  @Column({ name: "passed_steps", type: "int", unsigned: true, default: 0 })
  passedSteps!: number;

  @Column({ name: "failed_seq", type: "int", unsigned: true, nullable: true })
  failedSeq!: number | null;

  /** ★ 반드시 `mask.ts` 를 통과시킨 뒤 저장한다 (Playwright 에러에 입력값이 실려 나온다). */
  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: "queued_at", type: "datetime", precision: 3 })
  queuedAt!: Date;

  @Column({ name: "started_at", type: "datetime", precision: 3, nullable: true })
  startedAt!: Date | null;

  @Column({ name: "finished_at", type: "datetime", precision: 3, nullable: true })
  finishedAt!: Date | null;

  @Column({ name: "duration_ms", type: "int", unsigned: true, nullable: true })
  durationMs!: number | null;

  @ManyToOne("ProjectEntity", (project: ProjectEntity) => project.runs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "project_id" })
  project!: Relation<ProjectEntity>;

  @ManyToOne("ScenarioEntity", { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "scenario_id" })
  scenario!: Relation<ScenarioEntity> | null;

  @ManyToOne("SuiteEntity", { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "suite_id" })
  suite!: Relation<SuiteEntity> | null;

  @OneToMany("StepResultEntity", (result: StepResultEntity) => result.run)
  stepResults!: Relation<StepResultEntity[]>;
}
