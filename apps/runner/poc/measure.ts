/**
 * PoC-1 자동 측정 (03-phases Task 3.5)
 *
 * ⚠️ PoC 전용 임시물이다. 제품 코드가 아니다.
 *
 * **측정값을 손으로 적지 않는다. 이 스크립트가 숫자를 만든다.**
 *   ① 프레임 왕복 지연 — screencast 캡처 시각 → 클라이언트 `drawImage` 완료 시각.
 *      100 프레임 이상 모아 p50/p95 를 낸다. 캔버스 클라이언트는 **진짜 브라우저**(headless
 *      Chromium)로 띄우고 WS 로 붙인다 — Node 안에서 흉내 내면 캔버스 렌더 비용이 빠진다.
 *   ② 실효 fps — 관측 구간 동안 **렌더까지 끝난** 프레임 수 / 구간 초.
 *   ③ 클릭 적중률 — 더미 페이지 3×3 버튼 9개 × 캔버스 표시 배율 3종(100% / 70% / 130%) = 27 케이스.
 *      캔버스 위 CSS 좌표를 계산해 **실제 마우스 이벤트**를 쏘고, 원격 페이지에서 어떤 버튼이
 *      눌렸는지 확인한다. 빗나간 경우 착지 좌표를 함께 남겨 오차(px)를 뽑는다.
 *
 * 재현: yarn workspace @testflow/runner poc:measure
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

import type { InputDriver } from "../src/record/input-bridge.js";
import type { ScreencastDriver } from "../src/record/screencast.js";
import type { PocServerStats } from "./poc-ws-server.js";
import { isTargetName, parseArgs, startPoc, type TargetName } from "./poc1.js";

/* ── 합격 기준 (02-context "PoC 우선 검증 3가지 > PoC-1") ── */
export const PASS_CRITERIA = {
  latencyP95Ms: 200,
  fps: 10,
  hitRatePercent: 100,
} as const;

const CLIENT_VIEWPORT = { width: 1800, height: 1200 }; // 130% 확대(1664×1040) 캔버스가 다 들어가야 한다
const SCALES = [1, 0.7, 1.3] as const;

