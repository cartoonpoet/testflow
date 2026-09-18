/**
 * 라운드 8 · 삭제 UX 화면 검증(일회성). `node .pipeline/20260917-231945/g16-ui.mjs`
 *
 * 확인 대화상자가 **실제 개수**를 보여 주는지, 지운 뒤 목록·캐시가 갱신되는지,
 * 상세에서 지우면 목록으로 가는지, 콘솔 에러가 0건인지를 화면에서 본다.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(
  "/mnt/c/Users/jhson1/Documents/GitHub/testflow/apps/runner/package.json",
)("playwright");
import { writeFileSync } from "node:fs";

const OUT = ".pipeline/20260917-231945";
const WEB = "http://localhost:4173";
const API = "http://127.0.0.1:4000/api";
const PROJECT = "00000000-0000-4000-8000-000000000001";

const report = [];
const say = (line) => { console.log(line); report.push(line); };
const results = { pass: 0, fail: 0 };
const check = (label, ok, detail = "") => {
  if (ok) { results.pass += 1; say(`  ✔ ${label}${detail && ` — ${detail}`}`); }
  else { results.fail += 1; say(`  ✘ ${label}${detail && ` — ${detail}`}`); }
};

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? undefined : JSON.parse(text) };
}

/* ── fixture ─────────────────────────────────────────────────── */
say("══ fixture 만들기 ══");
const made = [];
for (let i = 1; i <= 3; i += 1) {
  const s = (await api("POST", `/projects/${PROJECT}/scenarios`, {
    name: `삭제UX 검증 ${i}`, feature: "UX", sourceType: "code", authorName: "g16",
  })).body;
  await api("PUT", `/scenarios/${s.id}/code`, {
    filename: "ux.spec.ts",
    content: "import { test, expect } from '@playwright/test';\ntest('x', async ({ page }) => { await page.goto('/'); await expect(page).toHaveTitle(/./); });\n",
  });
  for (const name of i === 1 ? ["a.csv", "b.csv"] : []) {
    await fetch(`${API}/scenarios/${s.id}/attachments?filename=${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.alloc(2048, 3),
    });
  }
  made.push(s);
  say(`  ${s.code} ${s.name} (첨부 ${i === 1 ? 2 : 0}개)`);
}

/* 끝난 run 3건 + 진행 중 run 1건 */
const doneRuns = [];
for (let i = 0; i < 3; i += 1) {
  const r = (await api("POST", "/runs", {
    scenarioId: made[0].id, baseUrl: "https://example.com", envLabel: "g16",
    browser: "chromium", variables: {}, secretKeys: [],
  })).body;
  await api("POST", `/runs/${r.runId}/cancel`);
  doneRuns.push(r.runId);
}
const liveRun = (await api("POST", "/runs", {
  scenarioId: made[1].id, baseUrl: "https://example.com", envLabel: "g16",
  browser: "chromium", variables: {}, secretKeys: [],
})).body.runId;
say(`  끝난 실행 3건 + 진행 중(queued) 1건 = ${liveRun}`);

/* ── 브라우저 ────────────────────────────────────────────────── */
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
context.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
context.on("pageerror", (err) => consoleErrors.push(String(err)));
const failedRequests = [];
context.on("response", (res) => {
  if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
});
const page = await context.newPage();

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/g16-${name}.png`, fullPage: false });
  say(`  [screenshot] g16-${name}.png`);
};

/* ── 1. 시나리오 목록 — 다중 선택 삭제 ───────────────────────── */
say("");
say("══ 1. 시나리오 목록 · 선택 삭제 ══");
await page.goto(`${WEB}/scenarios?q=삭제UX`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-slot="scenario-row"]');
const rows = await page.locator('[data-slot="scenario-row"]').count();
say(`  검색 결과 ${rows}행`);

await page.locator('[data-testid="scenario-select-all"]').check();
await page.waitForSelector('[data-slot="scenario-selection-bar"]');
const barCount = await page.locator('[data-slot="scenario-selection-bar"]').getAttribute("data-selected-count");
check("#14 선택 바가 그대로 뜨고 선택 삭제 버튼이 함께 있다",
  barCount === String(rows) &&
  (await page.locator('[data-testid="scenario-selection-run"]').isVisible()) &&
  (await page.locator('[data-testid="scenario-selection-delete"]').isVisible()),
  `selected=${barCount}`);
