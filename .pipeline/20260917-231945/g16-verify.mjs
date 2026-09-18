/**
 * 라운드 8 · 삭제 UX 실측 스크립트.
 *
 * ★ 이 스크립트의 핵심은 **디스크를 직접 본다**는 것이다. API 가 204 를 돌려줬다는 사실은
 *   증적 파일이 지워졌다는 증거가 아니다 — 07-attachments §8 의 97MB 고아 파일 사고가
 *   정확히 그 착각에서 났다.
 *
 * 실행: node .pipeline/20260917-231945/g16-verify.mjs
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const API = process.env.API ?? "http://127.0.0.1:4000/api";
const ROOT = resolve(process.env.ARTIFACT_ROOT ?? "./artifacts");
const log = [];

function say(line) {
  console.log(line);
  log.push(line);
}

function dirStat(dir) {
  if (!existsSync(dir)) return { exists: false, files: 0, bytes: 0, names: [] };
  const names = readdirSync(dir);
  let bytes = 0;
  let files = 0;
  for (const name of names) {
    const info = statSync(join(dir, name));
    if (info.isFile()) {
      files += 1;
      bytes += info.size;
    }
  }
  return { exists: true, files, bytes, names };
}

function treeBytes(dir) {
  if (!existsSync(dir)) return 0;
  const out = execFileSync("du", ["-sb", dir]).toString();
  return Number(out.split("\t")[0]);
}

function mysql(sql) {
  return execFileSync("docker", [
    "exec", "testflow-mysql", "mysql", "-uroot", "-ptestflow_local", "testflow",
    "-N", "-B", "-e", sql,
  ], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

function redis(...args) {
  return execFileSync("docker", ["exec", "testflow-redis", "redis-cli", ...args])
    .toString().trim();
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text === "" ? undefined : JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const results = { pass: 0, fail: 0 };
function check(label, ok, detail = "") {
  if (ok) { results.pass += 1; say(`  ✔ ${label}${detail === "" ? "" : ` — ${detail}`}`); }
  else { results.fail += 1; say(`  ✘ ${label}${detail === "" ? "" : ` — ${detail}`}`); }
}

/* ══════════════════════════════════════════════════════════════════ */

say("══ 0. 사전 상태 ══");
const projects = await call("GET", "/projects");
const projectId = projects.body?.[0]?.id ?? projects.body?.items?.[0]?.id;
say(`projectId = ${projectId}`);
const runsRootBefore = treeBytes(join(ROOT, "runs"));
say(`ARTIFACT_ROOT = ${ROOT}`);
say(`artifacts/runs 전체 = ${runsRootBefore} bytes (${(runsRootBefore / 1048576).toFixed(1)} MB), ${readdirSync(join(ROOT, "runs")).length} 디렉토리`);

/* ── 1. ★ 실행 삭제 → 증적 파일이 디스크에서 사라지는가 ───────────── */
say("");
say("══ 1. ★ 실행 삭제 — 증적 파일 디스크 실측 ══");

const runList = (await call("GET", `/runs?projectId=${projectId}&limit=100`)).body ?? [];
const terminal = ["passed", "failed", "cancelled", "timeout", "error"];
let victim = null;
for (const run of runList) {
  if (!terminal.includes(run.status)) continue;
  const d = dirStat(join(ROOT, "runs", run.id));
  if (d.exists && d.files > 0) { victim = { run, dir: d }; break; }
}

