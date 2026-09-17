/**
 * PoC 전용 shim (경로 A) — CJS 경로. 제품 코드가 아니다. 설명은 `index.mjs` 참조.
 * Playwright 가 spec 을 CJS 로 트랜스파일하는 경우(가장 가까운 package.json 에 type:module 이
 * 없을 때)를 위해 둔다. `extendTest` 는 ESM(.mjs)이라 동적 import 로 가져온다.
 */
const real = require("playwright/test");

let extended = null;
module.exports = new Proxy(real, {
  get(target, prop) {
    if (prop !== "test" && prop !== "default") return target[prop];
    if (extended === null) {
      throw new Error(
        "[r2-shim] CJS 경로에서는 fixture 주입이 동작하지 않는다 — ESM(.mjs) 경로를 쓰라. " +
          "가장 가까운 package.json 에 \"type\": \"module\" 이 있는지 확인하라.",
      );
    }
    return extended;
  },
});
