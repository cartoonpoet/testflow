import { describe, expect, it } from "vitest";
import type { RunDetail, StepResult } from "@testflow/contracts";
import {
  buildVideoTimeline,
  findStep,
  liveActiveSequence,
  stepAtVideoTime,
  videoTimeForStep,
  VIDEO_LEAD_SEC,
  VIDEO_TOLERANCE_SEC,
} from "./step-time";

/**
 * 시간축 매핑은 **순수 함수**라 여기서 전부 고정할 수 있다.
 *
 * ★ 이 파일이 지키는 것은 "정확함"이 아니라 **일관성**이다. 실제 오차는 브라우저 기동
 *   시간이라 코드로 없앨 수 없다(12-step-sync.md §3). 여기서는 같은 입력이 언제나 같은
 *   구간을 내고, 구간 사이에 **빈틈이 없고**, 영상 길이 밖으로 새지 않는 것을 고정한다.
 */
const BASE = "2026-09-18T00:00:00.000Z";

function step(sequence: number, offsetMs: number, durationMs: number | null): StepResult {
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    runId: "00000000-0000-4000-8000-000000000000",
    stepId: null,
    sequence,
    nameSnapshot: `스텝 ${String(sequence)}`,
    actionType: "click",
    status: "passed",
    startedAt: new Date(Date.parse(BASE) + offsetMs).toISOString(),
    durationMs,
    errorMessage: null,
  };
}

