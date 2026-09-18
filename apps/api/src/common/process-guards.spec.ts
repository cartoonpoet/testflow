import { afterEach, describe, expect, it, vi } from "vitest";
import { installProcessGuards } from "./process-guards.js";

type Recorded = { message: string; stack?: string };

function fakeLogger(): { error: (message: string, stack?: string) => void; entries: Recorded[] } {
  const entries: Recorded[] = [];
  return {
    entries,
    error(message: string, stack?: string) {
      entries.push(stack === undefined ? { message } : { message, stack });
    },
  };
}

const uninstallers: (() => void)[] = [];

afterEach(() => {
  while (uninstallers.length > 0) uninstallers.pop()?.();
  vi.restoreAllMocks();
});

function install(options: Parameters<typeof installProcessGuards>[0]): void {
  uninstallers.push(installProcessGuards(options));
}

describe("installProcessGuards", () => {
  it("★ unhandledRejection 에서 정리를 돌리고 exit(1) 한다 — 잡고 계속 돌지 않는다", async () => {
    const logger = fakeLogger();
    const exit = vi.fn();
    let closed = false;

    install({
      logger,
      exit,
      shutdown: async () => {
        closed = true;
        await Promise.resolve();
      },
    });

    process.emit("unhandledRejection", new Error("boom"), Promise.resolve());
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });

    expect(closed).toBe(true);
    expect(logger.entries[0]?.message).toContain("처리되지 않은 Promise rejection");
    expect(logger.entries[0]?.message).toContain("boom");
  });

  it("uncaughtException 도 같은 경로를 탄다 — 종료 절차가 두 벌이 되지 않는다", async () => {
    const logger = fakeLogger();
    const exit = vi.fn();
    const shutdown = vi.fn(async () => undefined);

    install({ logger, exit, shutdown });

    process.emit("uncaughtException", new Error("crash"));
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("정리 도중 또 터져도 정리를 다시 시작하지 않는다 (무한 루프 방지)", async () => {
    const logger = fakeLogger();
    const exit = vi.fn();
    const shutdown = vi.fn(async () => undefined);

    install({ logger, exit, shutdown });

    process.emit("uncaughtException", new Error("first"));
    process.emit("uncaughtException", new Error("second"));
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalled();
    });

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(logger.entries).toHaveLength(1);
  });

  it("정리가 실패해도 반드시 종료한다 — 닫다 매달린 프로세스는 재시작조차 못 한다", async () => {
    const logger = fakeLogger();
    const exit = vi.fn();

    install({
      logger,
      exit,
      shutdown: () => Promise.reject(new Error("close failed")),
    });

    process.emit("uncaughtException", new Error("crash"));
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(1);
    });
    expect(logger.entries.at(-1)?.message).toContain("종료 정리 실패");
  });

  it("★ 로그 메시지는 키 기반 마스킹을 거친다 — 비밀값이 새지 않는다", async () => {
    const logger = fakeLogger();
    const exit = vi.fn();

    install({ logger, exit, shutdown: async () => undefined });

    process.emit("uncaughtException", new Error('query failed: {"password":"hunter2"}'));
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalled();
    });
    expect(logger.entries[0]?.message).not.toContain("hunter2");
  });

  it("★ 스택에도 마스킹을 건다 — 스택 첫 줄은 메시지 원문이라 여기로 새어 나갔다(실측)", async () => {
    const logger = fakeLogger();
    const exit = vi.fn();

    install({ logger, exit, shutdown: async () => undefined });

    process.emit("uncaughtException", new Error('rejection 검증: password="hunter2"'));
    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalled();
    });
    expect(logger.entries[0]?.stack).toBeDefined();
    expect(logger.entries[0]?.stack).not.toContain("hunter2");
  });

  it("해제하면 핸들러가 남지 않는다", () => {
    const before = process.listenerCount("uncaughtException");
    const uninstall = installProcessGuards({ shutdown: async () => undefined });
    expect(process.listenerCount("uncaughtException")).toBe(before + 1);
    uninstall();
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});
