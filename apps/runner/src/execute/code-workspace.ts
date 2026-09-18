/**
 * 코드 실행용 임시 작업공간 (03-phases Task 3.4).
 *
 * 레이아웃 — run 1건마다 새로 만들고 **어떤 경로로 끝나도 지운다**(성공·실패·취소·타임아웃):
 * ```
 * /tmp/testflow-code-<runId8>-XXXXXX/
 *   node_modules -> <apps/runner>/node_modules   ← 심볼릭 링크
 *   playwright.config.mjs                        ← 생성 (pw-config.ts)
 *   specs/<filename>                             ← 사용자 코드 그대로
 *   out/                                         ← outputDir (video/trace/screenshot)
 * ```
 *
 * ## ★ 왜 `node_modules` 심볼릭 링크인가
 * 작업공간을 `/tmp` 에 두면 사용자 spec 의 `import { test } from "@playwright/test"` 가
 * **해석되지 않는다** — Node 는 상위 디렉토리를 훑는데 `/tmp` 위에는 아무것도 없다.
 * 링크 하나로 `apps/runner/node_modules` 를 빌려 쓰면 spec·config 양쪽이 해결된다.
 * pnpm 의 `node_modules/@playwright/test` 는 store 로의 심볼릭 링크이고 Node 는 realpath 로
 * 해석하므로 **CLI 와 같은 모듈 인스턴스**가 잡힌다(갈라지면 "did not expect test() to be
 * called here" 가 난다). 실측으로 확인했다.
 *
 * 대안으로 작업공간을 레포 안에 두는 방법이 있지만, 사용자 코드가 실행되는 디렉토리를
 * 레포 안에 만들면 실패 시 남은 파일이 `git status` 를 오염시키고 `.gitignore` 관리가 늘어난다.
 *
 * ## `variables` 는 환경변수로 넘긴다
 * `TESTFLOW_VAR_<KEY>`. 사용자 코드가 `process.env["TESTFLOW_VAR_password"]` 로 읽고,
 * 동시에 Runner 는 같은 값으로 `collectSecretValues()` 기반 마스킹을 걸 수 있다
 * (라운드 1 의 마스킹 규약을 코드 경로에서 살리는 유일한 방법 — 쟁점 5).
 * **이 값은 자식 프로세스 환경에만 있고 로그·DB 로는 나가지 않는다.**
 */
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ScenarioCodeFilenameSchema } from "@testflow/contracts";
import {
  PW_CONFIG_FILENAME,
  PW_ENV,
  PW_OUTPUT_DIR,
  PW_TEST_DIR,
  buildPwConfigSource,
} from "./pw-config.js";

/**
 * `apps/runner` 루트.
 *
 * `src/execute/code-workspace.ts` 와 `dist/execute/code-workspace.js` 의 깊이가 같아
 * 같은 상대 경로가 양쪽에서 성립한다(`env.ts` 의 `REPO_ROOT_DIR` 와 같은 규율).
 */
export const RUNNER_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** 작업공간 디렉토리 이름 접두사. 정리 누락을 `ls /tmp/testflow-code-*` 로 확인할 수 있게 고정한다. */
export const CODE_WORKSPACE_PREFIX = "testflow-code-";

/** `variables` 를 실을 환경변수 접두사. */
export const TESTFLOW_VAR_ENV_PREFIX = "TESTFLOW_VAR_";

/**
 * 작업공간 삭제 재시도 — 늦게 쓰는 프로세스를 이기기 위한 것이다(사유는 `dispose()` 주석).
 * 실측으로는 1회 재시도로 충분했고, 여유를 두어 3회로 둔다.
 */
const DISPOSE_ATTEMPTS = 3;
const DISPOSE_RETRY_MS = 400;

/**
 * ★ `playwright test` 프로세스가 끝난 뒤 증적을 훑기 전에 기다리는 시간.
 *
 * 자식의 `close` 이벤트는 stdio 가 닫힌 시점이고 **파일 쓰기가 끝난 시점이 아니다.**
 * 실측: SIGTERM 직후 `close` 가 95ms 만에 떴는데 그 뒤에 `test-failed-1.png` 가 쓰였다.
 * 기다리지 않으면 ① 증적을 놓치고 ② 지운 디렉토리가 되살아난다.
 */
