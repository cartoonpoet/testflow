/**
 * 실행마다 생성해 주입하는 `playwright.config` (03-phases Task 3.1 — ★ 게이트 G1).
 *
 * ## ★★ 이 모듈도 `playwright test` 프로세스가 로드한다
 * 생성된 config 파일이 `resolveInjectedConfig()` 를 **동적 import** 한다. 그래서
 * `pw-reporter.ts` 와 **같은 제약**을 받는다 — `@testflow/contracts` · `ioredis` · `typeorm` 금지.
 * (Runner 쪽에서도 같은 함수를 쓸 수 있게 순수하게 유지한다.)
 *
 * ## 왜 config 를 "생성"하는가
 * `playwright test --config` 는 **하나만** 먹고 Playwright 에 config extends 가 없다.
 * 그래서 우리 config 가 사용자 config 를 동적 import 해서 **병합**한다(PoC 가 실증).
 *
 * ## 우리가 덮어쓰는 것 — 이 목록 밖은 사용자 값을 유지한다
 * | 키 | 이유 |
 * |---|---|
 * | `testDir` | 작업공간의 `specs/` 를 가리켜야 한다 |
 * | `workers: 1` · `fullyParallel: false` | 라이브 화면이 1개다(PoC 실측: workers 2 → 두 테스트가 같은 캔버스에 섞인다) |
 * | `retries: 0` | 재시도는 같은 스텝을 두 번 발행해 `sequence`·`passed_steps` 를 왜곡한다 |
 * | `reporter` | 우리 reporter 를 **배열에 append** — 사용자 reporter 도 같이 산다 |
 * | `outputDir` | video/trace/screenshot 을 우리가 훑을 디렉토리여야 한다(Task 3.6) |
 * | `use.viewport` · `use.headless` | screencast size 와 일치해야 한다(Gen-Phase 4) |
 * | `use.video` · `use.trace` · `use.screenshot` | 증적 규약(Task 3.6) |
 * | `use.launchOptions.args` | **기존 args 에 덧붙인다**(통째로 교체하지 않는다) |
 *
 * **`timeout` · `expect` · `projects` · `webServer` 는 건드리지 않는다.**
 * **`use.baseURL` 도 덮지 않는다** — PoC 가 덮은 것은 fixture 서빙 때문이고 제품에서는 틀린 동작이다.
 * 단 사용자 config 에 `baseURL` 이 **없을 때만** 실행 요청의 `baseUrl`(= 화면의 환경 선택)을
 * **기본값으로 채운다**(덮어쓰기가 아니다 — `TestFlowPwOverrides.defaultBaseUrl` 주석 참조).
 */
import { pathToFileURL } from "node:url";

/** 작업공간에 쓰는 config 파일 이름. `.mjs` 다 — TS 트랜스파일을 한 겹 줄인다. */
export const PW_CONFIG_FILENAME = "playwright.config.mjs";

/** 작업공간 안의 spec 디렉토리 / 산출물 디렉토리 이름. */
export const PW_TEST_DIR = "specs";
export const PW_OUTPUT_DIR = "out";

/** 생성된 config 가 읽는 환경변수 이름. Runner 와 config 양쪽이 이 상수를 본다. */
export const PW_ENV = {
  reporterPath: "TESTFLOW_PW_REPORTER",
  userConfig: "TESTFLOW_PW_USER_CONFIG",
  headless: "TESTFLOW_PW_HEADLESS",
  viewportWidth: "TESTFLOW_PW_VIEWPORT_W",
  viewportHeight: "TESTFLOW_PW_VIEWPORT_H",
  /** 경로 D 의 CDP 포트. **Gen-Phase 3 에서는 비어 있다**(라이브 스트림 미부착). */
  cdpPort: "TESTFLOW_PW_CDP_PORT",
  eventsUrl: "TESTFLOW_PW_EVENTS_URL",
  /** 실행 요청의 `baseUrl`. 사용자 코드도 `process.env` 로 읽을 수 있다. */
  baseUrl: "TESTFLOW_BASE_URL",
} as const;

