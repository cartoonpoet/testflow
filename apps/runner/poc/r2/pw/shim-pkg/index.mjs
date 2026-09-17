/**
 * PoC 전용 shim (경로 A). 제품 코드가 아니다.
 *
 * ★ 사용자 spec 이 `import { test } from "@playwright/test"` 를 하면 Node 모듈 해석이
 *   spec 파일의 상위 디렉토리를 훑는다. 사용자 spec 을 `shimroot/specs/` 로 복사해 두면
 *   `shimroot/node_modules/@playwright/test` (= 이 파일)가 **진짜 패키지보다 먼저** 잡힌다.
 *   그래서 **사용자 코드를 한 글자도 고치지 않고** 확장된 `test` 를 넣을 수 있다.
 *
 * ★ 진짜 패키지는 `playwright/test` 로 가져온다. `@playwright/test` 로 가져오면
 *   이 shim 자신이 다시 잡혀 무한 루프가 된다. (`@playwright/test` 는 실제로
 *   `module.exports = require('playwright/test')` 한 줄짜리 재수출 패키지다 —
 *   같은 모듈 인스턴스를 공유하므로 Playwright 내부 상태가 갈라지지 않는다.)
 */
import * as real from "playwright/test";

import { extendTest } from "../../../../stream-fixture.mjs";

export * from "playwright/test";

export const test = extendTest(real.test);
export default test;
