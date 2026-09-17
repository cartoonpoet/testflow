import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import { RECORDING_STATUSES } from "@testflow/contracts";
import type { DraftSteps, RecordingStatus } from "@testflow/contracts";
import type { ScenarioEntity } from "./scenario.entity.js";

/**
 * 녹화 세션.
 *
 * Redis 에 둘 수도 있으나, 세션이 끊겼을 때 스텝 초안이 사라지면 테스터 작업이 통째로 날아간다.
 * **초안 보존이 목적**이라 DB 에 둔다 (02-context DDL 위 설계 주석).
 *
 * `draftSteps` 의 형태는 `DraftStepsSchema`(= `DraftStep[]`) 다.
 */
@Entity({ name: "recording_sessions" })
@Index("ix_recording_sessions_status", ["status", "lastSeenAt"])
export class RecordingSessionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "scenario_id", type: "char", length: 36 })
  scenarioId!: string;

  @Column({ name: "status", type: "enum", enum: RECORDING_STATUSES, default: "live" })
  status!: RecordingStatus;

  @Column({ name: "start_url", type: "varchar", length: 500 })
  startUrl!: string;

  /** ★ screencast 의 `size` 와 반드시 같아야 한다. 다르면 클릭 좌표 변환이 깨진다. */
  @Column({ name: "viewport_w", type: "int", unsigned: true, default: 1280 })
  viewportW!: number;

  @Column({ name: "viewport_h", type: "int", unsigned: true, default: 800 })
  viewportH!: number;

  @Column({ name: "runner_id", type: "varchar", length: 60, nullable: true })
  runnerId!: string | null;

  /** 확정 전 스텝 초안 배열. 세션 중 주기적으로 갱신한다. */
  @Column({ name: "draft_steps", type: "json", nullable: true })
  draftSteps!: DraftSteps | null;

  @CreateDateColumn({ name: "started_at", type: "datetime", precision: 3 })
  startedAt!: Date;

  /** 유휴 타임아웃 판정 기준. 청소 배치가 `ix_recording_sessions_status` 로 훑는다. */
  @UpdateDateColumn({ name: "last_seen_at", type: "datetime", precision: 3 })
  lastSeenAt!: Date;

  @Column({ name: "stopped_at", type: "datetime", precision: 3, nullable: true })
  stoppedAt!: Date | null;

  @ManyToOne("ScenarioEntity", { onDelete: "CASCADE" })
  @JoinColumn({ name: "scenario_id" })
  scenario!: Relation<ScenarioEntity>;
}
