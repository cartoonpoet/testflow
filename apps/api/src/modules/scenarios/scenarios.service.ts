import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { ProjectEntity, ScenarioEntity, TestStepEntity } from "@testflow/db";
import { hasBlockingIssues, validateScenarioCode } from "@testflow/contracts";
import type {
  ApiTestStep,
  CreateScenarioDto,
  PatchScenarioDto,
  PublishScenarioResponse,
  Scenario,
  ScenarioListQuery,
  ScenarioListResponse,
  ScenarioSourceType,
  ScenarioStatus,
} from "@testflow/contracts";
import { toApiSteps, toTestStep } from "./step.mapper.js";

/** `GET /api/scenarios/:id` 응답. `ScenarioDetail` 의 스텝을 css 제거본으로 좁힌 형태다. */
export type ScenarioDetailResponse = Scenario & { steps: ApiTestStep[] };

interface ScenarioListRow {
  id: string;
  code: string;
  name: string;
  feature: string | null;
  status: ScenarioStatus;
  source_type: ScenarioSourceType;
  author_name: string | null;
  updated_at: Date;
  step_count: number | string;
  run_id: string | null;
  run_code: string | null;
  run_status: string | null;
  run_finished_at: Date | null;
}

@Injectable()
export class ScenariosService {
  constructor(
    @InjectRepository(ScenarioEntity)
    private readonly scenarios: Repository<ScenarioEntity>,
    @InjectRepository(TestStepEntity)
    private readonly steps: Repository<TestStepEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * `GET /api/projects/:projectId/scenarios?q&status&feature&page&size`
   *
   * 시안(화면 2)의 6열 테이블 + 툴바(검색 · 상태 select · 기능 select)를 그대로 받친다.
   * `lastResult` 는 `scenarios.last_run_id` 비정규화 컬럼을 `runs` 에 LEFT JOIN 해서 만든다
   * (목록마다 실행 이력을 정렬·집계하면 느려진다).
   *
   * QueryBuilder 대신 원시 SQL 을 쓴 이유: 스텝 수 서브쿼리 + FK 없는 조인(`last_run_id`)이
   * 섞여 있어 QueryBuilder 로 쓰면 오히려 읽기 어렵다(ERDify 도 원시 SQL 을 쓴다).
   */
  async list(projectId: string, query: ScenarioListQuery): Promise<ScenarioListResponse> {
    await this.mustFindProject(projectId);

    const where: string[] = ["s.project_id = ?"];
    const params: unknown[] = [projectId];

    if (query.q !== undefined && query.q.trim() !== "") {
      const like = `%${escapeLike(query.q.trim())}%`;
      where.push("(s.name LIKE ? ESCAPE '\\\\' OR s.code LIKE ? ESCAPE '\\\\')");
      params.push(like, like);
    }
    if (query.status !== undefined) {
      where.push("s.status = ?");
      params.push(query.status);
    }
    if (query.feature !== undefined && query.feature.trim() !== "") {
      where.push("s.feature = ?");
      params.push(query.feature.trim());
    }

    const whereSql = where.join(" AND ");
    const offset = (query.page - 1) * query.size;

    const countRows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM scenarios s WHERE ${whereSql}`,
      params,
    )) as { total: number | string }[];
    const total = Number(countRows[0]?.total ?? 0);

    const rows = (await this.dataSource.query(
      `SELECT s.id, s.code, s.name, s.feature, s.status, s.source_type, s.author_name, s.updated_at,
              (SELECT COUNT(*) FROM test_steps ts WHERE ts.scenario_id = s.id) AS step_count,
              r.id          AS run_id,
              r.run_code    AS run_code,
              r.status      AS run_status,
              r.finished_at AS run_finished_at
         FROM scenarios s
         LEFT JOIN runs r ON r.id = s.last_run_id
        WHERE ${whereSql}
        ORDER BY s.updated_at DESC, s.code ASC
        LIMIT ? OFFSET ?`,
      [...params, query.size, offset],
    )) as ScenarioListRow[];

    return {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        feature: row.feature,
        status: row.status,
        sourceType: row.source_type,
        lastResult:
          row.run_id === null || row.run_code === null || row.run_status === null
            ? null
            : {
                runId: row.run_id,
                runCode: row.run_code,
                status: row.run_status,
                finishedAt: row.run_finished_at?.toISOString() ?? null,
              },
        updatedAt: row.updated_at.toISOString(),
        authorName: row.author_name,
        // COUNT(*) 는 드라이버가 문자열로 줄 수 있다(bigNumberStrings).
        stepCount: Number(row.step_count),
      })),
      total,
      page: query.page,
      size: query.size,
    };
  }

  /**
   * `POST /api/projects/:projectId/scenarios` — `code` 는 `TC-<FEATURE>-<3자리>` 로 자동 채번.
   *
   * ★ `sourceType` 은 **여기서만** 정해진다. `PATCH` 에는 이 필드가 없고
   *   (`PatchScenarioDtoSchema` 에 없다 + 컨트롤러가 strict 로 400 을 낸다),
   *   채번 규칙은 `steps`/`code` 가 **동일**하다(코드 시나리오도 `TC-…` 를 받는다).
   */
  async create(projectId: string, dto: CreateScenarioDto): Promise<Scenario> {
    await this.mustFindProject(projectId);
    const slug = featureSlug(dto.feature);

    // 채번은 read-then-insert 라 동시 요청에서 충돌할 수 있다.
    // uq_scenarios_code 가 최종 방어선이고, 여기서는 몇 번 재시도한다.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = await this.nextScenarioCode(projectId, slug);
      const entity = this.scenarios.create({
        projectId,
        code,
        name: dto.name,
        feature: dto.feature ?? null,
        status: "draft",
        // 기본값 `"steps"` 는 `CreateScenarioDtoSchema` 가 채운다(기존 호출부 무영향).
        sourceType: dto.sourceType,
        version: 1,
        authorName: dto.authorName ?? null,
        lastRunId: null,
      });

      try {
        return toScenario(await this.scenarios.save(entity));
      } catch (error) {
        if (isDuplicateKeyError(error)) continue;
        throw error;
      }
    }

    throw new ConflictException("시나리오 코드 채번에 반복 실패했습니다. 다시 시도해 주세요.");
  }

  /** `GET /api/scenarios/:id` — 빌더 화면이 읽는 형태(스텝 포함). */
  async findOne(id: string, advanced: boolean): Promise<ScenarioDetailResponse> {
    const scenario = await this.mustFind(id);
    const steps = await this.steps.find({
      where: { scenarioId: id },
      order: { sequence: "ASC" },
    });

    return {
      ...toScenario(scenario),
      // ★ 기본값은 css 가 제거된 형태다.
      steps: toApiSteps(steps.map(toTestStep), advanced),
    };
  }

  /** `PATCH /api/scenarios/:id` */
  async patch(id: string, dto: PatchScenarioDto): Promise<Scenario> {
    const scenario = await this.mustFind(id);

    if (dto.name !== undefined) scenario.name = dto.name;
    if (dto.feature !== undefined) scenario.feature = dto.feature;
    if (dto.authorName !== undefined) scenario.authorName = dto.authorName;

    return toScenario(await this.scenarios.save(scenario));
  }

  /** `DELETE /api/scenarios/:id` — 스텝은 FK CASCADE 로 함께 지워진다. */
  async remove(id: string): Promise<void> {
    const result = await this.scenarios.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException(`시나리오를 찾을 수 없습니다: ${id}`);
    }
  }

  /**
   * `POST /api/scenarios/:id/publish` — 발행 시 version 을 1 올린다.
   *
   * ★ 발행 조건이 `sourceType` 별로 갈린다 (03-phases Task 2.3).
   *   - `steps`: **기존 규칙 그대로** — 스텝 ≥ 1. 한 글자도 바꾸지 않았다(회귀 금지).
   *   - `code` : 코드 본문이 있고 `validateScenarioCode()` 의 `severity:"error"` 가 0건.
   *     본문이 저장될 때 이미 검사했지만 **다시 본다** — 저장 이후에 규칙이 강화될 수 있고
   *     (허용 목록 축소), DB 에 직접 넣은 행도 있을 수 있다.
   *     `code` 시나리오는 `test_steps` 가 언제나 0행이라 기존 규칙을 그대로 태울 수 없다.
   */
  async publish(id: string): Promise<PublishScenarioResponse> {
    const scenario = await this.mustFind(id);

    if (scenario.sourceType === "code") {
      await this.assertPublishableCode(id);
    } else {
      const stepCount = await this.steps.count({ where: { scenarioId: id } });
      if (stepCount === 0) {
        throw new BadRequestException("스텝이 하나도 없는 시나리오는 발행할 수 없습니다.");
      }
    }

    scenario.status = "published";
    scenario.version += 1;
    const saved = await this.scenarios.save(scenario);

    return { status: "published", version: saved.version };
  }

  /**
   * `code` 시나리오의 발행 가능 여부.
   *
   * ★ `ScenarioCodeEntity` 리포지토리를 이 서비스에 **주입하지 않는다.** 주입해 두면
   *   목록 조회 경로에서 실수로 본문을 끌어올 길이 열린다(쟁점 1이 구조로 막은 것이다).
   *   그래서 본문이 필요한 이 한 곳에서만 원시 SQL 로 **`content` 컬럼만** 읽는다.
   *   (`ScenarioCodeService` 를 주입하면 그쪽이 이 서비스를 주입하고 있어 순환이 된다.)
   */
  private async assertPublishableCode(scenarioId: string): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT content FROM scenario_codes WHERE scenario_id = ?`,
      [scenarioId],
    )) as { content: string }[];

