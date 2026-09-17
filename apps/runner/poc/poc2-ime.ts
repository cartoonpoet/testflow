/**
 * PoC-2 — 한글 IME 입력 정확도 (03-phases Task 12.1)
 *
 * ## 무엇을 재는가
 *  1. **왕복 정확도** — 넣은 한글 문자열과 `input.value` 가 **한 글자도 다르지 않은가**.
 *     (받침 유무 / 쌍자음 / 복합모음 / 한영 혼용 / 한글+숫자 / 공백 / 이모지)
 *  2. **A안(`Input.insertText`)의 알려진 한계가 실제로 재현되는가** —
 *     `insertText` 는 `keydown`/`keypress`/`keyup` 을 발생시키지 않는다(`beforeinput`/`input` 만).
 *     `keydown` 에 의존하는 위젯 3종(자동완성 · 숫자 마스킹 · 단축키)에서 실제로 깨지는지 본다.
 *  3. **B안(`Input.imeSetComposition` / `imeCommitComposition`) 이 그 한계를 해소하는가.**
 *     ⚠️ 제품 코드(`src/record/input-bridge.ts`)의 B안은 **여전히 미구현**이다.
 *        여기서는 승급 판정의 근거를 만들기 위해 **PoC 안에서만** CDP 를 직접 친다.
 *
 * ## 실행
 * ```
 * yarn workspace @testflow/runner build:poc
 * node dist-poc/poc/poc2-ime.js            # 결과 JSON 을 stdout 으로
 * node dist-poc/poc/poc2-ime.js --headed   # 눈으로 확인
 * ```
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import type { CDPSession, Page } from "playwright";

import { createInputBridge } from "../src/record/input-bridge.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `dist-poc/poc/` 에서 돌기 때문에 fixture 는 소스 트리에서 찾는다. */
const FIXTURE = pathToFileURL(join(HERE, "../../poc/fixtures/ime-test.html")).href;

/* ── 측정 케이스 ─────────────────────────────────────────── */

export interface ImeCase {
  id: string;
  text: string;
  note: string;
}

/** 한글의 실패 유형을 갈라 놓은 목록. "그냥 한글 한 줄" 로는 조합 실패가 안 드러난다. */
export const IME_CASES: readonly ImeCase[] = [
  { id: "no-batchim", text: "가나다", note: "받침 없는 글자만" },
  { id: "batchim", text: "한글 받침", note: "받침 있는 글자" },
  { id: "double-consonant", text: "깎다 빨갛다 있다", note: "쌍자음(ㄲ·ㅃ)·겹받침(ㅎ·ㅆ)" },
  { id: "compound-vowel", text: "왼쪽 의외로 웬만큼", note: "복합모음(ㅚ·ㅢ·ㅞ)" },
  { id: "greeting", text: "안녕하세요", note: "04-gen-10 이 넣어 본 문자열(재확인)" },
  { id: "sentence", text: "계약서를 검토합니다", note: "법무 도메인 실문장" },
  { id: "mixed-en", text: "TestFlow 계약서 Review", note: "한글+영문 혼용" },
  { id: "mixed-num", text: "계약서 3건 검토 2026년", note: "한글+숫자" },
  { id: "spaces", text: "앞  뒤  공백  두칸", note: "연속 공백 보존" },
  { id: "emoji", text: "계약 완료 ✅ 검토 🔍", note: "이모지(서로게이트 페어)" },
  { id: "punct", text: "제1조(목적) — “계약”의 정의", note: "한글+전각 문장부호" },
  { id: "long", text: "계약서를 검토하고 전자서명을 요청한 뒤 결재 상신합니다", note: "장문(28자)" },
];

/* ── 주입 방식 4종 ───────────────────────────────────────── */

export type MethodId =
  | "rawInsertText"
  | "productBridge"
  | "keyboardType"
  | "imeComposition";

export interface MethodResult {
  method: MethodId;
  label: string;
  /** 왕복 정확도 — 케이스별 일치 여부. */
  cases: { id: string; expected: string; actual: string; match: boolean }[];
  accuracy: string;
  /** keydown 에 의존하는 위젯 3종 + composition 관측. */
  widgets: {
    autocompleteKeydown: number;
    autocompleteInput: number;
    autocompleteSuggestions: number;
    numericKeydown: number;
    numericBlocked: number;
    numericValue: string;
    shortcutKeydown: number;
    shortcutSubmitted: number;
    shortcutLastSubmitted: string;
    compositionStart: number;
    compositionUpdate: number;
    compositionEnd: number;
    compositionValue: string;
    plainKeydown: number;
    plainBeforeinput: number;
    plainInput: number;
  };
}

