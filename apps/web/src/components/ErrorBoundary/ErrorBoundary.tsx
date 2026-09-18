import { Component } from "react";
import type * as React from "react";
import { markErrorHandled } from "@/lib/global-errors";
import { ErrorFallback } from "./ErrorFallback";

/**
 * ★ 흰 화면을 없애는 경계.
 *
 * ## 경계가 **세 겹**인 이유 (실측으로 확정했다)
 * 처음에는 "루트 1개 + 라우트마다 1개" 두 겹으로 설계했다. 그런데 셸(`AppShellRoute`)이
 * 던지는 경우를 실제로 만들어 보니 **루트 경계까지 오지 않았다** —
 * `react-router` 가 자기 **기본 errorElement** 로 먼저 잡아
 * `Unexpected Application Error!` + **스택 트레이스 전문**을 영어로 뿌렸다
 * (`/?boomroot=1` 실측 — 그 화면의 본문 원문은 artifact §3 에 옮겨 두었다). 흰 화면은 아니지만 **사용자에게 스택을
 * 보여 주지 않는다**는 요구를 정면으로 깬다.
 * → 그래서 라우터에게 우리 것을 쥐여 주는 `RouteErrorElement` 를 한 겹 더 뒀다.
 *
 * | 겹 | 어디 | 무엇을 잡나 | 화면 |
 * |---|---|---|---|
 * | ① 라우트 경계 (이 클래스) | `routes.tsx` `withSuspense` | 각 화면의 렌더 예외 · 청크 로드 실패 | 셸 유지, **본문만** 교체 |
 * | ② `RouteErrorElement` | 루트 라우트의 `errorElement` | 셸(`AppShellRoute`) 렌더 예외 | 화면 전체 |
 * | ③ 루트 경계 (이 클래스) | `App.tsx`, `RouterProvider` 바깥 | `QueryClientProvider`·라우터 생성 자체의 실패 | 화면 전체 |
 *
 * ## 왜 `errorElement` **하나로** 통일하지 않는가
 * `errorElement` 는 벗어날 방법이 **다른 경로로의 내비게이션뿐**이다 — 같은 경로로 다시
 * 가도 리셋되지 않아 "다시 시도" 한 번으로 그 자리에서 복구하는 동작을 만들 수 없다.
 * 화면 하나가 깨졌을 때 가장 흔한 회복은 "다시 시도"이므로 ①은 클래스 경계로 둔다.
 * ②는 화면을 통째로 다시 받는 것이 정답인 자리라 그 제약이 문제가 되지 않는다.
 *
 * ## react-query 에러와의 경계 (중복 금지)
 * **쿼리 실패는 여기로 오지 않는다.** `createQueryClient()` 는 `throwOnError` 를 켜지 않으므로
 * 실패가 `error` 상태로 내려오고, 각 화면이 `StateView` + `refetch` 로 그린다
 * (그 경로가 더 낫다 — 화면이 유지되고 재시도가 그 쿼리만 다시 돈다).
 * **그 동작을 이 경계로 대체하지 않는다.** 여기가 맡는 것은 "쿼리는 성공했는데 렌더가
 * 터진" 경우다. 이벤트 핸들러·타이머·Promise 안의 예외는 또 다른 경로다 —
 * `lib/global-errors.ts` 참조.
 */
export type ErrorBoundaryProps = {
  children: React.ReactNode;
  /** `root` 는 라우터 바깥(화면 전체 대체), `route` 는 셸 안쪽(본문만 대체). */
  variant?: "root" | "route";
  /**
   * 이 값이 바뀌면 경계가 스스로 풀린다. 라우트 경계는 `location.key` 를 넘긴다 —
   * **다른 화면으로 가면 에러 상태가 남아 있으면 안 된다.**
   */
  resetKey?: string;
};

type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 운영에서도 콘솔에는 남긴다 — 사용자가 개발자도구를 열어 스크린샷을 보내 줄 수 있다.
    console.error("[ErrorBoundary]", error, info.componentStack);
    // 전역 리스너가 같은 사고를 토스트로 한 번 더 알리지 않게 표시해 둔다.
    markErrorHandled(`uncaught:${error.message}`);
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <ErrorFallback error={error} variant={this.props.variant ?? "route"} onRetry={this.reset} />
    );
  }
}
