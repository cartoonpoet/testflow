import { describe, expect, it } from "vitest";
import type { Artifact, RunDetail, StepResult } from "@testflow/contracts";
import { appendArtifact, applyRunEvent } from "./run-events";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const AT = "2026-09-17T10:00:00.000Z";

function step(sequence: number, overrides: Partial<StepResult> = {}): StepResult {
  return {
    id: `2222${String(sequence).padStart(4, "0")}-2222-4222-8222-222222222222`,
    runId: RUN_ID,
    stepId: null,
    sequence,
    nameSnapshot: `스텝 ${String(sequence)}`,
    actionType: "click",
    status: "pending",
    startedAt: null,
    durationMs: null,
    errorMessage: null,
    ...overrides,
  };
}

function detail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: RUN_ID,
    runCode: "RUN-0001",
    projectId: "33333333-3333-4333-8333-333333333333",
    scenarioId: null,
    suiteId: null,
    batchId: null,
    scenarioName: "정상 로그인",
    envLabel: "스테이징",
    baseUrl: "https://staging.example.com",
    browser: "chromium",
    // 라운드 2 추가 필드(`RunSchema.sourceType`). 이 테스트는 녹화 실행을 다룬다.
    sourceType: "steps",
    status: "queued",
    runnerId: null,
    totalSteps: 3,
    passedSteps: 0,
    failedSeq: null,
    errorMessage: null,
    queuedAt: AT,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    summary: {
      envLabel: "스테이징",
      baseUrl: "https://staging.example.com",
      browser: "chromium",
      runnerId: null,
      startedAt: null,
      totalSteps: 3,
      currentStep: 0,
    },
    steps: [step(1), step(2), step(3)],
    ...overrides,
  };
}

describe("applyRunEvent", () => {
  it("run.status 가 상태·runner·시작시각을 채운다", () => {
    const next = applyRunEvent(detail(), {
      event: "run.status",
      runId: RUN_ID,
      status: "running",
      runnerId: "runner-03",
      at: AT,
    });

    expect(next.status).toBe("running");
    expect(next.runnerId).toBe("runner-03");
    expect(next.startedAt).toBe(AT);
    expect(next.summary.startedAt).toBe(AT);
  });

  it("step.started 가 해당 스텝만 running 으로 올리고 진행 단계를 갱신한다", () => {
    const next = applyRunEvent(detail(), {
      event: "step.started",
      runId: RUN_ID,
      sequence: 2,
      name: "스텝 2",
      totalSteps: 3,
      at: AT,
    });

    expect(next.steps.map((s) => s.status)).toEqual(["pending", "running", "pending"]);
    expect(next.summary.currentStep).toBe(2);
  });

  it("★ 이미 끝난 스텝을 step.started 재전송이 되돌리지 않는다 (멱등)", () => {
    const base = detail({
      steps: [step(1, { status: "passed", durationMs: 120 }), step(2), step(3)],
    });

    const next = applyRunEvent(base, {
      event: "step.started",
      runId: RUN_ID,
      sequence: 1,
      name: "스텝 1",
      totalSteps: 3,
      at: AT,
    });

    expect(next.steps[0]?.status).toBe("passed");
    expect(next.steps[0]?.durationMs).toBe(120);
  });

  it("step.finished 가 결과로 치환하고 passedSteps 를 다시 센다", () => {
    const result = step(1, { status: "passed", durationMs: 840, startedAt: AT });
    const next = applyRunEvent(detail(), {
      event: "step.finished",
      runId: RUN_ID,
      sequence: 1,
      result,
      at: AT,
    });

    expect(next.steps[0]).toEqual(result);
    expect(next.passedSteps).toBe(1);
  });

  it("★ 같은 step.finished 를 두 번 적용해도 결과가 같다 (중복 반영 없음)", () => {
    const result = step(1, { status: "passed", durationMs: 840 });
    const event = { event: "step.finished", runId: RUN_ID, sequence: 1, result, at: AT } as const;

    const once = applyRunEvent(detail(), event);
    const twice = applyRunEvent(once, event);

    expect(twice).toEqual(once);
    expect(twice.passedSteps).toBe(1);
  });

  it("step.finished 가 실패면 failedSeq 를 기록한다", () => {
    const result = step(2, { status: "failed", errorMessage: '기대(포함): "••••••••"' });
    const next = applyRunEvent(detail(), {
      event: "step.finished",
      runId: RUN_ID,
      sequence: 2,
      result,
      at: AT,
    });

    expect(next.failedSeq).toBe(2);
    expect(next.steps[1]?.errorMessage).toContain("••••••••");
  });

  it("run.finished 가 종료 상태·소요시간·에러를 확정한다", () => {
    const next = applyRunEvent(detail({ status: "running" }), {
      event: "run.finished",
      runId: RUN_ID,
      status: "cancelled",
      passedSteps: 1,
      totalSteps: 3,
      durationMs: 832,
      errorMessage: "사용자 요청으로 실행이 취소되었습니다.",
      at: AT,
    });

    expect(next.status).toBe("cancelled");
    expect(next.durationMs).toBe(832);
    expect(next.finishedAt).toBe(AT);
  });

  it("artifact.ready 는 상세 캐시를 바꾸지 않는다", () => {
    const base = detail();
    const next = applyRunEvent(base, {
      event: "artifact.ready",
      runId: RUN_ID,
      type: "video",
      artifact: artifact("44444444-4444-4444-8444-444444444444"),
      at: AT,
    });

    expect(next).toBe(base);
  });
});

