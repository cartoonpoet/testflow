import { spawn } from "node:child_process";
import { Socket, createServer } from "node:net";
import type { RunnerConfig } from "../env.js";

/**
 * 실행 격리 — **실행 1회당 컨테이너 1개** (03-phases Task 6.6 / ★ 사용자 최종 결정 (d)).
 *
 * ## ★ 무엇을 컨테이너에 넣었나 — "실행 전체"가 아니라 "브라우저"다
 * 계획서 초안은 인터프리터째 컨테이너에 넣고 `variables` 를 **stdin JSON** 으로 흘리는
 * 방식이었다(`docker inspect`·프로세스 목록에 비밀번호가 안 남게 하려는 목적).
 * 실제로 만들어 보니 **브라우저만 컨테이너에 넣는 쪽이 같은 목적을 더 강하게 달성**한다.
 *
 * | | 인터프리터를 컨테이너에 (초안) | 브라우저만 컨테이너에 (채택) |
 * |---|---|---|
 * | 비밀번호가 컨테이너에 들어가나 | **들어간다** (stdin 으로 전달) | **아예 안 들어간다** — 호스트 프로세스 메모리에만 존재 |
 * | `docker inspect` 노출 | 없음(stdin 이므로) | 없음 |
 * | DB 자격증명 | 컨테이너에 있어야 함 | **컨테이너에 없다** |
 * | 이미지 | 레포 코드를 통째로 빌드 | 공식 이미지 + `playwright` 한 줄 |
 * | 자원 제한 대상 | 전체 | **실제로 메모리를 먹는 것(브라우저)** |
 *
 * 메모리·CPU 를 폭주시키는 주체는 언제나 브라우저다. 제한을 거는 대상이 정확히 그것이고,
 * 비밀번호·DB 자격증명은 격리 경계 **바깥**에 남는다. 초안의 stdin 규약을 따르지 않은
 * 이유가 이것이다 — 목적(비밀 노출 차단)은 더 잘 만족한다.
 *
 * ## 기본값은 `local` 이다
 * `RUNNER_EXECUTION_MODE=docker` 로 명시해야 이 경로를 쓴다. 사유는
 * `browser.ts` 상단의 "실행 격리 모드 선택" 주석에 실측 근거와 함께 적어 두었다.
 */

export interface RunContainer {
  containerId: string;
  /** `chromium.connect()` 에 넘길 주소. */
  wsEndpoint: string;
  /** 정상 종료. `--rm` 이라 컨테이너는 자동 제거된다. */
  stop(): Promise<void>;
  /** 하드 타임아웃 시 강제 종료. */
  kill(): Promise<void>;
}

export class DockerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerUnavailableError";
  }
}

/**
 * docker 실행 파일 이름.
 *
 * ★ 이 개발 머신은 **WSL + Docker Desktop** 이라 리눅스 쪽 `docker` 가 없고
 *   Windows 바이너리 `docker.exe` 가 PATH 에 잡힌다. 둘 다 시도한다.
 */
const DOCKER_BINS = [process.env["RUNNER_DOCKER_BIN"], "docker", "docker.exe"].filter(
  (value): value is string => value !== undefined && value !== "",
);

let resolvedBin: string | null = null;

export async function resolveDockerBin(): Promise<string> {
  if (resolvedBin !== null) return resolvedBin;
  for (const bin of DOCKER_BINS) {
    const probe = await exec(bin, ["version", "--format", "{{.Server.Version}}"]).catch(() => null);
    if (probe !== null && probe.code === 0) {
      resolvedBin = bin;
      return bin;
    }
  }
  throw new DockerUnavailableError(
    `docker 를 찾지 못했습니다(시도: ${DOCKER_BINS.join(", ")}). ` +
      `RUNNER_EXECUTION_MODE=local 로 두거나 RUNNER_DOCKER_BIN 을 지정하세요.`,
  );
}

export async function isDockerAvailable(): Promise<boolean> {
  return resolveDockerBin().then(
    () => true,
    () => false,
  );
}

/** 이미지가 로컬에 있는지. 없으면 pull 이 필요하다(수 GB — 실행 중에 하지 않는다). */
export async function hasImage(image: string): Promise<boolean> {
  const bin = await resolveDockerBin();
  const result = await exec(bin, ["image", "inspect", image]).catch(() => null);
  return result !== null && result.code === 0;
}

/**
 * 실행 1건용 브라우저 컨테이너를 띄운다.
 *
 * - `--rm` : 종료 즉시 제거 (`docker ps -a` 에 남지 않는다)
 * - `--memory` / `--cpus` : 자원 상한
 * - `-p 127.0.0.1:<빈포트>:3000` : **루프백에만 바인딩**한다. 브라우저 서버는 인증이 없어서
 *   0.0.0.0 에 열면 같은 네트워크의 누구나 임의 페이지를 열 수 있다.
 * - `--init` : 좀비 프로세스 수거(브라우저는 자식 프로세스를 많이 만든다)
 */