if (victim === null) {
  say("  ! 증적이 있는 종료된 실행이 없다 — 이 절은 건너뛴다.");
} else {
  const { run, dir } = victim;
  say(`대상: ${run.runCode} (${run.id}) status=${run.status}`);
  say(`  [before] artifacts/runs/${run.id}/`);
  say(`           존재=${dir.exists} 파일=${dir.files}개 크기=${dir.bytes} bytes`);
  say(`           파일목록=${JSON.stringify(dir.names)}`);

  const artifactRows = mysql(`SELECT COUNT(*) FROM artifacts WHERE run_id='${run.id}'`);
  const stepRows = mysql(`SELECT COUNT(*) FROM step_results WHERE run_id='${run.id}'`);
  say(`  [before] DB artifacts=${artifactRows}행 step_results=${stepRows}행`);
  const lastRunRefs = mysql(`SELECT COUNT(*) FROM scenarios WHERE last_run_id='${run.id}'`);
  say(`  [before] scenarios.last_run_id 역참조=${lastRunRefs}행`);

  // Redis 잔재를 일부러 만들어 둔다(끝난 run 이라 버퍼가 이미 만료됐을 수 있다).
  redis("RPUSH", `run:${run.id}:events`, '{"seq":1,"payload":{}}');
  redis("SET", `run:${run.id}:seq`, "1");
  redis("SET", `testflow:run:token:${run.id}`, "a".repeat(64));
  redis("SET", `testflow:run:token:${run.id}:${"b".repeat(64)}`, "1");
  say(`  [before] Redis 키 = ${redis("EXISTS", `run:${run.id}:events`, `run:${run.id}:seq`, `testflow:run:token:${run.id}`, `testflow:run:token:${run.id}:${"b".repeat(64)}`)}/4 존재`);

  const del = await call("DELETE", `/runs/${run.id}`);
  say(`  DELETE /api/runs/${run.id} → ${del.status}`);
  check("204 로 삭제된다", del.status === 204, `status=${del.status}`);

  const after = dirStat(join(ROOT, "runs", run.id));
  say(`  [after]  artifacts/runs/${run.id}/ 존재=${after.exists} 파일=${after.files}개 크기=${after.bytes} bytes`);
  check("★ 증적 디렉토리가 디스크에서 사라졌다", after.exists === false);

  const runsRootAfter = treeBytes(join(ROOT, "runs"));
  say(`  [after]  artifacts/runs 전체 = ${runsRootAfter} bytes (줄어든 양 ${runsRootBefore - runsRootAfter} bytes)`);
  check("★ 줄어든 용량이 그 실행의 증적 크기와 일치한다",
    runsRootBefore - runsRootAfter >= dir.bytes,
    `${runsRootBefore - runsRootAfter} >= ${dir.bytes}`);

  check("DB artifacts 행이 CASCADE 로 사라졌다",
    mysql(`SELECT COUNT(*) FROM artifacts WHERE run_id='${run.id}'`) === "0");
  check("DB step_results 행이 CASCADE 로 사라졌다",
    mysql(`SELECT COUNT(*) FROM step_results WHERE run_id='${run.id}'`) === "0");
  check("DB runs 행이 사라졌다",
    mysql(`SELECT COUNT(*) FROM runs WHERE id='${run.id}'`) === "0");
  check("scenarios.last_run_id 역참조가 NULL 로 끊겼다",
    mysql(`SELECT COUNT(*) FROM scenarios WHERE last_run_id='${run.id}'`) === "0");

  const redisAfter = redis("EXISTS", `run:${run.id}:events`, `run:${run.id}:seq`, `testflow:run:token:${run.id}`, `testflow:run:token:${run.id}:${"b".repeat(64)}`);
  say(`  [after]  Redis 키 = ${redisAfter}/4 존재`);
  check("Redis 잔재(SSE 버퍼·seq·라이브 토큰·해시별 보조키)가 사라졌다", redisAfter === "0");

  const gone = await call("GET", `/runs/${run.id}`);
  check("GET /api/runs/:id → 404", gone.status === 404, `status=${gone.status}`);
}

/* ── 2. ★ 진행 중 run 삭제 → 409 ───────────────────────────────── */
say("");
say("══ 2. ★ 진행 중 실행 삭제 시도 → 409 ══");

const scenarios = (await call("GET", `/projects/${projectId}/scenarios?size=100`)).body?.items ?? [];
const published = scenarios.find((s) => s.status === "published") ?? scenarios[0];
say(`실행 대상 시나리오: ${published?.code} ${published?.name}`);

const created = await call("POST", "/runs", {
  scenarioId: published.id,
  baseUrl: "https://example.com",
  envLabel: "verify",
  browser: "chromium",
  variables: {},
  secretKeys: [],
});
say(`POST /api/runs → ${created.status} runId=${created.body?.runId}`);
const queuedRunId = created.body?.runId;
const queuedStatus = (await call("GET", `/runs/${queuedRunId}`)).body?.status;
say(`  이 실행의 상태 = ${queuedStatus}`);

