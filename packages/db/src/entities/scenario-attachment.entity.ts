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
import type { ScenarioEntity } from "./scenario.entity.js";

/**
 * 시나리오 첨부파일(테스트 데이터)의 **메타데이터**. `scenarios` 와 **1:N** 이다.
 *
 * ## 왜 별도 테이블인가 — `scenario_codes` 와 같은 논리
 * `scenarios` 는 목록 화면이 페이지당 20행씩 읽는 뜨거운 테이블이고 TypeORM `find()` 는
 * 기본적으로 전 컬럼을 선택한다. 첨부 정보를 거기에 붙이면 **목록 조회가 첨부 메타까지
 * 끌고 온다.** 분리가 그 위험을 구조적으로 없앤다 — 목록 쿼리는 이 테이블을 조인하지 않는다.
 *
 * ## ★ 왜 파일 **바이트**를 DB 에 넣지 않는가
 * `scenario_codes.content` 가 `MEDIUMTEXT` 인 것과는 반대 결정이다. 근거:
 *  ① 코드 본문은 **에디터에 보여야 해서** 조회가 곧 표시다. 첨부 바이트는 화면에 절대
 *    표시되지 않는다 — 다운로드와 Runner 배치에만 쓰인다.
 *  ② 개당 상한이 10MiB 다. `MEDIUMBLOB` 10MiB × 20개를 한 행씩 읽으면 mysqld 의
 *    `max_allowed_packet`(기본 64MB)과 버퍼풀을 정면으로 때린다.
 *  ③ 증적(`artifacts`)이 이미 **"메타는 DB · 바이트는 `ARTIFACT_ROOT`"** 규약을 쓴다.
 *    두 벌의 규약을 만들지 않는다.
 *
 * ## 1:1 이 아니라 1:N 인 이유
 * 사용자의 실제 시나리오가 `setInputFiles(['테스트용 파일-1.docx', '테스트용 파일-2.docx'])`
 * 처럼 **한 호출에 여러 파일**을 넘긴다. 1:1 은 그 사용례를 표현할 수 없다.
 * (`scenario_codes` 가 1:1 인 것은 "코드 본문은 1개"라는 계약 때문이고, 첨부는 그 계약이 없다.)
 *
 * ## 같은 이름을 다시 올리면 **덮어쓴다**
 * `uq_scenario_attachments_name (scenario_id, filename)` 이 그것을 강제한다.
 * 같은 이름이 2건 있으면 Runner 가 작업공간에 무엇을 쓸지 정할 수 없다(실행이 비결정적이 된다).
 *
 * [AUTHZ] 비회원제라 `created_by` 가 없다.
 */
@Entity({ name: "scenario_attachments" })
@Index("ix_scenario_attachments_scenario", ["scenarioId"])
export class ScenarioAttachmentEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "scenario_id", type: "char", length: 36 })
  scenarioId!: string;

  /**
   * ★ **원본 파일명 그대로.** 한글·공백을 포함한다 (`테스트용 파일-1.docx`).
   *
   * Runner 가 작업 디렉토리에 **이 이름으로** 쓴다. 사용자 코드가
   * `setInputFiles('테스트용 파일-1.docx')` 라고 적혀 있으므로 한 글자도 바꿀 수 없다.
   * 경로 문자·제어문자는 API 의 `AttachmentFilenameSchema` 가 막고,
   * Runner 가 쓰기 직전에 **한 번 더** 막는다(3중 방어).
   */
  @Column({ name: "filename", type: "varchar", length: 255 })
  filename!: string;

  /** 다운로드 응답의 `Content-Type`. 헤더에 그대로 실리므로 토큰 문법만 저장한다. */
  @Column({ name: "content_type", type: "varchar", length: 255 })
  contentType!: string;

  @Column({ name: "size_bytes", type: "int", unsigned: true })
  sizeBytes!: number;

  /**
   * ★ `scenario-attachments/<scenarioId>/<attachmentId>.bin`.
   *
   * **사용자 문자열이 한 글자도 들어가지 않는다** — 두 토막이 전부 서버 생성 UUID 다.
   * 그래서 이 값으로는 traversal 이 성립할 수 없다. 자세한 근거는
   * `@testflow/contracts` 의 `attachment.ts` 상단 주석.
   */
  @Column({ name: "storage_key", type: "varchar", length: 500 })
  storageKey!: string;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime", precision: 3 })
  updatedAt!: Date;

  @ManyToOne("ScenarioEntity", { onDelete: "CASCADE" })
  @JoinColumn({ name: "scenario_id" })
  scenario!: Relation<ScenarioEntity>;
}
