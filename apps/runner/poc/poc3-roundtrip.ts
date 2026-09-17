/**
 * PoC-3 — 녹화 → 재생 왕복 (03-phases Task 12.2)
 *
 * ⚠️ 검증용 하네스다. 제품 코드가 아니다. `record-verify.ts`(Gen-Phase 7)의 확장판이다.
 *
 * ## 04-gen-7 이 못 덮은 것을 덮는다
 * 04-gen-7 은 통제된 로그인 fixture 에서 7/7 을 실측했지만 **iframe · SPA 라우팅 ·
 * 동적 리스트가 빠져 있다**고 한계를 명시했다. 이번에 그 셋을 모두 넣는다.
 *
 *  - **대상 A** `fixtures/poc3-app.html` — iframe · pushState 라우팅 · **전체 이동(새 문서)** ·
 *    같은 이름 버튼이 늘어나는 동적 리스트
 *  - **대상 B** `https://playwright.dev` — 실제 공개 사이트(Docusaurus SPA). 우리가 만들지
 *    않은 마크업에서 role/label 후보가 실제로 뽑히는지 본다.
 *
 * ## 실행
 * ```
 * # MySQL·Redis·API·Runner 를 띄운 뒤
 * yarn workspace @testflow/runner build:poc
 * node apps/runner/dist-poc/poc/poc3-roundtrip.js
 * node apps/runner/dist-poc/poc/poc3-roundtrip.js --local-only    # 네트워크가 막힌 환경
 * ```
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

const POC_ROOT = resolve(fileURLToPath(new URL("../../poc", import.meta.url)));
const API = process.env["API_BASE"] ?? "http://127.0.0.1:4000/api";
const STATIC_PORT = Number(process.env["POC3_STATIC_PORT"] ?? 5311);
const VIEWPORT = { w: 1280, h: 800 } as const;

const TYPED_PASSWORD = "Tf!SecretPw#2026";

const out = (message: string): void => {
  process.stdout.write(`${message}\n`);
};
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/* ── fixture 절대 좌표 (원격 뷰포트 CSS 픽셀) ──────────────────
   fixture 의 인라인 style 과 1:1 대응한다. fixture 를 고치면 여기도 고친다. */
const A = {
  navHome: { x: 85, y: 41 },
  navContract: { x: 187, y: 41 },
  goPage2: { x: 314, y: 41 },
  search: { x: 190, y: 119 },
  addRow: { x: 415, y: 119 },
  /** 동적 리스트 2번째 줄의 "삭제" — 같은 이름 버튼이 4개인 상태에서 누른다. */
  deleteRow2: { x: 222, y: 203 },
  contractName: { x: 190, y: 119 },
  saveContract: { x: 415, y: 119 },
  /** iframe(left 40 / top 400) 내부 좌표를 더한 값. */
  frameOwner: { x: 40 + 126, y: 400 + 54 },
  frameConfirm: { x: 40 + 71, y: 400 + 102 },
  page2Memo: { x: 190, y: 115 },
  page2Complete: { x: 415, y: 115 },
  /** type="password" — 값을 수집하지 않고 `{{password}}` 로 승격되어야 한다. */
  page2Password: { x: 190, y: 191 },
} as const;

/* ── 정적 서버 (record-verify.ts 와 동일 구현) ────────────────── */

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
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${String(response.status)} ${text}`);
  }
  return (text === "" ? null : JSON.parse(text)) as T;
}

/* ── 녹화 조작 ──────────────────────────────────────────────── */

interface RecordedStep {
  sequence: number;
  name: string;
  actionType: string;
  /** `goto`·`wait` 처럼 대상이 없는 액션은 `null` 이다. */
  target: {
    primary: { by: string; value: string; name?: string | null };
    fallbacks: { by: string; value: string }[];
    frameUrl: string | null;
  } | null;
  input: { value: string; isSecret: boolean } | null;
}

/** 캔버스 클라이언트를 열고 원격 페이지를 조작할 손잡이를 만든다. */
async function openRecorderClient(
  browser: Browser,
  origin: string,
  wsUrl: string,
): Promise<{ page: Page; click: (p: { x: number; y: number }) => Promise<void>; type: (t: string) => Promise<void> }> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  await page.goto(`${origin}/client/index.html?ws=${encodeURIComponent(wsUrl)}&scale=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction("window.__poc && window.__poc.ready()", undefined, { timeout: 60_000 });

  const click = async (p: { x: number; y: number }): Promise<void> => {
    const css = (await page.evaluate(`window.__poc.toClientPoint(${String(p.x)}, ${String(p.y)})`)) as {
      x: number;
      y: number;
    };
    await page.mouse.click(css.x, css.y);
    await sleep(320);
  };
  const type = async (text: string): Promise<void> => {
    await page.keyboard.type(text, { delay: 55 });
    await sleep(900); // 디바운스 확정 대기
  };
  return { page, click, type };
}

