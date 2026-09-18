/**
 * ★ "사용자 코드" 4 — 자기 config 와 함께 오는 spec. 무수정.
 */
import { expect, test } from "@playwright/test";

test("사용자 config 와 함께 — 로그인", async ({ page }) => {
  await page.goto("/fixtures/record-login.html");
  await page.locator("#username").fill("with-user-config");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.locator("#result")).toHaveText("로그인 성공");
  await page.waitForTimeout(8000);
});
