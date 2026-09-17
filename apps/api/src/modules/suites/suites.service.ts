import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import type {
  CreateSuiteDto,
  PatchSuiteDto,
  Suite,
  SuiteDetail,
  SuiteListItem,
} from "@testflow/contracts";
import { ProjectEntity, SuiteEntity, SuiteScenarioEntity } from "@testflow/db";

interface SuiteListRow {
  id: string;
  name: string;
  scenario_count: number | string;
  batch_id: string | null;
  run_status: string | null;
  finished_at: Date | null;
}

/**
 * 스위트 = 시나리오 묶음.
 *
 * **실행 엔드포인트가 따로 없다.** `POST /api/runs {suiteId}` 한 경로로 실행하고,
 * 부모 run 없이 `runs.batch_id` 로 묶는다 (02-context "규약 메모" — `step_results` 구조를
 * 단일 시나리오 실행과 동일하게 유지하기 위해).
 */
@Injectable()
export class SuitesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SuiteEntity) private readonly suites: Repository<SuiteEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
  ) {}

  /**
   * `GET /api/projects/:projectId/suites`
   *
   * `lastRun` 은 그 스위트로 만들어진 run 중 **가장 최근 batch** 의 상태다. batch 안의 run 이
   * 하나라도 실패면 실패로 본다(묶음 실행의 결과는 "전부 통과했는가" 하나뿐이다).
   */
  async list(projectId: string): Promise<SuiteListItem[]> {
    await this.mustFindProject(projectId);

    const rows = (await this.dataSource.query(
      `SELECT s.id, s.name,
              (SELECT COUNT(*) FROM suite_scenarios ss WHERE ss.suite_id = s.id) AS scenario_count,
              last.batch_id, last.run_status, last.finished_at
         FROM suites s
         LEFT JOIN (
           SELECT r.suite_id, r.batch_id,
                  MAX(r.finished_at) AS finished_at,
                  CASE WHEN MIN(CASE WHEN r.status = 'passed' THEN 1 ELSE 0 END) = 1
                       THEN 'passed' ELSE 'failed' END AS run_status,
                  ROW_NUMBER() OVER (PARTITION BY r.suite_id ORDER BY MAX(r.queued_at) DESC) AS rn
             FROM runs r
            WHERE r.suite_id IS NOT NULL
            GROUP BY r.suite_id, r.batch_id
         ) last ON last.suite_id = s.id AND last.rn = 1
        WHERE s.project_id = ?
        ORDER BY s.created_at DESC`,
      [projectId],
    )) as SuiteListRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      scenarioCount: Number(row.scenario_count),
      lastRun:
        row.run_status === null
          ? null
          : {
              batchId: row.batch_id,
              status: row.run_status,
              finishedAt: row.finished_at?.toISOString() ?? null,
            },
    }));
  }

  /** `POST /api/projects/:projectId/suites` — 배열 순서가 곧 `suite_scenarios.sequence` 다. */
  async create(projectId: string, dto: CreateSuiteDto): Promise<SuiteDetail> {
    await this.mustFindProject(projectId);
    await this.assertScenariosBelongToProject(projectId, dto.scenarioIds);

    const suite = await this.suites.save(this.suites.create({ projectId, name: dto.name }));
    await this.replaceScenarios(suite.id, dto.scenarioIds);
    return this.findOne(suite.id);
  }

  /** `GET /api/suites/:id` */
  async findOne(id: string): Promise<SuiteDetail> {
    const suite = await this.mustFind(id);
    const rows = (await this.dataSource.query(
      `SELECT s.id, s.name, ss.sequence
         FROM suite_scenarios ss
         JOIN scenarios s ON s.id = ss.scenario_id
        WHERE ss.suite_id = ?
        ORDER BY ss.sequence ASC`,
      [id],
    )) as { id: string; name: string; sequence: number }[];

    return {
      ...toSuite(suite),
      scenarios: rows.map((row) => ({
        id: row.id,
        name: row.name,
        sequence: Number(row.sequence),
      })),
    };
  }

  /** `PATCH /api/suites/:id` — `scenarioIds` 를 주면 **전량 치환**(순서 변경·삭제 동시 처리). */
  async patch(id: string, dto: PatchSuiteDto): Promise<SuiteDetail> {
    const suite = await this.mustFind(id);

    if (dto.name !== undefined) {
      suite.name = dto.name;
      await this.suites.save(suite);
    }
    if (dto.scenarioIds !== undefined) {
      await this.assertScenariosBelongToProject(suite.projectId, dto.scenarioIds);
      await this.replaceScenarios(id, dto.scenarioIds);
    }

    return this.findOne(id);
  }

  /** `DELETE /api/suites/:id` — 링크는 FK CASCADE 로 함께 지워진다. */
  async remove(id: string): Promise<void> {
    const result = await this.suites.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException(`스위트를 찾을 수 없습니다: ${id}`);
    }
  }

  /* ── 내부 ─────────────────────────────────────────────── */

  /**
   * 링크 전량 치환.
   *
   * `suite_scenarios` 의 PK 는 `(suite_id, scenario_id)` 이므로 `sequence` 만 바뀌는 경우에도
   * 충돌이 없다 — `test_steps` 와 달리 순번에 UNIQUE 가 없어 vacate 트릭이 필요 없다.
   * 그래도 DELETE+INSERT 를 한 트랜잭션에 묶는다(중간 상태가 보이면 안 된다).
   */
  private async replaceScenarios(suiteId: string, scenarioIds: readonly string[]): Promise<void> {
    const unique = new Set(scenarioIds);
    if (unique.size !== scenarioIds.length) {
      throw new BadRequestException("scenarioIds 에 중복이 있습니다.");
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SuiteScenarioEntity);
      await repo.delete({ suiteId });
      await repo.insert(
        scenarioIds.map((scenarioId, index) => ({
          suiteId,
          scenarioId,
          sequence: index + 1,
        })),
      );
    });
  }

  /** 다른 프로젝트의 시나리오를 스위트에 섞으면 실행 시 baseUrl 이 엉뚱해진다. 미리 막는다. */
  private async assertScenariosBelongToProject(
    projectId: string,
    scenarioIds: readonly string[],
  ): Promise<void> {
    if (scenarioIds.length === 0) return;
    const placeholders = scenarioIds.map(() => "?").join(", ");
    const rows = (await this.dataSource.query(
      `SELECT id FROM scenarios WHERE project_id = ? AND id IN (${placeholders})`,
      [projectId, ...scenarioIds],
    )) as { id: string }[];

    const found = new Set(rows.map((row) => row.id));
    const missing = scenarioIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `이 프로젝트의 시나리오가 아닙니다: ${missing.join(", ")}`,
      );
    }
  }

  private async mustFind(id: string): Promise<SuiteEntity> {
    const suite = await this.suites.findOne({ where: { id } });
    if (!suite) throw new NotFoundException(`스위트를 찾을 수 없습니다: ${id}`);
    return suite;
  }

  private async mustFindProject(projectId: string): Promise<ProjectEntity> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    return project;
  }
}

export function toSuite(entity: SuiteEntity): Suite {
  return {
    id: entity.id,
    projectId: entity.projectId,
    name: entity.name,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
