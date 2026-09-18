import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { ErrorFallback, toError } from "./ErrorFallback";

/**
 * ★ 라우터가 **가로챈** 오류를 우리 화면으로 그린다 (루트 라우트의 `errorElement`).
 *
 * ## 왜 필요한가 — 실측으로 드러났다
 * 셸(`AppShellRoute`)이 렌더 중 던지면 `App.tsx` 의 루트 `ErrorBoundary` 까지 오지 **않는다.**
 * `react-router` 가 **자기 기본 errorElement** 로 먼저 잡기 때문이다. 그 기본 화면은
 * `Unexpected Application Error!` 와 **스택 트레이스 전문**을 그대로 뿌린다 —
 * 흰 화면은 아니지만 "스택을 사용자에게 보여 주지 마라"를 정면으로 깬다.
 * (`/?boomroot=1` 로 실제 예외를 던져 확인했다. 그 화면의 본문 원문은 artifact §3 참조.)
 *
 * 라우터의 기본값을 이기는 방법은 **우리 `errorElement` 를 주는 것 하나뿐**이다.
 *
 * ## 범위
 * 루트 라우트에만 건다. 자식 화면들은 `withSuspense` 의 클래스 경계가 **더 안쪽에서
 * 먼저** 잡으므로 여기까지 올라오지 않는다 — 즉 이 화면이 뜨는 것은 **셸 자체가
 * 깨졌을 때**뿐이고, 그때는 사이드바가 없으니 화면 전체를 대신 그리는 것이 맞다.
 *
 * `4xx`(`isRouteErrorResponse`)는 loader/action 이 있어야 생기는데 이 앱에는 없다.
 * 그래도 방어적으로 다룬다 — 나중에 loader 를 도입했을 때 이 화면이 조용히 틀리지 않게.
 */
export function RouteErrorElement() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <ErrorFallback
        variant="root"
        error={new Error(`요청을 처리하지 못했습니다 (HTTP ${String(error.status)})`)}
      />
    );
  }

  return <ErrorFallback variant="root" error={toError(error)} />;
}
