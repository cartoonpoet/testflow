/**
 * 코드 실행의 격리 — **`playwright test` 프로세스째 컨테이너에 넣는다** (Task 4.5 / ★ 게이트 G2).
 *
 * ## 라운드 1(`container.ts`)과 무엇이 다른가
 * 라운드 1은 **브라우저만** 컨테이너에 넣고 인터프리터·DB 자격증명·`variables` 를 호스트에 뒀다.
 * 그 판단은 옳았다 — 실행 대상이 **우리가 만든 JSON 스텝**이었고 신뢰 경계가 없었다.
 *
 * 라운드 2는 **사용자가 붙여넣은 임의 Node 코드를 `node` 로 실행**한다. 그 코드는
 * `fs.readFile("~/.ssh/id_rsa")` 도 `fetch("http://외부")` 도 할 수 있다.
 * **격리해야 할 대상이 바로 그 프로세스**이므로 그것이 컨테이너 안으로 들어가야 한다.
 * 그래서 이 파일은 `container.ts` 를 **고치지 않고 따로 있다** — 녹화 경로와 기존 `steps`
 * 실행의 격리 기본값(`local`)은 바뀌지 않는다(쟁점 4).
 *
 * ## 대가 — 숨기지 않는다 (실측 근거는 `.pipeline/…/04-gen-4.md` §게이트 G2)
 * | 항목 | 결과 |
 * |---|---|
 * | `variables` 평문 | **컨테이너 프로세스 env 에 들어간다.** 단 **`docker inspect` 에는 안 나온다** — `-e` 가 아니라 **stdin** 으로 넘긴다(실측 grep 0건) |
 * | CDP 포트 | 컨테이너 안 **TCP 중계** 필요. Chromium DevTools 가 루프백 peer 만 받기 때문이다(`pw-container-boot.ts` 주석) |
 * | reporter → Runner | 이벤트 싱크를 **`0.0.0.0` 에 bind** 해야 한다(`127.0.0.1` 이면 컨테이너에서 못 닿는다). 그만큼 로컬 노출면이 늘어난다 |
 * | 작업공간 | **bind mount 가능한 경로**여야 한다. WSL+Docker Desktop 에서는 `/tmp` 이 **보이지 않는다**(실측) → `/mnt/c` 로 옮겨야 하고 그쪽은 느리다 |
 * | 실행 오버헤드 | 라운드 1 실측 +6.5초. 이번 실측도 같은 자리수(§G2) |
 * | 이미지 | 3.55GB 베이스 + `@playwright/test` |
 *
 * ## ★ 이미지가 없으면 **실행을 거부한다** — local 로 조용히 내려가지 않는다
 * 격리 실패를 조용히 삼키면 사용자는 격리됐다고 믿고 신뢰할 수 없는 코드를 넣는다.
 * 그건 격리가 없는 것보다 나쁘다. `RUNNER_CODE_EXECUTION_MODE=local` 은 **사람이 명시**해야 한다.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { RUNNER_ROOT_DIR } from "./code-workspace.js";
import type { RunnerConfig } from "../env.js";

/* ── 컨테이너 안의 고정 경로 ────────────────────────────────
 * 이 세 값은 `buildCodeContainerArgs()` 의 마운트 지점과 **반드시** 짝이 맞아야 한다.
 * 어긋나면 Playwright 가 config 를 못 읽고 그것을 `No tests found` 로 보고한다(실측). */
export const CONTAINER_DIST_DIR = "/tfdist";
export const CONTAINER_WORKSPACE_DIR = "/ws";
export const CONTAINER_PW_CONFIG_MODULE = `${CONTAINER_DIST_DIR}/execute/pw-config.js`;
export const CONTAINER_PW_REPORTER_MODULE = `${CONTAINER_DIST_DIR}/execute/pw-reporter.js`;
/** 컨테이너에서 호스트(Runner)로 닿는 이름. reporter 싱크·대상 사이트가 여기로 온다. */
export const CONTAINER_HOST_ALIAS = "host.docker.internal";

