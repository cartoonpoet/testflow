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
