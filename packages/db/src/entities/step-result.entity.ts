import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import type { Relation } from "typeorm";
import { STEP_RESULT_STATUSES } from "@testflow/contracts";
import type { ActionType, StepResultStatus } from "@testflow/contracts";
import type { RunEntity } from "./run.entity.js";
import type { TestStepEntity } from "./test-step.entity.js";
import type { ArtifactEntity } from "./artifact.entity.js";

/**
 * 스텝 실행 결과 1건. 시안 실행 현황 화면의 3-상태 표현(완료 ✓ / 실행중 스피너 / 대기 번호)의 원본.
 *
 * `actionType` 은 `test_steps` 와 달리 VARCHAR 다 — 스텝이 삭제·편집돼도 이력이 남아야 하고,
 * 나중에 enum 이 늘어나도 과거 이력이 깨지지 않게 하기 위한 의도적 선택이다(02-context DDL 그대로).
 */
@Entity({ name: "step_results" })
@Unique("uq_step_results_seq", ["runId", "sequence"])
export class StepResultEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "run_id", type: "char", length: 36 })
  runId!: string;

  /** 스텝이 편집/삭제돼도 이력은 유지한다 → ON DELETE SET NULL */
  @Column({ name: "step_id", type: "char", length: 36, nullable: true })
  stepId!: string | null;

  @Column({ name: "sequence", type: "int", unsigned: true })
  sequence!: number;

  /** 실행 시점 스텝 이름 스냅샷. */
  @Column({ name: "name_snapshot", type: "varchar", length: 200 })
  nameSnapshot!: string;

  @Column({ name: "action_type", type: "varchar", length: 30 })
  actionType!: ActionType;

  @Column({ name: "status", type: "enum", enum: STEP_RESULT_STATUSES, default: "pending" })
  status!: StepResultStatus;

  @Column({ name: "started_at", type: "datetime", precision: 3, nullable: true })
  startedAt!: Date | null;

  @Column({ name: "duration_ms", type: "int", unsigned: true, nullable: true })
  durationMs!: number | null;

  /** ★ 반드시 `mask.ts` 를 통과시킨 뒤 저장한다. */
  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage!: string | null;

  @ManyToOne("RunEntity", (run: RunEntity) => run.stepResults, { onDelete: "CASCADE" })
  @JoinColumn({ name: "run_id" })
  run!: Relation<RunEntity>;

  @ManyToOne("TestStepEntity", { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "step_id" })
  step!: Relation<TestStepEntity> | null;

  @OneToMany("ArtifactEntity", (artifact: ArtifactEntity) => artifact.stepResult)
  artifacts!: Relation<ArtifactEntity[]>;
}