    const content = rows[0]?.content;
    if (content === undefined) {
      throw new BadRequestException("코드 본문이 없는 시나리오는 발행할 수 없습니다.");
    }
    if (hasBlockingIssues(validateScenarioCode(content))) {
      throw new BadRequestException(
        "코드에 오류가 있어 발행할 수 없습니다. 코드 편집 화면에서 오류를 먼저 해결하세요.",
      );
    }
  }

  async mustFind(id: string): Promise<ScenarioEntity> {
    const scenario = await this.scenarios.findOne({ where: { id } });
    if (!scenario) throw new NotFoundException(`시나리오를 찾을 수 없습니다: ${id}`);
    return scenario;
  }

  private async mustFindProject(projectId: string): Promise<ProjectEntity> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    return project;
  }

  private async nextScenarioCode(projectId: string, slug: string): Promise<string> {
    const prefix = `TC-${slug}-`;
    const rows = (await this.dataSource.query(
      `SELECT code FROM scenarios WHERE project_id = ? AND code LIKE ?`,
      [projectId, `${escapeLike(prefix)}%`],
    )) as { code: string }[];

    let max = 0;
    for (const row of rows) {
      const suffix = row.code.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) continue;
      max = Math.max(max, Number(suffix));
    }
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
  }
}

export function toScenario(entity: ScenarioEntity): Scenario {
  return {
    id: entity.id,
    projectId: entity.projectId,
    code: entity.code,
    name: entity.name,
    feature: entity.feature,
    status: entity.status,
    sourceType: entity.sourceType,
    version: entity.version,
    authorName: entity.authorName,
    lastRunId: entity.lastRunId,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * `code` 의 가운데 토막.
 *
 * 시안 표기는 `TC-AUTH-001` 이다. `feature` 에서 ASCII 영숫자만 남겨 대문자로 쓴다.
 * **한글 기능명(예: "로그인")은 남는 글자가 없어 `GEN` 으로 떨어진다** — 의도된 동작이다.
 * 의미 있는 코드를 원하면 `feature` 를 `AUTH` 처럼 적으면 된다.
 */
export function featureSlug(feature: string | undefined): string {
  const cleaned = (feature ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned === "" ? "GEN" : cleaned.slice(0, 8);
}

/** LIKE 패턴에서 `%` `_` `\` 를 문자 그대로 다루게 한다. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ER_DUP_ENTRY"
  );
}
