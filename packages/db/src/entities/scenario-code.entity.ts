import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { Relation } from "typeorm";
import type { ScenarioEntity } from "./scenario.entity.js";

/**
 * 코드 시나리오의 본문. `scenarios` 와 **1:1** 이다 (03-phases 쟁점 1).
 *
 * ## 왜 `scenarios` 의 컬럼이 아니라 별도 테이블인가
 * TypeORM `find()` 는 기본적으로 **전 컬럼을 선택**한다. `scenarios` 는 목록 화면이
 * 페이지당 20행씩 읽는 뜨거운 테이블이고(라운드 1 실측 p95 6.3ms / 249행),
 * 여기에 `MEDIUMTEXT` 를 붙이면 **목록 조회가 코드 본문을 통째로 끌고 온다.**
 * 1:1 분리가 그 위험을 구조적으로 없앤다 — 목록 쿼리는 이 테이블을 조인하지 않는다.
 *
 * ## 확장 지점 (나중에 1:N 이 되려면)
 * PK 는 `scenario_id` 가 아니라 **자체 `id`** 이고, 1:1 은 `uq_scenario_codes_scenario`
 * **UNIQUE 제약 하나로만** 강제한다. 다중 파일로 가려면 그 제약을 `(scenario_id, filename)`
 * UNIQUE 로 바꾸는 마이그레이션 하나면 되고 **PK·FK·관계 방향은 그대로다.**
 * (이번 범위는 단일 파일이다 — 다중 파일은 가상 파일트리 + 상대 import 해석 + 경로 쓰기 검증을
 * 요구하고, 그 쓰기 검증이 곧 임의 경로 쓰기 취약점의 입구다.)
 *
 * [AUTHZ] 비회원제라 `created_by` 가 없다.
 */
@Entity({ name: "scenario_codes" })
export class ScenarioCodeEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** `uq_scenario_codes_scenario` 로 유일하다 = 현재는 1:1. */
  @Column({ name: "scenario_id", type: "char", length: 36 })
  scenarioId!: string;

  /**
   * ★ 이 이름은 Runner 작업 디렉토리에 **실제 파일로 쓰인다.**
   * API 가 `ScenarioCodeFilenameSchema` 로 검증하지만 Runner 도 다시 검증한다
   * (라운드 1 storage traversal 3중 방어와 같은 규율).
   */
  @Column({ name: "filename", type: "varchar", length: 255 })
  filename!: string;

  /** `.spec.ts` 본문. 상한 `MAX_SCENARIO_CODE_BYTES`(256KiB) 는 API 가 강제한다. */
  @Column({ name: "content", type: "mediumtext" })
  content!: string;

  /** UTF-8 바이트 수. 목록·용량 표시에 쓴다(본문을 읽지 않고도 크기를 알기 위해). */
  @Column({ name: "size_bytes", type: "int", unsigned: true })
  sizeBytes!: number;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime", precision: 3 })
  updatedAt!: Date;

  @OneToOne("ScenarioEntity", { onDelete: "CASCADE" })
  @JoinColumn({ name: "scenario_id" })
  scenario!: Relation<ScenarioEntity>;
}
