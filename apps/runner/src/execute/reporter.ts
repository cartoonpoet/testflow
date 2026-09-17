import { randomUUID } from "node:crypto";
import {
  RUN_EVENT_BUFFER_MAX,
  RUN_EVENT_BUFFER_TTL_SEC,
  runEventBufferKey,
  runEventChannel,
  runEventSeqKey,
} from "@testflow/contracts";
import type {
  ActionType,
  Artifact,
  ArtifactType,
  RunEvent,
  RunEventEnvelope,
  RunStatus,
  StepResult,
  StepResultStatus,
  TestStep,
} from "@testflow/contracts";
import type { Redis } from "ioredis";
import type { DataSource } from "typeorm";
import { ArtifactEntity, RunEntity, StepResultEntity } from "@testflow/db";
import { maskSecretText } from "../mask.js";

/**
 * 스텝/실행 이벤트 → Redis pub/sub + DB 기록 (03-phases Task 6.4).
 *
 * ## ★ 발행 절차 — 순서를 바꾸면 SSE 재연결이 이벤트를 잃는다
 * ```
 * seq = INCR   run:<id>:seq
 *       EXPIRE run:<id>:seq 3600
 * body = JSON({seq, payload})
 *       RPUSH  run:<id>:events body
 *       LTRIM  run:<id>:events -500 -1
 *       EXPIRE run:<id>:events 3600
 *       PUBLISH run:<id> body          ← ★ 반드시 버퍼에 넣은 다음
 * ```
 * publish 를 먼저 하면 구독자(API)가 이벤트를 받은 직후 버퍼를 읽었을 때 그 이벤트가
 * 아직 없어 `Last-Event-ID` 재전송에 구멍이 생긴다 (04-gen-5 "SSE 이벤트 규약 ★").
 * 채널과 버퍼에는 **완전히 같은 바이트**를 넣는다.
 *
 * ## ★ 마스킹은 DB 쓰기 **전에** 한다
 * SSE 로 나가는 값은 API 가 한 번 더 마스킹하지만 **DB 에 남는 값은 API 를 거치지 않는다.**
 * Playwright 에러 메시지에는 입력값이 그대로 실려 나온다. 그래서 이 클래스는
 * `secretValues` 를 생성 시점에 받아 **모든** `error_message` 경로에 강제 적용한다 —
 * 호출부가 마스킹을 잊을 수 있는 틈을 남기지 않는다.
 *
 * ## `runs` 갱신 범위
 * **녹화 경로**에서 `total_steps` 는 실행 요청 시점에 API 가 이미 채웠다. Runner 는
 * `passed_steps`/`failed_seq`/`started_at`/`finished_at`/`duration_ms`/`status`/`runner_id`
 * 만 건드린다 (04-gen-5 전달사항 1번).
 *
 * **코드 경로(라운드 2)는 예외다** — 실행해 봐야 스텝 수를 알기 때문에 API 가 `0` 으로 두고
 * Runner 가 `updateTotalSteps()` 로 늘린다(쟁점 2). 그 메서드는 코드 경로 전용 절에 있다.
 */
export class RunReporter {
  /** sequence → step_results.id. 증적을 스텝에 묶을 때 쓴다. */
  private readonly stepResultIds = new Map<number, string>();

  constructor(
    private readonly redis: Redis,
    private readonly dataSource: DataSource,
    private readonly runId: string,
    private readonly runnerId: string,
    /** ★ 이 run 의 Secret 평문 값들. `collectSecretValues(job.data.variables, secretKeys)`. */
    private readonly secretValues: readonly string[],
  ) {}

  /** 마스킹된 메시지. 외부에서도 쓸 수 있게 열어 둔다(증적 텍스트 등). */
  mask(text: string): string {
    return maskSecretText(text, this.secretValues);
  }

  stepResultIdOf(sequence: number): string | null {
    return this.stepResultIds.get(sequence) ?? null;
  }

  /* ── 이벤트 발행 ──────────────────────────────────────── */