/** 컴파일된 Runner `dist` 디렉토리(호스트 경로). 컨테이너에 읽기 전용으로 마운트한다. */
export function runnerDistDir(): string {
  return resolve(RUNNER_ROOT_DIR, "dist");
}

/** docker 실행 파일 후보. WSL + Docker Desktop 은 리눅스 `docker` 가 없고 `docker.exe` 만 있다. */
const DOCKER_BINS = [process.env["RUNNER_DOCKER_BIN"], "docker", "docker.exe"].filter(
  (value): value is string => value !== undefined && value !== "",
);

let resolvedBin: string | null = null;

export class CodeContainerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeContainerUnavailableError";
  }
}

export async function resolveCodeDockerBin(): Promise<string> {
  if (resolvedBin !== null) return resolvedBin;
  for (const bin of DOCKER_BINS) {
    const probe = await exec(bin, ["version", "--format", "{{.Server.Version}}"]).catch(() => null);
    if (probe !== null && probe.code === 0) {
      resolvedBin = bin;
      return bin;
    }
  }
  throw new CodeContainerUnavailableError(
    `docker 를 찾지 못했습니다(시도: ${DOCKER_BINS.join(", ")}). ` +
      `격리 실행이 불가능합니다 — RUNNER_CODE_EXECUTION_MODE=local 을 **명시**하거나 docker 를 설치하세요.`,
  );
}

/** 테스트용 리셋. */
export function resetCodeDockerBinCache(): void {
  resolvedBin = null;
}

export async function assertCodeImagePresent(image: string): Promise<void> {
  const bin = await resolveCodeDockerBin();
  const result = await exec(bin, ["image", "inspect", image]).catch(() => null);
  if (result === null || result.code !== 0) {
    throw new CodeContainerUnavailableError(
      `격리 실행 이미지가 없습니다: ${image}. 먼저 빌드하세요 — ` +
        `\`docker build -f apps/runner/Dockerfile.code-exec -t ${image} apps/runner\`. ` +
        `격리 없이 돌리려면 RUNNER_CODE_EXECUTION_MODE=local 을 명시해야 합니다 ` +
        `(붙여넣은 코드가 Runner 호스트에서 그대로 실행됩니다).`,
    );
  }
}

/* ────────────────────────────────────────────────────────────
 * 경로 변환 — ★ WSL 에서 실측으로 확인한 제약
 * ──────────────────────────────────────────────────────────── */

/**
 * bind mount 에 넣을 **호스트 경로**를 만든다.
 *
 * ★ 실측: WSL 안에서 `docker.exe run -v /tmp/x:/x` 를 하면 Docker Desktop(Windows 엔진)이
 *   `/tmp/x` 를 **윈도 경로로** 해석해 **빈 디렉토리**를 마운트한다. 그대로 두면
 *   "컨테이너 안에 spec 이 없다"가 되는데, 에러가 아니라 `No tests found` 로 나와
 *   원인을 찾기가 아주 어렵다. 그래서 여기서 **명시적으로** 변환하고,
 *   변환할 수 없으면 **던진다**(조용히 빈 마운트를 만들지 않는다).
 *
 * - `/mnt/c/Users/x` → `C:/Users/x`
 * - 그 밖의 절대 경로는 그대로 (리눅스 네이티브 docker 의 정상 경로)
 */
export function toDockerMountPath(hostPath: string, platform: "wsl-docker-desktop" | "native"): string {
  if (!isAbsolute(hostPath)) {
    throw new CodeContainerUnavailableError(`마운트 경로가 절대 경로가 아닙니다: ${hostPath}`);
  }
  if (platform === "native") return hostPath;
  const matched = /^\/mnt\/([a-z])(\/.*)?$/u.exec(hostPath);
  if (matched === null) {
    throw new CodeContainerUnavailableError(
      `이 경로는 Docker Desktop(Windows 엔진)에 마운트할 수 없습니다: ${hostPath} — ` +
        `WSL 내부 경로(/tmp 등)는 컨테이너에서 보이지 않습니다(빈 디렉토리가 마운트됩니다). ` +
        `RUNNER_CODE_WORKSPACE_ROOT 를 /mnt/<드라이브>/… 아래로 지정하세요.`,
    );
  }
  const drive = (matched[1] ?? "c").toUpperCase();
  return `${drive}:${matched[2] ?? "/"}`;
}

