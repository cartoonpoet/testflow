/**
 * 라운드 9 · 가이드 화면(실전 함정 절 추가) 렌더 검증(일회성).
 * `node .pipeline/20260917-231945/g17-guide.mjs`  (미리 `pnpm --filter @testflow/web preview`)
 *
 * 목차 이동 · 가로 넘침 · 복사 버튼 · 반응형 · 콘솔 에러를 화면에서 본다.
 */
import { createRequire } from "node:module";
const require_ = createRequire("/mnt/c/Users/jhson1/Documents/GitHub/testflow/apps/runner/package.json");
const { chromium } = require_("playwright");
import { readFileSync, writeFileSync } from "node:fs";

const OUT = ".pipeline/20260917-231945";
const WEB = "http://localhost:4173";
const GUIDE = `${WEB}/guide`;

const report = [];
const say = (l) => { console.log(l); report.push(l); };
const r = { pass: 0, fail: 0 };
const check = (label, ok, detail = "") => {
  if (ok) { r.pass += 1; say(`  ✔ ${label}${detail && ` — ${detail}`}`); }
  else { r.fail += 1; say(`  ✘ ${label}${detail && ` — ${detail}`}`); }
};

/** content.ts 의 AI_PROMPT 를 그대로 읽어 온다(복사 버튼 대조용). */
function aiPrompt() {
  const src = readFileSync("apps/web/src/pages/guide/content.ts", "utf8");
  const m = src.match(/export const AI_PROMPT = `([\s\S]*?)`;\n/);
  return m[1].replace(/\\`/g, "`");
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: WEB });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

say("## 1. 목차 · 앵커 이동");
await page.goto(GUIDE, { waitUntil: "networkidle" });
await page.waitForSelector('[data-slot="guide-body"]');

const tocLinks = await page.locator('[data-slot="guide-toc"] > ol > li > a').allTextContents();
say(`  목차(절): ${JSON.stringify(tocLinks)}`);
check("절이 7개다", tocLinks.length === 7, `${tocLinks.length}개`);
check(
  "새 절이 목차에 있다",
  tocLinks.some((t) => t.includes("제약은 지켰는데 안 도는 이유")),
);

const ids = await page.$$eval("h2[id], h3[id]", (els) => els.map((e) => e.id));
check("앵커 id 중복 없음", new Set(ids).size === ids.length, `${ids.length}개`);
const NEW_IDS = ["pitfalls", "editor-fill", "iframe-title", "aria-hidden", "data-names", "nth-count", "first-click", "no-assert", "run-artifacts", "run-batch"];
check("새 앵커가 전부 DOM 에 있다", NEW_IDS.every((i) => ids.includes(i)), NEW_IDS.filter((i) => !ids.includes(i)).join(",") || "누락 0");

// 목차 링크로 이동 → 제목이 화면 안에 들어오는가
await page.click('[data-slot="guide-toc"] a[href="#pitfalls"]');
await page.waitForTimeout(400);
const hash = new URL(page.url()).hash;
const top = await page.$eval("#pitfalls", (e) => Math.round(e.getBoundingClientRect().top));
check("주소에 앵커가 남는다", hash.endsWith("#pitfalls"), hash);
check("제목이 화면 안(탑바 아래)으로 온다", top >= 0 && top < 200, `top=${top}px`);

// 소절 앵커도
await page.click('[data-slot="guide-toc"] a[href="#editor-fill"]');
await page.waitForTimeout(400);
const top2 = await page.$eval("#editor-fill", (e) => Math.round(e.getBoundingClientRect().top));
check("소절 앵커 이동", top2 >= 0 && top2 < 200, `top=${top2}px`);

say("");
say("## 2. 가로 넘침 (본문은 안 넘치고, 코드 블록 안에서만 스크롤)");
for (const w of [1440, 1050, 760, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    pres: [...document.querySelectorAll('[data-slot="guide-pre"]')].map((p) => ({
      over: p.scrollWidth > p.clientWidth,
      w: Math.round(p.clientWidth),
    })),
  }));
  check(
    `${w}px — body 가로 안 넘침`,
    m.scrollWidth <= m.clientWidth && m.docScroll <= m.docClient,
    `body ${m.scrollWidth}/${m.clientWidth} · doc ${m.docScroll}/${m.docClient}`,
  );
  const scrollable = m.pres.filter((p) => p.over).length;
  say(`     코드 블록 ${m.pres.length}개 중 자체 가로 스크롤 ${scrollable}개`);
}

say("");
say("## 3. 프롬프트 복사 버튼");
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(GUIDE, { waitUntil: "networkidle" });
const copyButtons = page.locator('[data-slot="guide-copy"]');
check("복사 버튼 2개", (await copyButtons.count()) === 2, `${await copyButtons.count()}개`);
await copyButtons.first().click();
await page.waitForTimeout(400);
const clip = await page.evaluate(() => navigator.clipboard.readText());
const expected = aiPrompt();
check("복사 내용이 AI_PROMPT 전문과 같다", clip === expected, `복사 ${clip.length}자 / 원본 ${expected.length}자`);
check("버튼이 '복사됨' 으로 바뀐다", (await copyButtons.first().textContent()).includes("복사됨"));

say("");
say("## 4. 길이 · 반응형 스크린샷");
const metrics = await page.evaluate(() => ({
  bodyHeight: Math.round(document.querySelector('[data-slot="guide-body"]').getBoundingClientRect().height),
  sections: document.querySelectorAll('[data-slot="guide-section"]').length,
  pres: document.querySelectorAll('[data-slot="guide-pre"]').length,
}));
say(`  본문 높이 ${metrics.bodyHeight}px · 절 ${metrics.sections}개 · 코드블록 ${metrics.pres}개`);

for (const w of [1050, 760]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(GUIDE, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const toc = await page.evaluate(() => {
    const n = document.querySelector('[data-slot="guide-toc"]');
    const rect = n.getBoundingClientRect();
    return { height: Math.round(rect.height), subs: n.querySelectorAll("ol ol a").length, top: Math.round(rect.top) };
  });
  say(`  ${w}px — 목차 높이 ${toc.height}px · 소절 링크 ${toc.subs}개`);
  check(`${w}px 목차가 첫 화면을 다 먹지 않는다`, toc.height < 500, `${toc.height}px`);
  await page.screenshot({ path: `${OUT}/g17-guide-vw${w}.png`, fullPage: false });
}

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(GUIDE, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/g17-guide-1440.png` });
await page.locator("#pitfalls").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/g17-guide-pitfalls.png` });

say("");
say("## 5. 콘솔");
check("콘솔 에러 0건", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | ") || "0건");

say("");
say(`RESULT  pass=${r.pass}  fail=${r.fail}`);
writeFileSync(`${OUT}/g17-guide.log.md`, report.join("\n") + "\n");
await browser.close();
process.exit(r.fail === 0 ? 0 : 1);
