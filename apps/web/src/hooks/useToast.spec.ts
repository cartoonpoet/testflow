import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOAST_DURATION_MS,
  dismissToast,
  getToasts,
  subscribeToasts,
  toast,
} from "./useToast";

describe("useToast 스토어", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const t of getToasts()) dismissToast(t.id);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("toast() 는 즉시 목록에 추가하고 구독자에게 알린다", () => {
    let notified = 0;
    const unsubscribe = subscribeToasts(() => {
      notified += 1;
    });

    toast("저장되었습니다", { label: "완료" });

    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]?.message).toBe("저장되었습니다");
    expect(getToasts()[0]?.label).toBe("완료");
    expect(notified).toBe(1);

    unsubscribe();
  });

  it("정확히 2.2초 후에 자동 소멸한다 (시안 스펙)", () => {
    expect(TOAST_DURATION_MS).toBe(2200);

    toast("적용되었습니다");
    expect(getToasts()).toHaveLength(1);

    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    expect(getToasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it("수동 dismiss 후 타이머가 만료돼도 다른 토스트를 건드리지 않는다", () => {
    const first = toast("첫 번째");
    toast("두 번째");

    dismissToast(first);
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]?.message).toBe("두 번째");

    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(getToasts()).toHaveLength(0);
  });

  it("스냅샷은 변경이 없으면 같은 참조를 돌려준다 (useSyncExternalStore 무한루프 방지)", () => {
    toast("고정");
    const a = getToasts();
    const b = getToasts();
    expect(a).toBe(b);

    dismissToast(-1); // 없는 id → 변경 없음
    expect(getToasts()).toBe(a);
  });
});