interface LatencyBucket {
  n: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

interface ClientStats {
  elapsedSeconds: number;
  received: number;
  rendered: number;
  droppedClient: number;
  bytes: number;
  sentMessages: number;
  maxBufferedAmount: number;
  wsErrors: number;
  fps: number;
  latencyDrawMs: LatencyBucket;
  latencyPaintMs: { n: number; p50: number | null; p95: number | null };
}

interface TargetRect {
  id: string;
  cx: number;
  cy: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LastClick {
  x: number;
  y: number;
  targetId: string | null;
  targetTag: string | null;
}

interface ThroughputResult {
  label: string;
  target: TargetName;
  screencastDriver: ScreencastDriver;
  quality: number;
  seconds: number;
  timestampKind: string;
  pageScaleFactor: number;
  client: ClientStats;
  server: PocServerStats;
}

interface AccuracyCase {
  scale: number;
  expected: string;
  actual: string | null;
  hit: boolean;
  landedOn: string | null;
  clickXRemote: number | null;
  clickYRemote: number | null;
  expectedXRemote: number;
  expectedYRemote: number;
  errorPx: number | null;
}

interface AccuracyResult {
  label: string;
  target: TargetName;
  inputDriver: InputDriver;
  screencastDriver: ScreencastDriver;
  pageScaleFactor: number;
  cases: AccuracyCase[];
  hits: number;
  total: number;
  hitRatePercent: number;
  maxErrorPx: number | null;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function openClient(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage({ viewport: CLIENT_VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // 첫 프레임이 실제로 렌더될 때까지 기다린다.
  await page.waitForFunction("window.__poc && window.__poc.ready()", undefined, { timeout: 30_000 });
  return page;
}

/* ── ① 지연 + ② fps ───────────────────────────────────────── */

async function measureThroughput(opts: {
  target: TargetName;
  screencastDriver: ScreencastDriver;
  quality: number;
  seconds: number;
  clientBrowser: Browser;
}): Promise<ThroughputResult> {
  const poc = await startPoc({
    target: opts.target,
    screencastDriver: opts.screencastDriver,
    quality: opts.quality,
  });
  const client = await openClient(opts.clientBrowser, poc.clientUrl(1));
  try {
    await sleep(1000); // 워밍업 — 첫 연결 직후의 이상치를 측정에서 뺀다
    poc.server.resetStats();
    await client.evaluate("window.__poc.reset()");
    await sleep(opts.seconds * 1000);
    const stats = (await client.evaluate("window.__poc.stats()")) as ClientStats;
    const scale = poc.server.screencast.getPageScale();
    return {
      label: `${opts.target}/${opts.screencastDriver}/q${String(opts.quality)}`,
      target: opts.target,
      screencastDriver: poc.server.screencast.driver,
      quality: opts.quality,
      seconds: opts.seconds,
      timestampKind: poc.server.screencast.timestampKind,
      pageScaleFactor: scale.pageScaleFactor,
      client: stats,
      server: poc.server.stats(),
    };
  } finally {
    await client.close().catch(() => undefined);
    await poc.close().catch(() => undefined);
  }
}

/* ── ③ 클릭 좌표 정확도 ───────────────────────────────────── */

async function measureAccuracy(opts: {
  inputDriver: InputDriver;
  screencastDriver: ScreencastDriver;
  quality: number;
  clientBrowser: Browser;
}): Promise<AccuracyResult> {
  const poc = await startPoc({
    target: "local",
    inputDriver: opts.inputDriver,
    screencastDriver: opts.screencastDriver,
    quality: opts.quality,
  });
  const client = await openClient(opts.clientBrowser, poc.clientUrl(1));
  const cases: AccuracyCase[] = [];
  try {
    for (const scale of SCALES) {
      await client.evaluate(`window.__poc.setScale(${String(scale)})`);
      await sleep(300);
      const targets = (await poc.page.evaluate("window.__targets()")) as TargetRect[];

      for (const target of targets) {
        await poc.page.evaluate("window.__resetHit()");
        const point = (await client.evaluate(
          `window.__poc.toClientPoint(${String(target.cx)}, ${String(target.cy)})`,
        )) as { x: number; y: number };

        // 실제 마우스 이벤트를 쏜다 — 클라이언트의 좌표 변환 코드를 우회하지 않기 위해서다.
        await client.mouse.move(point.x, point.y);
        await client.mouse.down();
        await client.mouse.up();

        let actual: string | null = null;
        let landing: LastClick | null = null;
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          landing = (await poc.page.evaluate("window.__lastClick")) as LastClick | null;
          actual = (await poc.page.evaluate("window.__lastHit")) as string | null;
          if (landing !== null) break;
          await sleep(25);
        }

        const errorPx =
          landing === null
            ? null
            : Math.hypot(landing.x - target.cx, landing.y - target.cy);
        cases.push({
          scale,
          expected: target.id,
          actual,
          hit: actual === target.id,
          landedOn: landing?.targetId ?? landing?.targetTag ?? null,
          clickXRemote: landing?.x ?? null,
          clickYRemote: landing?.y ?? null,
          expectedXRemote: target.cx,
          expectedYRemote: target.cy,
          errorPx,
        });
      }
    }
    const hits = cases.filter((c) => c.hit).length;
    const errors = cases.map((c) => c.errorPx).filter((e): e is number => e !== null);
    return {
      label: `local/input:${opts.inputDriver}`,
      target: "local",
      inputDriver: poc.server.input.driver,
      screencastDriver: poc.server.screencast.driver,
      pageScaleFactor: poc.server.screencast.getPageScale().pageScaleFactor,
      cases,
      hits,
      total: cases.length,
      hitRatePercent: cases.length === 0 ? 0 : (hits / cases.length) * 100,
      maxErrorPx: errors.length === 0 ? null : Math.max(...errors),
    };
  } finally {
    await client.close().catch(() => undefined);
    await poc.close().catch(() => undefined);
  }
}

/* ── 리포트 ─────────────────────────────────────────────────── */

function fmt(value: number | null, digits = 1): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function printReport(throughput: ThroughputResult[], accuracy: AccuracyResult[]): void {
  console.log("\n=== ① 프레임 왕복 지연 / ② 실효 fps ===");
  console.log(
    ["label", "sec", "rendered", "fps", "p50(ms)", "p95(ms)", "max(ms)", "drop(cli)", "drop(bp)", "ts-kind"].join(
      " | ",
    ),
  );
  for (const r of throughput) {
    console.log(
      [
        r.label,
        String(r.seconds),
        String(r.client.rendered),
        fmt(r.client.fps, 2),
        fmt(r.client.latencyDrawMs.p50),
        fmt(r.client.latencyDrawMs.p95),
        fmt(r.client.latencyDrawMs.max),
        String(r.client.droppedClient),
        String(r.server.framesDroppedBackpressure),
        r.timestampKind,
      ].join(" | "),
    );
  }

  console.log("\n=== ③ 클릭 요소 적중률 ===");
  console.log(["label", "hits/total", "rate(%)", "maxErr(px)", "pageScale"].join(" | "));
  for (const r of accuracy) {
    console.log(
      [
        r.label,
        `${String(r.hits)}/${String(r.total)}`,
        fmt(r.hitRatePercent, 1),
        fmt(r.maxErrorPx, 2),
        fmt(r.pageScaleFactor, 3),
      ].join(" | "),
    );
    for (const c of r.cases.filter((x) => !x.hit)) {
      console.log(
        `    MISS scale=${String(c.scale)} expected=${c.expected} actual=${String(c.actual)} ` +
          `landedOn=${String(c.landedOn)} at=(${fmt(c.clickXRemote)},${fmt(c.clickYRemote)}) ` +
          `want=(${fmt(c.expectedXRemote)},${fmt(c.expectedYRemote)})`,
      );
    }
  }
}

function verdict(throughput: ThroughputResult[], accuracy: AccuracyResult[]): Record<string, unknown> {
  const primary = throughput.find((r) => r.target === "local" && r.screencastDriver === "playwright");
  const bestAccuracy = accuracy.reduce<AccuracyResult | null>(
    (best, cur) => (best === null || cur.hitRatePercent > best.hitRatePercent ? cur : best),
    null,
  );
  const p95 = primary?.client.latencyDrawMs.p95 ?? null;
  const fps = primary?.client.fps ?? null;
  const rate = bestAccuracy?.hitRatePercent ?? null;
  return {
    latency: { p95Ms: p95, criterion: PASS_CRITERIA.latencyP95Ms, pass: p95 !== null && p95 <= PASS_CRITERIA.latencyP95Ms },
    fps: { value: fps, criterion: PASS_CRITERIA.fps, pass: fps !== null && fps >= PASS_CRITERIA.fps },
    hitRate: {
      percent: rate,
      criterion: PASS_CRITERIA.hitRatePercent,
      pass: rate !== null && rate >= PASS_CRITERIA.hitRatePercent,
    },
  };
}

/* ── main ───────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seconds = Number(args["seconds"] ?? "30");
  const quality = Number(args["quality"] ?? "60");
  const onlyTarget = args["target"];
  const targets: TargetName[] = isTargetName(onlyTarget) ? [onlyTarget] : ["local", "playwright-dev"];

  const clientBrowser = await chromium.launch({ headless: true });
  const throughput: ThroughputResult[] = [];
  const accuracy: AccuracyResult[] = [];
  try {
    for (const target of targets) {
      // 로컬 더미에서는 1안/2안을 모두 재서 비교한다. 공개 사이트는 1안만(시간 절약).
      const drivers: ScreencastDriver[] = target === "local" ? ["playwright", "cdp"] : ["playwright"];
      for (const screencastDriver of drivers) {
        console.log(`[measure] throughput ${target} / ${screencastDriver} / ${String(seconds)}s …`);
        throughput.push(
          await measureThroughput({ target, screencastDriver, quality, seconds, clientBrowser }),
        );
      }
    }
    // 입력 역주입 두 경로를 같은 27 케이스로 비교한다(02-context 가 비교를 지시).
    for (const inputDriver of ["cdp", "playwright"] as const) {
      console.log(`[measure] accuracy 27 cases / input:${inputDriver} …`);
      accuracy.push(
        await measureAccuracy({ inputDriver, screencastDriver: "playwright", quality, clientBrowser }),
      );
    }
  } finally {
    await clientBrowser.close().catch(() => undefined);
  }

  printReport(throughput, accuracy);

  const report = {
    generatedAt: new Date().toISOString(),
    env: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      playwright: "1.63.0",
      quality,
      seconds,
      size: { width: 1280, height: 800 },
      clientViewport: CLIENT_VIEWPORT,
      scales: SCALES,
    },
    criteria: PASS_CRITERIA,
    verdict: verdict(throughput, accuracy),
    throughput,
    accuracy,
  };
  const outPath = resolve(
    fileURLToPath(new URL("../../../../.pipeline/20260917-114450/poc1-measurements.json", import.meta.url)),
  );
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n[measure] JSON → ${outPath}`);
  console.log(`[measure] verdict → ${JSON.stringify(report.verdict)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
