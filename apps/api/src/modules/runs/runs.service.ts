import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { Queue } from "bullmq";
import { DataSource, Repository } from "typeorm";
import { Redis } from "ioredis";
import {
  RUN_JOB_NAME,
  RUN_QUEUE_NAME,
  RUNNER_CAPACITY_KEY_PREFIX,
  isTerminalRunStatus,
  liveStreamTokenKey,
  runEventBufferKey,
  runEventSeqKey,
} from "@testflow/contracts";
import type {
  CreateRunRequest,
  CreateRunResponse,
  RunDetail,
  RunJobData,
  RunListItem,
  RunListQuery,
  RunQueueStatus,
  ScenarioSourceType,
} from "@testflow/contracts";
import { ProjectEntity, RunEntity, StepResultEntity } from "@testflow/db";
import { REDIS_CLIENT } from "../../common/redis/redis.module.js";
import { maskSecrets } from "../../common/utils/mask.js";
import { RunEventsService } from "./runs.sse.js";
import { planRunBatch } from "./runs.plan.js";
import type { PlannedRun, RunTarget } from "./runs.plan.js";
import { toRun, toRunListItem, toRunSummary, toStepResult } from "./run.mapper.js";

interface ScenarioRow {
  id: string;
  project_id: string;
  name: string;
  /** ★ 코드 본문(`scenario_codes.content`)은 **읽지 않는다** — 큐에도 싣지 않는다. */
  source_type: ScenarioSourceType;
}

interface SuiteScenarioRow extends ScenarioRow {
  sequence: number;
}