export const ARTIFACT_SETTLE_MS = 700;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface CodeWorkspace {
  readonly dir: string;
  readonly configPath: string;
  readonly specPath: string;
  readonly outputDir: string;
  /** 반드시 호출한다. 두 번 불러도 안전하다. */
  dispose(): Promise<void>;
}

/**
 * ★ 파일명 재검증 — API 가 이미 막았지만 여기서 **한 번 더** 막는다.
 *
 * 라운드 1 의 storage traversal 3중 방어와 같은 규율이다. 근거는 가정이 아니라 경로다:
 * `scenario_codes` 행은 **DB 에 직접 INSERT 될 수 있다**(마이그레이션·운영 스크립트·수동 수정).
 * 그 행의 `filename` 이 `../../etc/passwd` 면 여기가 마지막 방어선이다.
 */
export function assertSafeSpecFilename(filename: string): string {
  const parsed = ScenarioCodeFilenameSchema.safeParse(filename);
  if (!parsed.success) {
    throw new Error(
      `실행할 수 없는 파일명입니다: ${JSON.stringify(filename)} — ${
        parsed.error.issues[0]?.message ?? "형식 오류"
      }`,
    );
  }
  return parsed.data;
}

/**
 * `variables` → 자식 프로세스 환경변수.
 *
 * 키에 `=` 나 NUL 이 들어가면 환경변수 블록이 깨지므로 그런 키는 **버린다**(치환하지 않는다 —
 * 치환하면 사용자가 예상한 이름과 달라져 조용히 `undefined` 가 된다. 버리면 코드가 바로 터져
 * 원인이 보인다).
 */
export function buildVariableEnv(variables: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (key === "" || key.includes("=") || key.includes("\0")) continue;
    env[`${TESTFLOW_VAR_ENV_PREFIX}${key}`] = value;
  }
  return env;
}

