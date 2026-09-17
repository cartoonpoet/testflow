import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import type { Relation } from "typeorm";
import type { SuiteEntity } from "./suite.entity.js";
import type { ScenarioEntity } from "./scenario.entity.js";

/** 스위트 ↔ 시나리오 조인 테이블. 복합 PK(suite_id, scenario_id) + 실행 순서. */
@Entity({ name: "suite_scenarios" })
@Index("ix_suite_scenarios_seq", ["suiteId", "sequence"])
export class SuiteScenarioEntity {
  @PrimaryColumn({ name: "suite_id", type: "char", length: 36 })
  suiteId!: string;

  @PrimaryColumn({ name: "scenario_id", type: "char", length: 36 })
  scenarioId!: string;

  @Column({ name: "sequence", type: "int", unsigned: true })
  sequence!: number;

  @ManyToOne("SuiteEntity", (suite: SuiteEntity) => suite.scenarios, { onDelete: "CASCADE" })
  @JoinColumn({ name: "suite_id" })
  suite!: Relation<SuiteEntity>;

  @ManyToOne("ScenarioEntity", { onDelete: "CASCADE" })
  @JoinColumn({ name: "scenario_id" })
  scenario!: Relation<ScenarioEntity>;
}
