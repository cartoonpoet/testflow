import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import { ACTION_TYPES } from "@testflow/contracts";
import type { ActionType, LocatorTarget, TestStepInput, TestStepOptions } from "@testflow/contracts";
import type { ScenarioEntity } from "./scenario.entity.js";

/**
 * 시나리오 스텝.
 *
 * JSON 컬럼 3종의 형태는 전부 `@testflow/contracts` 의 zod 스키마가 단일 소스다.
 * - `targetJson`  → `LocatorTargetSchema` (primary + fallbacks 순위 배열, FR-004)
 * - `inputJson`   → `TestStepInputSchema` (`{value, isSecret}`)
 * - `optionsJson` → `TestStepOptionsSchema` (`{timeoutMs, optional, waitMs?}`)
 *
 * ★ `targetJson.fallbacks` 의 `by:'css'` 항목은 API 응답에서 기본 제외한다
 *   (`toPublicLocatorTarget()`). 테스터 화면에 CSS Selector 를 노출하지 않는다.
 */
@Entity({ name: "test_steps" })
@Unique("uq_test_steps_seq", ["scenarioId", "sequence"])
export class TestStepEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "scenario_id", type: "char", length: 36 })
  scenarioId!: string;

  /** 1부터. 재정렬 시 전량 재기입한다. */
  @Column({ name: "sequence", type: "int", unsigned: true })
  sequence!: number;

  /** 업무 단계 이름. 예: "아이디 입력" */
  @Column({ name: "name", type: "varchar", length: 200 })
  name!: string;

  @Column({ name: "action_type", type: "enum", enum: ACTION_TYPES })
  actionType!: ActionType;

  @Column({ name: "target_json", type: "json", nullable: true })
  targetJson!: LocatorTarget | null;

  @Column({ name: "input_json", type: "json", nullable: true })
  inputJson!: TestStepInput | null;

  @Column({ name: "options_json", type: "json", nullable: true })
  optionsJson!: TestStepOptions | null;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime", precision: 3 })
  updatedAt!: Date;

  @ManyToOne("ScenarioEntity", (scenario: ScenarioEntity) => scenario.steps, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "scenario_id" })
  scenario!: Relation<ScenarioEntity>;
}
