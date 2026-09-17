import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { Redis } from "ioredis";
import {
  DEFAULT_VIEWPORT,
  RECORDING_TOKEN_TTL_SEC,
  recordingControlChannel,
  recordingTokenKey,
} from "@testflow/contracts";
import type {
  ApiTestStep,
  CreateRecordingDto,
  CreateRecordingResponse,
  DraftStep,
  RecordingSession,
  Viewport,
} from "@testflow/contracts";
import {
  ProjectEntity,
  RecordingSessionEntity,
  ScenarioEntity,
  TestStepEntity,
} from "@testflow/db";
import { REDIS_CLIENT } from "../../common/redis/redis.module.js";
import { toApiSteps, toTestStep } from "../scenarios/step.mapper.js";
import { generateRecordingToken, hashRecordingToken } from "./recording-token.js";

/**
 * 녹화 세션 수명주기.
 *
 * ## API 가 하는 일 / 하지 않는 일
 * **하는 일**: `recording_sessions` 행 생성·조회·종료, 단명 세션 토큰 발급·폐기,
 * 초안 스텝을 시나리오에 반영.
 * **하지 않는 일**: 브라우저 기동, 프레임 중계, 입력 역주입. 전부 Runner 다.
 *
 * WS 는 **Runner 직결**이다(`wsUrl` 이 `RUNNER_WS_PORT` 를 가리킨다). API 를 중계로
 * 끼우면 프레임마다 홉이 하나 더 늘어 지연이 배가되고, 프레임 왕복 지연이 이 기능의
 * 유일한 성패 요인이다 (02-context "구조상 쟁점 1건").
 *
 * 그 결과 **API 는 Runner 에게 명령할 직접 경로가 없다.** `stop`/`DELETE` 는
 * `recordingControlChannel()` 로 신호를 publish 하고, Runner(Gen-Phase 7)가 구독한다.
 */
