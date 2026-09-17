import { describe, expect, it } from "vitest";
import {
  RUN_EVENT_BUFFER_MAX,
  runEventBufferKey,
  runEventChannel,
  runEventSeqKey,
} from "@testflow/contracts";
import type { RunEventEnvelope } from "@testflow/contracts";
import { maskSecrets } from "../../common/utils/mask.js";
import { parseEnvelope, parseLastEventId } from "./runs.sse.js";

const RUN_ID = "11111111-2222-4333-8444-555555555555";

describe("Redis 키 규약 (Gen-Phase 6 reporter.ts 가 이대로 써야 한다)", () => {
  it("채널 · 버퍼 · 순번 키가 고정돼 있다", () => {
    expect(runEventChannel(RUN_ID)).toBe(`run:${RUN_ID}`);
    expect(runEventBufferKey(RUN_ID)).toBe(`run:${RUN_ID}:events`);
    expect(runEventSeqKey(RUN_ID)).toBe(`run:${RUN_ID}:seq`);
    expect(RUN_EVENT_BUFFER_MAX).toBe(500);
  });
});

describe("parseEnvelope — 깨진 메시지가 스트림을 죽이지 않는다", () => {
  it("정상 봉투를 파싱한다", () => {
    const envelope: RunEventEnvelope = {
      seq: 3,
      payload: {
        event: "run.status",
        runId: RUN_ID,
        status: "running",
        runnerId: "runner-1",
        at: "2026-09-17T01:00:00.000Z",
      },
    };
    expect(parseEnvelope(JSON.stringify(envelope))).toEqual(envelope);
  });

  it("JSON 이 아니면 null", () => {
    expect(parseEnvelope("not-json")).toBeNull();
  });

  it("스키마에 없는 event 이름이면 null", () => {
    expect(
      parseEnvelope(JSON.stringify({ seq: 1, payload: { event: "run.exploded", runId: RUN_ID } })),
    ).toBeNull();
  });

  it("seq 가 없으면 null (재전송 순번이 없는 이벤트는 흘릴 수 없다)", () => {
    expect(
      parseEnvelope(
        JSON.stringify({
          payload: {
            event: "run.status",
            runId: RUN_ID,
            status: "queued",
            at: "2026-09-17T01:00:00.000Z",
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("parseLastEventId", () => {
  it("헤더 값을 우선 쓴다", () => {
    expect(parseLastEventId("12", "3")).toBe(12);
  });

  it("헤더가 없으면 쿼리로 넘어간다", () => {
    expect(parseLastEventId(undefined, "3")).toBe(3);
  });

  it("비어 있거나 이상한 값은 0 (처음부터 재생)", () => {
    expect(parseLastEventId(undefined, undefined)).toBe(0);
    expect(parseLastEventId("", "")).toBe(0);
    expect(parseLastEventId("abc")).toBe(0);
    expect(parseLastEventId("-4")).toBe(0);
    expect(parseLastEventId("1.5")).toBe(0);
  });
});

describe("SSE 직렬화 — 이벤트가 프레임 하나로 나간다", () => {
  function serialize(envelope: RunEventEnvelope): string {
    const masked = maskSecrets(envelope.payload);
    return (
      `id: ${String(envelope.seq)}\n` +
      `event: ${envelope.payload.event}\n` +
      `data: ${JSON.stringify(masked)}\n\n`
    );
  }

  it("id · event · data 세 줄 + 빈 줄로 끝난다", () => {
    const frame = serialize({
      seq: 7,
      payload: {
        event: "step.started",
        runId: RUN_ID,
        sequence: 2,
        name: "아이디 입력",
        totalSteps: 5,
        at: "2026-09-17T01:00:00.000Z",
      },
    });

    expect(frame.startsWith("id: 7\nevent: step.started\ndata: {")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    // data 는 반드시 한 줄이어야 한다 — 개행이 섞이면 SSE 프레임이 쪼개진다.
    const dataLine = frame.split("\n")[2] ?? "";
    expect(dataLine.startsWith("data: ")).toBe(true);
    expect(JSON.parse(dataLine.slice("data: ".length))).toMatchObject({ sequence: 2 });
  });

  it("★ Playwright 에러에 박힌 비밀번호가 값 기반 마스킹으로 지워진다", () => {
    const secretValues = ["hunter2SuperSecret"];
    const masked = maskSecrets(
      {
        event: "run.finished",
        runId: RUN_ID,
        errorMessage:
          "locator.fill: Timeout 10000ms exceeded.\nCall log: waiting for locator(\"input[value='hunter2SuperSecret']\")",
      },
      secretValues,
    );
    const json = JSON.stringify(masked);
    expect(json).not.toContain("hunter2SuperSecret");
    expect(json).toContain("••••••••");
  });

  it("★ 계약 파싱이 스키마에 없는 키를 통째로 버린다 (1차 방어)", () => {
    const envelope = parseEnvelope(
      JSON.stringify({
        seq: 1,
        payload: {
          event: "run.status",
          runId: RUN_ID,
          status: "running",
          at: "2026-09-17T01:00:00.000Z",
          password: "hunter2SuperSecret",
        },
      }),
    );
    expect(envelope).not.toBeNull();
    expect(JSON.stringify(envelope)).not.toContain("hunter2SuperSecret");
    expect(envelope?.payload).not.toHaveProperty("password");
  });

  it("★ 키 이름이 Secret 인 필드는 마스킹돼 나간다", () => {
    const frame = serialize({
      seq: 9,
      payload: {
        event: "run.finished",
        runId: RUN_ID,
        status: "failed",
        passedSteps: 1,
        totalSteps: 2,
        durationMs: 1234,
        // 실제로는 runner 가 마스킹해 보내지만, 새어 들어와도 여기서 한 번 더 막는다.
        errorMessage: "fill failed",
        at: "2026-09-17T01:00:00.000Z",
      },
    });
    expect(frame).not.toContain("hunter2");
  });

  it("★ 중첩된 password 키가 payload 에 섞여도 값이 나가지 않는다", () => {
    const masked = maskSecrets({
      event: "run.status",
      runId: RUN_ID,
      context: { password: "hunter2", token: "abcdef" },
    });
    const json = JSON.stringify(masked);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("abcdef");
    expect(json).toContain("••••••••");
  });
});
