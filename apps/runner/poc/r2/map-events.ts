/**
 * 라운드 2 PoC — Playwright reporter 이벤트 → 라운드 1 SSE 규약(`@testflow/contracts`) 변환
 *
 * ⚠️ PoC 전용 임시물. 제품 코드가 아니다.
 *
 * ★ 변환은 **Runner 쪽에서** 한다(reporter 안에서 하지 않는다). 이유 2가지 —
 *   ① reporter 는 playwright test 프로세스 안이라 `@testflow/contracts`/Redis 를 끌어오면
 *      사용자 테스트의 의존성 그래프를 오염시킨다.
 *   ② SSE seq 부여·Redis 버퍼링 순서(04-gen-5 규약)는 Runner 의 책임이다.
 *
 * 변환한 이벤트는 `RunEventSchema` 로 **실제로 검증**한다 — 규약에 맞는지 말로 주장하지 않는다.
 */
import { RunEventSchema, type ActionType, type RunEvent } from "@testflow/contracts";

import type { ReporterEvent } from "./host.js";

/**
 * Playwright step 제목 → TestFlow `ActionType`. 미분류는 `wait` 로 떨어뜨린다.
 *
 * ★ 제목은 **실측한 문자열**로 맞췄다. Playwright 1.63 의 `pw:api` step 제목은
 *   `locator.click` 같은 API 이름이 아니라 사람이 읽는 라벨이다 —
 *   `Navigate` / `Click` / `Fill "hong.gildong"` / `Select option` / `Check` /
 *   `Wait for timeout` / `Expect "toHaveText"`.
 *   (문서에서 추측하지 않고 `--mode c` 실행 로그에서 뽑았다.)
 */
export function toActionType(title: string): ActionType {
  const t = title.toLowerCase();
  if (t.startsWith("navigate") || t.includes("goto")) return "goto";
  if (t.startsWith("fill") || t.startsWith("type") || t.startsWith("set input")) return "fill";
  if (t.startsWith("select option")) return "select";
  if (t.startsWith("uncheck")) return "uncheck";
  if (t.startsWith("check")) return "check";
  if (t.startsWith("click") || t.startsWith("double click")) return "click";
  if (t.startsWith("press")) return "press";
  if (t.startsWith("hover")) return "hover";
  if (t.includes("tohaveurl")) return "assert_url";
  if (t.includes("tobevisible") || t.includes("tobeattached") || t.includes("tobeenabled"))
    return "assert_visible";
  if (t.includes("tohavetext") || t.includes("tocontaintext") || t.includes("tohavevalue"))
    return "assert_text";
  return "wait";
}

/**
 * ★ 반드시 필요한 발견 — **step 제목에 입력값이 그대로 실린다.**
 *   `Fill "s3cr3t-pw"` 처럼 비밀번호가 제목에 박혀 나온다. 라운드 1의 `mask.ts` 규약
 *   (DB 쓰기 **전에** 마스킹)을 코드 입력 실행에도 그대로 적용해야 한다.
 *   여기서는 PoC 로 "값 부분을 벗겨 내는" 최소 처리만 보여 준다.
 */
export function stripStepValue(title: string): string {
  // `Fill "..."` / `Type "..."` 처럼 **입력 계열**만 값을 벗긴다.
  // `Expect "toHaveText"` 의 인용부호는 matcher 이름이라 지우면 정보가 사라진다.
  if (!/^(fill|type|set input)/i.test(title)) return title;
  return title.replace(/"[^"]*"/g, '"***"');
}

/** Playwright step 중 "사용자에게 보여줄 스텝"만 고른다. */
export function isUserVisibleStep(ev: ReporterEvent): boolean {
  const category = String(ev["category"] ?? "");
  const depth = Number(ev["depth"] ?? 0);
  if (depth !== 0) return false; // 중첩된 내부 호출(예: expect 안의 locator 질의)은 스텝이 아니다
  return category === "pw:api" || category === "expect" || category === "test.step";
}

const PW_STATUS_TO_RUN_STATUS: Readonly<Record<string, "passed" | "failed" | "timeout" | "cancelled">> = {
  passed: "passed",
  failed: "failed",
  timedOut: "timeout",
  interrupted: "cancelled",
  skipped: "cancelled",
};

export interface MappedEvent {
  readonly sse: RunEvent;
  /** 규약 검증 결과. `false` 면 그 이벤트는 SSE 로 내보낼 수 없다. */
  readonly valid: boolean;
  readonly error: string | null;
}

/**
 * reporter 원본 이벤트 목록 → SSE 이벤트 목록.
 * `runId` 는 호출부가 준다(실제 제품에서는 `runs.id`).
 */
export function mapReporterEvents(
  runId: string,
  stepIdSeed: () => string,
  events: readonly ReporterEvent[],
): MappedEvent[] {
  const out: MappedEvent[] = [];
  let sequence = 0;
  let passedSteps = 0;
  let totalSteps = 0;
  const pendingStart = new Map<string, { sequence: number; startedAt: string; name: string }>();
  let runStartedAtMs = 0;

  const push = (sse: RunEvent): void => {
    const check = RunEventSchema.safeParse(sse);
    out.push({ sse, valid: check.success, error: check.success ? null : check.error.message.slice(0, 300) });
  };
  const key = (ev: ReporterEvent): string => `${String(ev["testId"] ?? "")}|${String(ev["title"] ?? "")}`;

  for (const ev of events) {
    const at = new Date(ev.atMs).toISOString();
    switch (ev.kind) {
      case "run.begin": {
        runStartedAtMs = ev.atMs;
        push({ event: "run.status", runId, status: "running", runnerId: "r2-poc", at });
        break;
      }
      case "step.begin": {
        if (!isUserVisibleStep(ev)) break;
        sequence += 1;
        totalSteps += 1;
        // ★ 마스킹은 여기서 한다(DB/SSE 로 나가기 전). 근거는 `stripStepValue` 주석.
        const name = stripStepValue(String(ev["title"] ?? ""));
        pendingStart.set(key(ev), { sequence, startedAt: at, name });
        push({ event: "step.started", runId, sequence, name, totalSteps, at });
        break;
      }
      case "step.end": {
        if (!isUserVisibleStep(ev)) break;
        const started = pendingStart.get(key(ev));
        if (started === undefined) break;
        pendingStart.delete(key(ev));
        const error = ev["error"] === null || ev["error"] === undefined ? null : String(ev["error"]);
        if (error === null) passedSteps += 1;
        push({
          event: "step.finished",
          runId,
          sequence: started.sequence,
          at,
          result: {
            id: stepIdSeed(),
            runId,
            stepId: null, // 코드 입력 실행은 steps 테이블에 대응 행이 없다 ← ★ 본 구현의 결정 지점
            sequence: started.sequence,
            nameSnapshot: started.name.slice(0, 200),
            actionType: toActionType(started.name),
            status: error === null ? "passed" : "failed",
            startedAt: started.startedAt,
            durationMs: Math.max(0, Math.trunc(Number(ev["durationMs"] ?? 0))),
            errorMessage: error === null ? null : error.slice(0, 2000),
          },
        });
        break;
      }
      case "run.end": {
        const status = PW_STATUS_TO_RUN_STATUS[String(ev["status"] ?? "")] ?? "error";
        push({
          event: "run.finished",
          runId,
          status,
          passedSteps,
          totalSteps,
          durationMs: runStartedAtMs === 0 ? null : Math.max(0, ev.atMs - runStartedAtMs),
          errorMessage: null,
          at,
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}
