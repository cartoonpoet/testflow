import { describe, expect, it } from "vitest";
import { parseByteRange } from "./artifacts.service.js";

/**
 * ★ 라운드 4 — `<video>` 의 seek 을 받치는 Range 파서.
 *
 * 이 파서가 없으면 `GET /api/artifacts/:id` 는 언제나 200 + 전체를 준다. 그러면 브라우저는
 * **탐색을 포기하거나**(진행 바를 끌어도 되감기지 않는다) 파일을 통째로 다시 받는다.
 * 실측으로 확인한 실패 모드라 파싱 규칙을 테스트로 고정한다.
 */
const SIZE = 1_000;

describe("parseByteRange — 단일 구간", () => {
  it("헤더가 없으면 null(= 전체를 준다, 200)", () => {
    expect(parseByteRange(undefined, SIZE)).toBeNull();
    expect(parseByteRange("", SIZE)).toBeNull();
  });

  it("bytes=0-99 → 첫 100바이트", () => {
    expect(parseByteRange("bytes=0-99", SIZE)).toEqual({ start: 0, end: 99 });
  });

  it("★ bytes=0-1000 은 파일 끝까지로 잘린다(초과분을 거부하지 않는다)", () => {
    // curl -r 0-1000 이 정확히 이 형태다. 파일이 1000바이트면 끝 인덱스는 999 다.
    expect(parseByteRange("bytes=0-1000", SIZE)).toEqual({ start: 0, end: SIZE - 1 });
  });

  it("bytes=500- → 500부터 끝까지 (브라우저가 이어받을 때 쓴다)", () => {
    expect(parseByteRange("bytes=500-", SIZE)).toEqual({ start: 500, end: 999 });
  });

  it("bytes=-200 → 마지막 200바이트 (webm 은 메타데이터를 꼬리에서 찾기도 한다)", () => {
    expect(parseByteRange("bytes=-200", SIZE)).toEqual({ start: 800, end: 999 });
  });

  it("공백이 붙어도 읽는다", () => {
    expect(parseByteRange("  bytes=10-20 ", SIZE)).toEqual({ start: 10, end: 20 });
  });
});

describe("parseByteRange — 거부 / 미지원", () => {
  it("★ 다중 구간은 지원하지 않는다 — null 로 떨어져 전체를 준다(있는 척하지 않는다)", () => {
    // 지원한다고 206 을 주면서 한 구간만 보내면 브라우저가 조용히 깨진 파일을 받는다.
    expect(parseByteRange("bytes=0-9,20-29", SIZE)).toBeNull();
  });

  it("bytes 가 아닌 단위는 무시한다", () => {
    expect(parseByteRange("items=0-9", SIZE)).toBeNull();
  });

  it("시작이 파일 끝을 넘으면 416", () => {
    expect(parseByteRange("bytes=1000-1200", SIZE)).toBe("unsatisfiable");
  });

  it("시작 > 끝이면 416", () => {
    expect(parseByteRange("bytes=500-100", SIZE)).toBe("unsatisfiable");
  });

  it("빈 파일에 대한 Range 는 416", () => {
    expect(parseByteRange("bytes=0-10", 0)).toBe("unsatisfiable");
  });

  it("suffix 0(`bytes=-0`)은 416 — 줄 바이트가 없다", () => {
    expect(parseByteRange("bytes=-0", SIZE)).toBe("unsatisfiable");
  });
});
