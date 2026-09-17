import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import type { BrowserContext } from "playwright";
import { DEFAULT_VIEWPORT } from "@testflow/contracts";
import { startRunContainer } from "./container.js";
import type { RunContainer } from "./container.js";
import type { RunnerConfig } from "../env.js";

/**
 * ★ 실행 격리 모드 선택 — 기본은 `local` 이다.
 *
 * | 모드 | 무엇이 격리되나 | 언제 쓰나 |
 * |---|---|---|
 * | `local` (기본) | **고유 임시 프로필**(쿠키/스토리지/캐시) + 동시성 상한 + 하드 타임아웃 | 개발 머신, 단일 서버 |
 * | `docker` | 위 + **컨테이너 1개/실행 + `--memory`/`--cpus` 커널 수준 제한** | 운영 |
 *
 * ## 왜 `local` 이 기본인가 (실측 근거)
 * 이 개발 머신은 **WSL2 + Docker Desktop** 이다. 컨테이너 경로가 성립하려면
 * `mcr.microsoft.com/playwright:v1.63.0-noble`(**3.55GB**)이 로컬에 있어야 하고,
 * 그 이미지에는 브라우저 바이너리만 있고 `playwright` npm 패키지가 없어
 * `run-server` 를 띄우려면 컨테이너 기동 시 npm 설치가 한 번 더 일어난다
 * (그래서 `Dockerfile.exec` 로 미리 넣은 파생 이미지를 쓴다).
 * **CI·개발 머신에서 3.5GB 이미지를 전제로 두면 아무도 못 돌린다.**
 * 그래서 기본은 `local`, 운영 전환은 `RUNNER_EXECUTION_MODE=docker` 한 줄이다.
 *
 * ## `local` 모드의 격리 수단 (추측이 아니라 코드로 보장하는 것)
 * 1. `launchPersistentContext(<고유 임시 디렉토리>)` — 실행마다 **새 브라우저 프로세스 +
 *    새 프로필**. 앞 실행의 로그인 쿠키가 다음 실행에 새지 않는다.
 * 2. 동시성 상한 — BullMQ Worker 의 `concurrency: RUNNER_CONCURRENCY`.
 * 3. 하드 타임아웃 — `RUNNER_RUN_TIMEOUT_MS`(기본 300초). 넘기면 `timeout` 으로 확정.
 *
 * `local` 이 못 막는 것은 **메모리·CPU 폭주뿐**이다. 그 한 가지가 필요할 때 `docker` 를 켠다.
 */

export interface BrowserSession {
  context: BrowserContext;
  /** 진단·아티팩트 주석용. */
  mode: "local" | "docker";
  containerId: string | null;
  /** 하드 타임아웃 시 즉시 끊는다. */
  kill(): Promise<void>;
  /** 정상 정리. `context.close()` 를 포함한다(영상이 여기서 확정된다). */
  dispose(): Promise<void>;
}

export interface BrowserSessionOptions {
  runId: string;
  config: RunnerConfig;
  headless: boolean;
  /** 영상 저장 디렉토리(없으면 녹화하지 않는다). */
  videoDir: string;
}

const VIEWPORT = { width: DEFAULT_VIEWPORT.w, height: DEFAULT_VIEWPORT.h };

/** `--no-sandbox` 는 컨테이너/WSL 에서 chromium 이 뜨기 위한 사실상 필수 인자다. */
const CHROMIUM_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"];

export async function openBrowserSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  return options.config.executionMode === "docker"
    ? openDockerSession(options)
    : openLocalSession(options);
}

/** 고유 임시 프로필 + 새 브라우저 프로세스. */
async function openLocalSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  const profileDir = await mkdtemp(join(tmpdir(), `testflow-profile-${options.runId.slice(0, 8)}-`));
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: options.headless,
    viewport: VIEWPORT,
    recordVideo: { dir: options.videoDir, size: VIEWPORT },
    args: CHROMIUM_ARGS,
  });

  const cleanup = async (): Promise<void> => {
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  };

  return {
    context,
    mode: "local",
    containerId: null,
    kill: async () => {
      await context.close().catch(() => undefined);
      await cleanup();
    },
    dispose: async () => {
      await context.close().catch(() => undefined);
      await cleanup();
    },
  };
}

/**
 * 실행 1건 = 컨테이너 1개. 브라우저만 컨테이너 안에 있고 **인터프리터와 비밀번호는
 * 호스트에 남는다** — 사유는 `container.ts` 상단 표 참조.
 *
 * `connect()` 로 붙은 브라우저의 video·trace 는 Playwright 가 프로토콜로 **호스트로
 * 전송**해 준다. 그래서 `ARTIFACT_ROOT` 를 컨테이너에 마운트할 필요가 없다
 * (= 증적 디렉토리가 컨테이너에 노출되지 않는다).
 */
async function openDockerSession(options: BrowserSessionOptions): Promise<BrowserSession> {
  let container: RunContainer | null = null;
  try {
    container = await startRunContainer(options.config, options.runId);
    // ★ 재시도 — 컨테이너 로그가 "Listening" 을 찍은 직후에도 첫 핸드셰이크가
    //   ECONNRESET 으로 튕기는 순간이 있다(Docker Desktop 포트 프록시). 실측으로 확인했다.
    const browser = await connectWithRetry(container.wsEndpoint, 5);
    // connect 경로에는 launchPersistentContext 가 없다. 컨테이너 자체가 1회용이라
    // newContext() 만으로 이미 "새 프로필"과 같다.
    const context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: options.videoDir, size: VIEWPORT },
    });

    const handle = container;
    return {
      context,
      mode: "docker",
      containerId: handle.containerId,
      kill: async () => {
        await handle.kill();
      },
      dispose: async () => {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
        await handle.stop();
      },
    };
  } catch (error) {
    if (container) await container.kill();
    throw error;
  }
}

async function connectWithRetry(
  wsEndpoint: string,
  attempts: number,
): Promise<import("playwright").Browser> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await chromium.connect(wsEndpoint, { timeout: 30_000 });
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