interface Injector {
  id: MethodId;
  label: string;
  type: (text: string) => Promise<void>;
}

/** 한글 1글자를 초성부터 쌓아 올리는 조합 단계 — 실제 IME 가 보내는 중간 상태를 흉내낸다. */
function compositionStepsFor(text: string): string[] {
  // 글자 단위 누적: "한글" → ["한", "한글"]. 자모 단위까지 쪼개지 않아도
  // compositionupdate 가 여러 번 발생하는지 확인하는 데는 충분하다.
  const chars = [...text];
  return chars.map((_, i) => chars.slice(0, i + 1).join(""));
}

async function buildInjectors(page: Page, cdp: CDPSession): Promise<Injector[]> {
  const bridge = await createInputBridge(page, { driver: "cdp" });

  return [
    {
      id: "rawInsertText",
      label: "A안(원형) — Input.insertText 단독. keydown 을 만들지 않는다",
      type: async (text) => {
        await cdp.send("Input.insertText", { text });
      },
    },
    {
      id: "productBridge",
      label: "A안+ (현재 제품 구현) — input-bridge.insertText = keydown(229) + insertText",
      type: (text) => bridge.insertText(text),
    },
    {
      id: "keyboardType",
      label: "대조군 — page.keyboard.type (Playwright 고수준 API)",
      type: (text) => page.keyboard.type(text, { delay: 1 }),
    },
    {
      id: "imeComposition",
      label: "B안 — Input.imeSetComposition + imeCommitComposition (PoC 전용 직접 호출)",
      type: async (text) => {
        for (const partial of compositionStepsFor(text)) {
          await cdp.send("Input.imeSetComposition", {
            text: partial,
            selectionStart: partial.length,
            selectionEnd: partial.length,
          });
        }
        await cdp.send("Input.insertText", { text });
      },
    },
  ];
}

/* ── 측정 ────────────────────────────────────────────────── */

async function measureMethod(page: Page, injector: Injector): Promise<MethodResult> {
  const cases: MethodResult["cases"] = [];

  // 1) 왕복 정확도 — 대조군 input(①)에 넣고 그대로 읽는다.
  for (const testCase of IME_CASES) {
    await page.evaluate("window.__imeReset()");
    await page.focus("#plain");
    await injector.type(testCase.text);
    // insertText 는 동기적으로 반영되지만 keyboard.type 은 마지막 키가 남을 수 있다.
    await page.waitForTimeout(30);
    const actual = await page.inputValue("#plain");
    cases.push({
      id: testCase.id,
      expected: testCase.text,
      actual,
      match: actual === testCase.text,
    });
  }

  // 2) keydown 의존 위젯 — 리셋하고 각 위젯에 같은 문자열을 넣는다.
  await page.evaluate("window.__imeReset()");

  await page.focus("#plain");
  await injector.type("계약서");

  await page.focus("#autocomplete");
  await injector.type("계약서");
  await page.waitForTimeout(60); // 자동완성은 setTimeout(0) 뒤에 목록을 그린다.

  await page.focus("#numeric");
  await injector.type("한글123");
  await page.waitForTimeout(30);

  await page.focus("#shortcut");
  await injector.type("제출할내용");
  await page.keyboard.press("Enter"); // Enter 는 어느 방식이든 키 이벤트로 보낸다(단축키 자체 검증).
  await page.waitForTimeout(30);

  await page.focus("#composition");
  await injector.type("조합확인");
  await page.waitForTimeout(30);

  const widgets = (await page.evaluate("window.__imeSnapshot()")) as MethodResult["widgets"];

  const matched = cases.filter((c) => c.match).length;

  return {
    method: injector.id,
    label: injector.label,
    cases,
    accuracy: `${String(matched)}/${String(cases.length)}`,
    widgets,
  };
}

export async function runPoc2(options: { headless?: boolean } = {}): Promise<{
  fixture: string;
  results: MethodResult[];
}> {
  const browser = await chromium.launch({ headless: options.headless ?? true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(FIXTURE);

    const cdp = await context.newCDPSession(page);
    const injectors = await buildInjectors(page, cdp);

    const results: MethodResult[] = [];
    for (const injector of injectors) {
      results.push(await measureMethod(page, injector));
    }
    return { fixture: FIXTURE, results };
  } finally {
    await browser.close();
  }
}

const isDirect = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");

if (isDirect) {
  const headless = !process.argv.includes("--headed");
  runPoc2({ headless })
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
