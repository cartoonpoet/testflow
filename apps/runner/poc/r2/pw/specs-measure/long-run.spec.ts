/**
 * ★ "사용자 코드" 3 — 측정용. 한 페이지에 오래 머무는 테스트.
 *
 * 라운드 1과 같은 이유로 측정 대상 페이지는 **계속 변하는 화면**이어야 한다
 * (screencast 는 변경분만 송출한다). `record-login.html` 은 rAF 막대를 이미 갖고 있어
 * 페이지를 수정할 필요가 없다. 이 spec 도 TestFlow 를 import 하지 않는다.
 */
import { expect, test } from "@playwright/test";

const SECONDS = Number(process.env["TESTFLOW_R2_SPEC_SECONDS"] ?? "16");

test("측정 — 로그인 화면에 머문다", async ({ page }) => {
  await page.goto("/fixtures/record-login.html");
  await expect(page.locator("#login-submit")).toBeVisible();
  await page.locator("#username").fill("measure");
  await page.waitForTimeout(SECONDS * 1000);
});
