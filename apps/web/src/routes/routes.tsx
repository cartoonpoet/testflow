import { Suspense, lazy } from "react";
import type * as React from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
import { ErrorBoundary, RouteErrorElement } from "@/components/ErrorBoundary";
import { AppShellRoute } from "./AppShellRoute";
import { RouteFallback } from "./RouteFallback";

/**
 * 라우터. Gen-Phase 11 에서 `PagePlaceholder` 가 전부 사라졌다 —
 * 사이드바에서 **활성화된 메뉴가 모두 실제 화면**이다(라운드 3 에서 `HELP > 가이드` 추가).
 *
 * 경로는 `components/layout/Sidebar/navigation.ts` 의 `to` 값과 1:1 이어야 한다
 * (한쪽만 고치면 브레드크럼 `usePageTitle` 과 active 표시가 어긋난다).
 * `/suites/:suiteId` 처럼 메뉴에 없는 상세 경로는 `usePageTitle` 이 **가장 긴 접두 메뉴**로
 * 떨어뜨린다(`테스트 스위트`). 메뉴를 늘릴 필요가 없다.
 *
 * MVP 제외 화면(실행 환경 · 테스트 데이터 · 프로젝트 설정)은 **라우트를 만들지 않는다**
 * (04-gen-8 결정 3번 — 사이드바에서 `enabled:false` 로 비활성 표시만 한다).
 *
 * ## ★ 라우트 단위 code splitting (Gen-Phase 12 Task 12.7)
 * Gen-Phase 11 이 "필요하다" 고 판정하고 넘긴 작업이다. 단일 번들이 623.79KB 가 되어
 * `vite build` 가 500KB 경고를 냈다.
 *
 * - **가장 큰 덩어리는 빌더(`scenarios/builder`)와 그 안의 녹화 클라이언트**
 *   (`features/recorder` — 캔버스 렌더러 · WS · 입력/IME 브리지)다.
 *   대시보드·실행 현황만 보는 사용자에게는 **전부 죽은 코드**다.
 * - 각 라우트를 `React.lazy` 로 내리고 **라우트마다 `Suspense`** 를 건다.
 *   셸(사이드바·탑바)은 `AppShellRoute` 에 남아 있으므로 청크를 받는 동안에도
 *   화면 골격이 유지되고 **본문만** `RouteFallback` 으로 바뀐다.
 * - `fallback` 은 화면별 스켈레톤이 **아니라** 공용 `RouteFallback` 이다.
 *   화면별 스켈레톤을 쓰면 그 화면 청크를 미리 받게 되어 분할이 무효가 된다
 *   (`RouteFallback` 주석 참조).
 *
 * `lazy()` 호출은 **모듈 최상단**에 둔다. 렌더 안에서 부르면 매 렌더마다 새 컴포넌트 타입이
 * 만들어져 화면 전체가 언마운트/리마운트된다.
 */

/* ── 라우트별 지연 로드 ──────────────────────────────────── */

const DashboardPage = lazy(async () => ({
  default: (await import("@/pages/dashboard")).DashboardPage,
}));
const ScenariosPage = lazy(async () => ({
  default: (await import("@/pages/scenarios")).ScenariosPage,
}));
const NewScenarioPage = lazy(async () => ({
  default: (await import("@/pages/scenarios/NewScenarioPage")).NewScenarioPage,
}));
/** ★ 가장 큰 청크 — 빌더 + 인스펙터 + 녹화 클라이언트(`features/recorder`). */
const ScenarioBuilderPage = lazy(async () => ({
  default: (await import("@/pages/scenarios/builder")).ScenarioBuilderPage,
}));
/**
 * 코드 시나리오 편집 화면(라운드 2). 빌더와 **다른 청크**다 —
 * 코드 화면에는 녹화 클라이언트가 없고, 빌더를 쓰는 사용자에게 코드 화면은 죽은 코드다.
 */