export async function startRunContainer(
  config: RunnerConfig,
  runId: string,
): Promise<RunContainer> {
  const bin = await resolveDockerBin();
  if (!(await hasImage(config.docker.image))) {
    throw new DockerUnavailableError(
      `이미지가 없습니다: ${config.docker.image}. 먼저 \`docker pull ${config.docker.image}\` 를 실행하세요.`,
    );
  }

  const port = await findFreePort();
  const name = `testflow-run-${runId.slice(0, 8)}-${String(port)}`;
  const args = [
    "run",
    "-d",
    "--rm",
    "--init",
    "--name",
    name,
    `--memory=${config.docker.memory}`,
    `--cpus=${config.docker.cpus}`,
    "-p",
    `127.0.0.1:${String(port)}:3000`,
    config.docker.image,
    "npx",
    "playwright@1.63.0",
    "run-server",
    "--port",
    "3000",
    "--host",
    "0.0.0.0",
  ];

  const started = await exec(bin, args);
  if (started.code !== 0) {
    throw new DockerUnavailableError(`컨테이너 기동 실패: ${started.stderr.trim() || started.stdout.trim()}`);
  }
  const containerId = started.stdout.trim().slice(0, 64);

  const stop = async (): Promise<void> => {
    await exec(bin, ["stop", "-t", "3", containerId]).catch(() => undefined);
  };
  const kill = async (): Promise<void> => {
    await exec(bin, ["kill", containerId]).catch(() => undefined);
  };

  try {
    await waitForServerReady(bin, containerId, port, 60_000);
  } catch (error) {
    const logs = await exec(bin, ["logs", "--tail", "40", containerId]).catch(() => null);
    await kill();
    throw new DockerUnavailableError(
      `브라우저 서버가 뜨지 않았습니다(${String(error)}). 컨테이너 로그: ${
        logs === null ? "(읽기 실패)" : `${logs.stdout}${logs.stderr}`.trim().slice(0, 2000)
      }`,
    );
  }

  return { containerId, wsEndpoint: `ws://127.0.0.1:${String(port)}/`, stop, kill };
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

/** OS 가 비어 있다고 알려 준 포트를 그대로 쓴다(직접 스캔하면 경합이 난다). */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        if (port === 0) reject(new Error("빈 포트를 찾지 못했습니다."));
        else resolve(port);
      });
    });
  });
}

/**
 * ★ 브라우저 서버 준비 대기 — **TCP 포트 확인만으로는 부족하다(실측 확인).**
 *
 * WSL + Docker Desktop 에서 `-p` 로 퍼블리시한 호스트 포트는 **컨테이너 안의 프로세스가
 * 아직 bind 하기 전부터 연결을 받아 준다**(Docker 의 포트 프록시가 먼저 listen 한다).
 * 그래서 포트만 보고 `chromium.connect()` 를 하면 WS 핸드셰이크에서
 * `WebSocket error: read ECONNRESET` 로 죽는다 — 실제로 이 증상을 겪고 고친 코드다.
 *
 * 그래서 두 가지를 함께 본다:
 *   1. 컨테이너 로그에 `Listening on ws://…` 가 찍혔는가 (= 실제로 bind 했다)
 *   2. 포트가 열렸는가 (= 호스트에서 닿는다)
 */
async function waitForServerReady(
  bin: string,
  containerId: string,
  port: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const logs = await exec(bin, ["logs", containerId], 10_000).catch(() => null);
    const output = logs === null ? "" : `${logs.stdout}${logs.stderr}`;
    if (output.includes("Listening on ws://")) {
      await waitForPort(port, Math.max(1000, deadline - Date.now()));
      return;
    }
    // 컨테이너가 이미 죽었으면 더 기다릴 이유가 없다.
    const alive = await exec(bin, ["inspect", "-f", "{{.State.Running}}", containerId], 10_000).catch(
      () => null,
    );
    if (alive !== null && alive.stdout.trim() === "false") {
      throw new Error(`컨테이너가 기동 직후 종료되었습니다: ${output.trim().slice(0, 500)}`);
    }
    if (Date.now() >= deadline) throw new Error("브라우저 서버 로그 대기 타임아웃");
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const open = await new Promise<boolean>((resolve) => {
      const client = new Socket();
      client.setTimeout(1000);
      client.once("connect", () => {
        client.destroy();
        resolve(true);
      });
      client.once("timeout", () => {
        client.destroy();
        resolve(false);
      });
      client.once("error", () => {
        client.destroy();
        resolve(false);
      });
      client.connect(port, "127.0.0.1");
    });
    if (open) return;
    if (Date.now() >= deadline) throw new Error(`포트 ${String(port)} 대기 타임아웃`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
