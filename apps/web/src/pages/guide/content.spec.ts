import { describe, expect, it } from "vitest";
/**
 * ★ 원본 md 를 **`?raw` 로 그대로 읽어 온다**(테스트 전용 import).
 * 앱 코드에서는 이 import 를 쓰지 않는다 — 쓰면 문서 전문이 번들에 들어간다.
 */
import sourceMarkdown from "../../../../../docs/AI로-테스트코드-만들기.md?raw";
import {
  AI_PROMPT,
  GUIDE_INTRO,
  GUIDE_SECTIONS,
  GUIDE_TITLE,
  TS_CODE_BLOCKS,
  type GuideBlock,
  type GuideTable,
} from "./content";

/**
 * ★ 원본 마크다운과 화면 내용의 **자동 대조**.
 *
 * 가이드 화면은 `docs/AI로-테스트코드-만들기.md` 를 옮긴 것이다. 같은 글이 두 곳에 있으면
 * 반드시 갈라진다 — 원본만 고치고 화면을 안 고치는 일이 언젠가 반드시 일어난다.
 * 그 위험을 "사람이 기억하기" 가 아니라 **깨지는 테스트**로 바꾼다.
 *
 * 여기서 대조하는 것:
 *   1. `##` / `###` 제목 — 절 구조가 같은가
 *   2. 4-백틱 펜스 안의 **AI 프롬프트 전문** — 글자 하나까지 같은가 (이 문서의 핵심)
 *   3. ```` ```ts ```` 코드 블록 6개 — 집합이 같은가
 *   4. 표의 모든 칸 — 수치·문구가 같은가
 *   5. 본문의 **모든 산문 줄** — 화면 데이터 어딘가에 그대로 들어 있는가
 *
 * 5번이 성립하는 이유: `content.ts` 가 문장을 **원본 md 문법 그대로** 담기 때문이다.
 * (`**굵게**` 를 `<strong>` 으로 바꿔 쓰는 순간 이 대조는 불가능해진다.)
 */

/* ── 원본 md 파싱 (테스트 전용) ────────────────────────────── */

/** 펜스(``` 또는 ````) 블록을 전부 떼어 내고 남은 줄만 돌려준다. */
function splitFences(md: string): { fences: { info: string; body: string }[]; rest: string[] } {
  const fences: { info: string; body: string }[] = [];
  const rest: string[] = [];

  let fence: { info: string; marker: string; lines: string[] } | null = null;
  for (const line of md.split("\n")) {
    const open = /^(`{3,})(.*)$/.exec(line);

    if (fence === null) {
      if (open !== null) {
        fence = { info: (open[2] ?? "").trim(), marker: open[1] ?? "```", lines: [] };
        continue;
      }
      rest.push(line);
      continue;
    }

    if (open !== null && (open[1] ?? "") === fence.marker && (open[2] ?? "").trim() === "") {
      fences.push({ info: fence.info, body: fence.lines.join("\n") });
      fence = null;
      continue;
    }
    fence.lines.push(line);
  }

  return { fences, rest };
}

const { fences, rest: proseLines } = splitFences(sourceMarkdown);

function headings(level: number): string[] {
  const prefix = `${"#".repeat(level)} `;
  return proseLines.filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length).trim());
}

/** `| a | b |` 줄 → `["a", "b"]`. 구분선(`|---|`)은 호출부가 거른다. */
function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const mdTableRows = proseLines
  .filter((l) => l.trim().startsWith("|"))
  .filter((l) => !/^\|[\s|:-]+\|$/.test(l.trim()))
  .map(tableCells);

/* ── 화면 데이터 쪽 수집 ───────────────────────────────────── */

const allBlocks: GuideBlock[] = [
  ...GUIDE_INTRO,
  ...GUIDE_SECTIONS.flatMap((section) => section.blocks),
];

const pageTables: GuideTable[] = allBlocks.flatMap((block) => {
  if (block.kind === "table") return [block.table];
  if (block.kind === "ol") return block.items.flatMap((i) => (i.table === undefined ? [] : [i.table]));
  return [];
});

