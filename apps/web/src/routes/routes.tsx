import { Suspense, lazy } from "react";
import type * as React from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShellRoute } from "./AppShellRoute";
import { RouteFallback } from "./RouteFallback";

/**
 * 라우터. Gen-Phase 11 에서 `PagePlaceholder` 가 전부 사라졌다 —
 * 사이드바에서 **활성화된 메뉴 5개가 모두 실제 화면**이다.
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
const SuiteDetailPage = lazy(async () => ({
  default: (await import("@/pages/suites/SuiteDetail")).SuiteDetailPage,
}));

/** 라우트 element 를 `Suspense` 로 감싼다. 라우트마다 같은 fallback 을 쓴다. */
function withSuspense(element: React.ReactNode): React.ReactNode {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShellRoute />,
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
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
