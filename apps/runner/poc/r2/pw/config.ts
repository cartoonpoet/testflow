/**
 * 라운드 2 PoC — **우리가 주입하는** playwright.config.ts
 *
 * ⚠️ PoC 전용 임시물. 제품 코드가 아니다. Playwright 가 직접 TS 로 로드한다.
 *
 * 사용자 spec 은 건드리지 않는다. 라이브 스트리밍을 붙이는 모든 장치가 이 파일과
 * 환경변수에만 있다. 모드는 `TESTFLOW_R2_MODE` 로 고른다.
 *
 *   mode=b   `use.connectOptions.wsEndpoint`  — Runner 가 `launchServer` 로 띄운 브라우저에 붙는다.
 *   mode=d   `use.launchOptions.args`         — worker 가 브라우저를 띄우되 CDP 포트를 열어 둔다.
 *                                               Runner 가 `connectOverCDP` 로 그 브라우저에 붙는다.
 *   mode=a   아무 것도 안 한다                 — 스트리밍은 `@playwright/test` 해석 가로채기(shim)로
 *                                               주입된 fixture 가 담당한다.
 */
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

const mode = process.env["TESTFLOW_R2_MODE"] ?? "a";
const wsEndpoint = process.env["TESTFLOW_R2_WS_ENDPOINT"] ?? "";
const cdpPort = process.env["TESTFLOW_R2_CDP_PORT"] ?? "";
const testDir = process.env["TESTFLOW_R2_TESTDIR"] ?? "./specs";
const workers = Number(process.env["TESTFLOW_R2_WORKERS"] ?? "1");
const headless = process.env["TESTFLOW_R2_HEADLESS"] !== "false";

/**
 * ★ 사용자가 자기 `playwright.config.ts` 를 갖고 있을 때 — 충돌 검증.
 *   `--config` 는 **하나만** 먹는다(Playwright 에 config extends 가 없다). 그래서 우리 config 가
 *   사용자 config 를 **동적 import 해서 병합**할 수 있는지 실제로 시험한다.
 *   `TESTFLOW_R2_USER_CONFIG` 에 사용자 config 경로를 준다.
 */
const userConfigPath = process.env["TESTFLOW_R2_USER_CONFIG"] ?? "";
let userConfig: PlaywrightTestConfig = {};
if (userConfigPath !== "") {
  const loaded = (await import(userConfigPath)) as { default?: PlaywrightTestConfig };
  userConfig = loaded.default ?? {};
  console.log(`[R2CFG] merged user config: ${JSON.stringify(Object.keys(userConfig))}`);
}

export default defineConfig({
  // 사용자 config 를 **바닥에 깔고** 우리가 필요한 것만 위에서 덮는다.
  ...userConfig,
  testDir,
  // ★ 라이브 화면은 1개다 → worker 를 1개로 강제한다(근거는 artifact 에).
  workers,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  reporter: [["./live-reporter.ts"], ["line"]],
  use: {
    ...userConfig.use,
    baseURL: process.env["TESTFLOW_R2_BASE_URL"] ?? "http://127.0.0.1:3000",
    // screencast size 와 뷰포트를 일치시킨다(불일치 시 축소가 일어나 좌표·화질이 흔들린다).
    viewport: { width: 1280, height: 800 },
    headless,
    ...(mode === "b" && wsEndpoint !== "" ? { connectOptions: { wsEndpoint } } : {}),
    ...(mode === "d" && cdpPort !== ""
      ? {
          launchOptions: {
            args: [`--remote-debugging-port=${cdpPort}`, "--remote-debugging-address=127.0.0.1"],
          },
        }
      : {}),
  },
});