/* ────────────────────────────────────────────────────────────
 * ★ 게이트 G1 — 지원하지 않는 사용자 config
 * ──────────────────────────────────────────────────────────── */

export const UNSUPPORTED_USER_CONFIG_CODES = ["multi_project", "web_server"] as const;
export type UnsupportedUserConfigCode = (typeof UNSUPPORTED_USER_CONFIG_CODES)[number];

/**
 * 사용자에게 그대로 보여 주는 거부 메시지 (한국어).
 *
 * ★ 게이트 G1 판정의 산출물이다. 실측 근거는 `.pipeline/…/04-gen-3.md` 에 있다.
 *   요약: 두 경우 모두 **라이브 화면이 성립하지 않거나 우리 타임라인과 충돌**한다.
 */
export const UNSUPPORTED_USER_CONFIG_MESSAGE: Readonly<Record<UnsupportedUserConfigCode, string>> = {
  multi_project:
    "지원하지 않는 playwright.config 입니다. projects 를 2개 이상 구성한 config 는 실행할 수 없습니다 " +
    "— project 마다 브라우저가 따로 떠서 라이브 화면이 섞이고, CDP 디버깅 포트를 한 브라우저만 " +
    "점유해 두 번째 project 의 브라우저가 기동에 실패합니다. projects 를 하나만 남겨 주세요.",
  web_server:
    "지원하지 않는 playwright.config 입니다. webServer 를 쓰는 config 는 실행할 수 없습니다 " +
    "— 테스트 서버 기동·종료를 TestFlow 실행 타임라인(하드 타임아웃·취소)이 관리할 수 없고, " +
    "여러 실행이 같은 포트를 동시에 점유합니다. 실행 대상 서버를 미리 띄운 뒤 baseURL 로 지정해 주세요.",
};

export class UnsupportedUserConfigError extends Error {
  constructor(readonly code: UnsupportedUserConfigCode) {
    super(UNSUPPORTED_USER_CONFIG_MESSAGE[code]);
    this.name = UNSUPPORTED_USER_CONFIG_ERROR_NAME;
  }
}

/**
 * 이 에러는 **`playwright test` 프로세스 안에서** 던져지므로 Runner 에게는 stderr 문자열로만
 * 도착한다. 그래서 이름을 상수로 고정해 Runner 가 그것을 알아보고 **우리 한국어 메시지를
 * 그대로 사용자에게 보여 줄 수 있게** 한다. 못 알아보면 "import 구문을 확인하세요" 같은
 * **틀린 안내**가 나간다(실측으로 그 꼴을 봤다).
 */
export const UNSUPPORTED_USER_CONFIG_ERROR_NAME = "UnsupportedUserConfigError";

/** Playwright 의 stderr 에서 우리 거부 메시지를 되찾는다. 없으면 `null`. */
export function extractUnsupportedConfigMessage(stderr: string): string | null {
  const index = stderr.indexOf(`${UNSUPPORTED_USER_CONFIG_ERROR_NAME}: `);
  if (index === -1) return null;
  const rest = stderr.slice(index + UNSUPPORTED_USER_CONFIG_ERROR_NAME.length + 2);
  // 메시지는 한 줄이다(상수에 개행이 없다). 다음 줄부터는 스택 트레이스다.
  const line = rest.split("\n")[0]?.trim() ?? "";
  return line === "" ? null : line;
}

/**
 * 사용자 config 가 우리 실행 모델에서 성립하는지 검사한다.
 *
 * ★ **게이트 G1 의 판정을 코드로 굳힌 지점이다.** 되는 척하지 않고 **명시 거부**한다 —
 *   조용히 무시하면 사용자는 자기 `webServer` 가 떴다고 믿고 원인 모를 연결 실패를 본다.
 */
export function assertSupportedUserConfig(config: Readonly<Record<string, unknown>>): void {
  const projects = config["projects"];
  if (Array.isArray(projects) && projects.length > 1) {
    throw new UnsupportedUserConfigError("multi_project");
  }
  const webServer = config["webServer"];
  if (webServer !== undefined && webServer !== null) {
    if (!Array.isArray(webServer) || webServer.length > 0) {
      throw new UnsupportedUserConfigError("web_server");
    }
  }
}

