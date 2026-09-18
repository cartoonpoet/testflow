import { describe, expect, it, vi } from "vitest";
import type { LiveStreamServerMessage } from "@testflow/contracts";
import { LiveStreamServerMessageSchema } from "@testflow/contracts";
import {
  LIVE_STREAM_ENDED_LINGER_MS,
  LiveStreamRegistry,
  LiveStreamSession,
} from "./live-stream.js";
import type { LiveStreamFrame, LiveStreamSink } from "./live-stream.js";

/**
 * 라이브 스트림 상태 기계 회귀 (03-phases Task 4.3).
 *
 * 고정하는 성질 4가지 —
 *  ① `between-tests` 는 **page 수**로 판정한다(프레임 공백이 아니다 — 정지 화면 오판 방지).
 *  ② 종료 시 **캔버스를 비우지 않는다**: `ended` 메시지 → linger → **close 1000**.
 *  ③ 발행하는 모든 메시지가 `LiveStreamServerMessageSchema` 를 통과한다(계약 위반 0건).
 *  ④ 뷰어가 없어도 프레임이 실행을 막지 않는다(드롭 카운트만 오른다).
 */

/** 뷰어 소켓 대역. 실제 `ws` 는 `record/ws-server.ts` 가 붙인다. */
class FakeViewer {
  readonly messages: LiveStreamServerMessage[] = [];
  frames = 0;
  finished = 0;

  readonly sink: LiveStreamSink = {
    frame: () => {
      this.frames += 1;
    },
    message: (message) => {
      this.messages.push(message);
    },
    finish: () => {
      this.finished += 1;
    },
  };
}

function fakeSink(): FakeViewer {
  return new FakeViewer();
}

const FRAME: LiveStreamFrame = {
  data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  capturedAtMs: 1_700_000_000_000,
  viewportWidth: 1280,
  viewportHeight: 800,
};

const RUN_ID = "11111111-2222-3333-4444-555555555555";

describe("LiveStreamSession — 상태 기계", () => {
  it("붙는 즉시 현재 상태를 알려 준다(첫 프레임 전이므로 between-tests)", () => {
    const session = new LiveStreamSession(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);

    expect(viewer.messages).toEqual([{ t: "state", state: "between-tests" }]);
  });

  it("page 가 붙고 첫 프레임이 오면 live 로 간다", () => {
    const session = new LiveStreamSession(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);

    session.pageAttached();
    // ★ page 만 붙어서는 live 가 아니다 — 아직 화면이 없다.
    expect(viewer.messages).toHaveLength(1);

    session.pushFrame(FRAME);
    expect(viewer.messages.at(-1)).toEqual({ t: "state", state: "live" });
    expect(viewer.frames).toBe(1);
  });

  it("★ 테스트 전환 구간 — page 가 닫히면 between-tests 를 다시 발행한다", () => {
    const session = new LiveStreamSession(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);

    // 테스트 1
    session.pageAttached();
    session.pushFrame(FRAME);
    // 테스트 1 종료 → page 닫힘
    session.pageDetached();
    // 테스트 2
    session.pageAttached();
    session.pushFrame(FRAME);

    const states = viewer.messages.map((m) => (m.t === "state" ? m.state : m.t));
    expect(states).toEqual(["between-tests", "live", "between-tests", "live"]);
  });

  it("같은 상태를 두 번 발행하지 않는다(오버레이 깜빡임 방지)", () => {
    const session = new LiveStreamSession(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);

    session.pageAttached();
    session.pushFrame(FRAME);
    session.pushFrame(FRAME);
    session.pushFrame(FRAME);

    expect(viewer.messages.filter((m) => m.t === "state" && m.state === "live")).toHaveLength(1);
    expect(viewer.frames).toBe(3);
  });

  it("page 가 2개 붙었다가 1개만 닫히면 live 를 유지한다", () => {
    const session = new LiveStreamSession(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);

    session.pageAttached();
    session.pageAttached();
    session.pushFrame(FRAME);
    session.pageDetached();

    expect(session.stats().attachedPages).toBe(1);
    expect(session.stats().state).toBe("live");
  });

  it("pageDetached 를 과하게 불러도 attachedPages 가 음수로 새지 않는다", () => {
    const session = new LiveStreamSession(RUN_ID);
    session.pageDetached();
    session.pageDetached();
    expect(session.stats().attachedPages).toBe(0);
  });

  it("뷰어가 없어도 프레임이 던지지 않고 드롭만 센다", () => {
    const session = new LiveStreamSession(RUN_ID);
    session.pageAttached();
    expect(() => session.pushFrame(FRAME)).not.toThrow();
    expect(session.stats().framesDroppedNoViewer).toBe(1);
    expect(session.stats().framesForwarded).toBe(0);
  });
});

