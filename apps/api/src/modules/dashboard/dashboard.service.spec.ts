import { describe, expect, it } from "vitest";
import { startOfRange } from "./dashboard.service.js";

/**
 * 기간 경계는 **서버 로컬 자정** 기준이다.
 * MySQL 의 `CURDATE()` 를 쓰지 않는 이유는 `runs.queued_at` 이 앱이 넣은 UTC 값이라
 * 서버 타임존이 다르면 자정 근처에서 "오늘"이 하루 어긋나기 때문이다.
 */
describe("startOfRange", () => {
  const now = new Date(2026, 8, 17, 15, 42, 47, 362); // 2026-09-17 15:42 로컬

  it("today → 오늘 00:00:00.000 로컬", () => {
    const start = startOfRange("today", now);
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 8, 17]);
    expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()])
      .toEqual([0, 0, 0, 0]);
  });

  it("7d → 6일 전 자정(오늘 포함 7일)", () => {
    expect(startOfRange("7d", now).getDate()).toBe(11);
  });

  it("30d → 29일 전 자정(오늘 포함 30일). 월 경계를 넘긴다", () => {
    const start = startOfRange("30d", now);
    expect(start.getMonth()).toBe(7); // 8월
    expect(start.getDate()).toBe(19);
  });

  it("경계 시각이 실행 시각보다 항상 과거다", () => {
    for (const range of ["today", "7d", "30d"] as const) {
      expect(startOfRange(range, now).getTime()).toBeLessThan(now.getTime());
    }
  });
});
