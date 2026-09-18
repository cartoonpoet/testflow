/**
 * ★ 이 파일이 "사용자가 넣은 테스트 코드"다. codegen 산출물 형태 그대로다.
 *
 *   - `@playwright/test` 에서 `test`/`expect` 를 그대로 import 한다.
 *   - TestFlow 의 어떤 것도 import 하지 않는다.
 *   - **PoC 를 위해 단 한 줄도 고치지 않는다.** 고쳐야 스트리밍이 붙는다면 그건 실패다.
 *
 * 대상 URL 은 codegen 이 그렇게 뽑듯 환경변수 `BASE_URL`(config 의 `use.baseURL`)을 쓴다.
 */
import { expect, test } from "@playwright/test";

test("로그인 후 확인 버튼을 누른다", async ({ page }) => {
  await page.goto("/fixtures/record-login.html");
  await page.locator("#username").click();
  await page.locator("#username").fill("hong.gildong");
  await page.locator("#password").click();
  await page.locator("#password").fill("s3cr3t-pw");
  await page.locator("#env").selectOption("stg");
  await page.locator("#remember").check();
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.locator("#result")).toHaveText("로그인 성공");
  await page.waitForTimeout(1500);
  await page.getByTestId("confirm-b").click();
  await expect(page.locator("#log")).toContainText("확인");
  await page.waitForTimeout(1500);
});
