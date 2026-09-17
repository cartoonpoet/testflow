import { describe, expect, it, vi } from "vitest";
import type { LocatorTarget } from "@testflow/contracts";
import type { Frame, Locator, Page } from "playwright";
import { buildLocator, describeCandidate, resolveLocator, resolveSearchRoot } from "./locator.js";

/**
 * 실제 브라우저 없이 후보 선택 로직만 검증한다.
 * (브라우저를 띄운 fallback 실증은 E2E 로 했다 — 04-gen-6 "Locator fallback 동작 확인")
 *
 * 스텁 root 는 Playwright 의 `getByRole/getByLabel/...` 시그니처만 흉내 내고,
 * 각 호출이 "몇 개 매칭되는지"를 테이블로 답한다.
 */
function stubRoot(matches: Record<string, number>): Page {
  const make = (key: string): Locator => {
    const locator = {
      count: () => Promise.resolve(matches[key] ?? 0),
      nth: (n: number) => make(`${key}#${String(n)}`),
      __key: key,
    };
    return locator as unknown as Locator;
  };
  return {
    getByRole: (role: string, opts?: { name?: string }) =>
      make(`role:${role}:${opts?.name ?? ""}`),
    getByLabel: (value: string) => make(`label:${value}`),
    getByText: (value: string) => make(`text:${value}`),
    getByTestId: (value: string) => make(`testid:${value}`),
    locator: (value: string) => make(`css:${value}`),
    frames: () => [],
  } as unknown as Page;
}

const keyOf = (locator: Locator): string => (locator as unknown as { __key: string }).__key;

describe("describeCandidate", () => {
  it("role 은 role + name 을 보여준다", () => {
    expect(describeCandidate({ by: "role", role: "button", name: "로그인" })).toBe(
      'role=button name="로그인"',
    );
  });
  it("값 기반 후보는 by 와 값", () => {
    expect(describeCandidate({ by: "label", value: "아이디" })).toBe('label="아이디"');
  });
  it("nth 가 있으면 표시한다", () => {
    expect(describeCandidate({ by: "css", value: ".x", nth: 2 })).toBe('css=".x"[nth=2]');
  });
});

describe("buildLocator", () => {
  const root = stubRoot({});
  it("by 별로 올바른 Playwright API 를 고른다", () => {
    expect(keyOf(buildLocator(root, { by: "role", role: "button", name: "로그인" }))).toBe(
      "role:button:로그인",
    );
    expect(keyOf(buildLocator(root, { by: "label", value: "아이디" }))).toBe("label:아이디");
    expect(keyOf(buildLocator(root, { by: "text", value: "확인" }))).toBe("text:확인");
    expect(keyOf(buildLocator(root, { by: "testid", value: "submit" }))).toBe("testid:submit");
    expect(keyOf(buildLocator(root, { by: "css", value: "#status" }))).toBe("css:#status");
  });

  it("nth 가 있으면 .nth() 를 적용한다", () => {
    expect(keyOf(buildLocator(root, { by: "css", value: ".row", nth: 3 }))).toBe("css:.row#3");
  });
});

describe("resolveSearchRoot", () => {
  const target: LocatorTarget = { primary: { by: "css", value: "x" }, fallbacks: [] };

  it("frameUrl 이 없으면 page 자체", () => {
    const page = stubRoot({});
    expect(resolveSearchRoot(page, target)).toBe(page);
  });

  it("frameUrl 이 있으면 일치하는 frame", () => {
    const frame = { url: () => "https://x.example/inner" } as unknown as Frame;
    const page = { frames: () => [frame] } as unknown as Page;
    expect(resolveSearchRoot(page, { ...target, frameUrl: "https://x.example/inner" })).toBe(frame);
  });

  it("★ frame 을 못 찾으면 page 로 떨어뜨린다 — 여기서 던지면 fallback 을 못 써 본다", () => {
    const page = { frames: () => [] } as unknown as Page;
    expect(resolveSearchRoot(page, { ...target, frameUrl: "https://none" })).toBe(page);
  });
});

describe("resolveLocator — fallback 체인", () => {
  it("primary 가 유일하게 매칭되면 resolvedBy='primary'", async () => {
    const page = stubRoot({ "label:아이디": 1 });
    const result = await resolveLocator(
      page,
      { primary: { by: "label", value: "아이디" }, fallbacks: [] },
      500,
    );
    expect(result.resolvedBy).toBe("primary");
    expect(result.by).toBe("label");
    expect(result.usedFallback).toBe(false);
    expect(result.index).toBe(0);
  });

  it("★ primary 가 0개면 fallback 으로 내려가고 몇 번째인지 기록된다", async () => {
    const page = stubRoot({ "role:button:로그인": 1 });
    const result = await resolveLocator(
      page,
      {
        primary: { by: "testid", value: "broken" },
        fallbacks: [
          { by: "label", value: "없는-라벨" },
          { by: "role", role: "button", name: "로그인" },
        ],
      },
      500,
    );
    expect(result.resolvedBy).toBe("fallback[1]");
    expect(result.by).toBe("role");
    expect(result.usedFallback).toBe(true);
    expect(result.index).toBe(2);
  });

  it("★ 2개 이상 매칭되면 그 후보를 버리고 다음으로 간다(모호한 후보는 재생을 깨뜨린다)", async () => {
    const page = stubRoot({ "text:확인": 3, "testid:confirm": 1 });
    const result = await resolveLocator(
      page,
      { primary: { by: "text", value: "확인" }, fallbacks: [{ by: "testid", value: "confirm" }] },
      500,
    );
    expect(result.resolvedBy).toBe("fallback[0]");
    expect(result.attempts.find((a) => a.by === "text")?.matched).toBe(3);
  });

  it("nth 가 지정된 후보는 '1개만' 규칙을 적용하지 않는다", async () => {
    const page = stubRoot({ "css:.row#2": 5 });
    const result = await resolveLocator(
      page,
      { primary: { by: "css", value: ".row", nth: 2 }, fallbacks: [] },
      500,
    );
    expect(result.resolvedBy).toBe("primary");
  });

  it("전부 실패하면 시도 내역을 담아 던진다", async () => {
    const page = stubRoot({});
    await expect(
      resolveLocator(
        page,
        { primary: { by: "label", value: "a" }, fallbacks: [{ by: "testid", value: "b" }] },
        300,
      ),
    ).rejects.toThrow(/대상 요소를 찾지 못했습니다/);
  });

  it("★ 늦게 나타나는 요소를 기다린다(예산 안에서 폴링)", async () => {
    let calls = 0;
    const page = stubRoot({});
    vi.spyOn(page, "getByLabel").mockImplementation(
      () =>
        ({
          count: () => {
            calls += 1;
            return Promise.resolve(calls >= 3 ? 1 : 0);
          },
        }) as unknown as Locator,
    );
    const result = await resolveLocator(
      page,
      { primary: { by: "label", value: "늦게" }, fallbacks: [] },
      3000,
    );
    expect(result.resolvedBy).toBe("primary");
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
