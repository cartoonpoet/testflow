import { describe, expect, it } from "vitest";
import {
  CONTAINER_HOST_ALIAS,
  CONTAINER_PW_CONFIG_MODULE,
  CONTAINER_PW_REPORTER_MODULE,
  CodeContainerUnavailableError,
  buildCodeContainerArgs,
  codeContainerName,
  toDockerMountPath,
} from "./code-container.js";
import { PW_CONFIG_FILENAME } from "./pw-config.js";
import { loadConfig, resetConfigCache } from "../env.js";

/**
 * 코드 실행 격리(게이트 G2)의 **조립 규약**을 고정한다.
 *
 * 실제 컨테이너를 띄우는 부분은 단위 테스트의 대상이 아니다 — 실측은
 * `.pipeline/…/04-gen-4.md` §게이트 G2 에 있다. 여기서 고정하는 것은 **틀리면 조용히
 * 깨지는** 네 가지다:
 *  ① WSL 경로 변환 (틀리면 컨테이너에 **빈 디렉토리**가 마운트되고 `No tests found` 로 나온다)
 *  ② `variables` 가 `-e` 에 **실리지 않는다**(= `docker inspect` 에 평문이 남지 않는다)
 *  ③ `ARTIFACT_ROOT` 를 마운트하지 않는다 · `dist` 는 **읽기 전용**
 *  ④ CDP 중계 포트를 **127.0.0.1 에만** 퍼블리시한다
 */

function config(overrides: Record<string, string> = {}): ReturnType<typeof loadConfig> {
  const saved = { ...process.env };
  try {
    resetConfigCache();
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
    return loadConfig();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
    resetConfigCache();
  }
}

const SPEC = {
  runId: "11111111-2222-3333-4444-555555555555",
  workspaceDir: "/mnt/c/Users/tester/ws/testflow-code-11111111-abc",
  distDir: "/mnt/c/repo/apps/runner/dist",
  configFilename: PW_CONFIG_FILENAME,
  cdpPort: 41111,
  relayPort: 43795,
  env: { TESTFLOW_PW_HEADLESS: "true", TESTFLOW_PW_CDP_PORT: "41111" },
  secretEnv: { TESTFLOW_VAR_password: "PLAINTEXT-SECRET-UNIT-1234" },
} as const;

describe("toDockerMountPath — ★ WSL 경로 변환", () => {
  it("/mnt/c/… 를 C:/… 로 바꾼다", () => {
    expect(toDockerMountPath("/mnt/c/Users/x/ws", "wsl-docker-desktop")).toBe("C:/Users/x/ws");
    expect(toDockerMountPath("/mnt/d/data", "wsl-docker-desktop")).toBe("D:/data");
  });

  it("★ WSL 내부 경로(/tmp)는 **던진다** — 빈 디렉토리를 조용히 마운트하지 않는다", () => {
    // 실측: `docker.exe run -v /tmp/x:/x` 는 빈 디렉토리를 마운트하고 에러도 내지 않는다.
    //       그 결과가 `No tests found` 라서 원인을 찾기가 아주 어렵다.
    expect(() => toDockerMountPath("/tmp/testflow-code-abc", "wsl-docker-desktop")).toThrow(
      CodeContainerUnavailableError,
    );
    expect(() => toDockerMountPath("/home/me/ws", "wsl-docker-desktop")).toThrow(/마운트할 수 없습니다/u);
  });

  it("리눅스 네이티브 docker 에서는 경로를 그대로 쓴다", () => {
    expect(toDockerMountPath("/tmp/testflow-code-abc", "native")).toBe("/tmp/testflow-code-abc");
    expect(toDockerMountPath("/var/lib/x", "native")).toBe("/var/lib/x");
  });

  it("상대 경로는 던진다", () => {
    expect(() => toDockerMountPath("relative/path", "native")).toThrow(CodeContainerUnavailableError);
  });
});