/** 호스트가 WSL + Docker Desktop 인가. `RUNNER_DOCKER_MOUNT_STYLE` 로 강제할 수 있다. */
export function detectMountStyle(): "wsl-docker-desktop" | "native" {
  const forced = (process.env["RUNNER_DOCKER_MOUNT_STYLE"] ?? "").trim();
  if (forced === "native" || forced === "wsl-docker-desktop") return forced;
  return (resolvedBin ?? "").endsWith(".exe") ? "wsl-docker-desktop" : "native";
}

/* ────────────────────────────────────────────────────────────
 * 실행
 * ──────────────────────────────────────────────────────────── */

export interface CodeContainerSpec {
  runId: string;
  /** 작업공간(호스트 경로). `/ws` 로 마운트된다. */
  workspaceDir: string;
  /** 컴파일된 Runner `dist` 디렉토리(호스트 경로). `/tfdist` 로 **읽기 전용** 마운트된다. */
  distDir: string;
  /** 컨테이너 안 config 경로 기준의 상대 이름(작업공간 루트에 있다). */
  configFilename: string;
  /** 컨테이너 안 CDP 포트. 중계의 upstream 이다. */
  cdpPort: number;
  /** 호스트로 퍼블리시할 중계 포트. `connectOverCDP` 가 여기에 붙는다. 0 이면 라이브 없음. */
  relayPort: number;
  /** `TESTFLOW_*` 등 **비밀이 아닌** 환경변수. `docker inspect` 에 남는다. */
  env: Readonly<Record<string, string>>;
  /** ★ `variables` — **stdin 으로만** 간다. `docker inspect` 에 남지 않는다. */
  secretEnv: Readonly<Record<string, string>>;
}

export interface CodeContainerHandle {
  readonly containerName: string;
  readonly child: ChildProcess;
  /**
   * ★ **우아한 중단 1단계** — `docker kill -s INT`.
   *
   * Playwright 테스트 러너가 **유일하게 직접 받는 신호가 SIGINT 다**(실측: 1.63.0 의
   * `FixedNodeSIGINTHandler` 는 `process.on("SIGINT")` 하나만 건다). SIGTERM 은 핸들러가
   * 없어 Node 기본 동작으로 **즉사**하고, 그러면 `BrowserContext.close()` 가 돌지 않아
   * **영상이 `out/.playwright-artifacts-N/` 안에 미완성으로 남는다.**
   * SIGINT 를 받으면 러너가 워커를 접으며 컨텍스트를 닫아 영상을 `video.webm` 으로 옮긴다.
   */
  interrupt(): Promise<void>;
  /** `docker kill -s TERM` — SIGINT 유예를 넘겼을 때의 2단계. */
  terminate(): Promise<void>;
  /** 마지막 수단. */
  forceKill(): Promise<void>;
}

/** 컨테이너 이름. `docker ps` 에서 어느 run 인지 바로 보이게 한다. */
export function codeContainerName(runId: string): string {
  return `testflow-code-${runId.slice(0, 8)}-${String(process.pid)}`;
}