const refused = await call("DELETE", `/runs/${queuedRunId}`);
say(`DELETE /api/runs/${queuedRunId} → ${refused.status}`);
say(`  message: ${refused.body?.message}`);
check("★ 진행 중인 실행 삭제가 409 로 거부된다", refused.status === 409, `status=${refused.status}`);
check("거부 문구가 '먼저 취소하세요' 를 안내한다",
  String(refused.body?.message ?? "").includes("취소"));
check("DB 행이 그대로 살아 있다",
  mysql(`SELECT COUNT(*) FROM runs WHERE id='${queuedRunId}'`) === "1");

await call("POST", `/runs/${queuedRunId}/cancel`);
const afterCancel = await call("DELETE", `/runs/${queuedRunId}`);
say(`취소 후 DELETE → ${afterCancel.status}`);
check("취소한 뒤에는 삭제된다", afterCancel.status === 204, `status=${afterCancel.status}`);

/* ── 3. ★ 시나리오 삭제 — 코드 본문·첨부 디스크 파일 ───────────────── */
say("");
say("══ 3. ★ 시나리오 삭제 — 코드 본문·첨부 디스크 실측 ══");

const newScenario = (await call("POST", `/projects/${projectId}/scenarios`, {
  name: "라운드8 삭제 검증용",
  feature: "DEL",
  sourceType: "code",
  authorName: "verify",
})).body;
say(`생성: ${newScenario.code} (${newScenario.id})`);

await call("PUT", `/scenarios/${newScenario.id}/code`, {
  filename: "verify.spec.ts",
  content: "import { test, expect } from '@playwright/test';\ntest('x', async ({ page }) => { await page.goto('/'); await expect(page).toHaveTitle(/./); });\n",
});
const codeRows = mysql(`SELECT COUNT(*) FROM scenario_codes WHERE scenario_id='${newScenario.id}'`);
say(`  코드 본문 DB 행 = ${codeRows}`);

for (const name of ["데이터-1.csv", "데이터-2.csv"]) {
  const res = await fetch(
    `${API}/scenarios/${newScenario.id}/attachments?filename=${encodeURIComponent(name)}`,
    { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.alloc(4096, 7) },
  );
  say(`  첨부 업로드 ${name} → ${res.status}`);
}

const attachDir = join(ROOT, "scenario-attachments", newScenario.id);
const attachBefore = dirStat(attachDir);
say(`  [before] scenario-attachments/${newScenario.id}/ 존재=${attachBefore.exists} 파일=${attachBefore.files}개 ${attachBefore.bytes} bytes`);

const delScenario = await call("DELETE", `/scenarios/${newScenario.id}`);
say(`DELETE /api/scenarios/${newScenario.id} → ${delScenario.status}`);
check("204 로 삭제된다", delScenario.status === 204, `status=${delScenario.status}`);

const attachAfter = dirStat(attachDir);
say(`  [after]  scenario-attachments/${newScenario.id}/ 존재=${attachAfter.exists}`);
check("★ 첨부파일이 디스크에서 사라졌다", attachAfter.exists === false);
check("★ 코드 본문 DB 행이 CASCADE 로 사라졌다",
  mysql(`SELECT COUNT(*) FROM scenario_codes WHERE scenario_id='${newScenario.id}'`) === "0");
check("첨부 DB 행이 CASCADE 로 사라졌다",
  mysql(`SELECT COUNT(*) FROM scenario_attachments WHERE scenario_id='${newScenario.id}'`) === "0");

/* ── 4. 진행 중 실행이 있는 시나리오 삭제 → 409 ──────────────────── */
say("");
say("══ 4. 진행 중 실행이 있는 시나리오 삭제 → 409 ══");

const guarded = (await call("POST", `/projects/${projectId}/scenarios`, {
  name: "라운드8 진행중 가드 검증",
  feature: "DEL",
  sourceType: "code",
})).body;
await call("PUT", `/scenarios/${guarded.id}/code`, {
  filename: "guard.spec.ts",
  content: "import { test, expect } from '@playwright/test';\ntest('x', async ({ page }) => { await page.goto('/'); await expect(page).toHaveTitle(/./); });\n",
});
const guardRun = (await call("POST", "/runs", {
  scenarioId: guarded.id, baseUrl: "https://example.com", envLabel: "verify",
  browser: "chromium", variables: {}, secretKeys: [],
})).body;
say(`  ${guarded.code} 에 대해 실행 생성 → ${guardRun.runId} (queued)`);

