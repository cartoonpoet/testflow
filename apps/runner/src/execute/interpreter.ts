import { DEFAULT_STEP_TIMEOUT_MS } from "@testflow/contracts";
import type { ActionType, TestStep } from "@testflow/contracts";
import type { Locator, Page } from "playwright";
import { resolveLocator } from "./locator.js";
import type { ResolvedLocator } from "./locator.js";
import { buildVariableTable, resolveGotoUrl, substitute } from "./variables.js";
import type { VariableScope } from "./variables.js";

/**
 * `action_type` → Playwright 호출 디스패치 (03-phases Task 6.3).
 *
 * ## 단언(assert_*)을 `expect()` 로 하지 않는다
 * `expect` 는 `@playwright/test` 패키지에만 있고, 이 워크스페이스의 의존성은 코어
 * `playwright` **하나**다(버전 확정 목록에도 `@playwright/test` 가 없다). 테스트 러너를
 * 통째로 끌어들여 assertion 3개를 쓰는 것은 비용이 맞지 않는다 →
 * `waitFor` + 짧은 폴링으로 직접 구현한다. 동작은 같고 타임아웃 의미도 같다.
 *
 * ## 값은 전부 `{{변수}}` 치환을 거친다
 * 치환 테이블은 **큐 페이로드**에서만 온다(`variables.ts` 참조). DB 조회 없음.
 */

export class StepExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepExecutionError";
  }
}

export interface StepExecutionContext {
  page: Page;
  scope: VariableScope;
}

export interface StepExecutionResult {
  /** target 이 있는 동작이면 해결 정보. `goto`/`wait` 은 null. */
  resolved: ResolvedLocator | null;
  /** 진단 로그 한 줄. 민감값이 들어가지 않도록 값 자체는 넣지 않는다. */
  detail: string;
}

/** 단언 폴링 주기. */
const ASSERT_POLL_MS = 120;

export function stepTimeout(step: TestStep): number {
  return step.options.timeoutMs || DEFAULT_STEP_TIMEOUT_MS;
}

/**
 * 스텝 1개 실행.
 *
 * `switch` 는 `ActionType` 12종을 **전부** 다루고, 마지막 `never` 체크로 누락 시
 * 컴파일이 깨지게 해 두었다(계약에 동작이 추가되면 여기가 먼저 알려 준다).
 */
export async function executeStep(
  ctx: StepExecutionContext,
  step: TestStep,
): Promise<StepExecutionResult> {
  const timeout = stepTimeout(step);
  const table = buildVariableTable(ctx.scope);
  const action: ActionType = step.actionType;

  switch (action) {
    case "goto": {
      const url = resolveGotoUrl(requireInput(step).value, ctx.scope);
      await ctx.page.goto(url, { timeout, waitUntil: "domcontentloaded" });
      return { resolved: null, detail: `goto ${url}` };
    }

    case "wait": {
      const waitMs = step.options.waitMs ?? 1000;
      await ctx.page.waitForTimeout(waitMs);
      return { resolved: null, detail: `wait ${String(waitMs)}ms` };
    }

    case "assert_url": {
      const expected = substitute(requireInput(step).value, table);
      await assertUrl(ctx.page, expected, timeout);
      return { resolved: null, detail: `assert_url ${expected}` };
    }

    case "click": {
      const resolved = await locate(ctx, step, timeout);
      await resolved.locator.click({ timeout });
      return done(resolved, "click");
    }

    case "hover": {
      const resolved = await locate(ctx, step, timeout);
      await resolved.locator.hover({ timeout });
      return done(resolved, "hover");
    }

    case "fill": {
      const resolved = await locate(ctx, step, timeout);
      const value = substitute(requireInput(step).value, table);
      // ★ value 를 detail 에 넣지 않는다 — 비밀번호가 로그로 새는 경로가 된다.
      await resolved.locator.fill(value, { timeout });
      return done(resolved, `fill(${String(value.length)}자)`);
    }

    case "select": {
      const resolved = await locate(ctx, step, timeout);
      const value = substitute(requireInput(step).value, table);
      await resolved.locator.selectOption(value, { timeout });
      return done(resolved, `select ${value}`);
    }

    case "press": {
      const resolved = await locate(ctx, step, timeout);
      const key = substitute(requireInput(step).value, table);
      await resolved.locator.press(key, { timeout });
      return done(resolved, `press ${key}`);
    }

    case "check": {
      const resolved = await locate(ctx, step, timeout);
      await resolved.locator.check({ timeout });
      return done(resolved, "check");
    }

    case "uncheck": {
      const resolved = await locate(ctx, step, timeout);
      await resolved.locator.uncheck({ timeout });
      return done(resolved, "uncheck");
    }

    case "assert_visible": {
      const resolved = await locate(ctx, step, timeout);
      await resolved.locator.waitFor({ state: "visible", timeout });
      return done(resolved, "assert_visible");
    }

    case "assert_text": {
      const resolved = await locate(ctx, step, timeout);
      const expected = substitute(requireInput(step).value, table);
      await assertText(resolved.locator, expected, timeout);
      return done(resolved, `assert_text "${expected}"`);
    }

    default: {
      // ★ exhaustiveness. `ActionType` 이 늘면 여기서 컴파일 에러가 난다.
      const exhaustive: never = action;
      throw new StepExecutionError(`지원하지 않는 동작입니다: ${String(exhaustive)}`);
    }
  }
}

/* ── 내부 ────────────────────────────────────────────────── */

function done(resolved: ResolvedLocator, label: string): StepExecutionResult {
  return { resolved, detail: `${label} (${resolved.resolvedBy}/${resolved.by})` };
}

function requireInput(step: TestStep): { value: string; isSecret: boolean } {
  const input = step.input ?? null;
  if (!input) {
    throw new StepExecutionError(`'${step.actionType}' 동작에는 값(input)이 필요합니다.`);
  }
  return input;
}

async function locate(
  ctx: StepExecutionContext,
  step: TestStep,
  timeout: number,
): Promise<ResolvedLocator> {
  const target = step.target ?? null;
  if (!target) {
    throw new StepExecutionError(`'${step.actionType}' 동작에는 대상(target)이 필요합니다.`);
  }
  return resolveLocator(ctx.page, target, timeout);
}

/**
 * URL 단언. 완전 일치 → 실패 시 부분 일치(접두)로 완화한다.
 * 쿼리스트링·해시가 실행마다 달라지는 화면이 흔해서 완전 일치만 요구하면 거의 못 쓴다.
 */
async function assertUrl(page: Page, expected: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  let actual: string;
  for (;;) {
    actual = page.url();
    if (actual === expected || actual.startsWith(expected) || actual.includes(expected)) return;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(ASSERT_POLL_MS);
  }
  throw new StepExecutionError(`URL 이 기대값과 다릅니다. 기대: "${expected}" / 실제: "${actual}"`);
}

/** 텍스트 단언 — 포함 검사(공백 정규화 후). 완전 일치는 실무에서 너무 자주 깨진다. */
async function assertText(locator: Locator, expected: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  const needle = normalize(expected);
  let actual = "";
  for (;;) {
    try {
      actual = normalize((await locator.first().innerText({ timeout: 1000 })) || "");
      if (actual.includes(needle)) return;
    } catch {
      // 아직 요소가 없거나 detached 상태 — 계속 폴링한다.
    }
    if (Date.now() >= deadline) break;
    await sleep(ASSERT_POLL_MS);
  }
  throw new StepExecutionError(
    `텍스트가 기대값과 다릅니다. 기대(포함): "${expected}" / 실제: "${actual.slice(0, 200)}"`,
  );
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
