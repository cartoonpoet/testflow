import { describe, expect, it } from "vitest";
import {
  AI_PROMPT,
  GUIDE_INTRO,
  GUIDE_SECTIONS,
  GUIDE_TITLE,
  TS_CODE_BLOCKS,
  type GuideBlock,
} from "./content";

/**
 * 가이드 화면 데이터(`content.ts`) 자체의 건강성 검사.
 *
 * ★ 원래 이 파일은 `docs/` 의 원본 md 를 `?raw` 로 읽어 화면과 **자동 대조**했다.
 *   같은 글이 두 곳에 있으면 반드시 갈라지기 때문이다.
 *   **그 md 를 지우고 이 화면을 단일 출처로 삼기로 결정**했으므로 대조 대상이 없어졌다.
 *   → 대조 테스트 9건을 걷어내고, **md 없이도 성립하는 검사만** 남긴다.
 *
 * 여기서 지키는 것:
 *   1. 앵커 id 가 중복되지 않는다 — 목차 이동이 엉키지 않도록
 *   2. `InlineMd` 가 해석하지 못하는 인라인 문법(링크·이미지)이 본문에 없다
 *      — 들어오면 화면에 원문이 그대로 노출된다
 *   3. 핵심 산출물(AI 프롬프트)과 절 구조가 비어 있지 않다
 */

const allBlocks: GuideBlock[] = [...GUIDE_INTRO, ...GUIDE_SECTIONS.flatMap((s) => [...s.blocks])];

/** `InlineMd` 가 렌더하는 인라인 문법이 쓰인 산문 문자열 전량. */
function proseStrings(): string[] {
  const out: string[] = [GUIDE_TITLE, ...GUIDE_SECTIONS.map((s) => s.title)];
  for (const b of allBlocks) {
    switch (b.kind) {
      case "p":
      case "note":
      case "h3":
        out.push(b.text);
        break;
      case "ul":
        out.push(...b.items);
        break;
      case "ol":
        for (const item of b.items) {
          out.push(item.text);
          if (item.sub !== undefined) out.push(...item.sub);
          if (item.table !== undefined) out.push(...item.table.head, ...item.table.rows.flat());
        }
        break;
      case "qa":
        for (const item of b.items) out.push(item.q, ...item.a);
        break;
      case "table":
        out.push(...b.table.head, ...b.table.rows.flat());
        break;
      case "code":
        break;
    }
  }
  return out;
}

describe("가이드 화면 데이터", () => {
  it("앵커 id 가 중복되지 않는다 (목차 이동이 엉키지 않도록)", () => {
    const ids = [
      ...GUIDE_SECTIONS.map((s) => s.id),
      ...allBlocks.flatMap((b) => (b.kind === "h3" ? [b.id] : [])),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("InlineMd 가 해석하지 못하는 인라인 문법이 없다", () => {
    // `InlineMd` 는 `**굵게**` `*기울임*` `` `코드` `` 만 안다.
    // 링크·이미지가 들어오면 화면에서 원문 그대로 노출되므로 여기서 막는다.
    const body = proseStrings().join("\n");
    expect(body).not.toMatch(/!\[[^\]]*\]\(/);
    expect(body.replace(/`[^`]*`/g, "")).not.toMatch(/\[[^\]]*\]\([^)]*\)/);
  });

  it("`코드` 를 **굵게** 안에 넣지 않는다 (백틱이 화면에 그대로 보인다)", () => {
    /*
     * ★ `InlineMd` 는 **중첩을 모른다.** 규칙 3개가 교대(alternation)로만 붙어 있어서
     *   `**… `코드` …**` 를 만나면 바깥 `**` 가 먼저 잡히고 안쪽 백틱은 **글자로 남는다.**
     *   화면에 `` `change` `` 처럼 백틱이 그대로 노출된다 — 링크·이미지와 같은 종류의 사고다.
     *   실제로 이 검사를 넣기 전에 본문 11곳에서 백틱이 새고 있었다.
     *   고치는 법은 간단하다: 코드 칩을 굵게 밖으로 빼라 (``**파일 1개** · `test()` **1개**``).
     */
    const leaks: string[] = [];
    for (const line of proseStrings()) {
      for (const match of line.matchAll(/\*\*([\s\S]+?)\*\*/g)) {
        if ((match[1] ?? "").includes("`")) leaks.push(match[0]);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("핵심 산출물과 절 구조가 비어 있지 않다", () => {
    // AI 프롬프트는 이 화면의 존재 이유다. 복사 버튼이 빈 문자열을 복사하면 안 된다.
    expect(AI_PROMPT.trim().length).toBeGreaterThan(200);
    expect(AI_PROMPT).toContain("@playwright/test");

    expect(GUIDE_SECTIONS.length).toBeGreaterThan(0);
    for (const s of GUIDE_SECTIONS) {
      expect(s.title.trim()).not.toBe("");
      expect(s.blocks.length).toBeGreaterThan(0);
    }
    expect(TS_CODE_BLOCKS.length).toBeGreaterThan(0);
    for (const code of TS_CODE_BLOCKS) expect(code.trim()).not.toBe("");
  });

  it("AI 프롬프트가 길이 예산 안에 있다", () => {
    /*
     * ★ 프롬프트는 **길어질수록 효과가 떨어진다.** AI 가 앞부분을 흘린다.
     *   실전 함정을 반영하면서 항목을 늘리고 싶은 유혹이 계속 생기는 자리라,
     *   "늘릴 수는 있지만 공짜가 아니다" 를 여기서 숫자로 못 박는다.
     *   넘기고 싶으면 **기존 항목을 묶어서** 자리를 만들어라.
     */
    const items = AI_PROMPT.split("\n").filter((line) => /^\d+\. /.test(line));
    expect(items.length).toBeLessThanOrEqual(10);
    expect(AI_PROMPT.length).toBeLessThanOrEqual(1800);

    // 번호가 1부터 빠짐없이 이어져야 한다 — 본문이 "제약 1번" 처럼 번호로 가리킨다.
    expect(items.map((line) => Number(line.split(".")[0]))).toEqual(
      items.map((_, index) => index + 1),
    );
  });
});