/**
 * 실행(run) 서비스.
 *
 * ## `POST /api/runs` 는 202 를 즉시 돌려준다
 * 실행 자체는 Runner 가 큐에서 꺼내 한다. API 가 하는 일은
 * **① 스냅샷 행 INSERT → ② 큐 등록 → ③ 202 반환** 뿐이고, 진행 상황은 SSE 로만 관찰한다
 * (02-context "규약 메모"). 그래서 이 메서드에는 Playwright 도, 대기도 없다.
 *
 * ## ★ `variables` 평문은 DB 에 닿지 않는다
 * `runs` 테이블에는 컬럼 자체가 없다. 요청 body 의 `variables` 는 **BullMQ 큐 페이로드로만**
 * 흘러가고 job 만료와 함께 사라진다 (02-context "★ 사용자 최종 결정" (c) 파생 영향).
 * 나중에 "어떤 키를 썼는가"를 남겨야 하면 `maskVariablesForStorage()` 를 거친
 * `variables_masked` 컬럼을 새 마이그레이션으로 추가하라 — 절대 평문 컬럼을 만들지 마라.
 */
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(RunEntity) private readonly runs: Repository<RunEntity>,
    @InjectRepository(StepResultEntity) private readonly stepResults: Repository<StepResultEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectQueue(RUN_QUEUE_NAME) private readonly queue: Queue<RunJobData>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly events: RunEventsService,
  ) {}

  /**
   * `POST /api/runs` → **202 Accepted**.
   *
   * `scenarioId` 면 run 1건, `suiteId` 면 스위트에 담긴 시나리오 수만큼 run N건을
   * **같은 `batch_id`** 로 만든다(부모 run 없음).
   */
  async create(request: CreateRunRequest): Promise<CreateRunResponse> {
    const { projectId, targets, suiteId } = await this.resolveTargets(request);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${projectId}`);

    // 요청 값이 우선, 없으면 프로젝트 기본값 (02-context "★ 최종 결정" (a)).
    const baseUrl = request.baseUrl ?? project.baseUrl;
    const envLabel = request.envLabel ?? project.defaultEnvLabel;
    if (baseUrl.trim() === "") {
      throw new BadRequestException(
        "baseUrl 이 비어 있습니다. 요청에 baseUrl 을 넣거나 프로젝트의 base_url 을 설정하세요.",
      );
    }

    /*
     * ★ 묶음 id 는 **"대상이 여러 건인가"** 로 정한다(라운드 7 전에는 "스위트인가" 였다).
     *   시나리오 다중 선택도 스위트와 똑같이 `batch_id` 로 묶인 run N건이므로
     *   판정 기준이 스위트에만 걸려 있으면 다중 선택 묶음이 흩어진다.
     *   단건은 그대로 `null` 이다 — 1건짜리 묶음은 묶음이 아니다.
     */
    const batchId = suiteId !== null || targets.length > 1 ? randomUUID() : null;
    const planned = await this.insertRuns(targets, batchId, {
      projectId,
      suiteId,
      baseUrl,
      envLabel,
      browser: request.browser,
    });

    // ★ 큐 등록은 커밋 이후다. 반대로 하면 Runner 가 아직 보이지 않는 run 을 집어 든다.
    await this.queue.addBulk(
      planned.map((run) => ({
        name: RUN_JOB_NAME,
        data: {
          runId: run.id,
          projectId,
          scenarioId: run.scenarioId,
          suiteId,
          batchId,
          batchSequence: run.batchSequence,
          baseUrl,
          envLabel,
          browser: request.browser,
          /**
           * ★ Runner 의 실행 엔진 분기 키 (03-phases 쟁점 2 · Task 3.7).
           *   `steps` → 기존 interpreter 경로(**동작 무변경**), `code` → `playwright test`.
           *   **코드 본문은 싣지 않는다** — Runner 가 `scenarioId` 로 DB 에서 읽는다.
           *   근거는 `RunJobDataSchema.sourceType` 의 JSDoc 에 있다.
           */
          sourceType: run.sourceType,
          // ★ 평문 변수가 존재하는 유일한 장소.
          variables: request.variables,
          secretKeys: request.secretKeys,
        } satisfies RunJobData,
        opts: {
          jobId: run.id,
          removeOnComplete: { age: 3600, count: 100 },
          removeOnFail: { age: 86_400, count: 100 },
        },
      })),
    );

    const first = planned[0];
    if (!first) throw new BadRequestException("실행할 시나리오가 없습니다.");

    return {
      runId: first.id,
      runIds: planned.map((run) => run.id),
      batchId,
      status: "queued",
      position: await this.queue.getWaitingCount(),
    };
  }

  /**
   * `GET /api/runs/queue` — **큐가 실제로 어떻게 생겼는가.** (라운드 7)
   *
   * ★ 전부 관측값이다. `RUNNER_CONCURRENCY` 를 API 의 env 에서 읽지 **않는다** —
   *   그 값은 Runner 프로세스의 것이고, API 에 복사해 두면 한쪽만 바뀐 순간
   *   화면이 조용히 거짓말을 한다. Runner 가 Redis 에 적어 둔 값만 읽는다.
   *   키가 하나도 없으면 `concurrency: null` 이다 — 모르면 모른다고 한다.
   */
  async queueStatus(): Promise<RunQueueStatus> {
    const [waiting, active, jobs] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      // `jobId = runId` 규약(03-phases). 큐 순서 = FIFO 이므로 인덱스가 곧 대기 순번이다.
      this.queue.getWaiting(0, 99),
    ]);

    const capacity = await this.readRunnerCapacity();

    return {
      waiting,
      active,
      concurrency: capacity.total,
      runners: capacity.runners,
      waitingRunIds: jobs.map((job) => job.id ?? "").filter((id) => id !== ""),
    };
  }

  /**
   * 살아 있는 Runner 들의 동시 실행 한도 합계.
   *
   * `KEYS` 가 아니라 `SCAN` 이다(health 모듈과 같은 규율 — 운영 Redis 를 블로킹하지 않는다).
   * 연결은 `@Global()` RedisModule 의 공용 클라이언트를 쓴다 — BullMQ 전용 연결은
   * 블로킹 명령용이라 여기 섞지 않는다.
   */
  private async readRunnerCapacity(): Promise<{ total: number | null; runners: number }> {
    try {
      const client = this.redis;
      const keys: string[] = [];
      let cursor = "0";
      for (let i = 0; i < 10; i += 1) {
        const [next, found] = await client.scan(
          cursor,
          "MATCH",
          `${RUNNER_CAPACITY_KEY_PREFIX}*`,
          "COUNT",
          100,
        );
        keys.push(...found);
        cursor = next;
        if (cursor === "0") break;
      }
      if (keys.length === 0) return { total: null, runners: 0 };

      const values = await client.mget(...keys);
      let total = 0;
      for (const value of values) {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed > 0) total += parsed;
      }
      return { total: total > 0 ? total : null, runners: keys.length };
    } catch {
      // 큐 연결이 흔들려도 실행 요청 경로를 막지 않는다 — "모른다"로 떨어진다.
      return { total: null, runners: 0 };
    }
  }

  /** `GET /api/runs?projectId&scenarioId&status&limit` — 대시보드 "최근 실행". */
  async list(query: RunListQuery): Promise<RunListItem[]> {
    const where: Record<string, unknown> = {};
    if (query.projectId !== undefined) where["projectId"] = query.projectId;
    if (query.scenarioId !== undefined) where["scenarioId"] = query.scenarioId;
    if (query.status !== undefined) where["status"] = query.status;

    const rows = await this.runs.find({
      where,
      order: { queuedAt: "DESC" },
      take: query.limit,
    });
    return rows.map(toRunListItem);
  }

  /**
   * `GET /api/runs/:id` — 다크 요약바 + 스텝 목록.
   *
   * ★ 마스킹 3경로 중 **① API 응답**(03-phases Task 12.4).
   *   `runs.error_message` / `step_results.error_message` 는 Runner 가 쓰기 전에 이미
   *   마스킹하지만(경로 ③), 그것이 **유일한 방어선이면 Runner 쪽 누락 하나로 평문이 샌다.**
   *   그래서 나가기 직전에 SSE 와 **같은 값 목록**(BullMQ job 페이로드)으로 한 번 더 건다.
   *   job 이 만료된 뒤에는 값 목록이 비고 키 기반 마스킹만 남는다 — 그때는 이미
   *   DB 에 마스킹된 값만 있다.
   */
  async findOne(id: string): Promise<RunDetail> {
    const run = await this.mustFind(id);
    const steps = await this.stepResults.find({
      where: { runId: id },
      order: { sequence: "ASC" },
    });

    const detail: RunDetail = {
      ...toRun(run),
      summary: toRunSummary(run, steps),
      steps: steps.map(toStepResult),
    };

    const secretValues = await this.events.secretValuesOf(id);
    return maskSecrets(detail, secretValues) as RunDetail;
  }

  /**
   * `POST /api/runs/:id/cancel`.
   *
   * 아직 큐에 있으면 job 을 지우고 바로 `cancelled` 로 확정한다.
   * 이미 실행 중이면 Runner 가 컨테이너를 kill 해야 하므로 **취소 채널로 신호만 보낸다**
   * (Gen-Phase 6 Task 6.7 이 구독한다). 상태 확정은 Runner 가 한다.
   */
  async cancel(id: string): Promise<{ status: "cancelled" }> {
    const run = await this.mustFind(id);
    if (isTerminalRunStatus(run.status)) {
      throw new BadRequestException(`이미 종료된 실행입니다 (status: ${run.status}).`);
    }

    const job = await this.queue.getJob(id);
    const stillQueued = job !== undefined && (await job.isWaiting().catch(() => false));
    if (job) await job.remove().catch(() => undefined);

    await this.events.publishCancelSignal(id);

    if (stillQueued || run.status === "queued") {
      const now = new Date();
      run.status = "cancelled";
      run.finishedAt = now;
      run.durationMs = run.startedAt ? now.getTime() - run.startedAt.getTime() : 0;
      await this.runs.save(run);

      await this.events.publish(id, {
        event: "run.status",
        runId: id,
        status: "cancelled",
        runnerId: run.runnerId,
        at: now.toISOString(),
      });
    }

    return { status: "cancelled" };
  }

  async mustFind(id: string): Promise<RunEntity> {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`실행을 찾을 수 없습니다: ${id}`);
    return run;
  }

  /**
   * 삭제해도 되는 실행인가 (라운드 8). 안 되면 **404 · 409** 를 여기서 던진다.
   *
   * ★ **진행 중(`queued`/`running`)인 실행은 지우지 않는다 — 409 다.**
   *   큐에 job 이 남은 채 DB 행만 사라지면 Runner 가 없는 run 에 결과를 쓰려다 깨진다
   *   (`step_results.run_id` 가 FK 라 INSERT 자체가 실패한다). 안내는 "먼저 취소하세요" 다 —
   *   취소 경로(`POST /runs/:id/cancel`)가 이미 큐 job 제거와 상태 확정을 다 한다.
   *
   * ★ 판정을 **삭제 직전에** 한다. 실제로 지우는 컨트롤러가 이 함수를 먼저 부르고
   *   그다음 파일을 지운다 — 순서가 뒤집히면 "지우지 않기로 한 실행의 증적"을 먼저 날린다.
   */
  async assertDeletable(id: string): Promise<RunEntity> {
    const run = await this.mustFind(id);
    if (!isTerminalRunStatus(run.status)) {
      throw new ConflictException(
        `진행 중인 실행은 삭제할 수 없습니다 (${run.runCode}, status: ${run.status}). ` +
          "먼저 실행을 취소한 뒤 삭제하세요.",
      );
    }
    return run;
  }

  /**
   * run 행을 지운다. **증적 파일은 호출부(`RunsController`)가 먼저 지운다.**
   *
   * 지워지는 것:
   *  - `runs` 1행 → `step_results` · `artifacts` 는 **FK CASCADE** 로 함께 사라진다
   *    (`fk_step_results_run` · `fk_artifacts_run`, 둘 다 `ON DELETE CASCADE` — 실측 확인).
   *  - 큐에 남은 job (완료 job 이 `removeOnComplete.age=3600` 동안 남아 있다).
   *  - Redis 잔재 — 아래 `purgeRedis()` 참조.
   *  - `scenarios.last_run_id` 의 역참조 — **FK 가 없는 비정규화 컬럼**이라
   *    아무도 NULL 로 만들어 주지 않는다. 목록의 `LEFT JOIN` 이 NULL 을 내 화면은
   *    멀쩡하지만, **끊긴 포인터를 남기지 않는다**(나중에 INNER JOIN 으로 바꾸면 행이 사라진다).
   *
   * 순서: **큐 job → DB → Redis.** job 을 먼저 치우면 그 사이 Runner 가 집어 갈 길이 없고,
   * Redis 는 실패해도 TTL(1시간)로 사라지는 파생 데이터라 맨 뒤에 둔다.
   */
  async removeRow(run: RunEntity): Promise<void> {
    const job = await this.queue.getJob(run.id).catch(() => undefined);
    if (job) await job.remove().catch(() => undefined);

    await this.dataSource.transaction(async (manager) => {
      // 비정규화 역참조를 먼저 끊는다(FK 가 없어 CASCADE 가 닿지 않는다).
      await manager.query(`UPDATE scenarios SET last_run_id = NULL WHERE last_run_id = ?`, [run.id]);
      await manager.getRepository(RunEntity).delete({ id: run.id });
    });

    await this.purgeRedis(run.id);
  }

  /**
   * Redis 에 남는 것들 — **지우는 것이 맞다**는 판단과 근거 (라운드 8).
   *
   * | 키 | 무엇 | TTL | 판정 |
   * |---|---|---|---|
   * | `run:<id>:events` | SSE 재전송 버퍼(List, 최대 500건) | 1시간 | **지운다** |
   * | `run:<id>:seq`    | SSE `id:` 카운터                 | 1시간 | **지운다** |
   * | `testflow:run:token:<id>[:<hash>]` | 라이브 WS 토큰 해시 | 120초 | **지운다** |
   *
   * TTL 이 있으니 놔둬도 언젠가는 사라진다. 그럼에도 지우는 이유는 **양**이다 —
   * 실행 이력 100건을 정리하면 버퍼 100개(최대 5만 이벤트)가 한 시간 동안 Redis 에
   * 남는다. 지워진 run 의 이벤트를 다시 받을 클라이언트는 존재하지 않는다.
   *
   * 라이브 토큰은 **사실상 없다**(진행 중 run 은 삭제를 거부하므로). 그래도 지운다 —
   * 공짜이고, "끝난 run 에 토큰이 남아 있을 리 없다"는 전제에 기대지 않는다.
   * 취소 채널(`run:<id>:cancel`)은 pub/sub 라 **저장되는 것이 없어** 지울 대상이 아니다.
   *
   * 실패해도 던지지 않는다 — DB 행은 이미 없고, 남은 것은 TTL 로 사라지는 파생 데이터다.
   */
  private async purgeRedis(runId: string): Promise<void> {
    try {
      const keys = [runEventBufferKey(runId), runEventSeqKey(runId), liveStreamTokenKey(runId)];

      /*
       * 라이브 토큰은 **해시별 보조 키**(`…:<sha256>`)가 더 있다(라운드 4 다중 뷰어).
       * 개수를 알 수 없으므로 SCAN 으로 훑는다 — `KEYS` 는 쓰지 않는다(운영 Redis 블로킹).
       */
      let cursor = "0";
      for (let i = 0; i < 10; i += 1) {
        const [next, found] = await this.redis.scan(
          cursor,
          "MATCH",
          `${liveStreamTokenKey(runId)}:*`,
          "COUNT",
          100,
        );
        keys.push(...found);
        cursor = next;
        if (cursor === "0") break;
      }

      await this.redis.del(...keys);
    } catch (error) {
      this.logger.warn(
        `Redis 잔재를 지우지 못했습니다 (run ${runId}): ${String(error)}. TTL 로 사라진다.`,
      );
    }
  }

  /* ── 내부 ─────────────────────────────────────────────── */

  /** 요청을 실행 대상 시나리오 목록으로 편다. 스위트면 `sequence` 순서를 그대로 따른다. */
  private async resolveTargets(request: CreateRunRequest): Promise<{
    projectId: string;
    suiteId: string | null;
    targets: RunTarget[];
  }> {
    /*
     * ★ 단건과 다중 선택은 **같은 경로**다. 단건은 길이 1짜리 배열일 뿐이다 —
     *   갈래를 둘로 두면 "시나리오를 찾을 수 없다" 판정이 두 벌이 된다.
     */
    const scenarioIds = request.scenarioIds ?? (request.scenarioId === undefined ? undefined : [request.scenarioId]);
    if (scenarioIds !== undefined) {
      const rows = await this.findScenarios(scenarioIds);
      const found = new Map(rows.map((row) => [row.id, row]));
      const missing = scenarioIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(`시나리오를 찾을 수 없습니다: ${missing.join(", ")}`);
      }

      // ★ 요청 배열의 순서가 곧 실행 순서다(스위트의 `sequence` 자리).
      const ordered = scenarioIds.map((id) => found.get(id) as ScenarioRow);

      /*
       * ★ 프로젝트가 섞이면 거부한다. run 은 프로젝트 1건에 속하고 `baseUrl` 기본값도
       *   프로젝트에서 온다 — 섞인 묶음은 어느 프로젝트의 주소로 돌아야 하는지 말할 수 없다.
       */
      const projectIds = new Set(ordered.map((row) => row.project_id));
      if (projectIds.size > 1) {
        throw new BadRequestException(
          "서로 다른 프로젝트의 시나리오를 한 묶음으로 실행할 수 없습니다.",
        );
      }

      return {
        projectId: ordered[0]?.project_id ?? "",
        suiteId: null,
        targets: await this.toTargets(ordered),
      };
    }

    const suiteId = request.suiteId;
    if (suiteId === undefined) {
      // zod 의 superRefine 이 먼저 거른다. 여기 오면 계약이 깨진 것이다.
      throw new BadRequestException("scenarioId 또는 suiteId 중 하나는 반드시 필요합니다.");
    }

    const suiteRows = (await this.dataSource.query(
      `SELECT id, project_id FROM suites WHERE id = ?`,
      [suiteId],
    )) as { id: string; project_id: string }[];
    const suite = suiteRows[0];
    if (!suite) throw new NotFoundException(`스위트를 찾을 수 없습니다: ${suiteId}`);

    const rows = (await this.dataSource.query(
      `SELECT s.id, s.project_id, s.name, s.source_type, ss.sequence
         FROM suite_scenarios ss
         JOIN scenarios s ON s.id = ss.scenario_id
        WHERE ss.suite_id = ?
        ORDER BY ss.sequence ASC`,
      [suiteId],
    )) as SuiteScenarioRow[];

    if (rows.length === 0) {
      throw new BadRequestException("시나리오가 하나도 없는 스위트는 실행할 수 없습니다.");
    }

    return {
      projectId: suite.project_id,
      suiteId,
      // ★ 스위트에 녹화·코드 시나리오가 섞여 있어도 `batch_id` 묶음은 그대로다.
      //   갈리는 것은 run 마다의 `source_type` 스냅샷과 큐 페이로드뿐이다.
      targets: await this.toTargets(rows),
    };
  }

  /** `scenarios` 를 id 목록으로 읽는다(순서는 보장하지 않는다 — 호출부가 정렬한다). */
  private async findScenarios(ids: readonly string[]): Promise<ScenarioRow[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    return (await this.dataSource.query(
      `SELECT id, project_id, name, source_type FROM scenarios WHERE id IN (${placeholders})`,
      [...ids],
    )) as ScenarioRow[];
  }

  /**
   * 시나리오 행 → 실행 대상. **스텝 수 집계가 여기 한 곳**에 있다.
   *
   * 스위트 경로와 다중 선택 경로가 이 함수를 같이 쓴다 — 복사하면 `code` 시나리오의
   * `stepCount = 0` 규약(쟁점 2)이 한쪽에서만 지켜지는 사고가 난다.
   */
  private async toTargets(rows: readonly ScenarioRow[]): Promise<RunTarget[]> {
    const stepCounts = await this.countSteps(rows.map((row) => row.id));
    return rows.map((row) => ({
      scenarioId: row.id,
      scenarioName: row.name,
      stepCount: stepCounts.get(row.id) ?? 0,
      sourceType: row.source_type,
    }));
  }

  private async countSteps(scenarioIds: readonly string[]): Promise<Map<string, number>> {
    if (scenarioIds.length === 0) return new Map();
    const placeholders = scenarioIds.map(() => "?").join(", ");
    const rows = (await this.dataSource.query(
      `SELECT scenario_id, COUNT(*) AS step_count
         FROM test_steps WHERE scenario_id IN (${placeholders})
        GROUP BY scenario_id`,
      [...scenarioIds],
    )) as { scenario_id: string; step_count: number | string }[];

    // COUNT(*) 는 드라이버가 문자열로 줄 수 있다(bigNumberStrings).
    return new Map(rows.map((row) => [row.scenario_id, Number(row.step_count)]));
  }

  /**
   * run 행을 한 트랜잭션에 INSERT 한다.
   *
   * `run_code` 채번은 read-then-insert 라 동시 요청에서 겹칠 수 있다. `uq_runs_code` 가
   * 최종 방어선이고 여기서는 몇 번 재시도한다(scenarios 의 `code` 채번과 같은 전략).
   */
  private async insertRuns(
    targets: readonly RunTarget[],
    batchId: string | null,
    common: {
      projectId: string;
      suiteId: string | null;
      baseUrl: string;
      envLabel: string;
      browser: "chromium";
    },
  ): Promise<(PlannedRun & { id: string })[]> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const startSerial = (await this.nextRunSerial()) + 1;
      const planned = planRunBatch({ targets, startSerial, batchId });
      const withIds = planned.map((run) => ({ ...run, id: randomUUID() }));

      try {
        /**
         * ★ `queuedAt` 을 **앱에서 명시적으로 넣는다.** DB 기본값
         * (`DEFAULT CURRENT_TIMESTAMP(3)`)에 맡기면 MySQL 서버 시각(컨테이너 TZ)이
         * 들어가는데, DataSource 는 `timezone: "Z"` 라 그 값을 UTC 로 **읽는다.**
         * 그러면 `queued_at` 만 로컬 시각이고 `started_at`/`finished_at`(Node 가 쓰는 UTC)과
         * 어긋나 `finished_at < queued_at` 같은 값이 나온다. 실측으로 확인한 문제다
         * (04-gen-5 "이슈" 참조 — 다른 테이블의 DB 기본값은 이번 범위 밖이라 남겨 뒀다).
         */
        const queuedAt = new Date();
        await this.dataSource.transaction(async (manager) => {
          await manager.getRepository(RunEntity).insert(
            withIds.map((run) => ({
              queuedAt,
              id: run.id,
              runCode: run.runCode,
              projectId: common.projectId,
              scenarioId: run.scenarioId,
              suiteId: common.suiteId,
              batchId: run.batchId,
              scenarioName: run.scenarioName,
              envLabel: common.envLabel,
              baseUrl: common.baseUrl,
              browser: common.browser,
              // 실행 시점 스냅샷 — 시나리오가 삭제돼도 이력에 남아야 한다(Task 2.6).
              sourceType: run.sourceType,
              status: "queued" as const,
              runnerId: null,
              // `code` 는 0 이다 — 실행해 봐야 스텝 수를 안다(쟁점 2). Runner 가 증가시킨다.
              totalSteps: run.totalSteps,
              passedSteps: 0,
              failedSeq: null,
              errorMessage: null,
              startedAt: null,
              finishedAt: null,
              durationMs: null,
            })),
          );
        });
        return withIds;
      } catch (error) {
        if (isDuplicateKeyError(error)) continue;
        throw error;
      }
    }

    throw new ConflictException("run 코드 채번에 반복 실패했습니다. 다시 시도해 주세요.");
  }

  /**
   * 현재 최대 `RUN-` 일련번호.
   *
   * `SUBSTRING` 때문에 인덱스를 못 탄다 — `runs` 가 수십만 행을 넘기면 이 쿼리가
   * 실행 요청 지연의 주범이 된다. 그때는 Redis `INCR` 카운터나 별도 시퀀스 테이블로
   * 옮겨야 한다(현재 규모에서는 문제되지 않는다. 실측값은 04-gen-5 검증 로그 참조).
   */
  private async nextRunSerial(): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(run_code, 5) AS UNSIGNED)), 0) AS max_serial
         FROM runs WHERE run_code LIKE 'RUN-%'`,
    )) as { max_serial: number | string }[];
    return Number(rows[0]?.max_serial ?? 0);
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ER_DUP_ENTRY"
  );
}