  /**
   * 이벤트 1건 발행. **API 의 `RunEventsService.publish()` 와 같은 절차를 쓴다.**
   * @returns 부여된 `seq` (SSE `id:` 값)
   */
  async publish(payload: RunEvent): Promise<number> {
    const seqKey = runEventSeqKey(this.runId);
    const bufferKey = runEventBufferKey(this.runId);

    const seq = await this.redis.incr(seqKey);
    await this.redis.expire(seqKey, RUN_EVENT_BUFFER_TTL_SEC);

    const envelope: RunEventEnvelope = { seq, payload };
    const body = JSON.stringify(envelope);

    // ★ 버퍼 먼저, PUBLISH 나중. (파이프라인으로 묶어 왕복을 1회로 줄인다)
    await this.redis
      .multi()
      .rpush(bufferKey, body)
      .ltrim(bufferKey, -RUN_EVENT_BUFFER_MAX, -1)
      .expire(bufferKey, RUN_EVENT_BUFFER_TTL_SEC)
      .exec();

    await this.redis.publish(runEventChannel(this.runId), body);
    return seq;
  }

  /* ── 실행 수명주기 ────────────────────────────────────── */

  /**
   * 스텝 결과 행을 **전부 `pending` 으로 미리 만든다.**
   *
   * 시안 실행 현황 화면이 "완료 ✓ / 실행중 스피너 / **대기 번호**" 3-상태를 그리려면
   * 아직 실행하지 않은 스텝도 행으로 보여야 한다. API 의 `toRunSummary()` 가
   * pending 을 `currentStep` 에서 제외하는 것도 이 전제 위에 있다.
   */
  async seedStepResults(steps: readonly TestStep[]): Promise<void> {
    if (steps.length === 0) return;
    const repo = this.dataSource.getRepository(StepResultEntity);
    const rows = steps.map((step) => {
      const id = randomUUID();
      this.stepResultIds.set(step.sequence, id);
      return {
        id,
        runId: this.runId,
        stepId: step.id ?? null,
        sequence: step.sequence,
        nameSnapshot: step.name.slice(0, 200),
        actionType: step.actionType,
        status: "pending" as StepResultStatus,
        startedAt: null,
        durationMs: null,
        errorMessage: null,
      };
    });
    await repo.insert(rows);
  }

  /** `runs.status = 'running'` + `started_at` 확정 + `run.status` 이벤트. */
  async runStarted(): Promise<Date> {
    const startedAt = new Date();
    await this.dataSource.getRepository(RunEntity).update(
      { id: this.runId },
      { status: "running", runnerId: this.runnerId, startedAt },
    );
    await this.publish({
      event: "run.status",
      runId: this.runId,
      status: "running",
      runnerId: this.runnerId,
      at: startedAt.toISOString(),
    });
    return startedAt;
  }

  async stepStarted(step: TestStep, totalSteps: number): Promise<Date> {
    const at = new Date();
    await this.dataSource
      .getRepository(StepResultEntity)
      .update({ runId: this.runId, sequence: step.sequence }, { status: "running", startedAt: at });

    await this.publish({
      event: "step.started",
      runId: this.runId,
      sequence: step.sequence,
      name: step.name,
      totalSteps,
      at: at.toISOString(),
    });
    return at;
  }

  /**
   * 스텝 종료 기록 + `step.finished` 이벤트.
   * `errorMessage` 는 **여기서 마스킹된다** — 호출부가 원문을 그대로 넘겨도 안전하다.
   */
  async stepFinished(params: {
    step: TestStep;
    status: StepResultStatus;
    startedAt: Date;
    durationMs: number;
    errorMessage?: string | null;
  }): Promise<StepResult> {
    const masked =
      params.errorMessage === undefined || params.errorMessage === null
        ? null
        : this.mask(params.errorMessage).slice(0, 60_000);

    await this.dataSource.getRepository(StepResultEntity).update(
      { runId: this.runId, sequence: params.step.sequence },
      { status: params.status, durationMs: params.durationMs, errorMessage: masked },
    );

    const result: StepResult = {
      id: this.stepResultIds.get(params.step.sequence) ?? randomUUID(),
      runId: this.runId,
      stepId: params.step.id ?? null,
      sequence: params.step.sequence,
      nameSnapshot: params.step.name.slice(0, 200),
      actionType: params.step.actionType,
      status: params.status,
      startedAt: params.startedAt.toISOString(),
      durationMs: params.durationMs,
      errorMessage: masked,
    };

    await this.publish({
      event: "step.finished",
      runId: this.runId,
      sequence: params.step.sequence,
      result,
      at: new Date().toISOString(),
    });
    return result;
  }

