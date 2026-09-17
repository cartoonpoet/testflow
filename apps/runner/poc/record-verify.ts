/**
 * 녹화 파이프라인 실검증 스크립트 (Gen-Phase 7)
 *
 * ⚠️ 검증용 하네스다. 제품 코드가 아니다. `poc/` 정리 시 함께 정리한다.
 *
 * 하는 일 — **실제로 녹화한다.**
 *   1. 더미 페이지를 정적 서버로 띄운다 (`poc/fixtures/record-login.html`).
 *   2. API 로 시나리오 + 녹화 세션을 만든다(= 단명 토큰 발급 경로를 그대로 탄다).
 *   3. PoC-1 의 캔버스 클라이언트(`poc/client/index.html`)를 **진짜 headless Chromium** 으로
 *      띄워 Runner WS 에 붙인다. 측정이 검증된 방식이라 그대로 재사용한다.
 *   4. 캔버스에 **진짜 마우스·키보드 이벤트**를 쏴서 이동→입력→입력→클릭을 수행한다.
 *      (원격 페이지를 직접 질의할 방법이 없으므로 fixture 의 절대 좌표를 근거로 계산한다.)
 *   5. 초안이 쌓였는지 · 디바운스 · 비밀번호 승격 · 고유성 · fps 상한을 검사한다.
 *   6. `stop` 으로 확정한 스텝을 **Runner 로 다시 실행**해 녹화→재생 왕복을 본다.
 *
 * 실행:
 *   API·Runner 를 띄운 뒤
 *   node dist-poc/poc/record-verify.js            # 전체
 *   node dist-poc/poc/record-verify.js --idle     # 유휴 타임아웃만
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { WebSocket } from "ws";

const POC_ROOT = resolve(fileURLToPath(new URL("../../poc", import.meta.url)));
const API = process.env["API_BASE"] ?? "http://127.0.0.1:4000/api";
const STATIC_PORT = Number(process.env["VERIFY_STATIC_PORT"] ?? 5301);
const FIXTURE_PATH = "/fixtures/record-login.html";

/** ★ fixture 의 절대 좌표(원격 뷰포트 CSS 픽셀). fixture 를 고치면 여기도 고쳐야 한다. */
const REMOTE = {
  username: { x: 290, y: 109 },
  password: { x: 290, y: 159 },
  loginButton: { x: 220, y: 299 },
  confirmA: { x: 305, y: 404 },
  deleteB: { x: 415, y: 464 },
  deleteC: { x: 415, y: 524 },
} as const;

const TYPED_ID = "qa-tester";
const TYPED_PASSWORD = "hunter2";

const out = (message: string): void => {
  process.stdout.write(`${message}\n`);
};
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/* ── 정적 서버 ──────────────────────────────────────────────── */

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function startStatic(port: number): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/u, "");
      const absolute = join(POC_ROOT, relative);
      if (!absolute.startsWith(POC_ROOT + sep)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      try {
        const info = await stat(absolute);
        if (!info.isFile()) throw new Error("not a file");
        res.writeHead(200, {
          "content-type": MIME[extname(absolute).toLowerCase()] ?? "application/octet-stream",
          "cache-control": "no-store",
          "content-length": String(info.size),
        });
        createReadStream(absolute).pipe(res);
      } catch {
        res.writeHead(404).end("not found");
      }
    })();
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      done({ server, origin: `http://127.0.0.1:${String(port)}` });
    });
  });
}

