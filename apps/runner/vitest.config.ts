import { defineConfig } from "vitest/config";

/**
 * ⚠️ 라운드 2 PoC 때문에 생긴 파일이다.
 *
 * `poc/r2/pw/` 아래에는 **Playwright Test 가 실행하는 `*.spec.ts`** 가 있다(사용자 테스트 코드
 * 역할). vitest 의 기본 include(`**\/*.spec.ts`)가 이것들을 집어 들면
 * "Playwright Test did not expect test() to be called here" 로 터진다.
 * 제품 유닛 테스트는 전부 `src/` 에 있으므로 vitest 는 `src` 만 본다.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    exclude: ["**/node_modules/**", "dist/**", "dist-poc/**", "poc/r2/pw/**"],
  },
});
