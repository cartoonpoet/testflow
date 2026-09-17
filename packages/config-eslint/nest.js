import globals from "globals";
import { baseConfig } from "./base.js";

/**
 * apps/api (NestJS) · apps/runner · packages/db 용 config.
 *
 * 데코레이터 기반 코드에서 기본 룰이 오탐하는 지점을 완화한다.
 */
export const nestConfig = [
  ...baseConfig,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // @Injectable() 클래스가 필드 없이 생성자 주입만 가질 때 "빈 클래스" 오탐이 난다.
      "@typescript-eslint/no-extraneous-class": "off",

      // emitDecoratorMetadata 는 import 된 타입이 런타임까지 살아 있어야 동작한다.
      // `import type` 으로 바꾸면 design:paramtypes 가 undefined 가 되어 DI 가 깨진다.
      "@typescript-eslint/consistent-type-imports": "off",

      // DTO 클래스의 프로퍼티는 class-validator 데코레이터로만 초기화된다.
      "@typescript-eslint/no-extra-non-null-assertion": "error",

      // Nest 기본 예외를 그대로 던지는 구조라 커스텀 에러 클래스 강제는 하지 않는다.
      "no-console": "off",
    },
  },
];

export default nestConfig;