const guardDel = await call("DELETE", `/scenarios/${guarded.id}`);
say(`DELETE /api/scenarios/${guarded.id} → ${guardDel.status}`);
say(`  message: ${guardDel.body?.message}`);
check("★ 진행 중 실행이 있으면 409 로 거부된다", guardDel.status === 409, `status=${guardDel.status}`);
check("첨부·코드 본문이 지워지지 않았다(거부는 파일 삭제보다 먼저다)",
  mysql(`SELECT COUNT(*) FROM scenario_codes WHERE scenario_id='${guarded.id}'`) === "1");

await call("POST", `/runs/${guardRun.runId}/cancel`);
const guardDel2 = await call("DELETE", `/scenarios/${guarded.id}`);
say(`취소 후 DELETE → ${guardDel2.status}`);
check("취소한 뒤에는 삭제된다", guardDel2.status === 204, `status=${guardDel2.status}`);
const survivingRun = await call("GET", `/runs/${guardRun.runId}`);
say(`  시나리오를 지운 뒤 그 실행 이력: status=${survivingRun.status} scenarioId=${survivingRun.body?.scenarioId}`);
check("★ 실행 이력은 남는다(scenario_id 만 NULL)",
  survivingRun.status === 200 && survivingRun.body?.scenarioId === null);
await call("DELETE", `/runs/${guardRun.runId}`);

/* ── 5. 다중 삭제 ──────────────────────────────────────────────── */
say("");
say("══ 5. 다중 삭제 — 시나리오 3건 · 실행 3건 ══");

const bulkScenarios = [];
for (let i = 1; i <= 3; i += 1) {
  const s = (await call("POST", `/projects/${projectId}/scenarios`, {
    name: `라운드8 일괄삭제 ${i}`, feature: "DEL", sourceType: "code",
  })).body;
  bulkScenarios.push(s.id);
}
say(`  시나리오 3건 생성: ${bulkScenarios.join(", ")}`);
const bulkS = await call("POST", "/scenarios/bulk-delete", { ids: bulkScenarios });
say(`POST /api/scenarios/bulk-delete → ${bulkS.status} ${JSON.stringify(bulkS.body)}`);
check("★ 시나리오 3건이 한 번에 삭제된다",
  bulkS.status === 200 && bulkS.body?.deleted?.length === 3 && bulkS.body?.skipped?.length === 0);

const bulkRuns = [];
for (let i = 1; i <= 3; i += 1) {
  const r = (await call("POST", "/runs", {
    scenarioId: published.id, baseUrl: "https://example.com", envLabel: "verify",
    browser: "chromium", variables: {}, secretKeys: [],
  })).body;
  bulkRuns.push(r.runId);
  await call("POST", `/runs/${r.runId}/cancel`);
}
say(`  실행 3건 생성·취소: ${bulkRuns.join(", ")}`);
const bulkR = await call("POST", "/runs/bulk-delete", { ids: bulkRuns });
say(`POST /api/runs/bulk-delete → ${bulkR.status} ${JSON.stringify(bulkR.body)}`);
check("★ 실행 3건이 한 번에 삭제된다",
  bulkR.status === 200 && bulkR.body?.deleted?.length === 3 && bulkR.body?.skipped?.length === 0);

/* ── 6. 부분 성공 (진행 중 1건 섞기) ───────────────────────────── */
say("");
say("══ 6. 다중 삭제 부분 성공 — 진행 중 1건 + 끝난 1건 + 없는 1건 ══");

const mixDone = (await call("POST", "/runs", {
  scenarioId: published.id, baseUrl: "https://example.com", envLabel: "verify",
  browser: "chromium", variables: {}, secretKeys: [],
})).body.runId;
await call("POST", `/runs/${mixDone}/cancel`);
const mixActive = (await call("POST", "/runs", {
  scenarioId: published.id, baseUrl: "https://example.com", envLabel: "verify",
  browser: "chromium", variables: {}, secretKeys: [],
})).body.runId;
const mixGhost = "00000000-0000-4000-8000-000000000000";