  /** 아직 `pending` 인 스텝을 한꺼번에 `skipped` 로 접는다(실패·취소로 중단된 경우). */
  async skipRemaining(): Promise<void> {
    await this.dataSource
      .getRepository(StepResultEntity)
      .update({ runId: this.runId, status: "pending" }, { status: "skipped" });
  }

  /* ── 코드 실행 경로 (라운드 2) ─────────────────────────── */

  /**
   * ★ 코드 실행은 **스텝을 미리 시딩할 수 없다** — 실행해 봐야 스텝을 안다(쟁점 2).
   *   그래서 `step.started` 시점에 행을 **INSERT** 한다. `seedStepResults()` + `stepStarted()`
   *   조합(UPDATE)을 쓸 수 없는 이유가 이것이고, 라운드 1 결정 4번("대기 행")이 성립하지 않는 지점이다.
   *
   * ★ `stepId` 는 **항상 NULL** 이다. `test_steps` 에 대응 행이 없다(FK 는 NULL 허용).
   *
   * ★ `nameSnapshot` 을 **여기서 마스킹한다.** Playwright step 제목에는 입력값이 평문으로
   *   실려 온다(`Fill "s3cr3t-pw"`). 호출부가 패턴 마스킹(`stripStepValue`)을 이미 걸지만
   *   **값 기반 마스킹은 이 클래스만이 할 수 있다**(`secretValues` 를 가진 유일한 곳).
   *   두 겹을 다 거치게 해서 호출부가 잊을 틈을 남기지 않는다.
   */
  async codeStepStarted(params: {
    sequence: number;
    name: string;
    actionType: ActionType;
    totalSteps: number;
    startedAt: Date;
  }): Promise<string> {
    const id = randomUUID();
    this.stepResultIds.set(params.sequence, id);
    const nameSnapshot = this.mask(params.name).slice(0, 200);

    await this.dataSource.getRepository(StepResultEntity).insert({
      id,
      runId: this.runId,
      stepId: null,
      sequence: params.sequence,
      nameSnapshot,
      actionType: params.actionType,
      status: "running" as StepResultStatus,
      startedAt: params.startedAt,
      durationMs: null,
      errorMessage: null,
    });

    await this.publish({
      event: "step.started",
      runId: this.runId,
      sequence: params.sequence,
      name: nameSnapshot,
      totalSteps: params.totalSteps,
      at: params.startedAt.toISOString(),
    });
    return id;
  }

  /** 코드 실행 스텝 종료. `errorMessage`·`nameSnapshot` 양쪽이 마스킹된다. */
  async codeStepFinished(params: {
    sequence: number;
    name: string;
    actionType: ActionType;
    status: StepResultStatus;
    startedAt: Date;
    durationMs: number;
    errorMessage?: string | null;
  }): Promise<StepResult> {
    const nameSnapshot = this.mask(params.name).slice(0, 200);
    const masked =
      params.errorMessage === undefined || params.errorMessage === null
        ? null
        : this.mask(params.errorMessage).slice(0, 60_000);

    await this.dataSource.getRepository(StepResultEntity).update(
      { runId: this.runId, sequence: params.sequence },
      { status: params.status, durationMs: params.durationMs, errorMessage: masked },
    );

    const result: StepResult = {
      id: this.stepResultIds.get(params.sequence) ?? randomUUID(),
      runId: this.runId,
      stepId: null,
      sequence: params.sequence,
      nameSnapshot,
      actionType: params.actionType,
      status: params.status,
      startedAt: params.startedAt.toISOString(),
      durationMs: params.durationMs,
      errorMessage: masked,
    };

    await this.publish({
      event: "step.finished",
      runId: this.runId,
      sequence: params.sequence,
      result,
      at: new Date().toISOString(),
    });
    return result;
  }

  /**
   * ★ `runs.total_steps` 를 실행 중에 갱신한다.
   *
   * 라운드 1은 요청 시점에 스텝 수를 확정해 넣었지만 코드 실행은 **스텝을 발견해 가며** 센다
   * (API 가 `total_steps = 0` 으로 만들어 둔다 — 04-gen-2 §4.2). 계약은 바꾸지 않는다:
   * `totalSteps` 는 이미 숫자이고, **화면이 M 이 커지는 것을 견디면 된다**(쟁점 2).
   */
  async updateTotalSteps(totalSteps: number): Promise<void> {
    await this.dataSource.getRepository(RunEntity).update({ id: this.runId }, { totalSteps });
  }

