/**
 * `pw-config` 단위 테스트 — 병합 경계와 ★ 게이트 G1 거부 규칙.
 *
 * 병합 규칙을 **문장이 아니라 테스트로** 고정한다. "사용자 값을 유지한다"는 주장은
 * 실제로 유지되는지 확인하지 않으면 다음 사람이 무심코 `use` 를 통째로 교체한다
 * (PoC 가 실제로 그렇게 했고, 계획서가 그것을 고칠 지점으로 지목했다).
 */
import { describe, expect, it } from "vitest";
import {
  UNSUPPORTED_USER_CONFIG_MESSAGE,
  UnsupportedUserConfigError,
  assertSupportedUserConfig,
  buildPwConfigSource,
  extractUnsupportedConfigMessage,
  mergePlaywrightConfig,
} from "./pw-config.js";
import type { TestFlowPwOverrides } from "./pw-config.js";

const OVERRIDES: TestFlowPwOverrides = {
  testDir: "./specs",
  outputDir: "./out",
  reporterPath: "/abs/dist/execute/pw-reporter.js",
  headless: true,
  viewport: { width: 1280, height: 800 },
  cdpPort: null,
  defaultBaseUrl: "",
};

describe("mergePlaywrightConfig — 우리가 덮어쓰는 것", () => {
  it("사용자 config 가 없으면 우리 값만 남는다", () => {
    const merged = mergePlaywrightConfig({}, OVERRIDES);
    expect(merged["testDir"]).toBe("./specs");
    expect(merged["outputDir"]).toBe("./out");
    expect(merged["workers"]).toBe(1);
    expect(merged["fullyParallel"]).toBe(false);
    expect(merged["retries"]).toBe(0);
    expect(merged["reporter"]).toEqual([["/abs/dist/execute/pw-reporter.js"]]);
  });

  it("★ workers 1 · fullyParallel false 는 사용자 값을 덮는다 (라이브 화면이 1개다)", () => {
    const merged = mergePlaywrightConfig({ workers: 8, fullyParallel: true }, OVERRIDES);
    expect(merged["workers"]).toBe(1);
    expect(merged["fullyParallel"]).toBe(false);
  });

  it("★ retries 는 0 으로 덮는다 — 재시도는 같은 스텝을 두 번 발행한다", () => {
    expect(mergePlaywrightConfig({ retries: 3 }, OVERRIDES)["retries"]).toBe(0);
  });

  it("증적 옵션을 우리가 넣는다 (Task 3.6)", () => {
    const use = mergePlaywrightConfig({}, OVERRIDES)["use"] as Record<string, unknown>;
    /*
     * ★ 라운드 4 — `video` 만 `"on"` 이다. **성공한 실행도 다시 볼 수 있어야 한다**
     *   (`retain-on-failure` 는 성공 실행의 영상을 지운다). trace·screenshot 은 디버깅
     *   자료라 실패 시에만 남긴다 — 그 비대칭이 의도다.
     */
    expect(use["video"]).toBe("on");
    expect(use["trace"]).toBe("retain-on-failure");
    expect(use["screenshot"]).toBe("only-on-failure");
  });

  it("★ 사용자가 use.video 를 적어도 우리 값이 이긴다(다시 보기 보장)", () => {
    const use = mergePlaywrightConfig({ use: { video: "off" } }, OVERRIDES)["use"] as Record<
      string,
      unknown
    >;
    expect(use["video"]).toBe("on");
  });
});