describe("buildCodeContainerArgs", () => {
  const args = buildCodeContainerArgs(config(), SPEC, "wsl-docker-desktop");
  const joined = args.join(" ");

  it("★★ `variables` 평문이 인자에 **하나도** 없다 (= docker inspect 에 안 남는다)", () => {
    expect(joined).not.toContain("PLAINTEXT-SECRET-UNIT-1234");
    expect(joined).not.toContain("TESTFLOW_VAR_password");
    // 비밀이 아닌 env 는 `-e` 로 간다.
    expect(joined).toContain("TESTFLOW_PW_HEADLESS=true");
  });

  it("★ stdin 을 열어 둔다(`-i`) — 변수 전달 통로다", () => {
    expect(args).toContain("-i");
  });

  it("★ ARTIFACT_ROOT 를 마운트하지 않고 dist 는 읽기 전용이다", () => {
    const mounts = args.filter((a, i) => args[i - 1] === "-v");
    expect(mounts).toEqual(["C:/Users/tester/ws/testflow-code-11111111-abc:/ws", "C:/repo/apps/runner/dist:/tfdist:ro"]);
    expect(mounts.some((m) => /artifact/iu.test(m))).toBe(false);
    expect(mounts.some((m) => m.endsWith(":ro"))).toBe(true);
  });

  it("★ CDP 중계 포트를 127.0.0.1 에만 퍼블리시한다(인증 없는 DevTools)", () => {
    const published = args[args.indexOf("-p") + 1];
    expect(published).toBe("127.0.0.1:43795:43795");
    // 호스트 포트 == 컨테이너 포트여야 한다 — `/json/version` 의 webSocketDebuggerUrl 이
    // Host 헤더를 echo 하므로 두 값이 다르면 WS 주소가 어긋난다.
    const [, hostPort, containerPort] = (published ?? "").split(":");
    expect(hostPort).toBe(containerPort);
  });

  it("relayPort 가 0 이면 포트를 열지 않는다(라이브 없이 격리만)", () => {
    const noLive = buildCodeContainerArgs(config(), { ...SPEC, relayPort: 0 }, "wsl-docker-desktop");
    expect(noLive).not.toContain("-p");
  });

  it("자원 상한·--rm·--init 이 붙는다", () => {
    expect(joined).toContain("--memory=2g");
    expect(joined).toContain("--cpus=1.5");
    expect(args).toContain("--rm");
    expect(args).toContain("--init");
  });

  it("host.docker.internal 을 보장한다(리눅스 네이티브 docker 에서도)", () => {
    expect(joined).toContain("--add-host=host.docker.internal:host-gateway");
    expect(CONTAINER_HOST_ALIAS).toBe("host.docker.internal");
  });

  it("★ 부트스트랩을 거쳐 CLI 를 부른다 — 중계와 stdin 변수가 그 안에 있다", () => {
    const tail = args.slice(args.indexOf("node"));
    expect(tail).toEqual([
      "node",
      "/tfdist/execute/pw-container-boot.js",
      "43795",
      "41111",
      "--",
      "node",
      "/node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      `/ws/${PW_CONFIG_FILENAME}`,
    ]);
  });

  it("컨테이너 안 모듈 경로가 마운트 지점과 짝이 맞는다", () => {
    expect(CONTAINER_PW_CONFIG_MODULE).toBe("/tfdist/execute/pw-config.js");
    expect(CONTAINER_PW_REPORTER_MODULE).toBe("/tfdist/execute/pw-reporter.js");
  });

  it("컨테이너 이름에 runId 앞 8자가 들어간다(docker ps 에서 바로 보인다)", () => {
    expect(codeContainerName(SPEC.runId)).toContain("11111111");
    expect(codeContainerName(SPEC.runId).startsWith("testflow-code-")).toBe(true);
  });
});

describe("env — ★ 코드 실행 격리 기본값", () => {
  it("기본값이 docker 다 (사용자 임의 코드를 실행하기 때문)", () => {
    expect(config().codeExecutionMode).toBe("docker");
  });

  it("`local` 은 정확히 그 문자열일 때만 적용된다(오타로 격리가 풀리지 않는다)", () => {
    expect(config({ RUNNER_CODE_EXECUTION_MODE: "local" }).codeExecutionMode).toBe("local");
    expect(config({ RUNNER_CODE_EXECUTION_MODE: "LOCAL" }).codeExecutionMode).toBe("local");
    expect(config({ RUNNER_CODE_EXECUTION_MODE: " local " }).codeExecutionMode).toBe("local");
    // 오타·빈 값·알 수 없는 값은 **격리 쪽**으로 붙는다(안전한 방향).
    expect(config({ RUNNER_CODE_EXECUTION_MODE: "locall" }).codeExecutionMode).toBe("docker");
    expect(config({ RUNNER_CODE_EXECUTION_MODE: "lokal" }).codeExecutionMode).toBe("docker");
    expect(config({ RUNNER_CODE_EXECUTION_MODE: "" }).codeExecutionMode).toBe("docker");
  });

  it("★ 녹화·기존 steps 실행의 격리 기본값은 바뀌지 않았다(라운드 1: local)", () => {
    expect(config().executionMode).toBe("local");
    // 두 설정이 서로 간섭하지 않는다.
    expect(config({ RUNNER_EXECUTION_MODE: "docker" }).codeExecutionMode).toBe("docker");
    expect(config({ RUNNER_CODE_EXECUTION_MODE: "local" }).executionMode).toBe("local");
  });

  it("작업공간 루트는 기본이 비어 있다(= os.tmpdir())", () => {
    expect(config().codeWorkspaceRoot).toBe("");
    expect(config({ RUNNER_CODE_WORKSPACE_ROOT: "/mnt/c/ws" }).codeWorkspaceRoot).toBe("/mnt/c/ws");
  });
});