const mixed = await call("POST", "/runs/bulk-delete", { ids: [mixDone, mixActive, mixGhost] });
say(`POST /api/runs/bulk-delete (3건 혼합) → ${mixed.status}`);
say(`  ${JSON.stringify(mixed.body, null, 2)}`);
check("★ 끝난 1건은 지워지고 나머지는 건너뛴다(부분 성공)",
  mixed.body?.deleted?.length === 1 && mixed.body?.skipped?.length === 2);
check("건너뛴 이유가 in_progress / not_found 로 구분된다",
  mixed.body?.skipped?.some((s) => s.reason === "in_progress") &&
  mixed.body?.skipped?.some((s) => s.reason === "not_found"));
await call("POST", `/runs/${mixActive}/cancel`);
await call("DELETE", `/runs/${mixActive}`);

/* ── 7. 없는 id → 404 ─────────────────────────────────────────── */
say("");
say("══ 7. 존재하지 않는 id ══");
const ghostRun = await call("DELETE", `/runs/${mixGhost}`);
const ghostScenario = await call("DELETE", `/scenarios/${mixGhost}`);
check("DELETE /api/runs/<없는 id> → 404", ghostRun.status === 404, `status=${ghostRun.status}`);
check("DELETE /api/scenarios/<없는 id> → 404", ghostScenario.status === 404, `status=${ghostScenario.status}`);

const badBody = await call("POST", "/runs/bulk-delete", { ids: [] });
check("빈 배열 다중 삭제 → 400", badBody.status === 400, `status=${badBody.status}`);

/* ── 8. 회귀 ──────────────────────────────────────────────────── */
say("");
say("══ 8. 회귀 — 기존 경로가 그대로인가 ══");
const regressRuns = await call("GET", `/runs?projectId=${projectId}&limit=5`);
check("GET /api/runs 목록", regressRuns.status === 200, `${regressRuns.body?.length}건`);
const regressScenarios = await call("GET", `/projects/${projectId}/scenarios?size=5`);
check("GET /projects/:id/scenarios 목록", regressScenarios.status === 200, `${regressScenarios.body?.total}건`);
const regressQueue = await call("GET", "/runs/queue");
check("GET /api/runs/queue (라우트 순서 — bulk-delete 가 가로채지 않는다)",
  regressQueue.status === 200, JSON.stringify(regressQueue.body));
const second = scenarios.find((s) => s.id !== published.id && s.status === "published") ?? scenarios.find((s) => s.id !== published.id);
const multiRun = await call("POST", "/runs", {
  scenarioIds: [published.id, second.id], baseUrl: "https://example.com",
  envLabel: "verify", browser: "chromium", variables: {}, secretKeys: [],
});
say(`  POST /api/runs (scenarioIds 2건) → ${multiRun.status} ${JSON.stringify(multiRun.body)}`);
check("#14 다중 선택 실행(batch)이 그대로 동작한다",
  multiRun.status === 202 && multiRun.body?.runIds?.length === 2 && multiRun.body?.batchId !== null);
for (const id of multiRun.body?.runIds ?? []) {
  await call("POST", `/runs/${id}/cancel`);
  await call("DELETE", `/runs/${id}`);
}

/* ── 마무리 ───────────────────────────────────────────────────── */
say("");
const runsRootEnd = treeBytes(join(ROOT, "runs"));
const attachRootEnd = treeBytes(join(ROOT, "scenario-attachments"));
say(`artifacts/runs 최종 = ${runsRootEnd} bytes · scenario-attachments 최종 = ${attachRootEnd} bytes`);
say(`고아 검사: scenario-attachments 하위 디렉토리 = ${existsSync(join(ROOT, "scenario-attachments")) ? readdirSync(join(ROOT, "scenario-attachments")).length : 0}개`);
say("");
say(`결과: ${results.pass} pass / ${results.fail} fail`);

writeFileSync(
  new URL("./g16-verify.log", import.meta.url),
  log.join("\n") + "\n",
);
process.exit(results.fail === 0 ? 0 : 1);