describe("mergePlaywrightConfig — ★ 사용자 값을 유지하는 것", () => {
  it("timeout · expect · 그 밖의 최상위 키는 그대로 산다", () => {
    const merged = mergePlaywrightConfig(
      { timeout: 45_000, expect: { timeout: 7_000 }, globalTimeout: 900_000, maxFailures: 5 },
      OVERRIDES,
    );
    expect(merged["timeout"]).toBe(45_000);
    expect(merged["expect"]).toEqual({ timeout: 7_000 });
    expect(merged["globalTimeout"]).toBe(900_000);
    expect(merged["maxFailures"]).toBe(5);
  });

  it("★ use.baseURL 은 덮지 않는다 (PoC 가 덮은 것은 fixture 서빙 때문이고 제품에서는 틀린 동작)", () => {
    const use = mergePlaywrightConfig(
      { use: { baseURL: "https://staging.example.com" } },
      OVERRIDES,
    )["use"] as Record<string, unknown>;
    expect(use["baseURL"]).toBe("https://staging.example.com");
  });

  it("★ 사용자 config 에 baseURL 이 없으면 실행 요청의 baseUrl 이 기본값으로 들어간다", () => {
    const use = mergePlaywrightConfig({}, { ...OVERRIDES, defaultBaseUrl: "http://127.0.0.1:39555" })[
      "use"
    ] as Record<string, unknown>;
    expect(use["baseURL"]).toBe("http://127.0.0.1:39555");
  });

  it("★ 사용자 baseURL 이 있으면 그것이 이긴다 (기본값은 덮어쓰지 않는다)", () => {
    const use = mergePlaywrightConfig(
      { use: { baseURL: "https://user.example" } },
      { ...OVERRIDES, defaultBaseUrl: "http://127.0.0.1:39555" },
    )["use"] as Record<string, unknown>;
    expect(use["baseURL"]).toBe("https://user.example");
  });

  it("defaultBaseUrl 이 빈 문자열이면 baseURL 키를 만들지 않는다", () => {
    const use = mergePlaywrightConfig({}, OVERRIDES)["use"] as Record<string, unknown>;
    expect("baseURL" in use).toBe(false);
  });

  it("use 는 얕은 병합이다 — locale·actionTimeout 이 사라지지 않는다", () => {
    const use = mergePlaywrightConfig(
      { use: { locale: "ko-KR", actionTimeout: 9_000, timezoneId: "Asia/Seoul" } },
      OVERRIDES,
    )["use"] as Record<string, unknown>;
    expect(use["locale"]).toBe("ko-KR");
    expect(use["actionTimeout"]).toBe(9_000);
    expect(use["timezoneId"]).toBe("Asia/Seoul");
    // 우리 값도 같이 있다
    expect(use["viewport"]).toEqual({ width: 1280, height: 800 });
  });

  it("projects 1개는 그대로 유지한다", () => {
    const merged = mergePlaywrightConfig({ projects: [{ name: "only" }] }, OVERRIDES);
    expect(merged["projects"]).toEqual([{ name: "only" }]);
  });
});

describe("mergePlaywrightConfig — ★ launchOptions.args 는 덧붙인다", () => {
  it("사용자 args 와 CDP 포트 args 가 둘 다 있다 (Task 3.1 완료기준 ②)", () => {
    const use = mergePlaywrightConfig(
      { use: { launchOptions: { args: ["--foo", "--bar=1"] } } },
      { ...OVERRIDES, cdpPort: 39_341 },
    )["use"] as Record<string, unknown>;
    const args = (use["launchOptions"] as { args: string[] }).args;
    expect(args).toEqual([
      "--foo",
      "--bar=1",
      "--remote-debugging-port=39341",
      "--remote-debugging-address=127.0.0.1",
    ]);
  });

  it("cdpPort 가 null 이면 args 를 추가하지 않는다 (Gen-Phase 3 의 기본 — 라이브 없음)", () => {
    const use = mergePlaywrightConfig(
      { use: { launchOptions: { args: ["--foo"] } } },
      OVERRIDES,
    )["use"] as Record<string, unknown>;
    expect((use["launchOptions"] as { args: string[] }).args).toEqual(["--foo"]);
  });

  it("launchOptions 의 다른 키(slowMo·executablePath)는 유지한다", () => {
    const use = mergePlaywrightConfig(
      { use: { launchOptions: { slowMo: 250, args: ["--foo"] } } },
      OVERRIDES,
    )["use"] as Record<string, unknown>;
    expect((use["launchOptions"] as Record<string, unknown>)["slowMo"]).toBe(250);
  });

  it("사용자 args 가 없어도 깨지지 않는다", () => {
    const use = mergePlaywrightConfig({}, { ...OVERRIDES, cdpPort: 1234 })["use"] as Record<
      string,
      unknown
    >;
    expect((use["launchOptions"] as { args: string[] }).args).toEqual([
      "--remote-debugging-port=1234",
      "--remote-debugging-address=127.0.0.1",
    ]);
  });
});

describe("mergePlaywrightConfig — reporter 는 append 다", () => {
  it("우리 reporter 가 먼저, 사용자 reporter 가 뒤에 온다", () => {
    const merged = mergePlaywrightConfig(
      { reporter: [["html", { open: "never" }], ["json"]] },
      OVERRIDES,
    );
    expect(merged["reporter"]).toEqual([
      ["/abs/dist/execute/pw-reporter.js"],
      ["html", { open: "never" }],
      ["json"],
    ]);
  });

  it("문자열 reporter 도 배열로 승격해 살린다", () => {
    expect(mergePlaywrightConfig({ reporter: "list" }, OVERRIDES)["reporter"]).toEqual([
      ["/abs/dist/execute/pw-reporter.js"],
      ["list"],
    ]);
  });
});

