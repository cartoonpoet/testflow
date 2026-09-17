import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

/**
 * Runner 환경변수 단일 지점.
 *
 * ★ env 는 bracket 접근이다 (`noPropertyAccessFromIndexSignature`).
 *
 * ## 왜 `.env` 를 여기서 직접 읽지 않는가
 * `apps/runner` 의 실행 커맨드가 `node --env-file-if-exists=../../.env dist/main.js` 다
 * (`packages/db` 의 마이그레이션 CLI 와 같은 규약). 즉 **앰비언트 환경변수가 `.env` 를 이긴다** —
 * 레포 전체가 이 우선순위 하나로 통일돼 있다 (04-gen-4 `apps/api/src/common/config/env.ts` 참조).
 *
 * ## `ARTIFACT_ROOT` 는 반드시 API 와 같은 경로로 풀려야 한다
 * API(`artifacts.service.ts`)가 `resolve(REPO_ROOT_DIR, ARTIFACT_ROOT)` 로 푼다.
 * Runner 가 cwd 기준으로 풀면 **Runner 가 쓴 파일을 API 가 못 찾는다.** 같은 규칙을 쓴다.
 */

/**
 * 레포 루트 절대 경로.
 *
 * 소스(`apps/runner/src/env.ts`)와 컴파일 결과(`apps/runner/dist/env.js`) 의 깊이가 같아
 * 같은 상대 경로(`../../..`)가 양쪽에서 성립한다.
 */
export const REPO_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function str(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value.trim() === "" ? fallback : value;
}

function int(key: string, fallback: number): number {
  const parsed = Number(str(key, String(fallback)));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const value = str(key, String(fallback)).toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

/** 실행 격리 방식. 기본은 `local` 이다 — 사유는 `execute/container.ts` 상단 주석 참조. */
export type ExecutionMode = "local" | "docker";

export interface RunnerConfig {
  runnerId: string;
  redis: { host: string; port: number };
  concurrency: number;
  artifactRoot: string;
  keepArtifactsOnSuccess: boolean;
  /** run 1건의 하드 타임아웃. 넘기면 `timeout` 상태로 확정한다. */
  runTimeoutMs: number;
  headless: boolean;
  executionMode: ExecutionMode;
  docker: { image: string; memory: string; cpus: string };
  wsPort: number;
  /**
   * 코드 실행 라이브 스트림의 CDP 디버깅 포트를 **고정**한다. `0`(기본) 이면 실행마다
   * 빈 포트를 새로 할당한다 — 동시 실행이 포트를 다투지 않는 유일한 방법이므로 **기본값을
   * 유지하는 것이 옳다.**
   *
   * 고정이 필요한 경우가 두 가지 있다:
   *  ① 로컬 방화벽·보안 정책이 특정 포트만 허용하는 환경(동시 실행 1건으로 묶어야 한다).
   *  ② **고장 주입** — 그 포트를 미리 점유해 두면 `connectOverCDP` 가 실패한다.
   *     "스트림이 실패해도 실행은 계속된다"(Task 4.4)를 실측으로 확인하는 데 쓴다.
   */
  codeCdpPort: number;
  /**
   * ★ **코드 입력 실행 전용** 격리 방식 (게이트 G2). 녹화 경로와 기존 `steps` 실행의
   * `RUNNER_EXECUTION_MODE` 와 **별개다** — 라운드 1 기본값(`local`)은 바뀌지 않는다.
   *
   * 기본은 **`docker`** 다. 사용자가 붙여넣은 임의 Node 코드를 실행하기 때문이다
   * (`code-container.ts` 상단 주석 · 쟁점 4). `local` 은 **사람이 명시**해야 한다 —
   * 그때 붙여넣은 코드는 Runner 호스트에서 그대로 돈다.
   */
  codeExecutionMode: ExecutionMode;
  /** 코드 실행 격리 이미지. `Dockerfile.code-exec` 로 만든다. */
  codeDockerImage: string;
  /**
   * 코드 실행 작업공간의 부모 디렉토리.
   *
   * `local` 에서는 `os.tmpdir()`(기본)이 맞다. **`docker` 에서는 bind mount 가능한 경로여야
   * 한다** — WSL + Docker Desktop 에서 `/tmp` 은 컨테이너에 **빈 디렉토리로** 마운트된다
   * (실측). 그 환경에서는 `/mnt/<드라이브>/…` 아래를 지정해야 한다.
   */
  codeWorkspaceRoot: string;
}

/** `ARTIFACT_ROOT` 를 **레포 루트 기준**으로 푼다 (API 와 동일 규칙). */
export function resolveArtifactRoot(raw = str("ARTIFACT_ROOT", "./artifacts")): string {
  return isAbsolute(raw) ? resolve(raw) : resolve(REPO_ROOT_DIR, raw);
}

let cached: RunnerConfig | null = null;

export function loadConfig(): RunnerConfig {
  if (cached) return cached;

  const mode = str("RUNNER_EXECUTION_MODE", "local");
  cached = {
    // 여러 Runner 를 띄울 수 있으므로 호스트명 + pid 로 구분한다. health 판정 키가 이 값이다.
    runnerId: str("RUNNER_ID", `${hostname()}-${String(process.pid)}`).slice(0, 60),
    redis: { host: str("REDIS_HOST", "127.0.0.1"), port: int("REDIS_PORT", 6379) },
    concurrency: Math.max(1, int("RUNNER_CONCURRENCY", 2)),
    artifactRoot: resolveArtifactRoot(),
    keepArtifactsOnSuccess: bool("KEEP_ARTIFACTS_ON_SUCCESS", false),
    runTimeoutMs: Math.max(10_000, int("RUNNER_RUN_TIMEOUT_MS", 300_000)),
    headless: bool("RUNNER_HEADLESS", true),
    executionMode: mode === "docker" ? "docker" : "local",
    docker: {
      image: str("RUNNER_DOCKER_IMAGE", "mcr.microsoft.com/playwright:v1.63.0-noble"),
      memory: str("RUNNER_CONTAINER_MEMORY", "2g"),
      cpus: str("RUNNER_CONTAINER_CPUS", "1.5"),
    },
    wsPort: int("RUNNER_WS_PORT", 4100),
    codeCdpPort: Math.max(0, int("RUNNER_CODE_CDP_PORT", 0)),
    // ★ 기본 `docker`. 오타(`Docker`·`DOCKER`)로 격리가 조용히 풀리지 않게 소문자 비교하고,
    //   `local` **정확히** 일치할 때만 격리를 끈다.
    codeExecutionMode: str("RUNNER_CODE_EXECUTION_MODE", "docker").trim().toLowerCase() === "local"
      ? "local"
      : "docker",
    codeDockerImage: str("RUNNER_CODE_DOCKER_IMAGE", "testflow/playwright-code-exec:1.63.0"),
    codeWorkspaceRoot: str("RUNNER_CODE_WORKSPACE_ROOT", ""),
  };
  return cached;
}

/** 테스트에서 환경변수를 바꿔 가며 쓰기 위한 리셋. */
export function resetConfigCache(): void {
  cached = null;
}