@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(RecordingSessionEntity)
    private readonly sessions: Repository<RecordingSessionEntity>,
    @InjectRepository(ScenarioEntity) private readonly scenarios: Repository<ScenarioEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(TestStepEntity) private readonly steps: Repository<TestStepEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * `POST /api/scenarios/:id/recordings`
   *
   * 같은 시나리오에 살아 있는 세션이 있으면 **새로 만들기 전에 그것을 폐기**한다.
   * (409 로 막으면 브라우저 새로고침 한 번에 테스터가 영구히 잠긴다 — Runner 가 죽어
   * `live` 행이 남아 있어도 마찬가지다. 폐기 후 재발급이 유일하게 빠져나갈 수 있는 설계다.)
   */
  async create(scenarioId: string, dto: CreateRecordingDto): Promise<CreateRecordingResponse> {
    const scenario = await this.mustFindScenario(scenarioId);
    const project = await this.projects.findOne({ where: { id: scenario.projectId } });

    const viewport: Viewport = dto.viewport ?? { ...DEFAULT_VIEWPORT };
    const startUrl = dto.startUrl ?? project?.baseUrl ?? "";

    await this.disposeLiveSessions(scenarioId);

    const session = await this.sessions.save(
      this.sessions.create({
        scenarioId,
        status: "live",
        startUrl,
        viewportW: viewport.w,
        viewportH: viewport.h,
        runnerId: null,
        draftSteps: [],
        stoppedAt: null,
      }),
    );

    // ★ 평문 토큰은 응답으로만 나간다. Redis 에는 해시만 TTL 과 함께 남는다.
    const token = generateRecordingToken();
    await this.redis.set(
      recordingTokenKey(session.id),
      hashRecordingToken(token),
      "EX",
      RECORDING_TOKEN_TTL_SEC,
    );

    return {
      sessionId: session.id,
      wsUrl: buildRecorderWsUrl(session.id, token),
      expiresAt: new Date(Date.now() + RECORDING_TOKEN_TTL_SEC * 1000).toISOString(),
      viewport,
    };
  }

  /** `GET /api/recordings/:sessionId` */
  async findOne(sessionId: string): Promise<RecordingSession> {
    return toRecordingSession(await this.mustFind(sessionId));
  }

  /**
   * `POST /api/recordings/:sessionId/stop` — 초안을 확정해 시나리오 스텝으로 반영한다.
   *
   * 초안은 기존 스텝 **뒤에 이어 붙인다**(덮어쓰지 않는다 — 녹화 전에 손으로 만든 스텝을
   * 날려 먹는 사고를 막는다). 반영 후 `draft_steps` 는 비운다.
   */
  async stop(sessionId: string): Promise<{ steps: ApiTestStep[] }> {
    const session = await this.mustFind(sessionId);
    const drafts = session.draftSteps ?? [];

    const appended = await this.appendDraftsToScenario(session.scenarioId, drafts);

    session.status = "stopped";
    session.stoppedAt = new Date();
    session.draftSteps = [];
    await this.sessions.save(session);
    await this.revokeSession(sessionId, "stop");

    return { steps: appended };
  }

  /** `DELETE /api/recordings/:sessionId` — 브라우저 폐기 + 초안 버림. 204. */
  async remove(sessionId: string): Promise<void> {
    const session = await this.mustFind(sessionId);
    session.status = "stopped";
    session.stoppedAt = new Date();
    session.draftSteps = [];
    await this.sessions.save(session);
    await this.revokeSession(sessionId, "dispose");
  }

  /* ── 내부 ─────────────────────────────────────────────── */

  private async disposeLiveSessions(scenarioId: string): Promise<void> {
    const live = await this.sessions.find({ where: { scenarioId, status: "live" } });
    for (const session of live) {
      session.status = "expired";
      session.stoppedAt = new Date();
      await this.sessions.save(session);
      await this.revokeSession(session.id, "dispose");
      this.logger.log(`이전 녹화 세션을 폐기했습니다: ${session.id}`);
    }
  }

  /** 토큰 폐기 + Runner 에게 신호. 토큰을 지우는 순간 WS 재접속이 막힌다. */
  private async revokeSession(sessionId: string, kind: "stop" | "dispose"): Promise<void> {
    await this.redis.del(recordingTokenKey(sessionId));
    await this.redis.publish(
      recordingControlChannel(sessionId),
      JSON.stringify({ t: kind, sessionId, at: new Date().toISOString() }),
    );
  }

  private async appendDraftsToScenario(
    scenarioId: string,
    drafts: readonly DraftStep[],
  ): Promise<ApiTestStep[]> {
    if (drafts.length > 0) {
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(TestStepEntity);
        const rows = (await manager.query(
          `SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM test_steps WHERE scenario_id = ?`,
          [scenarioId],
        )) as { max_seq: number | string }[];
        const base = Number(rows[0]?.max_seq ?? 0);

        await repo.insert(
          drafts.map((draft, index) => ({
            scenarioId,
            sequence: base + index + 1,
            name: draft.name,
            actionType: draft.actionType,
            targetJson: draft.target ?? null,
            inputJson: draft.input ?? null,
            optionsJson: draft.options,
          })),
        );
      });
    }

    const steps = await this.steps.find({ where: { scenarioId }, order: { sequence: "ASC" } });
    // ★ 응답 직전 css 제거 (고급 설정 전용). 직접 entity 를 실으면 selector 가 샌다.
    return toApiSteps(steps.map(toTestStep), false);
  }

  private async mustFind(sessionId: string): Promise<RecordingSessionEntity> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException(`녹화 세션을 찾을 수 없습니다: ${sessionId}`);
    return session;
  }

  private async mustFindScenario(scenarioId: string): Promise<ScenarioEntity> {
    const scenario = await this.scenarios.findOne({ where: { id: scenarioId } });
    if (!scenario) throw new NotFoundException(`시나리오를 찾을 수 없습니다: ${scenarioId}`);
    return scenario;
  }
}

/**
 * `wsUrl` 은 **API 포트가 아니라 `RUNNER_WS_PORT`** 를 가리켜야 한다(03-phases Task 5.4 완료기준).
 *
 * nginx 뒤에 둘 때는 `RUNNER_WS_PUBLIC_URL`(예: `wss://testflow.internal/rec`)을 설정하고
 * `/rec/` 경로만 Runner 로 프록시한다.
 */
export function buildRecorderWsUrl(sessionId: string, token: string): string {
  const publicBase = (process.env["RUNNER_WS_PUBLIC_URL"] ?? "").trim();
  const query = `?token=${encodeURIComponent(token)}`;
  if (publicBase !== "") {
    return `${publicBase.replace(/\/+$/, "")}/${sessionId}${query}`;
  }

  const host = process.env["RUNNER_WS_HOST"] ?? "127.0.0.1";
  const port = process.env["RUNNER_WS_PORT"] ?? "4100";
  return `ws://${host}:${port}/rec/${sessionId}${query}`;
}

export function toRecordingSession(entity: RecordingSessionEntity): RecordingSession {
  return {
    id: entity.id,
    scenarioId: entity.scenarioId,
    status: entity.status,
    startUrl: entity.startUrl,
    viewport: { w: entity.viewportW, h: entity.viewportH },
    runnerId: entity.runnerId,
    draftStepCount: entity.draftSteps?.length ?? 0,
    startedAt: entity.startedAt.toISOString(),
    lastSeenAt: entity.lastSeenAt.toISOString(),
    stoppedAt: entity.stoppedAt?.toISOString() ?? null,
  };
}
