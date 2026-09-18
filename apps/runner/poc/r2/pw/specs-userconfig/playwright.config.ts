/**
 * ★ "사용자가 이미 갖고 있는 playwright.config.ts" — 충돌 검증용. 무수정 대상이다.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 45_000,
  expect: { timeout: 7_000 },
  use: { locale: "ko-KR", actionTimeout: 9_000 },
  reporter: [["dot"]],
});