const CodeScenarioPage = lazy(async () => ({
  default: (await import("@/pages/scenarios/code")).CodeScenarioPage,
}));
const RunsPage = lazy(async () => ({
  default: (await import("@/pages/runs")).RunsPage,
}));
const RunDetailPage = lazy(async () => ({
  default: (await import("@/pages/runs/RunDetail")).RunDetailPage,
}));
const SuitesPage = lazy(async () => ({
  default: (await import("@/pages/suites")).SuitesPage,
}));
/**
 * 가이드(사용 안내). 본문 텍스트 덩어리라 **가장 늦게 받아도 되는 청크**다 —
 * 대시보드만 보는 사용자에게는 통째로 죽은 코드이므로 반드시 lazy 로 남긴다.
 */
const GuidePage = lazy(async () => ({
  default: (await import("@/pages/guide")).GuidePage,
}));
const SuiteDetailPage = lazy(async () => ({
  default: (await import("@/pages/suites/SuiteDetail")).SuiteDetailPage,
}));

/**
 * ★ 라우트 단위 ErrorBoundary. 화면별로는 `errorElement` 대신 클래스 경계를 쓴다 —
 * 근거(특히 "다시 시도"가 `errorElement` 로는 불가능하다는 것)는 `ErrorBoundary.tsx` 주석.
 *
 * 이 컴포넌트는 `AppShell` 의 `<Outlet/>` 안에서 렌더되므로 **사이드바·탑바·브레드크럼은
 * 그대로 살아 있고 본문만** 안내로 바뀐다. 한 화면이 깨졌다고 다른 화면으로 가는 길까지
 * 끊을 이유가 없다.
 *
 * `location.key` 를 `resetKey` 로 넘긴다 — 사용자가 사이드바로 **다른 화면에 가면
 * 에러 상태가 저절로 풀린다.** 넘기지 않으면 한 번 깨진 경계가 이후 모든 라우트를
 * 에러 화면으로 덮어 버린다(경계는 언마운트되지 않는다 — element 만 바뀐다).
 */
function RouteBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary variant="route" resetKey={location.key}>
      {children}
    </ErrorBoundary>
  );
}

/**
 * 라우트 element 를 `Suspense` 로 감싼다. 라우트마다 같은 fallback 을 쓴다.
 *
 * ★ 경계가 `Suspense` **바깥**이다. `lazy()` 의 청크 로드 실패는 Suspense 가 아니라
 *   그 바깥 경계로 던져진다 — 안쪽에 두면 배포 직후의 청크 404 를 못 잡는다.
 */
function withSuspense(element: React.ReactNode): React.ReactNode {
  return (
    <RouteBoundary>
      <Suspense fallback={<RouteFallback />}>{element}</Suspense>
    </RouteBoundary>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShellRoute />,
    /*
     * ★ **라우터의 기본 errorElement 를 이긴다.** 주지 않으면 셸(`AppShellRoute`)이 던졌을 때
     *   react-router 가 `Unexpected Application Error!` + **스택 트레이스 전문**을 뿌린다
     *   (실측 확인 — `RouteErrorElement` 주석). 자식 화면은 `withSuspense` 의 클래스 경계가
     *   더 안쪽에서 먼저 잡으므로 여기까지 올라오지 않는다.
     */
    errorElement: <RouteErrorElement />,
    children: [
      { index: true, element: withSuspense(<DashboardPage />) },
      { path: "scenarios", element: withSuspense(<ScenariosPage />) },
      { path: "scenarios/new", element: withSuspense(<NewScenarioPage />) },
      { path: "scenarios/:scenarioId", element: withSuspense(<ScenarioBuilderPage />) },
      { path: "scenarios/:scenarioId/code", element: withSuspense(<CodeScenarioPage />) },
      { path: "runs", element: withSuspense(<RunsPage />) },
      { path: "runs/:runId", element: withSuspense(<RunDetailPage />) },
      { path: "suites", element: withSuspense(<SuitesPage />) },
      { path: "suites/:suiteId", element: withSuspense(<SuiteDetailPage />) },
      { path: "guide", element: withSuspense(<GuidePage />) },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
