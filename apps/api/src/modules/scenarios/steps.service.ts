import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import type { EntityManager } from "typeorm";
import { TestStepEntity } from "@testflow/db";
import { DEFAULT_STEP_OPTIONS, TestStepSchema } from "@testflow/contracts";
import type { ApiTestStep, CreateStepDto, PatchStepDto, TestStep } from "@testflow/contracts";
import { toApiStep, toApiSteps, toTestStep } from "./step.mapper.js";
import { SEQUENCE_VACATE_OFFSET, StepPlanError, planStepReplacement } from "./steps.plan.js";
import { ScenariosService } from "./scenarios.service.js";

@Injectable()
export class StepsService {
  constructor(
    @InjectRepository(TestStepEntity)
    private readonly steps: Repository<TestStepEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly scenarios: ScenariosService,
  ) {}

  /**
   * `PUT /api/scenarios/:id/steps` — **전량 치환**.
   * 순서 변경·삭제·추가를 한 번에 처리한다.
   *
   * ## 유니크 제약(`uq_test_steps_seq`)을 깨뜨리지 않는 순서
   *  0. 요청 배열은 컨트롤러에서 `TestStepArraySchema` 로 이미 걸렀다
   *     (`sequence` 가 1..n 연속이 아니면 여기까지 오지 못한다).
   *  1. 요청에 없는 기존 스텝 DELETE
   *  2. **살아남는 행 전체의 `sequence` 를 오프셋만큼 밀어 1..n 구간을 비운다**
   *     — "1번↔3번 교환" 같은 요청에서 중간 상태 충돌을 막는 핵심 단계다.
   *  3. 기존 행 UPDATE(최종 sequence) → 새 행 INSERT
   *
   * 전 과정을 하나의 트랜잭션에서 돌린다. 중간에 실패하면 원래 순서로 되돌아간다.
   *
   * ## 기존 행을 지우고 다시 넣지 않는 이유
   * `step_results.step_id` 가 `ON DELETE SET NULL` 이다. 전량 DELETE + INSERT 로 구현하면
   * 순서만 바꿔도 과거 실행 이력이 스텝과의 연결을 전부 잃는다. 그래서 id 를 보존한다.
   */
  async replaceAll(
    scenarioId: string,
    incoming: TestStep[],
    advanced: boolean,
  ): Promise<ApiTestStep[]> {
    await this.scenarios.mustFind(scenarioId);

    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.find(TestStepEntity, {
        where: { scenarioId },
        order: { sequence: "ASC" },
      });

      let plan;
      try {
        plan = planStepReplacement(
          existing.map((entity) => entity.id),
          incoming,
        );
      } catch (error) {
        if (error instanceof StepPlanError) throw new BadRequestException(error.message);
        throw error;
      }

      if (plan.deleteIds.length > 0) {
        await manager.delete(TestStepEntity, plan.deleteIds);
      }

      // 2단계 — 1..n 구간 비우기.
      await manager.query(`UPDATE test_steps SET sequence = sequence + ? WHERE scenario_id = ?`, [
        SEQUENCE_VACATE_OFFSET,
        scenarioId,
      ]);

      for (const update of plan.updates) {
        const step = incoming[update.index];
        if (step === undefined) continue;
        await manager.update(TestStepEntity, update.id, {
          ...toColumns(step),
          sequence: update.sequence,
        });
      }

      for (const insert of plan.inserts) {
        const step = incoming[insert.index];
        if (step === undefined) continue;
        await manager.insert(TestStepEntity, {
          scenarioId,
          sequence: insert.sequence,
          ...toColumns(step),
        });
      }

      await touchScenario(manager, scenarioId);
    });

    return this.listSteps(scenarioId, advanced);
  }

  /** `POST /api/scenarios/:id/steps` — `afterSequence` 뒤에 한 건 삽입하고 뒤를 밀어낸다. */
  async insertAfter(
    scenarioId: string,
    dto: CreateStepDto,
    advanced: boolean,
  ): Promise<ApiTestStep> {
    await this.scenarios.mustFind(scenarioId);

    const created = await this.dataSource.transaction(async (manager) => {
      const count = await manager.count(TestStepEntity, { where: { scenarioId } });
      // afterSequence 미지정이면 맨 뒤에 붙인다.
      const after = Math.min(Math.max(dto.afterSequence ?? count, 0), count);
      const sequence = after + 1;

      // ORDER BY DESC 로 뒤에서부터 밀어야 중간 상태에서 유니크 제약이 터지지 않는다.
      await manager.query(
        `UPDATE test_steps SET sequence = sequence + 1
          WHERE scenario_id = ? AND sequence > ?
          ORDER BY sequence DESC`,
        [scenarioId, after],
      );

      // 전체 형태 검증은 contracts 스키마로 한다(동작별 target/input 필수 여부까지 본다).
      const step = parseStep({ ...dto.step, sequence });
      const result = await manager.insert(TestStepEntity, {
        scenarioId,
        sequence,
        ...toColumns(step),
      });

      await touchScenario(manager, scenarioId);

      const id = (result.identifiers[0] as { id?: string } | undefined)?.id;
      if (id === undefined) throw new Error("스텝 INSERT 후 id 를 얻지 못했습니다.");
      return manager.findOneOrFail(TestStepEntity, { where: { id } });
    });

    return toApiStep(toTestStep(created), advanced);
  }

  /** `PATCH /api/steps/:stepId` — 인스펙터 "적용". `sequence` 가 오면 이동까지 처리한다. */
  async patch(stepId: string, dto: PatchStepDto, advanced: boolean): Promise<ApiTestStep> {
    const current = await this.mustFindStep(stepId);

    const updated = await this.dataSource.transaction(async (manager) => {
      const merged = parseStep({
        ...toTestStep(current),
        ...stripUndefined(dto),
        sequence: current.sequence,
      });

      if (dto.sequence !== undefined && dto.sequence !== current.sequence) {
        await this.move(manager, current, dto.sequence);
      }

      await manager.update(TestStepEntity, stepId, toColumns(merged));
      await touchScenario(manager, current.scenarioId);
      return manager.findOneOrFail(TestStepEntity, { where: { id: stepId } });
    });

    return toApiStep(toTestStep(updated), advanced);
  }

  /** `DELETE /api/steps/:stepId` — 삭제 후 뒤 스텝의 `sequence` 를 당겨 1..n 연속을 유지한다. */
  async remove(stepId: string): Promise<void> {
    const step = await this.mustFindStep(stepId);

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(TestStepEntity, stepId);
      await manager.query(
        `UPDATE test_steps SET sequence = sequence - 1
          WHERE scenario_id = ? AND sequence > ?
          ORDER BY sequence ASC`,
        [step.scenarioId, step.sequence],
      );
      await touchScenario(manager, step.scenarioId);
    });
  }

  async listSteps(scenarioId: string, advanced: boolean): Promise<ApiTestStep[]> {
    const rows = await this.steps.find({ where: { scenarioId }, order: { sequence: "ASC" } });
    return toApiSteps(rows.map(toTestStep), advanced);
  }

  private async mustFindStep(stepId: string): Promise<TestStepEntity> {
    const step = await this.steps.findOne({ where: { id: stepId } });
    if (!step) throw new NotFoundException(`스텝을 찾을 수 없습니다: ${stepId}`);
    return step;
  }

  /** 한 건 이동. 비우기 → 사이 구간 밀기/당기기 → 최종 위치 기입. */
  private async move(
    manager: EntityManager,
    step: TestStepEntity,
    rawTarget: number,
  ): Promise<void> {
    const count = await manager.count(TestStepEntity, { where: { scenarioId: step.scenarioId } });
    const to = Math.min(Math.max(rawTarget, 1), count);
    const from = step.sequence;
    if (to === from) return;

    // 이동할 행을 구간 밖으로 잠시 치운다.
    await manager.update(TestStepEntity, step.id, { sequence: SEQUENCE_VACATE_OFFSET + from });

    if (to < from) {
      await manager.query(
        `UPDATE test_steps SET sequence = sequence + 1
          WHERE scenario_id = ? AND sequence >= ? AND sequence < ?
          ORDER BY sequence DESC`,
        [step.scenarioId, to, from],
      );
    } else {
      await manager.query(
        `UPDATE test_steps SET sequence = sequence - 1
          WHERE scenario_id = ? AND sequence > ? AND sequence <= ?
          ORDER BY sequence ASC`,
        [step.scenarioId, from, to],
      );
    }

    await manager.update(TestStepEntity, step.id, { sequence: to });
    step.sequence = to;
  }
}

