import { afterEach, describe, expect, it } from "vitest";
import type { RunDetail, RunStatus } from "@testflow/contracts";
import { scrollBehavior, stepSyncMode } from "./useStepSync";

/**
 * `prefers-reduced-motion` 분기를 **함수 단위로** 고정한다.
 *
 * 브라우저에서도 확인하지만(`data-follow-behavior`), headless Chromium 은 부드러운
 * 스크롤 자체를 돌리지 않아 "움직임의 모양"으로는 두 경우를 가를 수 없다. 분기 자체는
 * 여기서 못박는 것이 확실하다.
 */
const original = Reflect.get(globalThis, "window") as unknown;

function stubMatchMedia(matches: boolean) {
  Reflect.set(globalThis, "window", {
    matchMedia: (query: string) => ({ matches: query.includes("reduce") && matches }),
  });
}

afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(globalThis, "window");
  else Reflect.set(globalThis, "window", original);
});

describe("scrollBehavior", () => {
  it("reduce 면 auto — 애니메이션 없이 즉시 이동한다", () => {
    stubMatchMedia(true);
    expect(scrollBehavior()).toBe("auto");
  });

  it("아니면 smooth — 다음 스텝으로 미끄러진다", () => {
    stubMatchMedia(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("★ CSS 에 맡기지 않는다 — `behavior` 를 명시로 넘기면 `scroll-behavior` 선언이 지지 않는다", () => {
    // globals.css 의 `scroll-behavior: auto !important` 는 CSS 끼리의 규칙이라
    // JS 가 명시한 `behavior` 를 덮지 못한다. 그래서 JS 에서 직접 판단해야 한다.
    stubMatchMedia(true);
    expect(scrollBehavior()).not.toBe("smooth");
  });

  it("window 가 없으면(SSR·테스트 환경) auto 로 떨어진다", () => {
    Reflect.deleteProperty(globalThis, "window");
    expect(scrollBehavior()).toBe("auto");
  });
});

/**
 * ★ 끝난 실행에 영상이 없을 때 `live` 로 남지 않는다 (라운드 6).
 *
 * 실측에서 `timeout` 으로 끝난 실행이 `data-step-sync-mode="live"` 로 남아
 * "끝난 실행인데 라이브 모드"로 읽혔다. 화면 동작은 같지만 이름이 사실과 달랐다.
 */
describe("stepSyncMode", () => {
  const run = (status: RunStatus): RunDetail => ({ status }) as unknown as RunDetail;

  it("영상이 붙어 있으면 언제나 video — 그 시간축이 강조를 정한다", () => {
    expect(stepSyncMode(run("timeout"), true)).toBe("video");
    expect(stepSyncMode(run("running"), true)).toBe("video");
  });

  it("아직 도는 중이면 live", () => {
    expect(stepSyncMode(run("running"), false)).toBe("live");
    expect(stepSyncMode(run("queued"), false)).toBe("live");
  });

  it("★ 끝났는데 영상이 없으면 ended — timeout·cancelled 도 끝난 실행이다", () => {
    for (const status of ["passed", "failed", "error", "cancelled", "timeout"] as const) {
      expect(stepSyncMode(run(status), false)).toBe("ended");
    }
  });

  it("run 을 아직 못 읽었으면 live (로딩 중)", () => {
    expect(stepSyncMode(undefined, false)).toBe("live");
  });
});
