import { describe, expect, it } from "vitest";
import {
  EMPTY_MARK,
  formatDateLabel,
  formatDurationMs,
  formatMonthDay,
  formatRatioPercent,
  formatRelativeTime,
  formatScenarioMeta,
  toBarWidth,
} from "./format";

/** 모든 케이스가 이 시각을 "지금"으로 본다. `new Date()` 를 쓰면 자정에 깨진다. */
const NOW = new Date(2026, 8, 17, 14, 32, 0); // 2026-09-17 14:32 로컬

describe("formatDurationMs", () => {
  it("시안 지표 표기(2m 14s)를 따른다", () => {
    expect(formatDurationMs(134_000)).toBe("2m 14s");
  });

  it("1분 미만은 초만, 1초 미만은 ms 로 낸다", () => {
    expect(formatDurationMs(7_997)).toBe("8s");
    expect(formatDurationMs(835)).toBe("835ms");
  });

  it("1시간을 넘으면 h/m 로 올린다", () => {
    expect(formatDurationMs(3_720_000)).toBe("1h 02m");
  });

  it("null 은 지어내지 않고 — 로 낸다", () => {
    expect(formatDurationMs(null)).toBe(EMPTY_MARK);
  });
});

describe("formatRatioPercent / toBarWidth", () => {
  it("0~1 비율을 백분율로 바꾼다", () => {
    // 54.550000000000004 가 아니라 54.549999… 로 저장되는 부동소수 특성상
    // `toFixed(1)` 은 54.5 로 내린다. 실측을 그대로 기록한다.
    expect(formatRatioPercent(0.5455)).toBe("54.5%");
    expect(formatRatioPercent(0.896)).toBe("89.6%");
    expect(formatRatioPercent(0)).toBe("0.0%");
  });

  it("진행바 폭은 0~100 으로 자른다", () => {
    expect(toBarWidth(71.4286)).toBe("71%");
    expect(toBarWidth(-5)).toBe("0%");
    expect(toBarWidth(150)).toBe("100%");
  });
});

describe("formatRelativeTime", () => {
  it("시안 표기(방금 전 / N분 전 / N시간 전)를 따른다", () => {
    expect(formatRelativeTime(new Date(2026, 8, 17, 14, 31, 40).toISOString(), NOW)).toBe("방금 전");
    expect(formatRelativeTime(new Date(2026, 8, 17, 14, 24, 0).toISOString(), NOW)).toBe("8분 전");
    expect(formatRelativeTime(new Date(2026, 8, 17, 13, 32, 0).toISOString(), NOW)).toBe("1시간 전");
  });

  it("일주일이 넘으면 날짜로 떨어진다", () => {
    expect(formatRelativeTime(new Date(2026, 8, 1, 9, 0, 0).toISOString(), NOW)).toBe("9월 1일");
  });

  it("startedAt 이 null 인 대기 중 실행도 깨지지 않는다", () => {
    expect(formatRelativeTime(null, NOW)).toBe(EMPTY_MARK);
  });
});

describe("formatDateLabel", () => {
  it("오늘은 시각까지, 어제는 어제로 낸다", () => {
    expect(formatDateLabel(new Date(2026, 8, 17, 9, 5, 0).toISOString(), NOW)).toBe("오늘 09:05");
    expect(formatDateLabel(new Date(2026, 8, 16, 23, 59, 0).toISOString(), NOW)).toBe("어제");
  });

  it("그 전은 월·일로 낸다", () => {
    expect(formatDateLabel(new Date(2026, 8, 15, 10, 0, 0).toISOString(), NOW)).toBe("9월 15일");
  });

  it("해가 다르면 연도를 붙인다", () => {
    expect(formatMonthDay(new Date(2025, 8, 15), NOW)).toBe("2025년 9월 15일");
  });
});

describe("formatScenarioMeta", () => {
  it("시안 보조 텍스트 형식과 같다", () => {
    expect(formatScenarioMeta("TC-AUTH-001", 5)).toBe("TC-AUTH-001 · 5개 스텝");
  });
});
