/**
 * `code-workspace` 단위 테스트 — 파일명 3중 방어, `variables` 환경변수, 수명주기.
 *
 * ★ 실제 파일시스템을 쓴다(모킹하지 않는다). "실행 후 디렉토리가 남지 않는다"는
 *   `fs` 를 모킹하면 증명할 수 없는 성질이다.
 */
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODE_WORKSPACE_PREFIX,
  RUNNER_ROOT_DIR,
  TESTFLOW_VAR_ENV_PREFIX,
  assertSafeSpecFilename,
  buildVariableEnv,
  createCodeWorkspace,
  pwCliPath,
  pwConfigModulePath,
  pwReporterModulePath,
} from "./code-workspace.js";

const RUN_ID = "8a1f0c2e-1111-4222-8333-444455556666";
const SPEC = 'import { test } from "@playwright/test";\ntest("t", async () => {});\n';

describe("★ 파일명 재검증 — API 가 이미 막았지만 여기가 마지막 방어선이다", () => {
  it("정상 파일명은 통과한다", () => {
    expect(assertSafeSpecFilename("login.spec.ts")).toBe("login.spec.ts");
    expect(assertSafeSpecFilename("a-b_c.1.spec.ts")).toBe("a-b_c.1.spec.ts");
  });

  it("traversal 시도를 거부한다 (DB 에 직접 INSERT 된 행을 가정)", () => {
    for (const bad of [
      "../../etc/passwd",
      "../x.spec.ts",
      "a/b.spec.ts",
      "a\\b.spec.ts",
      "/abs/x.spec.ts",
      "..spec.ts",
    ]) {
      expect(() => assertSafeSpecFilename(bad)).toThrow(/실행할 수 없는 파일명/);
    }
  });

  it(".spec.ts 가 아닌 확장자를 거부한다", () => {
    for (const bad of ["x.ts", "x.js", "x.spec.js", "", "login.spec.ts.sh"]) {
      expect(() => assertSafeSpecFilename(bad)).toThrow();
    }
  });
});

describe("buildVariableEnv", () => {
  it("TESTFLOW_VAR_ 접두사를 붙인다", () => {
    expect(buildVariableEnv({ password: "p", "testUser.id": "u" })).toEqual({
      [`${TESTFLOW_VAR_ENV_PREFIX}password`]: "p",
      [`${TESTFLOW_VAR_ENV_PREFIX}testUser.id`]: "u",
    });
  });

  it("환경변수 블록을 깨뜨리는 키는 버린다(치환하지 않는다)", () => {
    expect(buildVariableEnv({ "a=b": "x", "c\0d": "y", "": "z", ok: "1" })).toEqual({
      [`${TESTFLOW_VAR_ENV_PREFIX}ok`]: "1",
    });
  });

  it("빈 variables 는 빈 객체다", () => {
    expect(buildVariableEnv({})).toEqual({});
  });
});

describe("경로 해석", () => {
  it("reporter · config 모듈을 **자기 모듈 옆에서** 해석한다", () => {
    // ★ 경로는 `import.meta.url` 기준이다 — 즉 dist 에서 돌면 dist 를, 테스트(vitest)에서
    //   돌면 src 를 가리킨다. Playwright 가 로드하는 것은 **컴파일된 dist 쪽**이다
    //   (`pnpm start` = `node dist/main.js`). 그래서 여기서는 파일 존재가 아니라
    //   "형제 경로로 해석된다"를 고정한다.
    expect(pwReporterModulePath()).toBe(join(import.meta.dirname, "pw-reporter.js"));
    expect(pwConfigModulePath()).toBe(join(import.meta.dirname, "pw-config.js"));
  });

  it("빌드 산출물이 dist 에 실제로 있다 (Playwright 가 그것을 로드한다)", async () => {
    await expect(access(join(RUNNER_ROOT_DIR, "dist/execute/pw-reporter.js"))).resolves.toBeUndefined();
    await expect(access(join(RUNNER_ROOT_DIR, "dist/execute/pw-config.js"))).resolves.toBeUndefined();
  });

  it("@playwright/test CLI 가 존재한다 (spawn 대상)", async () => {
    await expect(access(pwCliPath())).resolves.toBeUndefined();
    expect(pwCliPath()).toContain("@playwright/test");
  });

  it("RUNNER_ROOT_DIR 이 apps/runner 를 가리킨다", async () => {
    const info = await stat(join(RUNNER_ROOT_DIR, "package.json"));
    expect(info.isFile()).toBe(true);
    const pkg = JSON.parse(await readFile(join(RUNNER_ROOT_DIR, "package.json"), "utf8")) as {
      name: string;
    };
    expect(pkg.name).toBe("@testflow/runner");
  });
});

describe("createCodeWorkspace", () => {
  it("레이아웃을 만들고 사용자 코드를 한 글자도 바꾸지 않는다", async () => {
    const ws = await createCodeWorkspace({ runId: RUN_ID, filename: "login.spec.ts", content: SPEC });
    try {
      expect(ws.dir).toContain(CODE_WORKSPACE_PREFIX);
      expect(await readFile(ws.specPath, "utf8")).toBe(SPEC);
      expect(ws.specPath.endsWith(join("specs", "login.spec.ts"))).toBe(true);

      const entries = (await readdir(ws.dir)).sort();
      expect(entries).toEqual(["node_modules", "out", "playwright.config.mjs", "specs"]);

      // 생성된 config 는 우리 모듈을 동적 import 하는 3줄짜리다.
      const config = await readFile(ws.configPath, "utf8");
      expect(config).toContain("resolveInjectedConfig");

      // ★ node_modules 심볼릭 링크가 apps/runner 의 것을 가리킨다
      //   (이게 없으면 사용자 spec 의 `@playwright/test` 가 해석되지 않는다).
      expect(await realpath(join(ws.dir, "node_modules"))).toBe(
        await realpath(join(RUNNER_ROOT_DIR, "node_modules")),
      );
      await expect(access(join(ws.dir, "node_modules", "@playwright", "test"))).resolves.toBeUndefined();
    } finally {
      await ws.dispose();
    }
  });

  it("dispose() 가 디렉토리를 지운다 — 두 번 불러도 안전하다", async () => {
    const ws = await createCodeWorkspace({ runId: RUN_ID, filename: "a.spec.ts", content: SPEC });
    await ws.dispose();
    await ws.dispose();
    await expect(access(ws.dir)).rejects.toThrow();
  });

  it("★ dispose() 가 심볼릭 링크를 따라가 apps/runner/node_modules 를 지우지 않는다", async () => {
    const ws = await createCodeWorkspace({ runId: RUN_ID, filename: "a.spec.ts", content: SPEC });
    await ws.dispose();
    // 이게 깨지면 레포가 통째로 망가진다. 실제로 확인한다.
    await expect(access(join(RUNNER_ROOT_DIR, "node_modules", "@playwright", "test"))).resolves
      .toBeUndefined();
  });

  it("★ 파일명이 위험하면 디렉토리를 만들지도 않는다", async () => {
    await expect(
      createCodeWorkspace({ runId: RUN_ID, filename: "../../evil.spec.ts", content: SPEC }),
    ).rejects.toThrow(/실행할 수 없는 파일명/);
  });

  it("동시에 2건을 만들어도 디렉토리가 충돌하지 않는다", async () => {
    const [a, b] = await Promise.all([
      createCodeWorkspace({ runId: RUN_ID, filename: "a.spec.ts", content: SPEC }),
      createCodeWorkspace({ runId: RUN_ID, filename: "a.spec.ts", content: SPEC }),
    ]);
    try {
      expect(a.dir).not.toBe(b.dir);
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});