await shot("scenario-selection");

await page.locator('[data-testid="scenario-selection-delete"]').click();
await page.waitForSelector('[data-slot="modal"]');
const dialogText = (await page.locator('[data-slot="modal"]').innerText()).replace(/\n+/g, " | ");
say(`  대화상자 전문: ${dialogText}`);
check("제목이 건수를 말한다", dialogText.includes(`시나리오 ${rows}건을 삭제할까요?`));
check("★ 대상마다 코드와 딸린 것이 적힌다", made.every((s) => dialogText.includes(s.code)));
check("★ 되돌릴 수 없다고 분명히 말한다", dialogText.includes("되돌릴 수 없습니다"));
check("★ 실행 이력은 남는다는 사실을 말한다", dialogText.includes("실행 이력"));
await shot("scenario-delete-dialog");

await page.locator('[data-testid="scenario-delete-confirm"]').click();
await page.waitForSelector('[data-slot="modal"]', { state: "detached" });
await page.waitForTimeout(800);
const afterRows = await page.locator('[data-slot="scenario-row"]').count();
/*
 * ★ 3건 중 1건(`삭제UX 검증 2`)에는 일부러 진행 중인 실행을 걸어 두었다.
 *   서버가 그 1건을 `skipped` 로 돌려주므로 **2건만 사라지는 것이 정답**이다.
 *   이것이 화면에서 본 부분 성공이다.
 */
check("★ 삭제 후 목록이 갱신된다(캐시 무효화) — 진행 중 1건은 남는다",
  afterRows === 1, `${rows} → ${afterRows}행`);
const toastText = await page.locator('[data-slot="toaster"]').first().innerText().catch(() => "");
say(`  토스트: ${toastText.replace(/\n+/g, " | ")}`);
check("★ 부분 성공을 토스트가 그대로 말한다(건너뛴 이유 포함)",
  /삭제했습니다/.test(toastText) && toastText.includes("1건은 건너뛰었습니다") &&
  toastText.includes("진행 중인 실행이 있어"));
await shot("scenario-after-delete");

/* ── 2. 실행 목록 — 다중 선택 삭제 ──────────────────────────── */
say("");
say("══ 2. 실행 목록 · 선택 삭제 ══");
await page.goto(`${WEB}/runs`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-slot="run-row"]');

const allRows = await page.locator('[data-slot="run-row-wrap"]').count();
const boxes = await page.locator('[data-testid="run-select"]').count();
const disabledBoxes = await page.locator('[data-testid="run-select"][data-select-disabled="true"]').count();
const disabledTitle = await page.locator('[data-testid="run-select"][data-select-disabled="true"]').first().getAttribute("title").catch(() => null);
say(`  행 ${allRows}개 · 체크박스 ${boxes}개 · 그중 꺼진 것 ${disabledBoxes}개`);
say(`  꺼진 체크박스 title: ${disabledTitle}`);
check("모든 행이 체크 칸을 갖는다(칸을 비우지 않아 표가 어긋나지 않는다)",
  boxes === allRows, `${boxes} === ${allRows}`);
check("★ 진행 중인 실행의 체크박스는 꺼져 있고 이유가 title 로 붙는다(서버 409 와 같은 규칙)",
  disabledBoxes >= 1 && String(disabledTitle).includes("중단"), `${disabledBoxes}개`);

for (const id of doneRuns) {
  await page.locator(`[data-testid="run-select"][data-run-id="${id}"]`).check();
}
await page.waitForSelector('[data-slot="run-selection-bar"]');
check("실행 선택 바가 뜬다",
  (await page.locator('[data-slot="run-selection-bar"]').getAttribute("data-selected-count")) === "3");
await shot("run-selection");

await page.locator('[data-testid="run-selection-delete"]').click();
await page.waitForSelector('[data-slot="modal"]');
await page.waitForTimeout(600); // 증적 개수 조회가 도착할 시간
const runDialog = (await page.locator('[data-slot="modal"]').innerText()).replace(/\n+/g, " | ");
say(`  대화상자 전문: ${runDialog}`);
check("제목이 건수를 말한다", runDialog.includes("실행 이력 3건을 삭제할까요?"));
check("★ RUN- 코드가 대상마다 적힌다", (runDialog.match(/RUN-\d+/g) ?? []).length >= 3);
check("★ 증적이 함께 삭제된다고 말한다", runDialog.includes("증적"));
check("★ 되돌릴 수 없다고 분명히 말한다", runDialog.includes("되돌릴 수 없습니다"));
check("시나리오는 지워지지 않는다고 말한다", runDialog.includes("시나리오와 코드는"));
await shot("run-delete-dialog");

