import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import {
  CDP_FIRST_CONNECT_TIMEOUT_MS,
  CDP_MAX_REBINDS,
  CDP_POLL_INTERVAL_MS,
  CDP_REBIND_TIMEOUT_MS,
  LIVE_STREAM_QUALITY,
  LIVE_STREAM_SIZE,
  connectOverCdpWithRetry,
  findFreeCdpPort,
  throttleFrames,
} from "./code-browser.js";
import type { ScreencastFrame } from "../record/screencast.js";
import type { LiveStreamFrame } from "./live-stream.js";

/**
 * 경로 D 부착 계층의 순수·경계 회귀 (03-phases Task 4.1).
 *
 * 브라우저를 실제로 띄우는 부분(`startCodeBrowser`)은 단위 테스트의 대상이 아니다 —
 * 실측은 `.pipeline/…/04-gen-4.md` 에 있다. 여기서 고정하는 것은
 *  ① 15fps 스로틀의 산술, ② 빈 포트 할당(동시 실행 충돌 방지),
 *  ③ **연결 실패가 던지지 않고 `null` 을 돌려주는 것**(= 실행이 스트림 때문에 죽지 않는다),
 *  ④ screencast 옵션 상수(`size` 생략 금지 규약의 값).
 */

function frame(bytes: number, capturedAtMs = 1_700_000_000_000): ScreencastFrame {
  return {
    data: Buffer.alloc(bytes, 0x41),
    timestamp: capturedAtMs,
    viewportWidth: 1280,
    viewportHeight: 800,
    capturedAtMs,
  };
}

describe("throttleFrames — 15fps 스로틀 (screencast.ts 무수정 재사용)", () => {
  it("첫 프레임은 언제나 통과한다", () => {
    const passed: LiveStreamFrame[] = [];
    const t = throttleFrames(15, (f) => passed.push(f));
    t.onFrame(frame(100));
    expect(passed).toHaveLength(1);
    expect(t.stats()).toMatchObject({ produced: 1, passed: 1, dropped: 0, bytesProduced: 100 });
  });

  it("최소 간격 안에 온 프레임은 버린다(큐에 쌓지 않는다)", () => {
    const passed: LiveStreamFrame[] = [];
    const t = throttleFrames(15, (f) => passed.push(f));
    for (let i = 0; i < 10; i += 1) t.onFrame(frame(50));
    // 같은 tick 이므로 1장만 통과한다(66.7ms 간격).
    expect(passed).toHaveLength(1);
    expect(t.stats().dropped).toBe(9);
    // ★ 버린 프레임의 바이트도 센다 — "원본이 얼마였나"를 알아야 절감률을 말할 수 있다.
    expect(t.stats().bytesProduced).toBe(500);
  });

  it("maxFps <= 0 이면 제한하지 않는다(RECORD_MAX_FPS=0 의 의미)", () => {
    const passed: LiveStreamFrame[] = [];
    const t = throttleFrames(0, (f) => passed.push(f));
    for (let i = 0; i < 5; i += 1) t.onFrame(frame(10));
    expect(passed).toHaveLength(5);
    expect(t.stats().dropped).toBe(0);
  });

  it("봉투에 실리는 필드를 그대로 넘긴다(capturedAtMs 가 지연 측정 기준점이다)", () => {
    const passed: LiveStreamFrame[] = [];
    const t = throttleFrames(15, (f) => passed.push(f));
    t.onFrame(frame(4, 1_700_000_123_456));
    expect(passed[0]).toMatchObject({
      capturedAtMs: 1_700_000_123_456,
      viewportWidth: 1280,
      viewportHeight: 800,
    });
    expect(passed[0]?.data.byteLength).toBe(4);
  });

  it("stats() 는 복사본이다(호출부가 내부 카운터를 못 만진다)", () => {
    const t = throttleFrames(15, () => undefined);
    const first = t.stats();
    t.onFrame(frame(1));
    expect(first.produced).toBe(0);
    expect(t.stats().produced).toBe(1);
  });
});

describe("findFreeCdpPort — 실행마다 빈 포트", () => {
  it("실제로 비어 있는 포트를 돌려준다", async () => {
    const port = await findFreeCdpPort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65_536);

    // 돌려준 포트에 실제로 bind 된다 = 비어 있었다.
    await new Promise<void>((done, fail) => {
      const server = createServer();
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => {
        server.close(() => done());
      });
    });
  });

  it("★ 연속 호출이 서로 다른 포트를 준다(동시 실행 2건이 충돌하지 않는다)", async () => {
    const ports = await Promise.all([
      findFreeCdpPort(),
      findFreeCdpPort(),
      findFreeCdpPort(),
      findFreeCdpPort(),
    ]);
    expect(new Set(ports).size).toBe(ports.length);
  });
});

describe("connectOverCdpWithRetry — ★ 실패해도 던지지 않는다", () => {
  it("아무도 없는 포트에서 null 을 돌려준다(실행은 계속된다)", async () => {
    const port = await findFreeCdpPort();
    const started = Date.now();
    const browser = await connectOverCdpWithRetry({
      port,
      timeoutMs: 400,
      intervalMs: 50,
      isStopped: () => false,
    });
    expect(browser).toBeNull();
    // 한도를 지킨다(무한 폴링이 아니다).
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("isStopped() 가 true 면 즉시 포기한다(취소·실행 종료)", async () => {
    const port = await findFreeCdpPort();
    const browser = await connectOverCdpWithRetry({
      port,
      timeoutMs: 30_000,
      isStopped: () => true,
    });
    expect(browser).toBeNull();
  });
});

describe("상수 — 어긋나면 화면이 조용히 깨지는 값들", () => {
  it("screencast size 는 DEFAULT_VIEWPORT(1280×800) 와 같다", () => {
    // pw-config.ts 가 `use.viewport` 에 넣는 값과 같아야 한다. 다르면 축소 렌더가 된다.
    expect(LIVE_STREAM_SIZE).toEqual({ width: 1280, height: 800 });
    expect(LIVE_STREAM_QUALITY).toBe(60);
  });

  it("재바인딩 한도는 첫 연결보다 짧다(끝난 실행에서 폴링이 오래 남지 않는다)", () => {
    expect(CDP_REBIND_TIMEOUT_MS).toBeLessThan(CDP_FIRST_CONNECT_TIMEOUT_MS);
    expect(CDP_POLL_INTERVAL_MS).toBe(200);
    expect(CDP_MAX_REBINDS).toBeGreaterThan(0);
  });
});
