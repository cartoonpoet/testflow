import { describe, expect, it } from "vitest";
import { railWindow } from "./StepRail";

/**
 * 스텝 레일의 **압축 창** 계산.
 *
 * 레일에는 스크롤 추적 이펙트가 없다 — "활성 행이 언제나 보인다"는 성질을 이 순수 함수
 * 하나가 통째로 책임진다. 그래서 여기서 못박는다(브라우저 실측은 그다음 확인이다).
 */
const steps = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ sequence: index + 1 }));

describe("railWindow", () => {
  it("창보다 짧으면 전부 보여 준다", () => {
    expect(railWindow(steps(5), 3, 9)).toEqual({ start: 0, end: 5 });
  });

  it("활성 스텝을 가운데 둔다", () => {
    // 33개 중 20번(index 19) → 19 - 4 = 15 부터 9개
    expect(railWindow(steps(33), 20, 9)).toEqual({ start: 15, end: 24 });
  });

  it("앞쪽에서는 창이 밀려나지 않는다", () => {
    expect(railWindow(steps(33), 2, 9)).toEqual({ start: 0, end: 9 });
  });

  it("뒤쪽에서는 마지막에 붙어 멈춘다", () => {
    expect(railWindow(steps(33), 33, 9)).toEqual({ start: 24, end: 33 });
  });

  it("활성 스텝이 없으면 **뒤쪽**을 보여 준다 — 기다리는 것은 방금 온 줄이다", () => {
    expect(railWindow(steps(33), null, 9)).toEqual({ start: 24, end: 33 });
  });

  it("활성 번호가 목록에 없어도 뒤쪽으로 떨어진다(빠진 sequence)", () => {
    expect(railWindow(steps(33), 999, 9)).toEqual({ start: 24, end: 33 });
  });

  it("스텝이 하나도 없으면 빈 창이다", () => {
    expect(railWindow([], null, 9)).toEqual({ start: 0, end: 0 });
  });
});
