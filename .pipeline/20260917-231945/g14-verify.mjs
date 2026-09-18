/**
 * 라운드 7 검증 하네스 (일회성). `node .pipeline/20260917-231945/g14-verify.mjs <mode> [args]`
 *
 * 무대·레일 표시 크기를 실측하고 스크린샷을 남긴다. 레포 산출물이 아니라 검증 기록이다.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire("/mnt/c/Users/jhson1/Documents/GitHub/testflow/apps/runner/package.json")("playwright");
import { writeFileSync } from "node:fs";

const OUT = ".pipeline/20260917-231945";
const WEB = "http://localhost:4173";

const measure = async (page) =>
  page.evaluate(() => {
    const box = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return {
        w: Math.round(r.width * 100) / 100,
        h: Math.round(r.height * 100) / 100,
        x: Math.round(r.x),
        y: Math.round(r.y),
        aspect: r.height === 0 ? null : Math.round((r.width / r.height) * 1000) / 1000,
        visible: r.width > 0 && r.height > 0,
      };
    };
    const canvas = document.querySelector('[data-testid="live-canvas"]');
    const video = document.querySelector('[data-slot="live-video"]');
    const rail = document.querySelector('[data-slot="step-rail"]');
    const stage = document.querySelector('[data-slot="live-stage"]');
    const list = document.querySelector('[data-slot="execution"]');
    const shown = canvas !== null && !canvas.classList.contains("hidden") ? canvas : video;
    return {
      view: document.querySelector('[data-slot="live-canvas"]')?.dataset["liveView"] ?? null,
      phase: document.querySelector('[data-slot="live-canvas"]')?.dataset["livePhase"] ?? null,
      syncMode: document.querySelector('[data-slot="run-detail"]')?.dataset["stepSyncMode"] ?? null,
      expanded: stage?.dataset["expanded"] ?? null,
      canvasAttr:
        canvas === null ? null : { w: canvas.getAttribute("width"), h: canvas.getAttribute("height") },
      stageBox: box(shown),
      canvasBox: box(canvas),
      videoBox: box(video),
      railBox: box(rail),
      railActive: rail?.getAttribute("data-rail-active") ?? null,
      railRows: [...document.querySelectorAll('[data-slot="rail-row"]')].map((r) => ({
        seq: r.getAttribute("data-sequence"),
        active: r.getAttribute("data-active"),
        status: r.getAttribute("data-status"),
        tag: r.tagName,
      })),
      listBox: box(list),
      listActive: list?.getAttribute("data-active-sequence") ?? null,
      seekNotice: document.querySelector('[data-slot="rail-seek-notice"]')?.textContent?.trim() ?? null,
      docScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      pct: (v) => v,
    };
  });

const pct = (w) => Math.round((w / 1280) * 1000) / 10;

async function withPage(fn, { width = 1440, height = 900, reducedMotion } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    ...(reducedMotion === undefined ? {} : { reducedMotion }),
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    return await fn(page, errors);
  } finally {
    await browser.close();
  }
}

const mode = process.argv[2];
const arg = process.argv[3];
const results = {};

if (mode === "stage") {
  // node ... stage <runId>
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1680, height: 1050 },
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 1050, height: 900 },
    { width: 760, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const key = `${String(vp.width)}x${String(vp.height)}`;
    results[key] = await withPage(
      async (page, errors) => {
        await page.goto(`${WEB}/runs/${arg}`, { waitUntil: "networkidle" });
        await page.waitForSelector('[data-slot="live-canvas"]', { timeout: 15000 });
        await page.waitForTimeout(1800);
        const m = await measure(page);
        if (vp.width >= 1366) {
          await page.screenshot({ path: `${OUT}/g14-stage-${key}.png` });
        } else {
          await page.screenshot({ path: `${OUT}/g14-vw${String(vp.width)}.png` });
        }
        return { ...m, stagePct: m.stageBox === null ? null : pct(m.stageBox.w), errors };
      },
      vp,
    );
  }
  writeFileSync(`${OUT}/g14-stage-measurements.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

if (mode === "expanded") {
  const out = await withPage(async (page, errors) => {
    await page.goto(`${WEB}/runs/${arg}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="live-expand"]');
    await page.waitForTimeout(1500);
    await page.click('[data-testid="live-expand"]');
    await page.waitForTimeout(700);
    const expanded = await measure(page);
    await page.screenshot({ path: `${OUT}/g14-expanded.png` });
    const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const closed = await measure(page);
    return {
      expanded: { ...expanded, stagePct: pct(expanded.stageBox.w) },
      bodyOverflow,
      closed: { ...closed, stagePct: pct(closed.stageBox.w) },
      errors,
    };
  });
  writeFileSync(`${OUT}/g14-expanded.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === "video") {
  const out = await withPage(async (page, errors) => {
    await page.goto(`${WEB}/runs/${arg}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-slot="live-video"]', { timeout: 20000 });
    await page.waitForTimeout(2500);
    const before = await measure(page);
    await page.screenshot({ path: `${OUT}/g14-video-rail.png` });

    // 레일에서 스텝을 눌러 영상 seek — #12 의 동작이 새 레이아웃에서도 살아 있는가.
    const rows = await page.$$('[data-slot="rail-row"]');
    const target = rows[rows.length - 1];
    const targetSeq = await target.getAttribute("data-sequence");
    const t0 = await page.$eval('[data-slot="live-video"]', (v) => v.currentTime);
    await target.click();
    await page.waitForTimeout(1200);
    const t1 = await page.$eval('[data-slot="live-video"]', (v) => v.currentTime);
    const after = await measure(page);
    await page.screenshot({ path: `${OUT}/g14-video-seek.png` });
    return { before, targetSeq, t0, t1, after, errors };
  });
  writeFileSync(`${OUT}/g14-video.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === "reduced") {
  const out = await withPage(
    async (page, errors) => {
      await page.goto(`${WEB}/runs/${arg}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);
      const animated = await page.evaluate(
        () =>
          [...document.querySelectorAll("*")].filter(
            (el) => getComputedStyle(el).animationName !== "none",
          ).length,
      );
      const behavior = await page.evaluate(
        () => document.querySelector('[data-slot="execution"]')?.getAttribute("data-follow-behavior") ?? null,
      );
      await page.screenshot({ path: `${OUT}/g14-reduced-motion.png` });
      return { animated, behavior, ...(await measure(page)), errors };
    },
    { reducedMotion: "reduce" },
  );
  writeFileSync(`${OUT}/g14-reduced.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === "rerun") {
  // node ... rerun <runId,runId,...>
  const ids = arg.split(",");
  const out = [];
  for (const id of ids) {
    out.push(
      await withPage(async (page, errors) => {
        await page.goto(`${WEB}/runs/${id}`, { waitUntil: "networkidle" });
        await page.waitForSelector('[data-slot="run-rerun"]', { timeout: 15000 });
        const head = await page.textContent('[data-slot="run-detail"] h1').catch(() => null);
        const code = (await page.textContent("body")).match(/RUN-\d+/)?.[0] ?? null;
        await page.click('[data-slot="run-rerun"]');
        await page.waitForSelector('[data-slot="run-dialog-form"]');
        await page.waitForTimeout(500);
        const filled = await page.evaluate(() => ({
          title: document.querySelector('[data-slot="modal"] h2, [role="dialog"] h2')?.textContent ?? null,
          baseUrl: document.querySelector('[data-slot="field-base-url"]')?.value ?? null,
          envLabel: document.querySelector('[data-slot="field-env-label"]')?.value ?? null,
          browser: document.querySelector('[data-slot="field-browser"]')?.value ?? null,
          account: document.querySelector('[data-slot="field-account"]')?.value ?? null,
          password: document.querySelector('[data-slot="field-password"]')?.value ?? null,
          secretNotice:
            document.querySelector('[data-slot="rerun-secret-notice"]')?.textContent?.trim() ?? null,
        }));
        await page.screenshot({ path: `${OUT}/g14-rerun-${code ?? id.slice(0, 6)}.png` });
        return { id, code, head, filled, errors };
      }),
    );
  }
  writeFileSync(`${OUT}/g14-rerun.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === "rerun-submit") {
  const out = await withPage(async (page, errors) => {
    await page.goto(`${WEB}/runs/${arg}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-slot="run-rerun"]', { timeout: 15000 });
    await page.click('[data-slot="run-rerun"]');
    await page.waitForSelector('[data-slot="run-dialog-form"]');
    await page.fill('[data-slot="field-account"]', "qa-tester");
    await page.fill('[data-slot="field-password"]', "hunter2");
    await page.click('[data-slot="run-dialog-submit"]');
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await page.waitForTimeout(2500);
    const newUrl = page.url();
    const banner = await page
      .textContent('[data-slot="notice-box"], [role="note"]')
      .catch(() => null);
    const bodyText = await page.textContent("body");
    await page.screenshot({ path: `${OUT}/g14-rerun-result.png` });
    return {
      newUrl,
      sameAsOriginal: newUrl.endsWith(arg),
      lineage: /다시 실행한 결과입니다/.test(bodyText),
      lineageText: bodyText.match(/RUN-\d+ 을\(를\) 다시 실행한 결과입니다/)?.[0] ?? null,
      banner,
      errors,
    };
  });
  writeFileSync(`${OUT}/g14-rerun-submit.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === "multiselect") {
  const out = await withPage(async (page, errors) => {
    await page.goto(`${WEB}/scenarios?q=G14-`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="scenario-select"]', { timeout: 15000 });
    await page.waitForTimeout(800);

    // ── 회귀: 체크박스를 눌러도 행 이동이 일어나지 않는다
    const boxes = await page.$$('[data-testid="scenario-select"]');
    const urlBefore = page.url();
    for (const box of boxes.slice(0, 4)) await box.click();
    await page.waitForTimeout(400);
    const urlAfterCheck = page.url();

    const barCount = await page.getAttribute(
      '[data-slot="scenario-selection-bar"]',
      "data-selected-count",
    );
    await page.screenshot({ path: `${OUT}/g14-multiselect.png` });

    // ── 전체 선택 / 해제
    await page.click('[data-testid="scenario-select-all"]');
    await page.waitForTimeout(300);
    const allOn = await page.getAttribute(
      '[data-slot="scenario-selection-bar"]',
      "data-selected-count",
    );
    await page.click('[data-testid="scenario-select-all"]');
    await page.waitForTimeout(300);
    const allOff = await page.$('[data-slot="scenario-selection-bar"]');

    // 다시 4건 선택 후 실행
    for (const box of (await page.$$('[data-testid="scenario-select"]')).slice(0, 4)) {
      await box.click();
    }
    await page.waitForTimeout(300);
    await page.click('[data-testid="scenario-selection-run"]');
    await page.waitForSelector('[data-slot="run-dialog-form"]');
    await page.waitForTimeout(900);
    const notice = await page
      .textContent('[data-slot="batch-concurrency-notice"]')
      .catch(() => null);
    await page.screenshot({ path: `${OUT}/g14-multiselect-dialog.png` });

    await page.fill('[data-slot="field-base-url"]', "http://127.0.0.1:4998/record-login.html");
    await page.click('[data-slot="run-dialog-submit"]');
    await page.waitForURL(/\/runs\?batch=/, { timeout: 20000 });
    await page.waitForTimeout(3000);
    const batchUrl = page.url();
    const progress = await page.textContent('[data-slot="batch-progress"]');
    const rows = await page.$$eval('[data-slot="batch-run"]', (els) =>
      els.map((el) => ({
        status: el.getAttribute("data-status"),
        pos: el.getAttribute("data-queue-position"),
        text: el.textContent?.replace(/\s+/g, " ").trim().slice(0, 120),
      })),
    );
    await page.screenshot({ path: `${OUT}/g14-batch.png` });
    return {
      urlUnchangedOnCheck: urlBefore === urlAfterCheck,
      barCount,
      allOn,
      barGoneAfterClear: allOff === null,
      notice,
      batchUrl,
      progress: progress?.replace(/\s+/g, " ").trim(),
      rows,
      errors,
    };
  });
  writeFileSync(`${OUT}/g14-multiselect.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === "dual-live") {
  // node ... dual-live <runIdA,runIdB> — 서로 다른 run 의 라이브를 동시에 본다
  const [a, b] = arg.split(",");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const open = async (id) => {
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${id}: ${m.text()}`);
    });
    page.on("pageerror", (e) => errors.push(`${id}: ${String(e)}`));
    await page.goto(`${WEB}/runs/${id}`, { waitUntil: "networkidle" });
    return page;
  };
  const pageA = await open(a);
  const pageB = await open(b);
  await pageA.waitForTimeout(9000);
  const read = async (page) =>
    page.evaluate(() => {
      const c = document.querySelector('[data-slot="live-canvas"]');
      const canvas = document.querySelector('[data-testid="live-canvas"]');
      const ctx = canvas?.getContext("2d");
      let mean = null;
      if (canvas !== null && ctx != null && canvas.width > 0) {
        const d = ctx.getImageData(0, 0, canvas.width, Math.min(120, canvas.height)).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        mean = Math.round((sum / (d.length / 4)) * 10) / 10;
      }
      return {
        runCode: document.body.textContent?.match(/RUN-\d+/)?.[0] ?? null,
        connection: c?.dataset["liveConnection"] ?? null,
        phase: c?.dataset["livePhase"] ?? null,
        hasFrame: c?.dataset["liveFrame"] ?? null,
        activeSeq:
          document.querySelector('[data-slot="step-rail"]')?.getAttribute("data-rail-active") ?? null,
        meanLuma: mean,
      };
    });
  const A = await read(pageA);
  const B = await read(pageB);
  await pageA.screenshot({ path: `${OUT}/g14-dual-a.png` });
  await pageB.screenshot({ path: `${OUT}/g14-dual-b.png` });
  await browser.close();
  const out = { A, B, errors };
  writeFileSync(`${OUT}/g14-dual-live.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === "regress") {
  // 녹화 실행(steps) 상세 + 녹화 화면 + 시나리오 목록 단건 진입
  const out = await withPage(async (page, errors) => {
    await page.goto(`${WEB}/runs/${arg}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const stepsRun = await page.evaluate(() => ({
      sourceType: document.querySelector('[data-slot="execution"]')?.getAttribute("data-source-type"),
      stage: document.querySelector('[data-slot="live-stage"]') !== null,
      rail: document.querySelector('[data-slot="step-rail"]') !== null,
      rerun: document.querySelector('[data-slot="run-rerun"]') !== null,
      rows: document.querySelectorAll('[data-slot="exec-row"]').length,
    }));
    await page.screenshot({ path: `${OUT}/g14-regress-stepsrun.png` });

    await page.goto(`${WEB}/scenarios/new`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const recorder = await page.evaluate(() => ({
      canvas: document.querySelector('[data-testid="stream-canvas"]') !== null,
      body: (document.body.textContent ?? "").slice(0, 60).replace(/\s+/g, " "),
    }));
    await page.screenshot({ path: `${OUT}/g14-regress-record.png` });
    return { stepsRun, recorder, errors };
  });
  writeFileSync(`${OUT}/g14-regress.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === "record") {
  const out = await withPage(async (page, errors) => {
    await page.goto(`${WEB}/scenarios/new`, { waitUntil: "networkidle" });
    await page.click('[data-testid="new-scenario-source-steps"]', { force: true });
    await page.fill('[data-testid="new-scenario-name"]', `G14-REC-${String(process.pid)}`);
    await page.click('[data-testid="new-scenario-submit"]');
    await page.waitForTimeout(3000);
    await page.fill('input[value="https://staging.example.com"]', "http://127.0.0.1:4998/record-login.html").catch(() => undefined);
    await page.getByText("녹화 시작").click({ force: true });
    await page.waitForSelector('[data-testid="stream-canvas"]', { timeout: 40000 }).catch(() => undefined);
    await page.waitForTimeout(8000);
    const started = await page.evaluate(() => ({
      url: location.pathname,
      canvas: document.querySelector('[data-testid="stream-canvas"]') !== null,
    }));
    // 녹화 캔버스가 뜨면 클릭 좌표 역변환이 살아 있는지 스케일 확인만 한다.
    let canvasInfo = null;
    if (started.canvas) {
      canvasInfo = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="stream-canvas"]');
        const r = c.getBoundingClientRect();
        return {
          attr: { w: c.getAttribute("width"), h: c.getAttribute("height") },
          rect: { w: Math.round(r.width), h: Math.round(r.height) },
          ratio: Math.round((r.width / Number(c.getAttribute("width"))) * 1000) / 1000,
          x: Math.round(r.x), y: Math.round(r.y),
        };
      });
      // confirm-a 중심(원격 306,405)을 rect 비율로 역산해 클릭 → 기록된 locator 확인
      const target = { rx: 306, ry: 405 };
      await page.mouse.click(
        canvasInfo.x + target.rx * canvasInfo.ratio,
        canvasInfo.y + target.ry * canvasInfo.ratio,
      );
      await page.waitForTimeout(3500);
      canvasInfo.recordedSteps = await page.$$eval('[data-slot="step-card"], [data-testid="step-card"]', (els) =>
        els.map((e) => e.textContent?.replace(/\s+/g, " ").trim().slice(0, 80)),
      ).catch(() => []);
      canvasInfo.bodyHasConfirm = (await page.textContent("body")).includes("confirm-a");
    }
    await page.screenshot({ path: `${OUT}/g14-record.png` });
    return { started, canvasInfo, errors };
  });
  writeFileSync(`${OUT}/g14-record.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (mode === "rail-toggle") {
  const out = await withPage(async (page, errors) => {
    await page.goto(`${WEB}/runs/${arg}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-slot="step-rail"]', { timeout: 15000 });
    await page.waitForTimeout(1500);
    const openStage = (await measure(page)).stageBox;
    await page.click('[data-testid="step-rail-close"]');
    await page.waitForTimeout(600);
    const closed = await measure(page);
    await page.screenshot({ path: `${OUT}/g14-rail-closed.png` });
    const reopenBtn = await page.$('[data-testid="step-rail-open"]');
    await reopenBtn.click();
    await page.waitForTimeout(600);
    const reopened = await measure(page);
    return {
      openStage,
      closedRail: closed.railBox,
      closedStage: closed.stageBox,
      reopenButtonExisted: reopenBtn !== null,
      reopenedRail: reopened.railBox,
      stageUnchanged: openStage.w === closed.stageBox.w && openStage.w === reopened.stageBox.w,
      errors,
    };
  });
  writeFileSync(`${OUT}/g14-rail-toggle.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