describe("buildVideoTimeline", () => {
  it("첫 스텝을 0초에 붙이고 그 뒤는 첫 스텝 기준 상대 시각 + LEAD 다", () => {
    const timeline = buildVideoTimeline([step(1, 0, 500), step(2, 2000, 300)], 10);

    expect(timeline).not.toBeNull();
    expect(timeline?.spans[0]?.startSec).toBe(0);
    expect(timeline?.spans[1]?.startSec).toBeCloseTo(2 + VIDEO_LEAD_SEC, 6);
    expect(timeline?.toleranceSec).toBe(VIDEO_TOLERANCE_SEC);
  });

  it("★ 구간 사이에 빈틈이 없다 — 앞 구간의 끝이 다음 구간의 시작이다", () => {
    const timeline = buildVideoTimeline(
      // `durationMs` 가 스텝 간격보다 훨씬 짧다(= 스텝 사이에 빈 시간이 있다).
      [step(1, 0, 10), step(2, 3000, 10), step(3, 6000, 10)],
      20,
    );

    const spans = timeline?.spans ?? [];
    expect(spans).toHaveLength(3);
    for (const [index, span] of spans.entries()) {
      if (index === 0) continue;
      expect(span.startSec).toBe(spans[index - 1]?.endSec);
    }
  });

  it("마지막 구간의 끝은 영상 길이다 — 끝까지 재생해도 강조가 꺼지지 않는다", () => {
    const timeline = buildVideoTimeline([step(1, 0, 100), step(2, 1000, 100)], 7.5);
    expect(timeline?.spans.at(-1)?.endSec).toBe(7.5);
  });

  it("영상 길이를 넘는 스텝은 길이로 clamp 된다 (context 가 여럿인 실행)", () => {
    const timeline = buildVideoTimeline([step(1, 0, 10), step(2, 60_000, 10)], 5);
    expect(timeline?.spans[1]?.startSec).toBe(5);
    expect(timeline?.spans[1]?.endSec).toBe(5);
  });

  it("스텝 순서가 뒤섞여 들어와도 sequence 오름차순으로 만든다", () => {
    const timeline = buildVideoTimeline([step(3, 4000, 10), step(1, 0, 10), step(2, 2000, 10)], 10);
    expect(timeline?.spans.map((span) => span.sequence)).toEqual([1, 2, 3]);
  });

  it("영상 길이를 모르면 null — 모르는 값으로 구간을 지어내지 않는다", () => {
    expect(buildVideoTimeline([step(1, 0, 10)], undefined)).toBeNull();
    expect(buildVideoTimeline([step(1, 0, 10)], Number.NaN)).toBeNull();
    expect(buildVideoTimeline([step(1, 0, 10)], 0)).toBeNull();
    expect(buildVideoTimeline([step(1, 0, 10)], Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("startedAt 이 없는 스텝만 있으면 null", () => {
    const noTime: StepResult = { ...step(1, 0, 10), startedAt: null };
    expect(buildVideoTimeline([noTime], 10)).toBeNull();
  });
});

describe("stepAtVideoTime", () => {
  const timeline = buildVideoTimeline(
    [step(1, 0, 900), step(2, 1000, 900), step(3, 2000, 900)],
    6,
  );

  it("구간 안의 시각은 그 스텝이다", () => {
    expect(stepAtVideoTime(timeline, 0)).toBe(1);
    expect(stepAtVideoTime(timeline, 1.5)).toBe(2);
    expect(stepAtVideoTime(timeline, 3)).toBe(3);
  });

  it("경계는 다음 스텝의 것이다 — 한 시각에 두 스텝이 강조되지 않는다", () => {
    const boundary = timeline?.spans[1]?.startSec ?? 0;
    expect(stepAtVideoTime(timeline, boundary)).toBe(2);
    expect(stepAtVideoTime(timeline, boundary - 0.001)).toBe(1);
  });

  it("영상 끝(마지막 구간의 끝)은 마지막 스텝이다", () => {
    expect(stepAtVideoTime(timeline, 6)).toBe(3);
    expect(stepAtVideoTime(timeline, 99)).toBe(3);
  });

  it("타임라인이 없으면 null", () => {
    expect(stepAtVideoTime(null, 1)).toBeNull();
  });
});

describe("videoTimeForStep", () => {
  const timeline = buildVideoTimeline([step(1, 0, 10), step(2, 2500, 10)], 10);

  it("구간의 **시작**으로 보낸다 (그 스텝이 시작하는 장면)", () => {
    expect(videoTimeForStep(timeline, 1)).toBe(0);
    expect(videoTimeForStep(timeline, 2)).toBeCloseTo(2.5 + VIDEO_LEAD_SEC, 6);
  });

  it("★ 왕복이 맞는다 — 스텝으로 seek 한 시각은 다시 그 스텝으로 읽힌다", () => {
    for (const sequence of [1, 2]) {
      const at = videoTimeForStep(timeline, sequence);
      expect(at).not.toBeNull();
      expect(stepAtVideoTime(timeline, at ?? 0)).toBe(sequence);
    }
  });

  it("없는 스텝은 null", () => {
    expect(videoTimeForStep(timeline, 9)).toBeNull();
    expect(videoTimeForStep(null, 1)).toBeNull();
  });
});

describe("liveActiveSequence", () => {
  function run(steps: StepResult[]): RunDetail {
    return { steps } as unknown as RunDetail;
  }

  it("running 이 있으면 그중 **가장 뒤**다", () => {
    const steps = [
      { ...step(1, 0, 10), status: "running" as const },
      { ...step(2, 10, 10), status: "running" as const },
    ];
    expect(liveActiveSequence(run(steps))).toBe(2);
  });

  it("running 이 없으면 마지막 스텝이다 (끝난 실행)", () => {
    expect(liveActiveSequence(run([step(1, 0, 10), step(2, 10, 10)]))).toBe(2);
  });

  it("스텝이 없으면 null", () => {
    expect(liveActiveSequence(run([]))).toBeNull();
  });
});

describe("findStep", () => {
  it("sequence 로 찾는다 / null 이면 undefined", () => {
    const steps = [step(1, 0, 10), step(2, 10, 10)];
    expect(findStep(steps, 2)?.nameSnapshot).toBe("스텝 2");
    expect(findStep(steps, null)).toBeUndefined();
    expect(findStep(steps, 7)).toBeUndefined();
  });
});
