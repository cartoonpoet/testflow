import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import { baseConfig } from "./base.js";

/**
 * apps/web 용 config.
 * exhaustive-deps 를 error 로 올린다 — react-query 훅을 많이 쓰는 구조라
 * 의존성 배열 누락이 곧 stale 데이터 버그가 된다.
 */
export const reactConfig = [
  ...baseConfig,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
    },
  },
];

export default reactConfig;
