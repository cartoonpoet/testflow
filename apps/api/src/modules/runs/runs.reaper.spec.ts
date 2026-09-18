import { describe, expect, it } from "vitest";
import { RUN_STALE_GRACE_MS, RUNNER_HEARTBEAT_TTL_SEC } from "@testflow/contracts";
import { isStaleRun } from "./runs.reaper.js";

const QUEUED = new Date("2026-09-19T00:00:00.000Z");

function run(overrides: Partial<{ runnerId: string | null; startedAt: Date | null }> = {}) {
  return {
    runnerId: "runner-a" as string | null,
    startedAt: new Date("2026-09-19T00:00:01.000Z") as Date | null,
    queuedAt: QUEUED,
    ...overrides,
  };
}

function at(msAfterStart: number): Date {
  return new Date(new Date("2026-09-19T00:00:01.000Z").getTime() + msAfterStart);
}

describe("isStaleRun — 회수 판정", () => {
  it("★ 음성 검증: Runner 가 살아 있으면 아무리 오래 돌아도 회수하지 않는다", () => {
    // 하드 타임아웃(300초)을 훌쩍 넘긴 1시간짜리 실행 — 그래도 heartbeat 가 있으면 정상이다.
    expect(
      isStaleRun(run(), {
        now: at(3_600_000),
        aliveRunnerIds: new Set(["runner-a"]),
        graceMs: RUN_STALE_GRACE_MS,
      }),
    ).toBe(false);
  });

  it("heartbeat 가 없고 유예를 넘겼으면 회수한다", () => {
    expect(
      isStaleRun(run(), {
        now: at(RUN_STALE_GRACE_MS),
        aliveRunnerIds: new Set(),
        graceMs: RUN_STALE_GRACE_MS,
      }),
    ).toBe(true);
  });

  it("heartbeat 가 없어도 유예 안이면 아직 회수하지 않는다 (Redis 순단·기동 직후 대비)", () => {
    expect(
      isStaleRun(run(), {
        now: at(RUN_STALE_GRACE_MS - 1),
        aliveRunnerIds: new Set(),
        graceMs: RUN_STALE_GRACE_MS,
      }),
    ).toBe(false);
  });

  it("유예는 heartbeat TTL 의 2배다 — 갱신 한 번을 걸러도 오탐하지 않는다", () => {
    expect(RUN_STALE_GRACE_MS).toBe(RUNNER_HEARTBEAT_TTL_SEC * 2 * 1000);
  });

  it("다른 Runner 가 살아 있는 것은 이 run 을 지켜 주지 못한다", () => {
    expect(
      isStaleRun(run(), {
        now: at(RUN_STALE_GRACE_MS),
        aliveRunnerIds: new Set(["runner-b"]),
        graceMs: RUN_STALE_GRACE_MS,
      }),
    ).toBe(true);
  });

  it("runner_id 가 없는 running 행은 누구도 책임지지 않으므로 유예 뒤 회수한다", () => {
    expect(
      isStaleRun(run({ runnerId: null }), {
        now: at(RUN_STALE_GRACE_MS),
        aliveRunnerIds: new Set(["runner-a"]),
        graceMs: RUN_STALE_GRACE_MS,
      }),
    ).toBe(true);
  });

  it("started_at 이 없으면 queued_at 을 기준으로 잰다", () => {
    const candidate = run({ runnerId: null, startedAt: null });
    expect(
      isStaleRun(candidate, {
        now: new Date(QUEUED.getTime() + RUN_STALE_GRACE_MS - 1),
        aliveRunnerIds: new Set(),
        graceMs: RUN_STALE_GRACE_MS,
      }),
    ).toBe(false);
    expect(
      isStaleRun(candidate, {
        now: new Date(QUEUED.getTime() + RUN_STALE_GRACE_MS),
        aliveRunnerIds: new Set(),
        graceMs: RUN_STALE_GRACE_MS,
      }),
    ).toBe(true);
  });
});