export function buildCodeContainerArgs(
  config: RunnerConfig,
  spec: CodeContainerSpec,
  mountStyle: "wsl-docker-desktop" | "native",
): string[] {
  const name = codeContainerName(spec.runId);
  const args = [
    "run",
    "--rm",
    // ★ `-i` 필수 — 변수를 stdin 으로 넘긴다.
    "-i",
    // 브라우저는 자식 프로세스를 많이 만든다. 좀비 수거.
    "--init",
    "--name",
    name,
    `--memory=${config.docker.memory}`,
    `--cpus=${config.docker.cpus}`,
    // 리눅스 네이티브 docker 에서도 `host.docker.internal` 이 잡히게 한다(Desktop 은 자동).
    "--add-host=host.docker.internal:host-gateway",
  ];

  if (spec.relayPort > 0) {
    // ★ **127.0.0.1 에만** 퍼블리시한다. DevTools 는 인증이 없어서 0.0.0.0 에 열면
    //   같은 네트워크의 누구나 브라우저를 조작할 수 있다(라운드 1 `container.ts` 와 같은 규율).
    args.push("-p", `127.0.0.1:${String(spec.relayPort)}:${String(spec.relayPort)}`);
  }

  args.push(
    "-v",
    `${toDockerMountPath(spec.workspaceDir, mountStyle)}:/ws`,
    // ★ 우리 `dist` 는 **읽기 전용**이다. 사용자 코드가 Runner 코드를 고칠 수 없어야 한다.
    "-v",
    `${toDockerMountPath(spec.distDir, mountStyle)}:/tfdist:ro`,
    "-w",
    "/ws",
  );

  // ★ `ARTIFACT_ROOT` 는 **마운트하지 않는다**(라운드 1 규율). 증적은 작업공간의
  //   `out/` 에 쌓이고 Runner 가 호스트 쪽에서 읽어 `storage.putFile()` 로 옮긴다.
  for (const [key, value] of Object.entries(spec.env)) {
    args.push("-e", `${key}=${value}`);
  }

  args.push(
    config.codeDockerImage,
    "node",
    "/tfdist/execute/pw-container-boot.js",
    String(spec.relayPort),
    String(spec.cdpPort),
    "--",
    "node",
    "/node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    `/ws/${spec.configFilename}`,
  );
  return args;
}

/**
 * 컨테이너를 띄우고 **stdin 으로 변수를 넘긴 뒤 닫는다.**
 *
 * stdin 을 닫지 않으면 부트스트랩이 `end` 를 못 받아 영원히 기다린다 —
 * 변수가 없어도 **빈 줄을 쓰고 닫는다.**
 */
export async function spawnCodeContainer(
  config: RunnerConfig,
  spec: CodeContainerSpec,
): Promise<CodeContainerHandle> {
  const bin = await resolveCodeDockerBin();
  await assertCodeImagePresent(config.codeDockerImage);
  const mountStyle = detectMountStyle();
  const args = buildCodeContainerArgs(config, spec, mountStyle);
  const name = codeContainerName(spec.runId);

  const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin?.end(`${JSON.stringify(spec.secretEnv)}\n`);

  return {
    containerName: name,
    child,
    interrupt: async () => {
      // `--init`(tini) 이 PID 1 이고 부트스트랩이 그 자식이다. tini 는 받은 신호를
      // 자식에게 그대로 넘기고, 부트스트랩도 `SIGINT` 를 playwright 에게 넘긴다
      // (`pw-container-boot.ts` 의 시그널 전달 루프). 그래서 3단을 거쳐 러너에 닿는다.
      await exec(bin, ["kill", "-s", "INT", name]).catch(() => undefined);
    },
    terminate: async () => {
      // `docker kill -s TERM` — 부트스트랩이 SIGTERM 을 자식(playwright)에게 넘긴다.
      // Playwright 는 SIGTERM 에 `interrupted` 를 보고하고 종료한다 → `cancelled` 로 매핑된다.
      await exec(bin, ["kill", "-s", "TERM", name]).catch(() => undefined);
    },
    forceKill: async () => {
      await exec(bin, ["kill", name]).catch(() => undefined);
    },
  };
}

/* ── 내부 ────────────────────────────────────────────────── */

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function exec(bin: string, args: readonly string[], timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`docker 명령 타임아웃: ${bin} ${args.slice(0, 2).join(" ")}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
