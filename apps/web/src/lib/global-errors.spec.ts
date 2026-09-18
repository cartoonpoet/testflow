import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@/hooks/useToast";
import {
  DEDUPE_WINDOW_MS,
  UNEXPECTED_ERROR_MESSAGE,
  installGlobalErrorHandlers,
  markErrorHandled,
  resetErrorReporting,
  shouldReport,
} from "./global-errors";
import type { GlobalErrorTarget } from "./global-errors";

/** `window` 없이 리스너 동작을 확인하기 위한 최소 대상(vitest 기본 환경은 node 다). */
function fakeTarget(): GlobalErrorTarget & { fire: (type: string, event: unknown) => void } {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set<EventListener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    fire(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event as Event);
    },
  };
}

function clearToasts(): void {
  for (const t of getToasts()) dismissToast(t.id);
}

describe("shouldReport — 중복 억제", () => {
  beforeEach(() => {
    resetErrorReporting();
  });

  it("처음 보는 오류는 알린다", () => {
    expect(shouldReport("uncaught:boom", () => 0)).toBe(true);
  });

  it("같은 오류가 창 안에서 반복되면 한 번만 알린다 (매 프레임 던지는 타이머 대비)", () => {
    expect(shouldReport("uncaught:boom", () => 0)).toBe(true);
    expect(shouldReport("uncaught:boom", () => 100)).toBe(false);
    expect(shouldReport("uncaught:boom", () => DEDUPE_WINDOW_MS)).toBe(false);
  });

  it("창을 지나면 다시 알린다 — 나중에 또 나면 그건 새 사고다", () => {
    expect(shouldReport("uncaught:boom", () => 0)).toBe(true);
    expect(shouldReport("uncaught:boom", () => DEDUPE_WINDOW_MS + 1)).toBe(true);
  });

  it("★ ErrorBoundary 가 처리한 오류는 토스트로 다시 알리지 않는다 (화면 대체 + 토스트 중복 금지)", () => {
    markErrorHandled("uncaught:render blew up", () => 0);
    expect(shouldReport("uncaught:render blew up", () => 10)).toBe(false);
  });

  it("다른 오류는 서로 막지 않는다", () => {
    expect(shouldReport("uncaught:a", () => 0)).toBe(true);
    expect(shouldReport("uncaught:b", () => 0)).toBe(true);
  });
});

describe("installGlobalErrorHandlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetErrorReporting();
    clearToasts();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("★ 이벤트 핸들러 안의 예외(ErrorBoundary 가 못 잡는 것)를 토스트로 알린다", () => {
    const target = fakeTarget();
    installGlobalErrorHandlers(target);

    target.fire("error", { error: new Error("onClick blew up") });

    const toasts = getToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(toasts[0]?.tone).toBe("danger");
  });

  it("★ await 되지 않은 Promise 도 알린다", () => {
    const target = fakeTarget();
    installGlobalErrorHandlers(target);

    target.fire("unhandledrejection", { reason: new Error("no catch") });

    expect(getToasts()).toHaveLength(1);
  });

  it("스택 원문은 화면에 싣지 않는다 — 콘솔로만 보낸다", () => {
    const target = fakeTarget();
    installGlobalErrorHandlers(target);

    target.fire("error", { error: new Error("ReferenceError: x is not defined") });

    expect(getToasts()[0]?.message).not.toContain("ReferenceError");
    expect(console.error).toHaveBeenCalled();
  });

  it("리소스 로드 실패(error 가 없는 ErrorEvent)는 무시한다", () => {
    const target = fakeTarget();
    installGlobalErrorHandlers(target);

    target.fire("error", { error: null, message: "" });

    expect(getToasts()).toHaveLength(0);
  });

  it("해제 함수를 부르면 더 이상 알리지 않는다", () => {
    const target = fakeTarget();
    const uninstall = installGlobalErrorHandlers(target);
    uninstall();

    target.fire("error", { error: new Error("late") });

    expect(getToasts()).toHaveLength(0);
  });
});
