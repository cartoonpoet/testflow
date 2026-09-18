/**
 * 라운드 2 PoC — 실행·측정 드라이버
 *
 * ⚠️ PoC 전용 임시물. 제품 코드가 아니다.
 *
 * 재현:
 *   pnpm --filter @testflow/runner build:poc
 *   node dist-poc/poc/r2/r2.js --mode c            # reporter 만 (경로 C 판정)
 * *   node dist-poc/poc/r2/r2.js --mode b            # launchServer + connectOptions + CDP
 *   node dist-poc/poc/r2/r2.js --mode d            # launchOptions CDP 포트 + connectOverCDP
 *   node dist-poc/poc/r2/r2.js --all               # 전 모드 + JSON 산출
 *   node dist-poc/poc/r2/r2.js --mode d --spec functional --workers 2
 *
 * 측정 정직성(라운드 1 기준 유지)
 *   - 지연/fps 는 **캔버스 클라이언트를 진짜 headless Chromium 으로 띄워** 재고
 *     `drawImage` 가 끝난 프레임만 센다. Node 에서 수신만 세면 낙관적 값이 나온다.
 *   - 대역폭은 클라이언트가 **실제로 받은** 바이트로 낸다.
 *   - 측정 구간은 첫 프레임 렌더 이후로 잡고, 그 시점에 통계를 리셋한다.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

import {
  attachStream,
  DEFAULT_MAX_FPS,
  launchOwnedBrowser,
  startHost,
  watchBrowserPages,
  type AttachedStream,
  type HostStats,
  type R2Host,
  type ReporterEvent,
} from "./host.js";
import { mapReporterEvents, type MappedEvent } from "./map-events.js";

/* ── 합격 기준 (라운드 1 PoC-1 과 동일) ── */
export const PASS_CRITERIA = { latencyP95Ms: 200, fps: 10 } as const;

const R2_DIST_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));
const RUNNER_DIR = resolve(R2_DIST_DIR, "../../../");
/** ⚠️ Playwright 는 **원본 TS** 를 직접 로드한다(dist-poc 가 아니다). */
const PW_DIR = resolve(RUNNER_DIR, "poc/r2/pw");
const PW_BIN = resolve(RUNNER_DIR, "node_modules/.bin/playwright");

/**
 * ★ 경로 A(`@playwright/test` 해석 가로채기 shim)와 그 음성 대조군 A0 는
 *   **라운드 2 Gen-Phase 6 에서 코드째 폐기했다.** 측정값은 문서
 *   (`.pipeline/20260917-231945/r2-poc-live-stream.md`)에 남아 있고, 구현은 남기지 않는다 —
 *   모듈 해석을 가로채는 가짜 `@playwright/test` 패키지가 레포에 있는 것 자체가 위험하고
 *   (03-phases 리스크 1: "경로 A 로는 가지 않는다"), 남아 있으면 후퇴 경로로 오인된다.
 *   후퇴가 필요하면 **경로 B** 를 쓴다.
 */
export type Mode = "b" | "c" | "d";
const MODE_LABEL: Readonly<Record<Mode, string>> = {
  b: "B. launchServer + use.connectOptions + connectOverCDP",
  c: "C. Reporter 만 (page 접근 가능성 판정)",
  d: "D. use.launchOptions --remote-debugging-port + connectOverCDP",
};

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

interface ClientStats {
  elapsedSeconds: number;
  received: number;
  rendered: number;
  droppedClient: number;
  bytes: number;
  wsErrors: number;
  fps: number;
  mbps: number;
  latencyDrawMs: { n: number; min: number | null; p50: number | null; p95: number | null; max: number | null };
  latencyPaintMs: { n: number; p50: number | null; p95: number | null };
}

export interface RunOutcome {
  mode: Mode;
  label: string;
  specDir: string;
  testDir: string;
  workers: number;
  maxFps: number;
  exitCode: number | null;
  /** 스트리밍이 붙은 page 수. 0 이면 라이브 화면이 안 나온다. */
  pagesAttached: number;
  attachError: string | null;
  /** 경로 B/D 에서 Runner 가 열거한 page URL 들 — "page 를 우리가 소유한다"의 증거. */
  enumeratedPageUrls: string[];
  client: ClientStats | null;
  canvasSample: { distinctColors: number; center: number[] } | null;
  host: HostStats;
  eventKinds: Record<string, number>;
  probe: ReporterEvent | null;
  mapped: { total: number; invalid: number; invalidErrors: string[] };
  mappedSample: MappedEvent[];
  stdoutTail: string;
  /** 사용자 spec 파일은 어떤 모드에서도 수정하지 않는다(복사만 한다). */
  userCodeModified: false;
}