  /**
   * 아직 `running` 인 스텝을 `skipped` 로 접는다(취소·타임아웃으로 프로세스를 끊은 경우).
   *
   * ★ `failed` 로 기록하지 않는다 — 테스터가 직접 멈춘 실행이 "실패 1건"으로 통계에 잡히면
   *   성공률이 왜곡된다(라운드 1 `executor.ts` 의 같은 판단).
   */
  async skipRunningSteps(): Promise<void> {
    await this.dataSource
      .getRepository(StepResultEntity)
      .update({ runId: this.runId, status: "running" }, { status: "skipped" });
  }

  /**
   * 실행 종료 확정. `runs` 갱신 + `run.finished` 이벤트.
   *
   * ★ **이미 `running` 인 run 의 최종 status 를 확정하는 것은 Runner 의 몫이다.**
   *   API 는 취소 신호만 보내고 상태를 바꾸지 않는다 — 그래야 Runner 가 나중에
   *   `passed` 로 덮어써 상태가 되돌아가는 사고가 안 난다 (04-gen-5 이슈 4번).
   */
  async runFinished(params: {
    status: RunStatus;
    startedAt: Date | null;
    passedSteps: number;
    totalSteps: number;
    failedSeq: number | null;
    errorMessage?: string | null;
  }): Promise<void> {
    const finishedAt = new Date();
    const durationMs =
      params.startedAt === null ? null : Math.max(0, finishedAt.getTime() - params.startedAt.getTime());
    const masked =
      params.errorMessage === undefined || params.errorMessage === null
        ? null
        : this.mask(params.errorMessage).slice(0, 60_000);

    await this.dataSource.getRepository(RunEntity).update(
      { id: this.runId },
      {
        status: params.status,
        passedSteps: params.passedSteps,
        failedSeq: params.failedSeq,
        errorMessage: masked,
        finishedAt,
        durationMs,
        runnerId: this.runnerId,
      },
    );

    // 시나리오 목록의 `lastResult` 비정규화 컬럼 갱신 (Task 4.6 이 이 컬럼을 읽는다).
    await this.dataSource.query(
      `UPDATE scenarios s
          JOIN runs r ON r.id = ?
           SET s.last_run_id = r.id
         WHERE s.id = r.scenario_id`,
      [this.runId],
    );

    await this.publish({
      event: "run.finished",
      runId: this.runId,
      status: params.status,
      passedSteps: params.passedSteps,
      totalSteps: params.totalSteps,
      durationMs,
      errorMessage: masked,
      at: finishedAt.toISOString(),
    });
  }

  /* ── 증적 ────────────────────────────────────────────── */

  /** `artifacts` 행 INSERT + `artifact.ready` 이벤트. */
  async artifactReady(params: {
    type: ArtifactType;
    storageKey: string;
    contentType: string;
    sizeBytes: number;
    stepSequence: number | null;
  }): Promise<Artifact> {
    const id = randomUUID();
    const createdAt = new Date();
    const stepResultId =
      params.stepSequence === null ? null : (this.stepResultIds.get(params.stepSequence) ?? null);

    await this.dataSource.getRepository(ArtifactEntity).insert({
      id,
      runId: this.runId,
      stepResultId,
      artifactType: params.type,
      storageKey: params.storageKey,
      contentType: params.contentType,
      // ★ BIGINT UNSIGNED 는 드라이버가 문자열로 주고받는다 (04-gen-2 이슈 4번).
      sizeBytes: String(params.sizeBytes),
      createdAt,
    });

    const artifact: Artifact = {
      id,
      runId: this.runId,
      stepResultId,
      type: params.type,
      storageKey: params.storageKey,
      contentType: params.contentType,
      sizeBytes: params.sizeBytes,
      stepSequence: params.stepSequence,
      url: `/api/artifacts/${id}`,
      createdAt: createdAt.toISOString(),
    };

    await this.publish({
      event: "artifact.ready",
      runId: this.runId,
      type: params.type,
      artifact,
      at: createdAt.toISOString(),
    });
    return artifact;
  }
}
