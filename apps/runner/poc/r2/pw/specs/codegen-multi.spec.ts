/**
 * ★ "사용자 코드" 2 — test() 가 여러 개일 때 page 가 테스트마다 새로 생긴다.
 *   스트림이 끊기는지 / 이어붙는지 확인하기 위한 케이스다. 이 파일도 무수정이다.
 */
import { expect, test } from "@playwright/test";

test("첫 번째 — 아이디만 채운다", async ({ page }) => {
  await page.goto("/fixtures/record-login.html");
  await page.locator("#username").fill("first-test");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.locator("#result")).toHaveText("로그인 성공");
  await page.waitForTimeout(1200);
});

test("두 번째 — 아이디를 비운 채 제출한다", async ({ page }) => {
  await page.goto("/fixtures/record-login.html");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.locator("#result")).toHaveText("아이디를 입력하세요");
  await page.waitForTimeout(1200);
});