async function createSession(
  scenarioName: string,
  startUrl: string,
): Promise<{ scenarioId: string; sessionId: string; wsUrl: string }> {
  const projects = await api<{ id: string }[]>("/projects");
  const projectId = projects[0]?.id;
  if (projectId === undefined) throw new Error("프로젝트가 없습니다. 시드를 확인하세요.");

  const scenario = await api<{ id: string; code: string }>(`/projects/${projectId}/scenarios`, {
    method: "POST",
    body: JSON.stringify({ name: scenarioName, feature: "POC3", authorName: "gen-phase-12" }),
  });
  const session = await api<{ sessionId: string; wsUrl: string }>(
    `/scenarios/${scenario.id}/recordings`,
    { method: "POST", body: JSON.stringify({ startUrl, viewport: { w: VIEWPORT.w, h: VIEWPORT.h } }) },
  );
  return { scenarioId: scenario.id, sessionId: session.sessionId, wsUrl: session.wsUrl };
}

/* ── 재생 ───────────────────────────────────────────────────── */

interface ReplayResult {
  runId: string;
  status: string;
  passedSteps: number;
  totalSteps: number;
  errorMessage: string | null;
  steps: { sequence: number; name: string; status: string; error: string | null }[];
}

async function replay(scenarioId: string, baseUrl: string): Promise<ReplayResult> {
  const run = await api<{ runId: string }>("/runs", {
    method: "POST",
    body: JSON.stringify({
      scenarioId,
      baseUrl,
      envLabel: "PoC-3",
      browser: "chromium",
      variables: { password: TYPED_PASSWORD },
    }),
  });

  for (let i = 0; i < 180; i += 1) {
    await sleep(1000);
    const detail = await api<{
      status: string;
      passedSteps: number;
      totalSteps: number;
      errorMessage: string | null;
      steps: { sequence: number; nameSnapshot: string; status: string; errorMessage: string | null }[];
    }>(`/runs/${run.runId}`);
    if (["passed", "failed", "cancelled", "timeout", "error"].includes(detail.status)) {
      return {
        runId: run.runId,
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
    }
  }
  throw new Error(`재생이 180초 안에 끝나지 않았습니다: ${run.runId}`);
}

/* ── 대상 A — 로컬 SPA fixture ──────────────────────────────── */

async function targetLocal(
  browser: Browser,
  origin: string,
): Promise<Record<string, unknown>> {
  const startUrl = `${origin}/fixtures/poc3-app.html`;
  const { scenarioId, sessionId, wsUrl } = await createSession(
    `PoC-3 로컬 SPA ${new Date().toISOString().slice(11, 19)}`,
    startUrl,
  );
  out(`[A] 세션 ${sessionId} → ${startUrl}`);

  const { page, click, type } = await openRecorderClient(browser, origin, wsUrl);
  await sleep(900); // 동적 리스트 3줄이 붙기를 기다린다(fixture 가 300ms 뒤 추가)

  // ① 홈 — 검색어 입력(디바운스 대상) → 항목 추가 → 동적 리스트 2번째 줄 삭제(고유성)
  await click(A.search);
  await type("계약서");
  await click(A.addRow);
  await sleep(250);
  await click(A.deleteRow2);

  // ② SPA 라우팅 (pushState — 같은 문서)
  await click(A.navContract);
  await sleep(350);
  await click(A.contractName);
  await type("2026 유지보수 계약");
  await click(A.saveContract);

  // ③ iframe 안의 요소
  await click(A.frameOwner);
  await type("김담당");
  await click(A.frameConfirm);

  // ④ 전체 이동 (새 문서) — addInitScript 재주입 여부가 여기서 갈린다
  await click(A.navHome);
  await sleep(300);
  await click(A.goPage2);
  await sleep(1400);
  await click(A.page2Memo);
  await type("검토 완료");
  // ⑤ 비밀번호 승격 — 새 문서의 type="password" 에 평문을 실제로 친다.
  await click(A.page2Password);
  await type(TYPED_PASSWORD);
  await click(A.page2Complete);
  await sleep(700);

  const live = await api<{ draftStepCount: number; status: string }>(`/recordings/${sessionId}`);
  out(`[A] 초안 ${String(live.draftStepCount)}건`);

  const stopped = await api<{ steps: RecordedStep[] }>(`/recordings/${sessionId}/stop`, {
    method: "POST",
  });
  await page.close().catch(() => undefined);

  const advanced = await api<{ steps: RecordedStep[] }>(`/scenarios/${scenarioId}?advanced=1`);
  const result = await replay(scenarioId, origin);
  out(`[A] 재생: ${result.status} ${String(result.passedSteps)}/${String(result.totalSteps)}`);

  return {
    startUrl,
    scenarioId,
    draftStepCount: live.draftStepCount,
    recordedSteps: stopped.steps.map(describe),
    frameSteps: advanced.steps.filter((s) => (s.target?.frameUrl ?? null) !== null).map(describe),
    afterFullNavigationSteps: advanced.steps
      .filter((s) => s.name.includes("메모") || s.name.includes("완료"))
      .map(describe),
    // ★ 비밀번호 유출 대조 — 이 시나리오에는 password 필드가 없으므로 평문 자체가 없어야 한다.
    plaintextScan: {
      searched: JSON.stringify({ stopped: stopped.steps, advanced: advanced.steps }).length,
      foundTypedPassword: JSON.stringify({ stopped: stopped.steps, advanced: advanced.steps }).includes(
        TYPED_PASSWORD,
      ),
    },
    replay: result,
    roundTrip: `${String(result.passedSteps)}/${String(result.totalSteps)}`,
  };
}

/* ── 대상 B — 공개 사이트 playwright.dev ────────────────────── */

/**
 * 원격 페이지를 직접 질의할 수 없으므로, **같은 뷰포트의 참조 페이지**를 로컬에 따로 띄워
 * 대상 요소의 화면 좌표를 구한다. 같은 URL·같은 뷰포트라 좌표가 일치한다.
 */
async function referencePoints(
  browser: Browser,
  url: string,
  picks: { key: string; role: "link" | "button"; name: string }[],
): Promise<Record<string, { x: number; y: number }>> {
  const page = await browser.newPage({ viewport: { width: VIEWPORT.w, height: VIEWPORT.h } });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1500);
    const points: Record<string, { x: number; y: number }> = {};
    for (const pick of picks) {
      const box = await page
        .getByRole(pick.role, { name: pick.name, exact: false })
        .first()
        .boundingBox({ timeout: 10_000 })
        .catch(() => null);
      if (box !== null) {
        points[pick.key] = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      }
    }
    return points;
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function targetPublic(browser: Browser, origin: string): Promise<Record<string, unknown>> {
  const SITE = "https://playwright.dev";

  const home = await referencePoints(browser, SITE, [
    { key: "docs", role: "link", name: "Docs" },
    { key: "getStarted", role: "link", name: "GET STARTED" },
  ]);
  const docs = await referencePoints(browser, `${SITE}/docs/intro`, [
    { key: "writingTests", role: "link", name: "Writing tests" },
  ]);
  out(`[B] 참조 좌표: ${JSON.stringify({ ...home, ...docs })}`);

  const docsPoint = home["docs"];
  const writingPoint = docs["writingTests"];
  if (docsPoint === undefined || writingPoint === undefined) {
    return { skipped: true, reason: "참조 좌표를 구하지 못했습니다(사이트 구조 변경 가능).", home, docs };
  }

  const { scenarioId, sessionId, wsUrl } = await createSession(
    `PoC-3 공개사이트 ${new Date().toISOString().slice(11, 19)}`,
    SITE,
  );
  out(`[B] 세션 ${sessionId} → ${SITE}`);

  const { page, click } = await openRecorderClient(browser, origin, wsUrl);
  await sleep(2500);

  await click(docsPoint); // Docusaurus 의 클라이언트 사이드 라우팅
  await sleep(2500);
  await click(writingPoint); // 라우팅 이후 새 화면의 링크 — 리스너가 살아 있어야 잡힌다
  await sleep(2000);

  const live = await api<{ draftStepCount: number }>(`/recordings/${sessionId}`);
  const stopped = await api<{ steps: RecordedStep[] }>(`/recordings/${sessionId}/stop`, {
    method: "POST",
  });
  await page.close().catch(() => undefined);

  const result = await replay(scenarioId, SITE);
  out(`[B] 재생: ${result.status} ${String(result.passedSteps)}/${String(result.totalSteps)}`);

  return {
    site: SITE,
    scenarioId,
    draftStepCount: live.draftStepCount,
    recordedSteps: stopped.steps.map(describe),
    replay: result,
    roundTrip: `${String(result.passedSteps)}/${String(result.totalSteps)}`,
  };
}

function describe(step: RecordedStep): Record<string, unknown> {
  const target = step.target;
  return {
    seq: step.sequence,
    action: step.actionType,
    name: step.name,
    primary:
      target === null
        ? null
        : `${target.primary.by}=${target.primary.value}${
            target.primary.name === undefined || target.primary.name === null
              ? ""
              : ` [${target.primary.name}]`
          }`,
    fallbacks: target === null ? [] : target.fallbacks.map((f) => `${f.by}=${f.value}`),
    frameUrl: target?.frameUrl ?? null,
    input: step.input === null ? null : { value: step.input.value, isSecret: step.input.isSecret },
  };
}

/* ── main ───────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const localOnly = process.argv.includes("--local-only");
  const { server, origin } = await startStatic(STATIC_PORT);
  let browser: Browser | null = null;
  const report: Record<string, unknown> = {};

  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    report["local"] = await targetLocal(browser, origin);

    if (localOnly) {
      report["public"] = { skipped: true, reason: "--local-only" };
    } else {
      try {
        report["public"] = await targetPublic(browser, origin);
      } catch (error: unknown) {
        report["public"] = {
          skipped: true,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    out("\n===== POC3 REPORT =====");
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

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