await page.locator('[data-testid="run-delete-confirm"]').click();
await page.waitForSelector('[data-slot="modal"]', { state: "detached" });
await page.waitForTimeout(800);
const goneAll = await Promise.all(doneRuns.map(async (id) => (await api("GET", `/runs/${id}`)).status));
check("★ 고른 3건이 실제로 사라졌다", goneAll.every((s) => s === 404), JSON.stringify(goneAll));
await shot("run-after-delete");

/* ── 2b. 증적이 실제로 있는 실행의 대화상자(지우지 않고 문구만 본다) ── */
say("");
say("══ 2b. 증적이 있는 실행의 확인 대화상자 — 실제 개수 표기 ══");
const allRuns = (await api("GET", `/runs?projectId=${PROJECT}&limit=100`)).body ?? [];
let withArtifacts = null;
for (const r of allRuns) {
  const list = (await api("GET", `/runs/${r.id}/artifacts`)).body ?? [];
  if (list.length > 0) { withArtifacts = { run: r, artifacts: list }; break; }
}
if (withArtifacts === null) {
  say("  ! 증적이 있는 실행이 없다 — 건너뛴다.");
} else {
  const bytes = withArtifacts.artifacts.reduce((sum, a) => sum + (a.sizeBytes ?? 0), 0);
  say(`  대상 ${withArtifacts.run.runCode}: 증적 ${withArtifacts.artifacts.length}개 · ${bytes} bytes`);
  await page.goto(`${WEB}/runs/${withArtifacts.run.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="run-delete-open"]');
  await page.locator('[data-testid="run-delete-open"]').click();
  await page.waitForSelector('[data-slot="modal"]');
  await page.waitForTimeout(500);
  const withArtifactDialog = (await page.locator('[data-slot="modal"]').innerText()).replace(/\n+/g, " | ");
  say(`  대화상자 전문: ${withArtifactDialog}`);
  check("★ 증적 개수를 실제 값으로 적는다",
    withArtifactDialog.includes(`증적 ${withArtifacts.artifacts.length}개`), withArtifactDialog);
  await shot("run-delete-dialog-with-artifacts");
  // ★ 지우지 않는다 — 문구만 본다. 취소로 닫는다.
  await page.getByRole("button", { name: "취소" }).click();
  await page.waitForSelector('[data-slot="modal"]', { state: "detached" });
  check("취소를 누르면 아무것도 지워지지 않는다",
    (await api("GET", `/runs/${withArtifacts.run.id}`)).status === 200);
}

/* ── 3. 실행 상세 — 진행 중이면 버튼이 꺼진다 ──────────────── */
say("");
say("══ 3. 실행 상세 · 진행 중이면 삭제 버튼이 꺼진다 ══");
await page.goto(`${WEB}/runs/${liveRun}`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="run-delete-open"]');
const disabled = await page.locator('[data-testid="run-delete-open"]').isDisabled();
const title = await page.locator('[data-testid="run-delete-open"]').getAttribute("title");
check("★ 진행 중이면 삭제 버튼이 꺼져 있다", disabled === true);
check("★ 이유가 title 로 붙는다(#14 재실행 버튼과 같은 방식)",
  String(title).includes("중단"), title);
await shot("run-detail-active-disabled");

/* ── 4. 실행 상세 — 끝난 실행 삭제 → 목록으로 ──────────────── */
say("");
say("══ 4. 실행 상세 · 삭제 후 목록으로 이동 ══");
await api("POST", `/runs/${liveRun}/cancel`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
check("취소된 뒤에는 삭제 버튼이 켜진다",
  (await page.locator('[data-testid="run-delete-open"]').isDisabled()) === false);

await page.locator('[data-testid="run-delete-open"]').click();
await page.waitForSelector('[data-slot="modal"]');
await page.waitForTimeout(500);
const detailDialog = (await page.locator('[data-slot="modal"]').innerText()).replace(/\n+/g, " | ");
say(`  대화상자 전문: ${detailDialog}`);
check("★ 단건 대화상자가 RUN 코드와 시나리오 이름을 적는다", /RUN-\d+/.test(detailDialog));
await shot("run-detail-delete-dialog");

await page.locator('[data-testid="run-delete-confirm"]').click();
await page.waitForURL(/\/runs$/, { timeout: 10_000 });
check("★ 상세에서 지우면 목록으로 이동한다", /\/runs$/.test(page.url()), page.url());
await shot("run-detail-after-delete");

/* ── 5. 코드 편집 화면 — 시나리오 삭제(첨부 개수 표시) ─────── */
say("");
say("══ 5. 코드 편집 화면 · 시나리오 삭제 ══");
const withAttachments = (await api("POST", `/projects/${PROJECT}/scenarios`, {
  name: "삭제UX 첨부확인", feature: "UX", sourceType: "code",
})).body;
await api("PUT", `/scenarios/${withAttachments.id}/code`, {
  filename: "ux.spec.ts",
  content: "import { test, expect } from '@playwright/test';\ntest('x', async ({ page }) => { await page.goto('/'); await expect(page).toHaveTitle(/./); });\n",
});
for (const name of ["a.csv", "b.csv", "c.csv"]) {
  await fetch(`${API}/scenarios/${withAttachments.id}/attachments?filename=${name}`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.alloc(1024, 5),
  });
}

await page.goto(`${WEB}/scenarios/${withAttachments.id}/code`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="scenario-delete-open"]');
const labels = await page.locator('[data-slot="button"]').allInnerTexts();
say(`  화면의 버튼 라벨: ${JSON.stringify(labels.filter((l) => l.trim() !== ""))}`);
check("★ 페이지 머리의 버튼은 '시나리오 삭제' 라 첨부 행의 '삭제' 와 섞이지 않는다",
  labels.includes("시나리오 삭제") && labels.includes("삭제"));
await shot("code-page-buttons");

await page.locator('[data-testid="scenario-delete-open"]').click();
await page.waitForSelector('[data-slot="modal"]');
const codeDialog = (await page.locator('[data-slot="modal"]').innerText()).replace(/\n+/g, " | ");
say(`  대화상자 전문: ${codeDialog}`);
check("★ 첨부 개수를 실제 값(3개)으로 적는다", codeDialog.includes("첨부 3개"), codeDialog);
check("★ 코드 본문이 있다고 적는다", codeDialog.includes("코드 본문 1건"));
await shot("code-delete-dialog");

await page.locator('[data-testid="scenario-delete-confirm"]').click();
await page.waitForURL(/\/scenarios$/, { timeout: 10_000 });
check("★ 코드 화면에서 지우면 목록으로 이동한다", /\/scenarios$/.test(page.url()), page.url());

/* ── 6. 빌더 화면(녹화 시나리오) ────────────────────────────── */
say("");
say("══ 6. 빌더 화면 · 시나리오 삭제 ══");
const stepsScenario = (await api("POST", `/projects/${PROJECT}/scenarios`, {
  name: "삭제UX 녹화", feature: "UX", sourceType: "steps",
})).body;
await page.goto(`${WEB}/scenarios/${stepsScenario.id}`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="scenario-delete-open"]');
await page.locator('[data-testid="scenario-delete-open"]').click();
await page.waitForSelector('[data-slot="modal"]');
const builderDialog = (await page.locator('[data-slot="modal"]').innerText()).replace(/\n+/g, " | ");
say(`  대화상자 전문: ${builderDialog}`);
check("★ 녹화 시나리오는 스텝 수를 적는다", builderDialog.includes("스텝 0개"));
await shot("builder-delete-dialog");
await page.locator('[data-testid="scenario-delete-confirm"]').click();
await page.waitForURL(/\/scenarios$/, { timeout: 10_000 });
check("빌더에서 지우면 목록으로 이동한다", /\/scenarios$/.test(page.url()));

/* ── 7. 반응형 ──────────────────────────────────────────────── */
say("");
say("══ 7. 반응형 1050 / 760 ══");
const leftover = (await api("POST", `/projects/${PROJECT}/scenarios`, {
  name: "삭제UX 반응형", feature: "UX", sourceType: "code",
})).body;
for (const width of [1050, 760]) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${WEB}/scenarios?q=삭제UX`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-slot="scenario-row"]');
  await page.locator('[data-testid="scenario-select-all"]').check();
  await page.waitForSelector('[data-slot="scenario-selection-bar"]');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`vw${width} 가로 스크롤 없음`, overflow <= 0, `overflow=${overflow}`);
  await shot(`vw${width}`);

  await page.locator('[data-testid="scenario-selection-delete"]').click();
  await page.waitForSelector('[data-slot="modal"]');
  const dlgOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(`vw${width} 대화상자도 가로 스크롤 없음`, dlgOverflow <= 0, `overflow=${dlgOverflow}`);
  await shot(`vw${width}-dialog`);
  await page.keyboard.press("Escape");
}
await page.setViewportSize({ width: 1440, height: 900 });