/** 화면이 담고 있는 모든 산문 문자열(원본 md 문법 그대로). */
const pageProse: string[] = allBlocks.flatMap((block) => {
  switch (block.kind) {
    case "p":
    case "note":
      return [block.text];
    case "h3":
      return [block.text];
    case "ul":
      return [...block.items];
    case "ol":
      return block.items.flatMap((i) => [i.text, ...(i.sub ?? [])]);
    case "qa":
      return block.items.flatMap((i) => [i.q, ...i.a]);
    default:
      return [];
  }
});

const pageProseBlob = pageProse.join("\n");

/* ── 검사 ─────────────────────────────────────────────────── */

describe("가이드 화면 ↔ 원본 md 대조", () => {
  it("H1 이 같다", () => {
    expect(headings(1)).toEqual([GUIDE_TITLE]);
  });

  it("절(`##`) 제목과 순서가 같다", () => {
    expect(headings(2)).toEqual(GUIDE_SECTIONS.map((s) => s.title));
  });

  it("소절(`###`) 제목과 순서가 같다", () => {
    const pageH3 = allBlocks.flatMap((b) => (b.kind === "h3" ? [b.text] : []));
    expect(headings(3)).toEqual(pageH3);
  });

  it("★ AI 프롬프트가 원본과 글자 하나까지 같다", () => {
    // 프롬프트만 4-백틱 펜스다(안에 3-백틱이 없어서 굳이 4개일 필요는 없지만 원본이 그렇다).
    const promptFence = fences.find((f) => f.info === "");
    expect(promptFence).toBeDefined();
    expect(AI_PROMPT).toBe(promptFence?.body);
  });

  it("```ts 코드 블록이 순서까지 같다", () => {
    const mdTs = fences.filter((f) => f.info === "ts").map((f) => f.body);
    expect(mdTs).toHaveLength(6);
    expect(TS_CODE_BLOCKS).toEqual(mdTs);
  });

  it("화면이 그리는 코드 블록이 원본 코드 블록 집합과 같다", () => {
    const rendered = allBlocks.flatMap((b) => (b.kind === "code" ? [b.code] : []));
    const expected = new Set([AI_PROMPT, ...TS_CODE_BLOCKS]);
    expect(new Set(rendered)).toEqual(expected);
  });

  it("표의 모든 줄(머리·본문)이 그대로 옮겨졌다", () => {
    const pageRows = pageTables.flatMap((t) => [t.head, ...t.rows]).map((r) => r.join(" | "));
    const mdRows = mdTableRows.map((r) => r.join(" | "));
    expect(pageRows.toSorted()).toEqual(mdRows.toSorted());
  });

  it("본문 산문이 한 줄도 빠지지 않았다", () => {
    const missing = proseLines
      .map((line) => line.trim())
      // 제목 · 표 · 수평선 · 빈 줄은 위에서 따로 검사했다.
      .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("|") && line !== "---")
      // 리스트 마커(`- ` `1. ` `> `)만 떼고 본문을 남긴다. 화면 데이터에는 마커가 없다.
      .map((line) => line.replace(/^(?:[-*]\s+|\d+\.\s+|>\s*)/, "").trim())
      .filter((line) => line !== "")
      .filter((line) => !pageProseBlob.includes(line));

    expect(missing).toEqual([]);
  });

  it("앵커 id 가 중복되지 않는다 (목차 이동이 엉키지 않도록)", () => {
    const ids = [
      ...GUIDE_SECTIONS.map((s) => s.id),
      ...allBlocks.flatMap((b) => (b.kind === "h3" ? [b.id] : [])),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("원본 md 에 이 화면이 해석하지 못하는 인라인 문법이 없다", () => {
    // `InlineMd` 는 `**굵게**` `*기울임*` `` `코드` `` 만 안다.
    // 링크·이미지가 새로 들어오면 화면에서 원문 그대로 노출되므로 여기서 막는다.
    const body = proseLines.filter((l) => !l.startsWith("#")).join("\n");
    expect(body).not.toMatch(/!\[[^\]]*\]\(/);
    expect(body.replace(/`[^`]*`/g, "")).not.toMatch(/\[[^\]]*\]\([^)]*\)/);
  });
});
