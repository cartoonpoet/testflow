/**
 * 컨테이너 안에서 `playwright test` 를 띄우는 부트스트랩 (03-phases Task 4.5 — ★ 게이트 G2).
 *
 * ## ★★ 이 파일은 컨테이너 안에서 돈다 — 의존성 0
 * `pw-reporter.ts` 와 **같은 제약**이다: `@testflow/contracts` · `ioredis` · `typeorm` 금지.
 * Node 내장 모듈만 쓴다. 컨테이너에는 우리 `dist` 만 읽기 전용으로 마운트되고
 * `node_modules` 는 이미지가 제공한다 — 여기서 뭔가를 import 하면 그 자리에서 죽는다.
 *
 * ## 왜 이 부트스트랩이 필요한가 — 실측으로 확정된 두 가지 (04-gen-4 §G2)
 *
 * ### ① CDP 중계 — Chromium DevTools 는 **루프백 peer 만** 받는다
 * `--remote-debugging-address=0.0.0.0` 으로 bind 해도 docker 포트 프록시를 통해 들어온
 * 연결을 **reset 한다**(실측: 호스트에서 `Recv failure: Connection reset by peer`,
 * `connectOverCDP: socket hang up`. `Host:` 헤더를 localhost·컨테이너IP 로 바꿔도 동일).
 * 인증이 없는 프로토콜이라 Chromium 이 의도적으로 막는 것이다.
 *
 * → 그래서 컨테이너 **안에서** `0.0.0.0:<relayPort>` → `127.0.0.1:<cdpPort>` 로 TCP 를 중계한다.
 *   Chromium 이 보는 peer 는 항상 루프백이다. 실측: `connectOverCDP` 성공(+1.95초),
 *   screencast 580프레임/12.8MB 수신.
 *
 * ★ 이 덕에 **`pw-config.ts` 의 `--remote-debugging-address=127.0.0.1` 을 고치지 않아도 된다.**
 *   0.0.0.0 으로 바꾸는 쪽이 간단해 보이지만 그건 ⓐ 동작하지 않고 ⓑ 컨테이너 네트워크의
 *   다른 컨테이너에게 인증 없는 DevTools 를 열어 주는 짓이다.
 *
 * ### ② `variables` 를 **stdin** 으로 받는다 — `docker inspect` 에 평문을 남기지 않는다
 * `-e TESTFLOW_VAR_password=…` 로 넘기면 `docker inspect` **전문에 평문이 그대로 나온다**
 * (실측 확인). `--env-file` 도 같다(Docker 가 읽어 `Config.Env` 에 넣는다).
 * 그래서 변수는 **stdin 한 줄(JSON)** 로만 들어오고, 이 프로세스가 자식 환경에만 심는다.
 * 실측: 같은 실행에서 `docker inspect` 전문 grep **0건**, 사용자 코드의
 * `process.env["TESTFLOW_VAR_password"]` 는 **정상 동작**(계약 유지).
 *
 * 남는 노출: **컨테이너 안** `/proc/<pid>/environ`. 사용자 코드가 `process.env` 로 읽는다는
 * 계약을 지키는 한 피할 수 없다. 호스트에서는 보이지 않는다 — 그것이 격리 경계다.
 *
 * ## 인자
 * ```
 * node /tfdist/execute/pw-container-boot.js <relayPort> <cdpPort> -- <command> [args…]
 * ```
 */
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";

const argv = process.argv.slice(2);
const relayPort = Number(argv[0]);
const cdpPort = Number(argv[1]);
const separator = argv.indexOf("--");
const command = separator === -1 ? [] : argv.slice(separator + 1);

function fail(message: string): never {
  process.stderr.write(`[tf-boot] ${message}\n`);
  process.exit(90);
}

if (!Number.isFinite(relayPort) || !Number.isFinite(cdpPort)) fail("relayPort/cdpPort 인자가 없다");
if (command.length === 0) fail("실행할 명령이 없다 (`--` 뒤에 넣어라)");

/* ── ① CDP 중계 ─────────────────────────────────────────────
 * 실패해도 **테스트는 계속돼야 한다**(라이브는 관찰 수단이다). 그래서 던지지 않는다. */
if (relayPort > 0 && cdpPort > 0) {
  const relay = createServer((downstream) => {
    const upstream = connect(cdpPort, "127.0.0.1");
    downstream.pipe(upstream);
    upstream.pipe(downstream);
    downstream.on("error", () => upstream.destroy());
    upstream.on("error", () => downstream.destroy());
  });
  relay.on("error", (error: Error) => {
    process.stderr.write(`[tf-boot] CDP 중계 실패(실행은 계속한다): ${error.message}\n`);
  });
  relay.listen(relayPort, "0.0.0.0");
  relay.unref();
}

/* ── ② stdin 으로 변수 수신 → 자식 환경에만 심는다 ───────────
 * 호스트가 **반드시 stdin 을 닫는다**(변수가 없으면 빈 줄). 닫지 않으면 여기서 영영 기다린다. */
let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffered += chunk;
});
process.stdin.on("end", () => {
  let variables: Record<string, string> = {};
  try {
    const trimmed = buffered.trim();
    if (trimmed !== "") {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        variables = parsed as Record<string, string>;
      }
    }
  } catch {
    // 깨진 JSON 을 조용히 넘기지 않는다 — 변수 없이 돌면 사용자 코드가 빈 값을 채워
    // "왜 로그인이 안 되지" 로 몇 시간을 태운다.
    process.stderr.write("[tf-boot] stdin 변수 JSON 파싱 실패 — 변수 없이 실행한다\n");
  }

  const child = spawn(command[0] ?? "", command.slice(1), {
    // ★ 자식 stdin 은 닫는다. 사용자 테스트가 stdin 을 기다려 멈추는 일을 막는다.
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...variables },
  });
  child.on("error", (error: Error) => {
    process.stderr.write(`[tf-boot] 테스트 프로세스 기동 실패: ${error.message}\n`);
    process.exit(91);
  });
  // ★ 자식의 종료 코드를 **그대로** 물려준다. 삼키면 Runner 가 status 를 잘못 확정한다.
  child.on("close", (code, signal) => {
    process.exit(code === null ? (signal === null ? 1 : 0) : code);
  });
  // 컨테이너에 오는 SIGTERM(= `docker stop`/`docker kill -s TERM`)을 자식에게 넘긴다.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
});