/**
 * 라운드 2 — 코드 실행(`sourceType === "code"`)은 스텝을 미리 시딩할 수 없고
 * 총 단계 수가 실행 중에 늘어난다(03-phases 쟁점 2). 화면이 그것을 견디는지 고정한다.
 */
describe("applyRunEvent — 코드 실행 (라운드 2)", () => {
  /** 코드 실행의 출발점: 스텝 0건 · totalSteps 0. */
  function codeDetail(): RunDetail {
    return detail({
      sourceType: "code",
      status: "running",
      totalSteps: 0,
      steps: [],
      summary: {
        envLabel: "스테이징",
        baseUrl: "https://staging.example.com",
        browser: "chromium",
        runnerId: null,
        startedAt: null,
        totalSteps: 0,
        currentStep: 0,
      },
    });
  }

  it("★ 시딩되지 않은 step.started 가 행을 새로 만든다 (대기 행이 없다)", () => {
    const next = applyRunEvent(codeDetail(), {
      event: "step.started",
      runId: RUN_ID,
      sequence: 1,
      name: 'Navigate "/login"',
      totalSteps: 1,
      at: AT,
    });

    expect(next.steps).toHaveLength(1);
    expect(next.steps[0]?.status).toBe("running");
    expect(next.steps[0]?.nameSnapshot).toBe('Navigate "/login"');
    expect(next.totalSteps).toBe(1);
  });

  it("★ M(총 단계 수)이 커져도 되돌아가지 않는다 (단조 증가)", () => {
    let state = codeDetail();
    for (const totalSteps of [1, 2, 3]) {
      state = applyRunEvent(state, {
        event: "step.started",
        runId: RUN_ID,
        sequence: totalSteps,
        name: `스텝 ${String(totalSteps)}`,
        totalSteps,
        at: AT,
      });
    }
    expect(state.summary.totalSteps).toBe(3);

    // 재연결 재전송으로 **과거의 작은 값**이 뒤늦게 들어온다.
    const late = applyRunEvent(state, {
      event: "step.started",
      runId: RUN_ID,
      sequence: 1,
      name: "스텝 1",
      totalSteps: 1,
      at: AT,
    });

    expect(late.totalSteps).toBe(3);
    expect(late.summary.totalSteps).toBe(3);
    expect(late.summary.currentStep).toBe(3);
  });

  it("step.finished 만 온 단계도 행이 생기고 sequence 순으로 정렬된다", () => {
    const seeded = applyRunEvent(codeDetail(), {
      event: "step.finished",
      runId: RUN_ID,
      sequence: 2,
      result: step(2, { status: "passed", durationMs: 120 }),
      at: AT,
    });
    const next = applyRunEvent(seeded, {
      event: "step.finished",
      runId: RUN_ID,
      sequence: 1,
      result: step(1, { status: "passed", durationMs: 90 }),
      at: AT,
    });

    expect(next.steps.map((item) => item.sequence)).toEqual([1, 2]);
    expect(next.passedSteps).toBe(2);
  });

  it("★ 녹화 실행에는 행을 새로 만들지 않는다 (회귀 방지)", () => {
    const next = applyRunEvent(detail({ steps: [] }), {
      event: "step.started",
      runId: RUN_ID,
      sequence: 1,
      name: "스텝 1",
      totalSteps: 3,
      at: AT,
    });

    expect(next.steps).toHaveLength(0);
  });
});

describe("appendArtifact", () => {
  const a = artifact("44444444-4444-4444-8444-444444444444");

  it("새 증적을 뒤에 붙인다", () => {
    expect(appendArtifact([], a)).toHaveLength(1);
  });

  it("★ 같은 id 는 두 번 들어가지 않는다 (재연결 재전송)", () => {
    expect(appendArtifact([a], a)).toHaveLength(1);
  });
});

function artifact(id: string): Artifact {
  return {
    id,
    runId: RUN_ID,
    stepResultId: null,
    type: "video",
    storageKey: `runs/${RUN_ID}/video.webm`,
    contentType: "video/webm",
    sizeBytes: 278_265,
    stepSequence: null,
    url: `/api/artifacts/${id}`,
    createdAt: AT,
  };
}
