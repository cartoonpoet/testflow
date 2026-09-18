import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMPORTS,
  CodeValidationIssueSchema,
  hasBlockingIssues,
  validateScenarioCode,
} from "./code-validation.js";
import { MAX_SCENARIO_CODE_BYTES } from "./scenario.js";

/**
 * PoC 의 `apps/runner/poc/r2/pw/specs/codegen-login.spec.ts` 본문(주석 헤더 제외한 실물 코드).
 * 파일을 `fs` 로 읽지 않는 이유: `@testflow/contracts` 는 **브라우저에서도 import 되는 패키지**라
 * `types: []` 로 node 타입을 쓰지 않는다. 테스트도 같은 제약을 지킨다.
 */
const CODEGEN_LOGIN_SPEC = `import { expect, test } from "@playwright/test";

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
`;

describe("validateScenarioCode — 통과 케이스", () => {
  it("PoC codegen 산출물 실물은 issue 0건이다", () => {
    expect(validateScenarioCode(CODEGEN_LOGIN_SPEC)).toEqual([]);
  });

  it("허용 목록은 @playwright/test 하나뿐이다", () => {
    expect(ALLOWED_IMPORTS).toEqual(["@playwright/test"]);
  });

  it("test.describe 로 감싼 형태도 통과한다", () => {
    const code = `import { test, expect } from '@playwright/test';
test.describe("로그인", () => {
  test("성공", async ({ page }) => { await expect(page).toHaveURL("/"); });
});
`;
    expect(validateScenarioCode(code)).toEqual([]);
  });

  it("주석 안의 금지 import 는 오탐으로 잡지 않는다", () => {
    const code = `// import fs from "fs";
/* const x = require("child_process"); */
import { test } from "@playwright/test";
test("t", async () => {});
`;
    expect(validateScenarioCode(code)).toEqual([]);
  });

  it("issue 는 CodeValidationIssueSchema 를 만족한다", () => {
    const issues = validateScenarioCode(`import fs from "fs";\ntest("t", async () => {});\n`);
    for (const issue of issues) {
      expect(CodeValidationIssueSchema.safeParse(issue).success).toBe(true);
    }
  });
});

describe("validateScenarioCode — 거부 케이스 6종", () => {
  it("① Node 내장 모듈(fs) 을 거부하고 줄 번호를 준다", () => {
    const code = `import { test } from "@playwright/test";\nimport fs from "fs";\ntest("t", async () => {});\n`;
    const issues = validateScenarioCode(code);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("node_builtin");
    expect(issues[0]?.moduleName).toBe("fs");
    expect(issues[0]?.line).toBe(2);
    // `import fs from "fs";` 에서 모듈 리터럴이 시작하는 열(1-based) = 16
    expect(issues[0]?.column).toBe(16);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("② node: 접두사도 거부한다", () => {
    const issues = validateScenarioCode(`import fs from "node:fs/promises";\ntest("t", async () => {});\n`);
    expect(issues.map((i) => i.code)).toEqual(["node_builtin"]);
  });

  it("③ 허용 목록 밖 패키지를 거부한다 (playwright 본체 포함)", () => {
    const code = `import { chromium } from "playwright";\nimport axios from "axios";\ntest("t", async () => {});\n`;
    const issues = validateScenarioCode(code);
    expect(issues.map((i) => i.code)).toEqual(["import_not_allowed", "import_not_allowed"]);
    expect(issues.map((i) => i.moduleName)).toEqual(["playwright", "axios"]);
  });

  it("④ 상대 경로 import 를 거부한다 (단일 파일이라 가리킬 대상이 없다)", () => {
    const code = `import { helper } from "./helpers.js";\nimport cfg from "../config";\ntest("t", async () => {});\n`;
    const issues = validateScenarioCode(code);
    expect(issues.map((i) => i.code)).toEqual(["relative_import", "relative_import"]);
  });

  it("⑤ 빈 본문을 거부한다", () => {
    const issues = validateScenarioCode("   \n\t\n");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("empty");
  });

  it("⑥ 256KB 를 넘는 본문을 거부한다", () => {
    const code = `import { test } from "@playwright/test";\ntest("t", async () => {});\n// ${"x".repeat(MAX_SCENARIO_CODE_BYTES)}\n`;
    const issues = validateScenarioCode(code);
    expect(issues.map((i) => i.code)).toContain("too_large");
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("동적 import 와 require 형태도 잡는다", () => {
    const code = `const fs = require("fs");\nawait import("node:child_process");\ntest("t", async () => {});\n`;
    const issues = validateScenarioCode(code);
    expect(issues.map((i) => i.code)).toEqual(["node_builtin", "node_builtin"]);
    expect(issues.map((i) => i.line)).toEqual([1, 2]);
  });

  it("부수효과 import(`import \"x\"`) 도 잡는다", () => {
    const issues = validateScenarioCode(`import "node:fs";\ntest("t", async () => {});\n`);
    expect(issues.map((i) => i.code)).toEqual(["node_builtin"]);
  });
});

describe("validateScenarioCode — 경고", () => {
  it("test( 가 하나도 없으면 경고하지만 저장을 막지는 않는다", () => {
    const issues = validateScenarioCode(`import { expect } from "@playwright/test";\nconst a = 1;\n`);
    expect(issues.map((i) => i.code)).toEqual(["no_test"]);
    expect(issues[0]?.severity).toBe("warning");
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("주석 처리된 test( 는 세지 않는다", () => {
    const issues = validateScenarioCode(`import { test } from "@playwright/test";\n// test("t", async () => {});\n`);
    expect(issues.map((i) => i.code)).toEqual(["no_test"]);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════
 * ★ 이 검사의 **한계**를 테스트로 박아 둔다.
 *
 * 아래 케이스들은 **통과해 버린다**. 버그가 아니라 정규식 스캐너의 구조적 한계다.
 * `validateScenarioCode()` 는 **보안 경계가 아니다** — 보안은 실행 격리(쟁점 4)가 담당한다.
 * 이 테스트가 통과하는 한, 누구도 이 함수를 보안 장치로 오해할 수 없다.
 * (만약 이 테스트가 깨진다면, 누군가 검출을 강화한 것이다. 그래도 **여전히 보안 경계는 아니다** —
 *  문자열을 조립하는 방법은 무한하다.)
 * ════════════════════════════════════════════════════════════════════
 */
describe("★ 한계 — 우회는 검출되지 않는다 (의도된 동작)", () => {
  it("require([\"f\",\"s\"].join(\"\")) 는 검출되지 않는다", () => {
    const code = `const fs = require(["f", "s"].join(""));\ntest("t", async () => {});\n`;
    const issues = validateScenarioCode(code);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("변수로 조립한 동적 import 도 검출되지 않는다", () => {
    const code = `const m = "node:" + "fs";\nconst fs = await import(m);\ntest("t", async () => {});\n`;
    const issues = validateScenarioCode(code);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("createRequire 우회도 검출되지 않는다 (전역 process 접근 자체를 막지 못한다)", () => {
    const code = `const secret = process.env["HOME"];\ntest("t", async () => { console.log(secret); });\n`;
    expect(validateScenarioCode(code)).toEqual([]);
  });
});