describe("★ 게이트 G1 — 지원하지 않는 사용자 config 는 명시 거부한다", () => {
  it("projects 가 2개 이상이면 거부한다", () => {
    expect(() => assertSupportedUserConfig({ projects: [{ name: "a" }, { name: "b" }] })).toThrow(
      UnsupportedUserConfigError,
    );
    try {
      assertSupportedUserConfig({ projects: [{ name: "a" }, { name: "b" }] });
    } catch (error) {
      expect((error as UnsupportedUserConfigError).code).toBe("multi_project");
      expect((error as Error).message).toBe(UNSUPPORTED_USER_CONFIG_MESSAGE.multi_project);
    }
  });

  it("webServer 가 있으면 거부한다", () => {
    expect(() =>
      assertSupportedUserConfig({ webServer: { command: "npm run dev", url: "http://localhost:3000" } }),
    ).toThrow(UnsupportedUserConfigError);
    expect(() => assertSupportedUserConfig({ webServer: [{ command: "x" }] })).toThrow(
      UnsupportedUserConfigError,
    );
  });

  it("거부 메시지는 한국어이고 '왜' 와 '무엇을 하라' 를 둘 다 담는다", () => {
    for (const message of Object.values(UNSUPPORTED_USER_CONFIG_MESSAGE)) {
      expect(message).toContain("지원하지 않는 playwright.config");
      expect(message).toMatch(/주세요/);
      expect(message.length).toBeGreaterThan(60);
    }
  });

  it("projects 1개 · webServer 없음 · 빈 배열은 통과한다", () => {
    expect(() => assertSupportedUserConfig({})).not.toThrow();
    expect(() => assertSupportedUserConfig({ projects: [{ name: "only" }] })).not.toThrow();
    expect(() => assertSupportedUserConfig({ projects: [] })).not.toThrow();
    expect(() => assertSupportedUserConfig({ webServer: [] })).not.toThrow();
    expect(() => assertSupportedUserConfig({ webServer: null })).not.toThrow();
  });
});

describe("extractUnsupportedConfigMessage — ★ 거부 메시지가 사용자에게 그대로 닿아야 한다", () => {
  it("stderr 에서 우리 한국어 메시지를 되찾는다", () => {
    // Playwright 프로세스의 실제 stderr 모양(에러 이름 + 메시지 + 스택).
    const stderr = [
      "Error: UnsupportedUserConfigError: " + UNSUPPORTED_USER_CONFIG_MESSAGE.web_server,
      "    at assertSupportedUserConfig (file:///abs/dist/execute/pw-config.js:1:1)",
      "    at resolveInjectedConfig (file:///abs/dist/execute/pw-config.js:2:2)",
    ].join("\n");
    expect(extractUnsupportedConfigMessage(stderr)).toBe(UNSUPPORTED_USER_CONFIG_MESSAGE.web_server);
  });

  it("관계없는 stderr 에서는 null 이다 (일반 안내로 떨어져야 한다)", () => {
    expect(extractUnsupportedConfigMessage("Error: Cannot find module 'lodash'")).toBeNull();
    expect(extractUnsupportedConfigMessage("")).toBeNull();
  });

  it("multi_project 메시지도 되찾는다", () => {
    const stderr = `UnsupportedUserConfigError: ${UNSUPPORTED_USER_CONFIG_MESSAGE.multi_project}\n  at x`;
    expect(extractUnsupportedConfigMessage(stderr)).toBe(UNSUPPORTED_USER_CONFIG_MESSAGE.multi_project);
  });
});

describe("buildPwConfigSource", () => {
  it("생성된 config 에 로직이 들어 있지 않다 (병합은 모듈 한 곳에만)", () => {
    const source = buildPwConfigSource("/abs/dist/execute/pw-config.js");
    expect(source).toContain("resolveInjectedConfig");
    expect(source).toContain("file:///abs/dist/execute/pw-config.js");
    // 3줄(+빈 줄) 이상으로 자라면 로직이 새어 들어간 것이다.
    expect(source.trim().split("\n")).toHaveLength(3);
  });

  it("경로를 file:// URL 로 바꾼다 (Windows 경로도 안전하다)", () => {
    expect(buildPwConfigSource("/tmp/a b/pw-config.js")).toContain("file:///tmp/a%20b/pw-config.js");
  });
});