/** `TestStep` → 엔티티 컬럼. `sequence` 는 호출부가 따로 정한다. */
function toColumns(step: TestStep): Omit<
  Partial<TestStepEntity>,
  "id" | "scenarioId" | "sequence"
> {
  return {
    name: step.name,
    actionType: step.actionType,
    targetJson: step.target ?? null,
    inputJson: step.input ?? null,
    optionsJson: step.options,
  };
}

/** contracts 의 교차검증(`superRefine`)까지 태운다. 실패하면 400. */
function parseStep(candidate: unknown): TestStep {
  const result = TestStepSchema.safeParse({ options: DEFAULT_STEP_OPTIONS, ...(candidate as object) });
  if (!result.success) {
    throw new BadRequestException({
      statusCode: 400,
      error: "Bad Request",
      message: "스텝 형태가 올바르지 않습니다.",
      details: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/** `undefined` 키를 지운다 — spread 로 기존 값을 `undefined` 로 덮어쓰지 않기 위해. */
function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** 목록의 '수정일' 열이 스텝 편집을 반영하도록 시나리오의 updated_at 도 올린다. */
async function touchScenario(manager: EntityManager, scenarioId: string): Promise<void> {
  await manager.query(`UPDATE scenarios SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`, [
    scenarioId,
  ]);
}