describe("LiveStreamSession — ★ 종료 시 캔버스를 비우지 않는다", () => {
  it("ended 를 보내고 linger 뒤에 정상 종료(finish)한다", () => {
    vi.useFakeTimers();
    try {
      const session = new LiveStreamSession(RUN_ID);
      const viewer = fakeSink();
      session.attach(viewer.sink);
      session.pageAttached();
      session.pushFrame(FRAME);

      session.end("failed");
      // ★ 즉시 닫지 않는다 — 마지막 프레임이 남을 시간을 준다.
      expect(viewer.messages.at(-1)).toEqual({ t: "state", state: "ended", runStatus: "failed" });
      expect(viewer.finished).toBe(0);

      vi.advanceTimersByTime(LIVE_STREAM_ENDED_LINGER_MS + 1);
      expect(viewer.finished).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ended 이후의 프레임·상태 변화는 무시된다(마지막 프레임을 덮어쓰지 않는다)", () => {
    const session = new LiveStreamSession(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);
    session.end("passed");
    const countAfterEnd = viewer.messages.length;

    session.pageAttached();
    session.pushFrame(FRAME);
    session.pageDetached();

    expect(viewer.frames).toBe(0);
    expect(viewer.messages).toHaveLength(countAfterEnd);
    expect(session.stats().state).toBe("ended");
  });

  it("end() 는 멱등이다", () => {
    const session = new LiveStreamSession(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);
    session.end("passed");
    session.end("failed");
    expect(viewer.messages.filter((m) => m.t === "state" && m.state === "ended")).toHaveLength(1);
  });

  it("★ 레지스트리에서 내려가도 linger 가 살아 있다(= 마지막 프레임이 남는다)", () => {
    vi.useFakeTimers();
    try {
      const registry = new LiveStreamRegistry();
      const session = registry.open(RUN_ID);
      const viewer = fakeSink();
      session.attach(viewer.sink);

      session.end("passed");
      registry.close(RUN_ID);
      // dispose() 가 즉시 닫아 버리면 클라이언트가 마지막 프레임을 그리기 전에 종료된다.
      expect(viewer.finished).toBe(0);

      vi.advanceTimersByTime(LIVE_STREAM_ENDED_LINGER_MS + 1);
      expect(viewer.finished).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("end() 없이 dispose 되면 즉시 소켓을 닫는다(세션 누수 방지)", () => {
    const registry = new LiveStreamRegistry();
    const session = registry.open(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);

    registry.close(RUN_ID);
    expect(viewer.finished).toBe(1);
    expect(registry.get(RUN_ID)).toBeUndefined();
  });

  it("종료 뒤에 붙은 뷰어도 ended 와 runStatus 를 받는다", () => {
    const session = new LiveStreamSession(RUN_ID);
    session.end("timeout");
    const late = fakeSink();
    session.attach(late.sink);
    expect(late.messages).toEqual([{ t: "state", state: "ended", runStatus: "timeout" }]);
  });
});

/**
 * ★ 라운드 4 — **정지 화면에서 늦게 붙은 뷰어에게 첫 프레임을 보장한다.**
 *
 * `page.screencast` 는 변경분만 송출한다(04-gen-3 실측). 화면이 멈춘 순간에 붙으면
 * 프레임이 한 장도 오지 않아 캔버스가 검게 남는다 — 라운드 4가 고친 바로 그 버그다.
 */
describe("LiveStreamSession — 늦게 붙은 뷰어의 첫 프레임 (라운드 4)", () => {
  it("★ 캐시된 마지막 프레임을 붙는 즉시 보낸다(새 프레임이 하나도 없어도)", () => {
    const session = new LiveStreamSession(RUN_ID);
    const early = fakeSink();
    session.attach(early.sink);
    session.pageAttached();
    session.pushFrame(FRAME);

    // 이 시점부터 화면이 정지했다고 가정한다 — `pushFrame` 이 더 오지 않는다.
    const late = fakeSink();
    session.attach(late.sink);

    expect(late.frames).toBe(1);
    expect(session.stats().cachedFramesReplayed).toBe(1);
    // 상태도 `live` 로 받는다 — "화면이 아직 없습니다"가 뜰 이유가 없다.
    expect(late.messages[0]).toEqual({ t: "state", state: "live" });
  });

  it("뷰어가 하나도 없는 동안 온 프레임도 캐시된다", () => {
    const session = new LiveStreamSession(RUN_ID);
    session.pageAttached();
    session.pushFrame(FRAME);
    expect(session.stats().framesDroppedNoViewer).toBe(1);
    expect(session.hasCachedFrame()).toBe(true);

    const late = fakeSink();
    session.attach(late.sink);
    expect(late.frames).toBe(1);
  });

  it("★ 캐시가 비었을 때만 키프레임을 요청한다(실행 중인 페이지 개입 최소화)", async () => {
    const session = new LiveStreamSession(RUN_ID);
    const provider = vi.fn(() => Promise.resolve(FRAME));
    session.setKeyframeProvider(provider);

    const first = fakeSink();
    session.attach(first.sink);
    await Promise.resolve();
    await Promise.resolve();

    expect(provider).toHaveBeenCalledTimes(1);
    expect(first.frames).toBe(1);
    expect(session.stats().keyframesDelivered).toBe(1);

    // 캐시가 찼으므로 다음 뷰어는 캡처 없이 캐시로 답한다.
    const second = fakeSink();
    session.attach(second.sink);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(second.frames).toBe(1);
  });

  it("키프레임 공급자가 없거나 null 을 주면 조용히 넘어간다(실행에 영향 없음)", async () => {
    const session = new LiveStreamSession(RUN_ID);
    session.setKeyframeProvider(() => Promise.resolve(null));
    const viewer = fakeSink();
    expect(() => {
      session.attach(viewer.sink);
    }).not.toThrow();
    await Promise.resolve();
    expect(viewer.frames).toBe(0);
    expect(session.stats().keyframesRequested).toBe(1);
    expect(session.stats().keyframesDelivered).toBe(0);
  });

  it("공급자가 던져도 세션이 죽지 않는다", async () => {
    const session = new LiveStreamSession(RUN_ID);
    session.setKeyframeProvider(() => Promise.reject(new Error("page closed")));
    const viewer = fakeSink();
    session.attach(viewer.sink);
    await Promise.resolve();
    await Promise.resolve();
    expect(viewer.frames).toBe(0);
    expect(session.stats().state).toBe("between-tests");
  });
});

describe("LiveStreamSession — 계약 준수", () => {
  it("발행하는 모든 메시지가 LiveStreamServerMessageSchema 를 통과한다", () => {
    const session = new LiveStreamSession(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);
    session.pageAttached();
    session.pushFrame(FRAME);
    session.pageDetached();
    session.error("CDP_ATTACH_FAILED", "실행 화면에 연결하지 못했습니다.");
    session.end("failed");

    expect(viewer.messages.length).toBeGreaterThan(3);
    for (const message of viewer.messages) {
      expect(LiveStreamServerMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it("error() 는 뷰어에만 알리고 상태를 바꾸지 않는다(실행은 계속된다)", () => {
    const session = new LiveStreamSession(RUN_ID);
    const viewer = fakeSink();
    session.attach(viewer.sink);
    const before = session.stats().state;

    session.error("CDP_ATTACH_FAILED", "x");

    expect(session.stats().state).toBe(before);
    expect(viewer.messages.at(-1)).toEqual({
      t: "error",
      code: "CDP_ATTACH_FAILED",
      message: "x",
    });
  });
});

describe("LiveStreamRegistry", () => {
  it("같은 runId 로 두 번 열면 같은 세션이다", () => {
    const registry = new LiveStreamRegistry();
    expect(registry.open(RUN_ID)).toBe(registry.open(RUN_ID));
    expect(registry.size()).toBe(1);
  });

  it("열지 않은 runId 는 undefined — WS 서버가 4404 를 주는 근거다", () => {
    const registry = new LiveStreamRegistry();
    expect(registry.get(RUN_ID)).toBeUndefined();
  });

  it("★ 다중 뷰어 — 나중에 붙은 뷰어가 먼저 붙은 뷰어를 끊지 않는다", () => {
    const session = new LiveStreamSession(RUN_ID);
    const first = fakeSink();
    const second = fakeSink();

    session.attach(first.sink);
    session.attach(second.sink);
    expect(session.viewerCount).toBe(2);
    // ★ 라운드 2의 "최신이 이긴다"(sink 1개)를 되돌린 지점이다. 아무도 닫히지 않는다.
    expect(first.finished).toBe(0);

    session.pageAttached();
    session.pushFrame(FRAME);
    expect(first.frames).toBeGreaterThanOrEqual(1);
    expect(second.frames).toBeGreaterThanOrEqual(1);
  });

  it("★ 한 뷰어가 나가도 남은 뷰어는 계속 받는다", () => {
    const session = new LiveStreamSession(RUN_ID);
    const first = fakeSink();
    const second = fakeSink();
    session.attach(first.sink);
    session.attach(second.sink);
    session.pageAttached();

    session.detach(first.sink);
    expect(session.viewerCount).toBe(1);

    const before = second.frames;
    session.pushFrame(FRAME);
    expect(second.frames).toBe(before + 1);
  });

  it("closeAll 이 전부 내린다", () => {
    const registry = new LiveStreamRegistry();
    registry.open("a".repeat(36));
    registry.open("b".repeat(36));
    registry.closeAll();
    expect(registry.size()).toBe(0);
  });
});
