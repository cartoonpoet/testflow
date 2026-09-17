import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * TestFlow 공통 ESLint flat config.
 *
 * oxlint 를 채택하지 않은 이유: NestJS 데코레이터 룰셋 생태계가 ESLint 쪽에만 있다
 * (02-context "린트" 행).
 *
 * ★ typescript-eslint 8.70.0 은 TypeScript 7.0 에서 하드 에러로 죽는다
 *   ("typescript-eslint does not support TS 7.0", upstream issue #10940).
 *   그래서 이 레포의 TypeScript 는 6.0.3 에 고정돼 있다. 자세한 내용은
 *   .pipeline/20260917-114450/spike-versions.md 참고.
 */
export const baseConfig = tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // _ 접두 인자는 의도적 미사용으로 본다.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // 타입 전용 import 를 명시하면 데코레이터 메타데이터 emit 과 충돌할 수 있어
      // nest.js / node 쪽에서는 별도로 완화한다.
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // prettier 와 충돌하는 포매팅 룰을 전부 끈다. 반드시 마지막에 온다.
  prettier,
);

export default baseConfig;
