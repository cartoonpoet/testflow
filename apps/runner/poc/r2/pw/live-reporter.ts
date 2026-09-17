/**
 * 라운드 2 PoC — 커스텀 Playwright reporter (경로 C 검증 + 진행 이벤트 수신)
 *
 * ⚠️ PoC 전용 임시물. 제품 코드가 아니다.
 * ⚠️ 이 파일은 **Playwright 가 직접 TS 로 로드**한다(tsc 로 컴파일하지 않는다).
 *    그래서 `@testflow/contracts` 를 import 하지 않는다 — 원본 이벤트를 NDJSON 으로 내보내고,
 *    SSE 규약(`step.started` 등)으로의 변환은 Runner 쪽(`poc/r2/map-events.ts`)이 한다.
 *
 * 하는 일 2가지
 *   1. onBegin/onTestBegin/onStepBegin/onStepEnd/onTestEnd/onEnd 를 받아
 *      `TESTFLOW_R2_EVENTS_URL` 로 POST 한다(없으면 stdout 에 `[R2EV]` 접두사로 찍는다).
 *   2. ★ 경로 C 판정용 — reporter 에게 주어진 인자에서 **`page` 에 닿을 수 있는지** 실제로 훑는다.
 *      결과를 `probe` 이벤트로 남긴다(추측하지 않는다).
 */
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

const EVENTS_URL = process.env["TESTFLOW_R2_EVENTS_URL"] ?? "";

/** ★ 경로 C 판정 — 주어진 객체 그래프에서 Playwright `Page` 로 보이는 것을 찾는다. */
function probePageReachability(test: TestCase, result: TestResult): Record<string, unknown> {
  const looksLikePage = (v: unknown): boolean =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as { screenshot?: unknown }).screenshot === "function" &&
    typeof (v as { goto?: unknown }).goto === "function";

  const visited = new Set<unknown>();
  const found: string[] = [];
  const walk = (value: unknown, path: string, depth: number): void => {
    if (depth > 4 || value === null || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    if (looksLikePage(value)) {
      found.push(path);
      return;
    }
    for (const key of Object.keys(value)) {
      let child: unknown;
      try {
        child = (value as Record<string, unknown>)[key];
      } catch {
        continue;
      }
      walk(child, `${path}.${key}`, depth + 1);
    }
  };
  walk(test, "test", 0);
  walk(result, "result", 0);
  walk(test.parent, "suite", 0);

  return {
    pageFoundAt: found,
    testKeys: Object.keys(test),
    resultKeys: Object.keys(result),
    // fixture 값에 닿는 공식 API 가 있는지 — 없으면 경로 C 는 원리적으로 불가능하다.
    hasFixturesApi: "fixtures" in (test as object) || "fixtures" in (result as object),
    // reporter 가 볼 수 있는 부착물. 스크린샷/비디오는 **끝난 뒤** 파일로만 온다.
    attachmentNames: result.attachments.map((a) => a.name),
  };
}

export default class LiveReporter implements Reporter {
  private queue: Promise<void> = Promise.resolve();
  private probed = false;
  private seq = 0;

  printsToStdio(): boolean {
    return true;
  }

  private emit(kind: string, data: Record<string, unknown>): void {
    this.seq += 1;
    const body = JSON.stringify({ kind, seq: this.seq, atMs: Date.now(), ...data });
    console.log(`[R2EV] ${body}`);
    if (EVENTS_URL === "") return;
    this.queue = this.queue.then(async () => {
      try {
        await fetch(EVENTS_URL, { method: "POST", body: `${body}\n` });
      } catch {
        /* PoC — 호스트가 먼저 닫혔으면 무시 */
      }
    });
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.emit("run.begin", {
      workers: config.workers,
      totalTests: suite.allTests().length,
      testTitles: suite.allTests().map((t) => t.titlePath().slice(1).join(" › ")),
    });
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    if (!this.probed) {
      this.probed = true;
      this.emit("probe", probePageReachability(test, result));
    }
    this.emit("test.begin", {
      testId: test.id,
      title: test.titlePath().slice(1).join(" › "),
      file: test.location.file.split(/[\\/]/).pop() ?? "",
      line: test.location.line,
      workerIndex: result.workerIndex,
      parallelIndex: result.parallelIndex,
      retry: result.retry,
    });
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    // category: "test.step" | "pw:api" | "expect" | "hook" | "fixture" …
    this.emit("step.begin", {
      testId: test.id,
      workerIndex: result.workerIndex,
      category: step.category,
      title: step.title,
      depth: depthOf(step),
      line: step.location?.line ?? null,
    });
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    this.emit("step.end", {
      testId: test.id,
      workerIndex: result.workerIndex,
      category: step.category,
      title: step.title,
      depth: depthOf(step),
      durationMs: step.duration,
      error: step.error?.message ?? null,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.emit("test.end", {
      testId: test.id,
      title: test.titlePath().slice(1).join(" › "),
      status: result.status,
      expectedStatus: test.expectedStatus,
      durationMs: result.duration,
      error: result.error?.message ?? null,
      workerIndex: result.workerIndex,
    });
  }

  onEnd(result: FullResult): Promise<void> {
    this.emit("run.end", { status: result.status, durationMs: result.duration });
    return this.queue;
  }

  onError(error: { message?: string }): void {
    this.emit("run.error", { message: error.message ?? "unknown" });
  }
}

function depthOf(step: TestStep): number {
  let depth = 0;
  let cur = step.parent;
  while (cur !== undefined) {
    depth += 1;
    cur = cur.parent;
  }
  return depth;
}