export async function createCodeWorkspace(params: {
  runId: string;
  filename: string;
  content: string;
  /**
   * 작업공간 부모 디렉토리. 비우면 `os.tmpdir()`.
   *
   * ★ **`docker` 격리에서는 bind mount 가능한 경로여야 한다.** WSL + Docker Desktop 에서
   *   `/tmp` 은 컨테이너에 **빈 디렉토리로** 마운트된다(실측 — `code-container.ts`
   *   `toDockerMountPath()` 주석). 그 환경에서는 `/mnt/<드라이브>/…` 를 넘긴다.
   */
  root?: string;
  /**
   * `node_modules` 심볼릭 링크를 만들지 않는다.
   *
   * ★ `docker` 격리에서 이 링크는 **깨진 링크**다 — 호스트 경로를 가리키는데 컨테이너 안에는
   *   그 경로가 없다. 컨테이너 이미지가 `/node_modules` 로 `@playwright/test` 를 제공한다
   *   (`Dockerfile.code-exec`). 링크를 그대로 두면 Node 가 그것을 먼저 잡아 모듈 해석이 깨진다.
   */
  skipNodeModulesLink?: boolean;
  /**
   * 생성 config 가 동적 import 할 `pw-config.js` 의 경로.
   *
   * ★ `docker` 격리에서는 **컨테이너 안 경로**(`/tfdist/execute/pw-config.js`)여야 한다.
   *   호스트 경로를 그대로 쓰면 컨테이너 안에 그 파일이 없어 config 로드가 실패하고,
   *   Playwright 는 그것을 `No tests found` 로 보고해 원인이 보이지 않는다.
   */
  configModulePath?: string;
}): Promise<CodeWorkspace> {
  const filename = assertSafeSpecFilename(params.filename);

  const parent = params.root !== undefined && params.root.trim() !== "" ? params.root : tmpdir();
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, `${CODE_WORKSPACE_PREFIX}${params.runId.slice(0, 8)}-`));
  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    // 심볼릭 링크는 링크 자체만 지워진다(`rm -r` 은 링크를 따라가지 않는다) —
    // `apps/runner/node_modules` 가 지워지지 않는다는 뜻이다. 확인했다.
    //
    // ★ 재시도하는 이유 — 실측한 경쟁 상태.
    //   취소로 SIGTERM 을 준 뒤 자식의 `close` 이벤트가 떠도 **Playwright(또는 그 손자
    //   프로세스)가 잠시 더 `outputDir` 에 파일을 쓴다.** 한 번만 지우면 그 뒤에 쓰인 파일이
    //   디렉토리를 되살려 `/tmp` 에 남는다(실제로 `out/<테스트>/test-failed-1.png` 가 남았다).
    for (let attempt = 0; attempt < DISPOSE_ATTEMPTS; attempt += 1) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if (!(await exists(dir))) return;
      await delay(DISPOSE_RETRY_MS);
    }
    // 마지막 시도. 여기서도 남으면 호출부가 알 수 있게 **삼키지 않는다** —
    // 조용히 넘기면 `/tmp` 가 차는 것을 아무도 모른다.
    await rm(dir, { recursive: true, force: true });
  };

  try {
    await mkdir(join(dir, PW_TEST_DIR), { recursive: true });
    await mkdir(join(dir, PW_OUTPUT_DIR), { recursive: true });
    if (params.skipNodeModulesLink !== true) {
      await symlink(join(RUNNER_ROOT_DIR, "node_modules"), join(dir, "node_modules"), "dir");
    }

    const specPath = join(dir, PW_TEST_DIR, filename);
    // 사용자 코드는 **한 글자도 바꾸지 않는다.** 주입은 config 와 환경변수에만 있다.
    await writeFile(specPath, params.content, "utf8");

    const configPath = join(dir, PW_CONFIG_FILENAME);
    await writeFile(
      configPath,
      buildPwConfigSource(params.configModulePath ?? pwConfigModulePath()),
      "utf8",
    );

    return { dir, configPath, specPath, outputDir: join(dir, PW_OUTPUT_DIR), dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/** 컴파일된 `pw-config.js` 의 절대 경로. 생성된 config 가 이것을 동적 import 한다. */
export function pwConfigModulePath(): string {
  return fileURLToPath(new URL("pw-config.js", import.meta.url));
}

/** 컴파일된 `pw-reporter.js` 의 절대 경로. Playwright 의 `reporter` 배열에 들어간다. */
export function pwReporterModulePath(): string {
  return fileURLToPath(new URL("pw-reporter.js", import.meta.url));
}

/** `@playwright/test` CLI 진입점. spawn 대상이다. */
export function pwCliPath(): string {
  // `apps/runner/node_modules` 기준으로 해석된다(dist/src 어디서 돌아도 동일).
  return resolve(RUNNER_ROOT_DIR, "node_modules/@playwright/test/cli.js");
}

/** 생성된 config 가 읽을 환경변수 묶음. */
export function buildPwEnv(params: {
  reporterPath: string;
  eventsUrl: string;
  /** 실행 요청의 `baseUrl`. config 의 `use.baseURL` 기본값이 되고, 사용자 코드도 읽을 수 있다. */
  baseUrl: string;
  headless: boolean;
  viewport: { width: number; height: number };
  userConfigPath: string | null;
  cdpPort: number | null;
}): Record<string, string> {
  const env: Record<string, string> = {
    [PW_ENV.reporterPath]: params.reporterPath,
    [PW_ENV.eventsUrl]: params.eventsUrl,
    [PW_ENV.baseUrl]: params.baseUrl,
    [PW_ENV.headless]: params.headless ? "true" : "false",
    [PW_ENV.viewportWidth]: String(params.viewport.width),
    [PW_ENV.viewportHeight]: String(params.viewport.height),
  };
  if (params.userConfigPath !== null) env[PW_ENV.userConfig] = params.userConfigPath;
  if (params.cdpPort !== null) env[PW_ENV.cdpPort] = String(params.cdpPort);
  return env;
}