/* ── API ────────────────────────────────────────────────────── */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${String(response.status)} ${text}`);
  return (text === "" ? null : JSON.parse(text)) as T;
}

/* ── 클라이언트 조작 ────────────────────────────────────────── */

interface PocStats {
  elapsedSeconds: number;
  rendered: number;
  received: number;
  bytes: number;
  droppedClient: number;
  fps: number;
  latencyDrawMs: { n: number; p50: number | null; p95: number | null; max: number | null };
}

async function clickRemote(page: Page, point: { x: number; y: number }): Promise<void> {
  // DOM lib 이 없는 tsconfig 라 페이지 코드는 문자열로 넘긴다(`measure.ts` 와 같은 방식).
  const css = (await page.evaluate(
    `window.__poc.toClientPoint(${String(point.x)}, ${String(point.y)})`,
  )) as { x: number; y: number };
  await page.mouse.click(css.x, css.y);
  await sleep(250);
}

/* ── 검증 본체 ──────────────────────────────────────────────── */

interface Report {
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const idleOnly = process.argv.includes("--idle");
  const { server, origin } = await startStatic(STATIC_PORT);
  const fixtureUrl = `${origin}${FIXTURE_PATH}`;
  out(`정적 서버: ${fixtureUrl}`);

  let browser: Browser | null = null;
  const report: Report = {};

  try {
    const projects = await api<{ id: string; name: string }[]>("/projects");
    const projectId = projects[0]?.id;
    if (projectId === undefined) throw new Error("프로젝트가 없습니다. 시드를 확인하세요.");

    const scenario = await api<{ id: string; code: string; name: string }>(
      `/projects/${projectId}/scenarios`,
      {
        method: "POST",
        body: JSON.stringify({
          name: `녹화 검증 ${new Date().toISOString().slice(11, 19)}`,
          feature: "AUTH",
          authorName: "gen-phase-7",
        }),
      },
    );
    out(`시나리오 생성: ${scenario.code} (${scenario.id})`);

    const session = await api<{ sessionId: string; wsUrl: string; expiresAt: string }>(
      `/scenarios/${scenario.id}/recordings`,
      { method: "POST", body: JSON.stringify({ startUrl: fixtureUrl, viewport: { w: 1280, h: 800 } }) },
    );
    out(`녹화 세션: ${session.sessionId}  ws=${session.wsUrl.replace(/token=[^&]+/u, "token=…")}`);

    /* ── ① 잘못된 토큰은 4401 로 거부되는가 ── */
    report["badToken"] = await expectCloseCode(session.wsUrl.replace(/token=[^&]+/u, "token=bad"));
    report["unknownSession"] = await expectCloseCode(
      session.wsUrl.replace(/\/rec\/[0-9a-f-]{36}/u, "/rec/00000000-0000-4000-8000-000000000000"),
    );

    if (idleOnly) {
      report["idle"] = await verifyIdleTimeout(session);
      out(JSON.stringify(report, null, 2));
      return;
    }

    /* ── ② 캔버스 클라이언트로 접속 ── */
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const clientUrl = `${origin}/client/index.html?ws=${encodeURIComponent(session.wsUrl)}&scale=1`;
    await page.goto(clientUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction("window.__poc && window.__poc.ready()", undefined, { timeout: 60_000 });
    out("캔버스 클라이언트 접속 + 첫 프레임 렌더 완료");

    /* ── ③ fps / 대역폭 측정 (스로틀 확인) ── */
    const measureSeconds = Number(process.env["VERIFY_MEASURE_SECONDS"] ?? 10);
    await page.evaluate("window.__poc.reset()");
    await sleep(measureSeconds * 1000);
    const stats = (await page.evaluate("window.__poc.stats()")) as PocStats;
    report["throughput"] = {
      seconds: Number(stats.elapsedSeconds.toFixed(2)),
      renderedFrames: stats.rendered,
      fps: Number(stats.fps.toFixed(2)),
      megabitsPerSecond: Number(((stats.bytes * 8) / stats.elapsedSeconds / 1e6).toFixed(2)),
      latencyDrawMs: stats.latencyDrawMs,
      droppedClient: stats.droppedClient,
    };
    out(`fps=${stats.fps.toFixed(2)}  frames=${String(stats.rendered)}`);

    /* ── ④ 실제 조작: 이동(세션 시작) → 입력 → 입력 → 클릭 ── */
    await clickRemote(page, REMOTE.username);
    await page.keyboard.type(TYPED_ID, { delay: 60 });
    await sleep(900); // 디바운스 확정 대기

    await clickRemote(page, REMOTE.password);
    await page.keyboard.type(TYPED_PASSWORD, { delay: 60 });
    await sleep(900);

    await clickRemote(page, REMOTE.loginButton);
    await sleep(400);

    // 같은 이름 요소가 여럿인 상황 — 고유성 검증이 실제로 도는지
    await clickRemote(page, REMOTE.confirmA);
    await clickRemote(page, REMOTE.deleteB);
    await clickRemote(page, REMOTE.deleteC);
    await sleep(800);

    const live = await api<{ draftStepCount: number; status: string }>(`/recordings/${session.sessionId}`);
    report["draftStepCount"] = live.draftStepCount;
    out(`초안 ${String(live.draftStepCount)}건 (status=${live.status})`);

    /* ── ⑤ 확정 → 시나리오 반영 ── */
    const stopped = await api<{ steps: unknown[] }>(`/recordings/${session.sessionId}/stop`, {
      method: "POST",
    });
    report["confirmedSteps"] = stopped.steps;

    const advanced = await api<{ steps: unknown[] }>(`/scenarios/${scenario.id}?advanced=1`);
    report["storedStepsAdvanced"] = advanced.steps;

    /* ── ⑥ 비밀번호 유출 전수 검사 ── */
    const haystack = JSON.stringify({ stopped, advanced, live });
    report["secretLeak"] = {
      searchedBytes: haystack.length,
      passwordPlaintextFound: haystack.includes(TYPED_PASSWORD),
      typedIdFound: haystack.includes(TYPED_ID),
    };

    /* ── ⑦ 녹화 → 재생 왕복 ── */
    const run = await api<{ runId: string }>("/runs", {
      method: "POST",
      body: JSON.stringify({
        scenarioId: scenario.id,
        baseUrl: origin,
        envLabel: "녹화검증",
        browser: "chromium",
        variables: { password: TYPED_PASSWORD },
      }),
    });
    out(`재생 실행 등록: ${run.runId}`);

    let final: { status: string; passedSteps: number; totalSteps: number; errorMessage: string | null } = {
      status: "queued",
      passedSteps: 0,
      totalSteps: 0,
      errorMessage: null,
    };
    for (let i = 0; i < 120; i += 1) {
      await sleep(1000);
      const detail = await api<{
        status: string;
        passedSteps: number;
        totalSteps: number;
        errorMessage: string | null;
        steps: { sequence: number; nameSnapshot: string; status: string; errorMessage: string | null }[];
      }>(`/runs/${run.runId}`);
      if (["passed", "failed", "cancelled", "timeout", "error"].includes(detail.status)) {
        final = detail;
        report["replay"] = {
          status: detail.status,
          passedSteps: detail.passedSteps,
          totalSteps: detail.totalSteps,
          errorMessage: detail.errorMessage,
          steps: detail.steps.map((s) => ({
            sequence: s.sequence,
            name: s.nameSnapshot,
            status: s.status,
            error: s.errorMessage,
          })),
        };
        break;
      }
    }
    out(`재생 결과: ${final.status} (${String(final.passedSteps)}/${String(final.totalSteps)})`);

    report["scenarioId"] = scenario.id;
    report["sessionId"] = session.sessionId;
    out("\n===== REPORT =====");
    out(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close().catch(() => undefined);
    await new Promise<void>((done) => {
      server.close(() => {
        done();
      });
    });
  }
}

/** WS 를 열어 close code 를 받아 온다. 연결이 유지되면 즉시 끊고 `null` 을 돌려준다. */
function expectCloseCode(wsUrl: string): Promise<{ closeCode: number | null; opened: boolean }> {
  return new Promise((done) => {
    const socket = new WebSocket(wsUrl);
    let opened = false;
    const timer = setTimeout(() => {
      socket.terminate();
      done({ closeCode: null, opened });
    }, 8000);
    socket.on("open", () => {
      opened = true;
    });
    socket.on("close", (code) => {
      clearTimeout(timer);
      done({ closeCode: code, opened });
    });
    socket.on("error", () => undefined);
  });
}

/**
 * 유휴 타임아웃 검증.
 * Runner 를 `RECORDING_IDLE_TIMEOUT_MS=15000` 으로 띄워 놓고 돌린다.
 */
async function verifyIdleTimeout(session: { sessionId: string; wsUrl: string }): Promise<unknown> {
  const socket = new WebSocket(session.wsUrl);
  await new Promise<void>((done, fail) => {
    socket.once("open", () => {
      done();
    });
    socket.once("error", fail);
  });
  await sleep(2000);
  socket.close();
  out("유휴 타임아웃 대기 중… (최대 60초)");

  for (let i = 0; i < 60; i += 1) {
    await sleep(2000);
    const state = await api<{ status: string; draftStepCount: number }>(`/recordings/${session.sessionId}`);
    if (state.status !== "live") {
      return { status: state.status, waitedSeconds: (i + 1) * 2, draftStepCount: state.draftStepCount };
    }
  }
  return { status: "live", timedOut: true };
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
