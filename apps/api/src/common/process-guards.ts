import { Logger } from "@nestjs/common";
import { maskSecretsInText } from "@testflow/contracts";
import { maskErrorMessage } from "./utils/mask.js";

/**
 * ★ 프로세스 레벨 예외 핸들러 — "API 가 조용히 죽는다"를 없앤다.
 *
 * ## 왜 필요한가
 * Node 20+ 는 처리되지 않은 Promise rejection 을 **던진다**(`--unhandled-rejections=throw`
 * 가 기본값). 즉 핸들러가 없으면 API 는 스택 한 덩어리만 stderr 에 뱉고 즉사하고,
 * 그 순간 **모든 화면이 멈춘다.** 죽는 것 자체보다 나쁜 것은
 *  ① 무엇 때문에 죽었는지 한 줄로 남지 않는다는 것과
 *  ② 그 스택에 **비밀값이 실려 나갈 수 있다**는 것이다.
 *
 * ## ★ `uncaughtException` 에서 왜 계속 돌지 않고 종료하는가
 * `process.on("uncaughtException")` 으로 잡고 **계속 도는 것이 가장 흔한 실수**다.
 * 그 시점의 프로세스는 **중간에서 끊긴 상태**다 —
 *  - TypeORM 트랜잭션이 커밋도 롤백도 안 된 채 열려 있을 수 있고,
 *  - `res.writeHead()` 까지만 나간 SSE 응답이 남아 있을 수 있으며,
 *  - ioredis 구독 연결이 리스너만 붙은 채 떠 있을 수 있다.
 * 그 상태로 다음 요청을 받으면 **조용한 데이터 오염**이 된다 — 흰 화면보다 훨씬 나쁘다.
 * 반면 종료를 택하면 손실은 "그 순간의 요청들" 하나로 끝나고, 프로세스 관리자
 * (pm2 / systemd `Restart=always` / docker `restart: unless-stopped`)가 깨끗한 프로세스를
 * 다시 띄운다. **복구는 재시작이 하고, 우리가 하는 일은 "왜 죽었는지 남기고 곱게 닫는 것"** 이다.
 *
 * "곱게"가 실제로 하는 일은 `app.close()` 다 — Nest 의 `onApplicationShutdown` 훅이 돌아
 * 열린 SSE 구독(`RunEventsService`)과 회수 타이머(`StaleRunReaper`)가 정리된다.
 * 그마저 매달리면 `timeoutMs` 뒤에 강제 종료한다(닫다가 영원히 안 죽는 프로세스는
 * 관리자가 재시작조차 못 한다).
 *
 * ## 로그에 비밀값을 남기지 않는다
 * 예외 메시지에는 입력값이 그대로 실려 나온다(쿼리 파라미터·드라이버 오류의 SQL 등).
 * ★ **값 기반 마스킹은 여기서 불가능하다** — 어느 run 의 비밀값인지 알 수 없는 지점이라
 * `collectSecretValues()` 가 줄 목록이 언제나 비어 있다(즉 `maskErrorMessage(error)` 만으로는
 * 아무것도 가려지지 않는다. 실측으로 확인했다). 그래서 `maskSecretsInText()` 로
 * **`키=값` 모양**(`password=…` · `"token":"…"` · `Authorization: Bearer …`)을 한 번 더 지운다.
 * 스택은 `Logger.error` 의 두 번째 인자로만 나가고 **사용자 응답에는 절대 싣지 않는다**
 * (Nest 기본 필터가 이미 그렇게 한다 — 실측 결과는 artifact §5 참조).
 */
export type ProcessGuardOptions = {
  /** 종료 전에 돌릴 정리 절차. API 는 `app.close()` 다. */
  shutdown: () => Promise<void>;
  /** 정리가 이 시간 안에 끝나지 않으면 강제 종료한다. */
  timeoutMs?: number;
  /** 테스트 주입용. 기본은 `process.exit`. */
  exit?: (code: number) => void;
  /** 테스트 주입용. 기본은 `Logger("ProcessGuard")`. */
  logger?: Pick<Logger, "error">;
};

/** 정리를 기다리는 상한. SSE 구독 정리·DB 풀 반납은 보통 한 프레임이면 끝난다. */
export const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * `unhandledRejection` · `uncaughtException` 핸들러를 건다.
 *
 * 두 신호를 **같은 경로**로 보낸다 — Node 기본값에서 전자는 후자가 되므로
 * 처리를 갈라 두면 "어느 쪽으로 죽었느냐"에 따라 정리가 달라지는 이상한 상태가 된다.
 *
 * @returns 붙인 핸들러를 떼는 함수(테스트용).
 */
export function installProcessGuards(options: ProcessGuardOptions): () => void {
  const logger = options.logger ?? new Logger("ProcessGuard");
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;

  let dying = false;

  const fatal = (kind: string, error: unknown): void => {
    // 정리 도중 두 번째 예외가 나도 정리를 다시 시작하지 않는다(무한 루프 방지).
    if (dying) return;
    dying = true;

    logger.error(`${kind} — 프로세스를 종료합니다: ${safeMessage(error)}`, safeStack(error));

    const force = setTimeout(() => exit(1), timeoutMs);
    force.unref();

    void options
      .shutdown()
      .catch((closeError: unknown) => {
        logger.error(`종료 정리 실패: ${safeMessage(closeError)}`);
      })
      .finally(() => {
        clearTimeout(force);
        exit(1);
      });
  };

  const onRejection = (reason: unknown): void => {
    fatal("처리되지 않은 Promise rejection", reason);
  };
  const onException = (error: Error): void => {
    fatal("처리되지 않은 예외", error);
  };

  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);

  return () => {
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onException);
  };
}

/** 마스킹 2겹 — 값 기반(여기서는 빈 목록) + 자유 텍스트의 `키=값` 모양. */
function safeMessage(error: unknown): string {
  return maskSecretsInText(maskErrorMessage(error));
}

/**
 * 스택은 있으면 남긴다(로그에만 — 사용자 응답에는 절대 싣지 않는다).
 *
 * ★ **스택에도 마스킹을 건다.** `error.stack` 의 첫 줄은 `Error: <message>` 라서
 *   메시지만 가리고 스택을 날것으로 찍으면 **바로 아래 줄에 같은 비밀값이 그대로 남는다.**
 *   실측으로 잡은 구멍이다 — `password="hunter2"` 가 메시지에서는 가려졌는데 스택에서
 *   그대로 보였다(artifact §5).
 */
function safeStack(error: unknown): string | undefined {
  return error instanceof Error && error.stack !== undefined
    ? maskSecretsInText(error.stack)
    : undefined;
}