/* ── playwright test 실행 ─────────────────────────────────── */

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function spawnPlaywrightTest(
  env: Record<string, string>,
  onLine: (line: string) => void,
): { done: Promise<SpawnResult>; kill: () => void } {
  const child = spawn(PW_BIN, ["test", "--config", resolve(PW_DIR, "config.ts")], {
    cwd: PW_DIR,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let buffer = "";
  const feed = (text: string): void => {
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    feed(text);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    feed(text);
  });
  const done = new Promise<SpawnResult>((finish) => {
    child.on("close", (code) => {
      finish({ exitCode: code, stdout, stderr, timedOut: false });
    });
  });
  return { done, kill: () => child.kill("SIGKILL") };
}

/* ── 뷰어 ─────────────────────────────────────────────────── */

async function openViewer(browser: Browser, host: R2Host): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, deviceScaleFactor: 1 });
  await page.goto(host.viewerUrl(1), { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__poc && window.__poc.ready()", undefined, { timeout: 30_000 });
  return page;
}

/* ── 한 모드 실행 ─────────────────────────────────────────── */

export async function runMode(opts: {
  mode: Mode;
  specDir: string;
  measureSeconds: number;
  workers: number;
  viewerBrowser: Browser;
  maxFps?: number;
  specSeconds?: number;
  /** 사용자 자체 playwright.config.ts 경로(병합 검증용). */
  userConfig?: string;
  /** headed 검증용. WSL 에서 X(WSLg)가 있으면 동작한다. */
  headed?: boolean;
}): Promise<RunOutcome> {
  const maxFps = opts.maxFps ?? DEFAULT_MAX_FPS;
  const host = await startHost();
  let viewerPage: Page | null = null;

  const attached: AttachedStream[] = [];
  const enumerated = new Set<string>();
  let attachError: string | null = null;
  let owned: Awaited<ReturnType<typeof launchOwnedBrowser>> | null = null;
  let cdpBrowser: Browser | null = null;
  let watcher: ReturnType<typeof watchBrowserPages> | null = null;

  const attach = (page: Page): void => {
    enumerated.add(page.url());
    void attachStream(page, host, maxFps)
      .then((s) => {
        attached.push(s);
        enumerated.add(page.url());
      })
      .catch((error: unknown) => {
        attachError ??= String(error).slice(0, 400);
      });
  };

  const env: Record<string, string> = {
    TESTFLOW_R2_MODE: opts.mode,
    TESTFLOW_R2_BASE_URL: host.httpUrl("/"),
    TESTFLOW_R2_EVENTS_URL: host.eventsUrl(),
    TESTFLOW_R2_WORKERS: String(opts.workers),
    TESTFLOW_R2_MAX_FPS: String(maxFps),
    ...(opts.specSeconds === undefined ? {} : { TESTFLOW_R2_SPEC_SECONDS: String(opts.specSeconds) }),
    ...(opts.userConfig === undefined ? {} : { TESTFLOW_R2_USER_CONFIG: opts.userConfig }),
    ...(opts.headed === true ? { TESTFLOW_R2_HEADLESS: "false" } : {}),
  };
  const testDir = opts.specDir;
  // 포트 충돌 회피 — PoC 수준으로 충분하다.
  const cdpPort = 9400 + (host.port % 500);

  try {
    viewerPage = await openViewer(opts.viewerBrowser, host);
    if (opts.mode === "b") {
      owned = await launchOwnedBrowser({ cdpPort, headless: true });
      env["TESTFLOW_R2_WS_ENDPOINT"] = owned.wsEndpoint;
      owned.onPage(attach);
    } else if (opts.mode === "d") {
      env["TESTFLOW_R2_CDP_PORT"] = String(cdpPort);
    }
    env["TESTFLOW_R2_TESTDIR"] = testDir;

    const lines: string[] = [];
    const proc = spawnPlaywrightTest(env, (line) => {
      lines.push(line);
      if (line.startsWith("[R2EV]") || line.startsWith("[R2FX]")) console.log(`   ${line}`);
      else if (line.trim() !== "") console.log(`   | ${line}`);
    });

    // 경로 D — worker 가 브라우저를 띄운 다음에야 CDP 포트가 열린다. 열릴 때까지 재시도.
    if (opts.mode === "d") {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        try {
          cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${String(cdpPort)}`);
          break;
        } catch {
          await sleep(200);
        }
      }
      if (cdpBrowser === null) {
        attachError = `connectOverCDP(127.0.0.1:${String(cdpPort)}) 30초 내 실패`;
      } else {
        watcher = watchBrowserPages(cdpBrowser);
        watcher.onPage(attach);
      }
    }

    /* 측정 구간 */
    let client: ClientStats | null = null;
    let canvasSample: { distinctColors: number; center: number[] } | null = null;
    if (opts.measureSeconds > 0 && viewerPage !== null) {
      const firstFrameDeadline = Date.now() + (opts.mode === "c" ? 20_000 : 45_000);
      let sawFrame = false;
      const vp = viewerPage;
      while (Date.now() < firstFrameDeadline) {
        sawFrame = (await vp.evaluate("window.__poc.firstFrame()")) as boolean;
        if (sawFrame) break;
        await sleep(200);
      }
      if (sawFrame) {
        host.resetStats();
        await vp.evaluate("window.__poc.reset()");
        await sleep(opts.measureSeconds * 1000);
        client = (await vp.evaluate("window.__poc.stats()")) as ClientStats;
        canvasSample = (await vp.evaluate("window.__poc.sample()")) as {
          distinctColors: number;
          center: number[];
        };
        const shot = process.env["TESTFLOW_R2_SHOT"];
        if (shot !== undefined && shot !== "") {
          // ★ 눈으로 확인할 증거 — 캔버스에 진짜 테스트 화면이 그려졌는지.
          await vp.screenshot({ path: shot });
          console.log(`   [r2] viewer screenshot → ${shot}`);
        }
      }
    }

    const result = await Promise.race([
      proc.done,
      sleep(180_000).then((): SpawnResult => ({ exitCode: null, stdout: "", stderr: "", timedOut: true })),
    ]);
    if (result.timedOut) proc.kill();
    await sleep(600); // reporter 의 마지막 POST 가 도착할 시간

    const runId = randomUUID();
    const mapped = mapReporterEvents(runId, () => randomUUID(), host.events);
    const kinds: Record<string, number> = {};
    for (const ev of host.events) kinds[ev.kind] = (kinds[ev.kind] ?? 0) + 1;

    return {
      mode: opts.mode,
      label: MODE_LABEL[opts.mode],
      specDir: opts.specDir,
      testDir,
      workers: opts.workers,
      maxFps,
      exitCode: result.exitCode,
      pagesAttached: attached.length,
      attachError,
      enumeratedPageUrls: [...enumerated],
      client,
      canvasSample,
      host: host.stats(),
      eventKinds: kinds,
      probe: host.events.find((e) => e.kind === "probe") ?? null,
      mapped: {
        total: mapped.length,
        invalid: mapped.filter((m) => !m.valid).length,
        invalidErrors: mapped.filter((m) => !m.valid).map((m) => m.error ?? "").slice(0, 3),
      },
      mappedSample: mapped.slice(0, 10),
      stdoutTail: lines.filter((l) => l.trim() !== "").slice(-20).join("\n"),
      userCodeModified: false,
    };
  } finally {
    for (const s of attached) await s.stop().catch(() => undefined);
    watcher?.stop();
    await cdpBrowser?.close().catch(() => undefined);
    await owned?.close().catch(() => undefined);
    await viewerPage?.close().catch(() => undefined);
    await host.close();
  }
}

/* ── 리포트 ───────────────────────────────────────────────── */

function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "n/a" : v.toFixed(digits);
}

function printOutcome(o: RunOutcome): void {
  const c = o.client;
  console.log(`\n── ${o.label}`);
  console.log(
    `   testDir=${o.testDir} workers=${String(o.workers)} maxFps=${String(o.maxFps)} exit=${String(o.exitCode)}`,
  );
  console.log(
    `   pagesAttached=${String(o.pagesAttached)} attachError=${o.attachError ?? "none"} ` +
      `enumerated=${JSON.stringify(o.enumeratedPageUrls)}`,
  );
  if (c === null) {
    console.log("   ★ 프레임이 한 장도 렌더되지 않았다 (라이브 화면 없음)");
  } else {
    console.log(
      `   fps=${fmt(c.fps, 2)} p50=${fmt(c.latencyDrawMs.p50)}ms p95=${fmt(c.latencyDrawMs.p95)}ms ` +
        `max=${fmt(c.latencyDrawMs.max)}ms mbps=${fmt(c.mbps, 2)} rendered=${String(c.rendered)} ` +
        `dropCli=${String(c.droppedClient)} n=${String(c.latencyDrawMs.n)}`,
    );
    console.log(
      `   paint p50=${fmt(c.latencyPaintMs.p50)}ms p95=${fmt(c.latencyPaintMs.p95)}ms · ` +
        `canvas distinctColors=${String(o.canvasSample?.distinctColors ?? 0)} ` +
        `center=${JSON.stringify(o.canvasSample?.center ?? [])}`,
    );
    console.log(
      `   host: produced=${String(o.host.framesProduced)} sent=${String(o.host.framesSent)} ` +
        `dropBp=${String(o.host.framesDroppedBackpressure)} dropNoViewer=${String(o.host.framesDroppedNoViewer)}`,
    );
  }
  console.log(`   events=${JSON.stringify(o.eventKinds)}`);
  console.log(`   SSE 변환: total=${String(o.mapped.total)} invalid=${String(o.mapped.invalid)}`);
  if (o.mapped.invalid > 0) console.log(`   invalidErrors=${JSON.stringify(o.mapped.invalidErrors)}`);
}

/* ── main ─────────────────────────────────────────────────── */

function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const SPEC_DIRS: Readonly<Record<string, string>> = {
  measure: "./specs-measure",
  functional: "./specs",
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const all = args["all"] === "true";
  const modes: Mode[] = all
    ? ["c", "b", "d"]
    : [(args["mode"] ?? "d") as Mode];
  const specKey = args["spec"] ?? "measure";
  const specDir = SPEC_DIRS[specKey] ?? specKey;
  const measureSeconds = Number(args["seconds"] ?? (specKey === "measure" ? "12" : "0"));
  const workers = Number(args["workers"] ?? "1");
  const maxFps = Number(args["maxFps"] ?? String(DEFAULT_MAX_FPS));
  const specSeconds = Number(args["specSeconds"] ?? "20");
  const userConfig = args["userConfig"];
  const headed = args["headed"] === "true";

  const viewerBrowser = await chromium.launch({ headless: true });
  const outcomes: RunOutcome[] = [];
  try {
    for (const mode of modes) {
      console.log(`\n[r2] === mode ${mode} · spec ${specKey} · workers ${String(workers)} ===`);
      try {
        const outcome = await runMode({
          mode,
          specDir,
          measureSeconds,
          workers,
          viewerBrowser,
          maxFps,
          specSeconds,
          ...(userConfig === undefined ? {} : { userConfig }),
          headed,
        });
        outcomes.push(outcome);
        printOutcome(outcome);
      } catch (error) {
        console.log(`   ★ mode ${mode} 실행 자체가 실패했다: ${String(error).slice(0, 600)}`);
      }
    }
  } finally {
    await viewerBrowser.close().catch(() => undefined);
  }

  const outFile = args["out"];
  if (outFile !== undefined && outFile !== "true") {
    const report = {
      generatedAt: new Date().toISOString(),
      env: {
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        playwright: "1.63.0",
        size: { width: 1280, height: 800 },
        quality: 60,
        maxFps,
        measureSeconds,
        workers,
        specDir,
      },
      criteria: PASS_CRITERIA,
      outcomes,
    };
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\n[r2] JSON → ${outFile}`);
  }
}

if (process.argv[1]?.includes("r2.js") === true) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
