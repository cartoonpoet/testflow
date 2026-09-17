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
  };
  return cached;
}

/** 테스트에서 환경변수를 바꿔 가며 쓰기 위한 리셋. */
export function resetConfigCache(): void {
  cached = null;
}
