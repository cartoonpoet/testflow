import { nestConfig } from "@testflow/config-eslint/nest";

export default [
  ...(Array.isArray(nestConfig) ? nestConfig : [nestConfig]),
  {
    // ⚠️ 라운드 2 PoC 전용. `poc/r2/pw/` 는 **Playwright 가 직접 로드**하는 파일들이다
    //    (config · custom reporter · fixture shim · 사용자 spec). 제품 빌드에 들어가지 않고
    //    tsconfig.poc.json 에서도 제외돼 타입 기반 린트의 프로젝트에 속하지 않는다.
    //    사용자 spec 은 **무수정 대상**이라 린트 규칙을 적용하는 것 자체가 부적절하다.
    ignores: ["poc/r2/pw/**"],
  },
];
