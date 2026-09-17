import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import type { LocatorCandidate, LocatorTarget } from "@testflow/contracts";
import { REPO_ROOT_DIR } from "../env.js";
import { buildLocator } from "../execute/locator.js";
import { resolveInjectedScriptPath } from "./session.js";

/**
 * ★ Task 7.4 완료 기준의 실검증 — "같은 텍스트 버튼이 여러 개인 페이지에서 각각을 눌렀을 때
 *   생성된 primary locator 가 **서로 다르고 각각 정확히 1개**에 매칭된다".
 *
 * 이 테스트가 특별한 이유: 후보를 만드는 쪽(`injected.ts`, 페이지 안)과 그것을 다시 푸는 쪽
 * (`execute/locator.ts`, Playwright)이 **서로 다른 구현**이다. 여기서는 injected 가 만든 후보를
 * **Playwright 로 실제로 세어 본다** — 둘의 매칭 규칙이 어긋나면 "녹화는 되는데 재생이 깨지는"
 * 실패가 나오고, 그 어긋남을 잡는 유일한 방법이 이 왕복 검사다.
 *
 * jsdom 이 아니라 **진짜 Chromium** 을 쓴다. 접근성 role/name 계산과 `getByRole` 의미는
 * 브라우저·Playwright 조합에서만 실제와 같다.
 */

const FIXTURE = `file://${resolve(REPO_ROOT_DIR, "apps/runner/poc/fixtures/record-login.html")}`;

let browser: Browser | null = null;
let page: Page | null = null;
let launchError: string | null = null;

beforeAll(async () => {
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript({ path: resolveInjectedScriptPath() });
    page = await context.newPage();
    await page.goto(FIXTURE, { waitUntil: "domcontentloaded" });
  } catch (error) {
    launchError = error instanceof Error ? error.message : String(error);
  }
}, 60_000);

afterAll(async () => {
  await browser?.close().catch(() => undefined);
});

/** 주입 스크립트가 페이지 안에서 만든 후보 배열을 그대로 꺼내 온다. */
async function targetOf(selector: string, index: number): Promise<LocatorTarget> {
  if (page === null) throw new Error(`Chromium 기동 실패: ${launchError ?? "unknown"}`);
  return page.evaluate(
    ([sel, idx]) => {
      const build = (window as unknown as { __tfBuildTarget?: (el: Element) => unknown })
        .__tfBuildTarget;
      if (typeof build !== "function") throw new Error("injected.js 가 주입되지 않았습니다.");
      const el = document.querySelectorAll(sel as string)[idx as number];
      if (!el) throw new Error(`요소를 찾지 못했습니다: ${String(sel)}[${String(idx)}]`);
      return build(el);
    },
    [selector, index] as const,
  ) as Promise<LocatorTarget>;
}

/** ★ injected 가 "유일하다"고 판단한 후보를 Playwright 로 다시 센다. */
async function playwrightCount(candidate: LocatorCandidate): Promise<number> {
  if (page === null) throw new Error("page 없음");
  return buildLocator(page, candidate).count();
}

describe("injected.ts — Locator 후보 생성 + 고유성 검증", () => {
  it("주입 스크립트가 페이지에 실제로 살아 있다", () => {
    expect(launchError).toBeNull();
  });

  it('"확인" 버튼 3개 — primary 가 서로 다르고 각각 정확히 1개에 매칭된다', async () => {
    const targets = await Promise.all([0, 1, 2].map((i) => targetOf(".row button", i * 2)));
    const keys = targets.map((t) => JSON.stringify(t.primary));
    expect(new Set(keys).size).toBe(3);

    for (const target of targets) {
      // 이 페이지의 확인 버튼들은 data-testid 가 서로 달라 **testid 단계에서 유일**해진다
      // (role=button/name=확인 은 3개라 탈락 → 다음 순위로 내려간다).
      expect(target.primary.by).toBe("testid");
      expect(target.primary.nth).toBeUndefined();
      await expect(playwrightCount(target.primary)).resolves.toBe(1);
    }
  });

  it('"삭제" 버튼 3개 — 구별 속성이 없으면 nth 로 좁혀 유일해진다', async () => {
    const targets = await Promise.all([0, 1, 2].map((i) => targetOf(".row button", i * 2 + 1)));
    const keys = targets.map((t) => JSON.stringify(t.primary));
    expect(new Set(keys).size).toBe(3);

    for (const [index, target] of targets.entries()) {
      expect(target.primary.by).toBe("role");
      expect(target.primary.nth).toBe(index);
      // nth 를 붙인 locator 는 정확히 1개를 가리킨다.
      await expect(playwrightCount(target.primary)).resolves.toBe(1);
    }
  });

  it("role 이 잡히는 버튼은 role 이 primary 다 (우선순위 1)", async () => {
    const target = await targetOf("#login-submit", 0);
    expect(target.primary).toMatchObject({ by: "role", role: "button", name: "로그인" });
    await expect(playwrightCount(target.primary)).resolves.toBe(1);
  });

  it("label 로 이름이 붙은 입력란 — role 이 먼저 잡히고 label 은 fallback 으로 남는다", async () => {
    const target = await targetOf("#username", 0);
    // 우선순위 1번(role)이 유일하게 매칭되므로 label 까지 내려가지 않는다.
    // `<label for>` 는 accessible name 의 출처로 role 후보 안에 이미 반영돼 있다.
    expect(target.primary).toMatchObject({ by: "role", role: "textbox", name: "아이디" });
    await expect(playwrightCount(target.primary)).resolves.toBe(1);

    const labelFallback = target.fallbacks.find((c) => c.by === "label");
    expect(labelFallback).toMatchObject({ by: "label", value: "아이디" });
    if (labelFallback) await expect(playwrightCount(labelFallback)).resolves.toBe(1);
  });

  it("★ password 입력란은 role 후보를 만들지 않는다 (getByRole('textbox') 에 잡히지 않는다)", async () => {
    const target = await targetOf("#password", 0);
    const chain: LocatorCandidate[] = [target.primary, ...target.fallbacks];
    expect(chain.some((c) => c.by === "role")).toBe(false);
    expect(target.primary).toMatchObject({ by: "label", value: "비밀번호" });
    await expect(playwrightCount(target.primary)).resolves.toBe(1);
  });

  it("★ 스냅샷에 value 속성을 담지 않는다 (비밀번호 유출 경로 차단)", async () => {
    await page?.fill("#password", "hunter2");
    const target = await targetOf("#password", 0);
    expect(JSON.stringify(target)).not.toContain("hunter2");
    expect(Object.keys(target.snapshot?.attrs ?? {})).not.toContain("value");
  });

  it("fallback 체인이 순위 배열로 저장되고 css 는 언제나 마지막이다", async () => {
    const target = await targetOf("#login-submit", 0);
    const chain = [target.primary, ...target.fallbacks];
    expect(chain.length).toBeGreaterThan(1);
    expect(chain[chain.length - 1]?.by).toBe("css");
    expect(chain.filter((c) => c.by === "css")).toHaveLength(1);
  });
});
