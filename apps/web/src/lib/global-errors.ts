/**
 * ★ 렌더 **바깥**에서 터진 예외를 사용자에게 알린다.
 *
 * ## 왜 ErrorBoundary 만으로는 부족한가 — 경계가 여기서 갈린다
 * React 의 ErrorBoundary 는 **렌더·라이프사이클·`useEffect` 본문에서 던져진 예외만** 잡는다.
 * 다음 셋은 **절대 잡히지 않는다.**
 *   ① 이벤트 핸들러 (`onClick` 안에서 던진 예외)
 *   ② 타이머·콜백 (`setTimeout`, `requestAnimationFrame`, `EventSource.onmessage`)
 *   ③ await 되지 않은 Promise (`unhandledrejection`)
 * 이 셋은 예전에는 **아무 흔적 없이 삼켜졌다** — 버튼을 눌렀는데 아무 일도 안 일어나고
 * 콘솔에만 빨간 줄이 남는 상태다. 그래서 `window` 리스너가 따로 필요하다.
 *
 * ## 무엇을 보여 주나 — 토스트 1건, 스택 없음
 * 이 예외들은 **화면이 깨진 것이 아니라 동작 하나가 실패한 것**이다. 화면을 통째로
 * 대체하면(= ErrorBoundary 처럼) 멀쩡히 보이던 데이터까지 날린다. 그래서 토스트로만 알린다.
 * 원문 메시지는 영어 스택 문자열이라 사용자에게 의미가 없다 — **콘솔에만** 남기고
 * 화면에는 한국어 한 줄을 띄운다.
 *
 * ## react-query 에러와의 경계 (중복 금지)
 * 쿼리 실패(`ApiError`)는 **화면별로 이미 `StateView` + 재시도로** 그린다. 그 경로는
 * rejection 이 react-query 안에서 처리되므로 `unhandledrejection` 이 되지 않는다 —
 * 즉 여기로 오지 않는다. 여기로 오는 것은 **아무도 처리하지 않은** 실패뿐이다.
 * (mutation 의 `mutateAsync` 를 `catch` 없이 부르면 여기로 온다. 그건 호출부의 버그이고,
 *  토스트로 드러나는 편이 조용히 삼켜지는 것보다 낫다.)
 */
import { toast } from "@/hooks/useToast";

/** 사용자에게 보여 줄 한 줄. 원문(영어 스택)은 콘솔로 보낸다. */
export const UNEXPECTED_ERROR_MESSAGE =
  "처리 중 예상치 못한 오류가 발생했습니다. 다시 시도해 주세요.";

/** 같은 오류가 짧은 간격으로 반복될 때 토스트를 한 번만 띄우는 창. */
export const DEDUPE_WINDOW_MS = 4000;

type Clock = () => number;

/**
 * ErrorBoundary 가 이미 처리한 오류는 여기서 다시 알리지 않는다.
 *
 * React 는 개발 모드에서 **경계가 잡은 예외를 `window` 로 한 번 더** 흘린다
 * (`reportError`). 표시를 안 하면 같은 사고가 "화면 대체 + 토스트" 로 두 번 보인다.
 */
const handled = new Map<string, number>();

function sweep(now: number): void {
  for (const [key, at] of handled) {
    if (now - at > DEDUPE_WINDOW_MS) handled.delete(key);
  }
}

/** ErrorBoundary 가 부른다. 같은 메시지가 `window` 로 다시 오면 무시된다. */
export function markErrorHandled(message: string, now: Clock = Date.now): void {
  const at = now();
  sweep(at);
  handled.set(message, at);
}

/**
 * 이 오류를 사용자에게 알려야 하는가. **순수 함수** — 테스트가 이것만 본다.
 *
 * `false` 인 경우:
 *  - 최근에 ErrorBoundary 가 처리한 같은 메시지 (중복)
 *  - 최근에 같은 메시지로 이미 토스트를 띄웠다 (폭주 방지 — 예: 매 프레임 던지는 타이머)
 */
export function shouldReport(message: string, now: Clock = Date.now): boolean {
  const at = now();
  sweep(at);
  const last = handled.get(message);
  if (last !== undefined && at - last <= DEDUPE_WINDOW_MS) return false;
  handled.set(message, at);
  return true;
}

/** 테스트 사이의 격리를 위해 상태를 비운다. */
export function resetErrorReporting(): void {
  handled.clear();
}

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return String(reason);
}

function report(kind: string, reason: unknown): void {
  const message = messageOf(reason);
  if (!shouldReport(`${kind}:${message}`)) return;
  console.error(`[${kind}]`, reason);
  toast(UNEXPECTED_ERROR_MESSAGE, { label: "오류", tone: "danger" });
}

/**
 * 리스너를 붙일 대상. `window` 가 이 모양을 만족한다.
 *
 * `Window` 로 못 박지 않는 이유는 **테스트가 DOM 없이 돌기 때문**이다
 * (`apps/web` 의 vitest 는 기본 `node` 환경이다 — jsdom 을 새로 들이지 않는다).
 */
export interface GlobalErrorTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/**
 * 전역 리스너를 건다. `main.tsx` 가 **React 를 렌더하기 전에** 한 번 부른다
 * (렌더 자체가 던지는 예외도 콘솔에 남아야 한다).
 *
 * @returns 리스너를 떼는 함수(테스트용).
 */
export function installGlobalErrorHandlers(
  target: GlobalErrorTarget = window,
): () => void {
  const onError: EventListener = (event: Event): void => {
    const { error } = event as ErrorEvent;
    /*
     * ★ 리소스 로드 실패(`<img>`·`<script>`)도 이 이벤트로 온다. 그때는 `error` 가 없다.
     *   그것까지 토스트로 띄우면 "이미지 하나 깨졌는데 오류 팝업"이 된다 — 거른다.
     */
    if (error === null || error === undefined) return;
    report("uncaught", error);
  };
  const onRejection: EventListener = (event: Event): void => {
    report("unhandledrejection", (event as PromiseRejectionEvent).reason);
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