/* ────────────────────────────────────────────────────────────
 * 병합
 * ──────────────────────────────────────────────────────────── */

/** 우리가 강제하는 값들. `resolveInjectedConfig()` 가 환경변수로 조립한다. */
export interface TestFlowPwOverrides {
  readonly testDir: string;
  readonly outputDir: string;
  readonly reporterPath: string;
  readonly headless: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
  /** 비어 있으면 CDP 포트를 열지 않는다(Gen-Phase 3 의 기본 — 라이브 스트림 없음). */
  readonly cdpPort: number | null;
  /**
   * 실행 요청의 `baseUrl`(환경 선택). **사용자 config 에 `use.baseURL` 이 없을 때만** 채운다.
   *
   * ★ "덮어쓰기"가 아니라 "기본값"이다. 이것 없이는 `runs.base_url`(= 화면의 환경 선택)이
   *   코드 실행에 아무 영향을 주지 않아 `page.goto("/login")` 이 동작하지 않는다.
   *   사용자가 자기 config 에 `baseURL` 을 적었으면 그 값이 이긴다 — 계획서의 "baseURL 은
   *   사용자 값을 유지한다"를 지키면서 환경 선택도 살리는 유일한 지점이다.
   */
  readonly defaultBaseUrl: string;
}

type PlainConfig = Record<string, unknown>;

/**
 * 사용자 config(바닥) + 우리 강제값(위)을 병합한다. **순수 함수 — 단위 테스트의 대상이다.**
 *
 * 핵심 3가지 —
 *  1. `use` 는 **얕은 병합**이다. 통째로 교체하면 사용자의 `locale`·`actionTimeout` 이 사라진다.
 *  2. `use.launchOptions.args` 는 **concat** 이다. 교체하면 사용자가 켠 브라우저 플래그가 사라진다
 *     (PoC 는 통째로 교체했다 — 제품에서 고쳐야 할 지점으로 지목된 부분).
 *  3. `use.baseURL` 은 **손대지 않는다.** 사용자 값이 없으면 없는 대로 둔다.
 */
export function mergePlaywrightConfig(
  userConfig: Readonly<PlainConfig>,
  overrides: TestFlowPwOverrides,
): PlainConfig {
  const userUse = asRecord(userConfig["use"]);
  const userLaunchOptions = asRecord(userUse["launchOptions"]);
  const userArgs = Array.isArray(userLaunchOptions["args"])
    ? (userLaunchOptions["args"] as unknown[]).map((arg) => String(arg))
    : [];

  const cdpArgs =
    overrides.cdpPort === null
      ? []
      : [
          `--remote-debugging-port=${String(overrides.cdpPort)}`,
          "--remote-debugging-address=127.0.0.1",
        ];

  // 사용자 reporter 배열에 **append**. 문자열 하나로 준 경우도 배열로 승격한다.
  const userReporter = userConfig["reporter"];
  const reporter: unknown[] = [[overrides.reporterPath]];
  if (typeof userReporter === "string") {
    reporter.push([userReporter]);
  } else if (Array.isArray(userReporter)) {
    reporter.push(...(userReporter as unknown[]));
  }

  return {
    ...userConfig,
    testDir: overrides.testDir,
    outputDir: overrides.outputDir,
    workers: 1,
    fullyParallel: false,
    retries: 0,
    reporter,
    use: {
      // ★ baseURL 기본값은 `...userUse` **앞**에 둔다 — 사용자 값이 있으면 그것이 덮어쓴다.
      ...(overrides.defaultBaseUrl === "" ? {} : { baseURL: overrides.defaultBaseUrl }),
      ...userUse,
      headless: overrides.headless,
      viewport: { width: overrides.viewport.width, height: overrides.viewport.height },
      /*
       * 증적.
       *
       * ★ 라운드 4 — `video` 만 `"on"` 으로 바꿨다. **성공한 실행도 영상을 남긴다.**
       *   사용자 요구가 "테스트 한 거를 다시 보고 싶다" 이고, `retain-on-failure` 는
       *   **성공한 실행에 영상이 아예 없다**(Playwright 가 지운다). "다시 보기" 버튼이
       *   실패한 실행에만 나타나는 것은 기능이 없는 것과 같다.
       *
       *   대가는 디스크다. 실측(1280×800 · webm): 테스트 1건당 **초당 약 25~45KB**,
       *   30초짜리 실행이 약 1MB 다. 하루 200 실행이면 **약 200MB/일 · 6GB/월**.
       *   `trace`(실행당 0.7MB+)·`screenshot` 은 그대로 실패 시에만 남긴다 — 그 둘은
       *   "다시 보기"가 아니라 **디버깅** 용이고, 영상보다 비싸면서 성공 실행에서는
       *   볼 이유가 없다.
       */
      video: "on",
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
      launchOptions: {
        ...userLaunchOptions,
        args: [...userArgs, ...cdpArgs],
      },
    },
  };
}

