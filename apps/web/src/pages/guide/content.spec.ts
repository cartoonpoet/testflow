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
});
