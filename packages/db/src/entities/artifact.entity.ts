import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import { ARTIFACT_TYPES } from "@testflow/contracts";
import type { ArtifactType } from "@testflow/contracts";
import type { RunEntity } from "./run.entity.js";
import type { StepResultEntity } from "./step-result.entity.js";

/**
 * 증적(FR-008). 영상·trace 는 run 단위(`stepResultId` NULL), 스크린샷은 스텝 단위다.
 *
 * `storageKey` 는 어댑터 무관 논리 키다(`runs/<runId>/step-03.png`).
 * API 가 파일을 서빙할 때 **경로 순회 방어**를 반드시 한다 — `StorageKeySchema` 검증 +
 * resolve 후 `ARTIFACT_ROOT` 접두 검사.
 *
 * 보존 정책 자동 만료는 MVP 제외. 도입 시 `expires_at DATETIME(3)` 추가 + 배치 삭제.
 */
@Entity({ name: "artifacts" })
@Index("ix_artifacts_run_type", ["runId", "artifactType"])
export class ArtifactEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "run_id", type: "char", length: 36 })
  runId!: string;

  @Column({ name: "step_result_id", type: "char", length: 36, nullable: true })
  stepResultId!: string | null;

  @Column({ name: "artifact_type", type: "enum", enum: ARTIFACT_TYPES })
  artifactType!: ArtifactType;

  @Column({ name: "storage_key", type: "varchar", length: 500 })
  storageKey!: string;

  @Column({ name: "content_type", type: "varchar", length: 100 })
  contentType!: string;

  @Column({ name: "size_bytes", type: "bigint", unsigned: true, nullable: true })
  sizeBytes!: string | null;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @ManyToOne("RunEntity", { onDelete: "CASCADE" })
  @JoinColumn({ name: "run_id" })
  run!: Relation<RunEntity>;

  @ManyToOne("StepResultEntity", (result: StepResultEntity) => result.artifacts, {
    onDelete: "CASCADE",
    nullable: true,
  })
  @JoinColumn({ name: "step_result_id" })
  stepResult!: Relation<StepResultEntity> | null;
}