/* ── 8. 회귀 — 첨부 삭제(기존 기능) ─────────────────────────── */
say("");
say("══ 8. 회귀 · 첨부 삭제(기존 기능) ══");
await api("PUT", `/scenarios/${leftover.id}/code`, {
  filename: "ux.spec.ts",
  content: "import { test, expect } from '@playwright/test';\ntest('x', async ({ page }) => { await page.goto('/'); await expect(page).toHaveTitle(/./); });\n",
});
await fetch(`${API}/scenarios/${leftover.id}/attachments?filename=regress.csv`, {
  method: "POST", headers: { "Content-Type": "application/octet-stream" },
  body: Buffer.alloc(512, 9),
});
await page.goto(`${WEB}/scenarios/${leftover.id}/code`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="attachment-list"]');
await page.locator('[data-testid="attachment-delete"]').first().click();
await page.waitForSelector('[data-testid="attachment-empty"]', { timeout: 10_000 });
check("★ 첨부 삭제(기존 기능)가 그대로 동작한다", true);
await shot("regress-attachment-delete");
await api("DELETE", `/scenarios/${leftover.id}`);

/* ── 9. 대시보드 회귀(RunRow DOM 변경) ─────────────────────── */
say("");
say("══ 9. 회귀 · 대시보드 최근 실행(RunRow 구조 변경) ══");
await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const dashRows = await page.locator('[data-slot="run-row"]').count();
const dashCheckboxes = await page.locator('[data-testid="run-select"]').count();
check("대시보드 '최근 실행' 행이 그대로 그려진다", dashRows >= 0, `${dashRows}행`);
check("★ 대시보드에는 체크박스가 생기지 않는다(선택 props 를 주지 않았다)",
  dashCheckboxes === 0, `${dashCheckboxes}개`);