/**
 * 생성된 config 파일(`playwright.config.mjs`)이 호출하는 진입점.
 * **`playwright test` 프로세스 안에서 실행된다.**
 */
export async function resolveInjectedConfig(): Promise<PlainConfig> {
  const userConfigPath = process.env[PW_ENV.userConfig] ?? "";
  let userConfig: PlainConfig = {};
  if (userConfigPath !== "") {
    const loaded = (await import(pathToFileURL(userConfigPath).href)) as { default?: unknown };
    userConfig = asRecord(loaded.default);
    // ★ 여기서 던지면 Playwright 가 config 로드 실패로 종료하고, Runner 는 그 메시지를
    //   `run.status = error` 로 확정한다(실행 환경 오류 — 시나리오 실패가 아니다).
    assertSupportedUserConfig(userConfig);
  }

  const cdpPortRaw = Number(process.env[PW_ENV.cdpPort] ?? "");
  return mergePlaywrightConfig(userConfig, {
    testDir: `./${PW_TEST_DIR}`,
    outputDir: `./${PW_OUTPUT_DIR}`,
    reporterPath: process.env[PW_ENV.reporterPath] ?? "",
    headless: (process.env[PW_ENV.headless] ?? "true") !== "false",
    viewport: {
      width: intOr(process.env[PW_ENV.viewportWidth], 1280),
      height: intOr(process.env[PW_ENV.viewportHeight], 800),
    },
    cdpPort: Number.isFinite(cdpPortRaw) && cdpPortRaw > 0 ? Math.trunc(cdpPortRaw) : null,
    defaultBaseUrl: process.env[PW_ENV.baseUrl] ?? "",
  });
}

/**
 * 작업공간에 쓸 config 파일 본문.
 *
 * ★ 본문에 로직을 넣지 않는다. 병합 규칙은 `mergePlaywrightConfig()` 한 곳에만 있어야
 *   단위 테스트로 고정할 수 있다 — 생성 문자열 안의 로직은 테스트가 닿지 않는다.
 *   `import` 가 아니라 **동적 `import()`** 인 이유: Playwright 의 config 로더는 bare
 *   `file://` specifier 를 정적 import 로 만나면 해석하지 못할 수 있다(실측으로 동적만 확인했다).
 */
export function buildPwConfigSource(pwConfigModulePath: string): string {
  const moduleUrl = pathToFileURL(pwConfigModulePath).href;
  return [
    "// TestFlow 가 실행마다 생성하는 파일이다. 직접 수정하지 마라 — 실행이 끝나면 지워진다.",
    `const { resolveInjectedConfig } = await import(${JSON.stringify(moduleUrl)});`,
    "export default await resolveInjectedConfig();",
    "",
  ].join("\n");
}

function asRecord(value: unknown): PlainConfig {
  return typeof value === "object" && value !== null ? { ...(value as PlainConfig) } : {};
}

function intOr(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}
