import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import type { ProjectEntity } from "./project.entity.js";
import type { SuiteScenarioEntity } from "./suite-scenario.entity.js";

/**
 * 스위트 = 시나리오 묶음.
 * 실행은 `POST /api/runs { suiteId }` 로 하고, 부모 run 없이 `batch_id` 로 묶는다
 * (02-context "규약 메모").
 */
@Entity({ name: "suites" })
export class SuiteEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "project_id", type: "char", length: 36 })
  projectId!: string;

  @Column({ name: "name", type: "varchar", length: 200 })
  name!: string;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime", precision: 3 })
  updatedAt!: Date;

  @ManyToOne("ProjectEntity", (project: ProjectEntity) => project.suites, { onDelete: "CASCADE" })
  @JoinColumn({ name: "project_id" })
  project!: Relation<ProjectEntity>;

  @OneToMany("SuiteScenarioEntity", (link: SuiteScenarioEntity) => link.suite)
  scenarios!: Relation<SuiteScenarioEntity[]>;
}