await shot("regress-dashboard");

/* ── 마무리 ────────────────────────────────────────────────── */
say("");
say(`콘솔 에러: ${consoleErrors.length}건`);
for (const line of consoleErrors) say(`  - ${line}`);
say(`4xx/5xx 응답: ${failedRequests.length}건`);
for (const line of failedRequests) say(`  - ${line}`);
/*
 * ★ Runner 가 떠 있지 않은 환경이라 `GET /api/runs/:id/live` 404 와 WS 연결 거부가 난다.
 *   둘 다 **이번 변경 이전부터 있던 동작**이다(queryClient.ts 의 runLive 주석에 실측 기록이
 *   남아 있다). 삭제 경로가 만든 에러가 있는지를 따로 본다.
 */
const preexisting = (line) => line.includes("/live") || line.includes("ws://") || line.includes("WebSocket");
const ours = consoleErrors.filter((line) => !preexisting(line));
const oursReq = failedRequests.filter((line) => !preexisting(line));
say(`  → 삭제 경로가 만든 에러: 콘솔 ${ours.length}건 · 요청 ${oursReq.length}건`);
for (const line of [...ours, ...oursReq]) say(`    · ${line}`);
check("★ 삭제 경로가 만든 콘솔 에러 0건 (Runner 미기동의 /live 404·WS 거부는 기존 동작)",
  ours.length === 0 && oursReq.length === 0);

await browser.close();
say("");
say(`결과: ${results.pass} pass / ${results.fail} fail`);
writeFileSync(`${OUT}/g16-ui.log`, report.join("\n") + "\n");
process.exit(results.fail === 0 ? 0 : 1);
