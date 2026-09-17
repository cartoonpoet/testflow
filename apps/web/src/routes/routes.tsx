import { createBrowserRouter, Navigate } from "react-router-dom";
import { DashboardPage } from "@/pages/dashboard";
import { ScenariosPage } from "@/pages/scenarios";
import { NewScenarioPage } from "@/pages/scenarios/NewScenarioPage";
import { ScenarioBuilderPage } from "@/pages/scenarios/builder";
import { RunDetailPage, RunsPage } from "@/pages/runs";
import { SuiteDetailPage, SuitesPage } from "@/pages/suites";
import { AppShellRoute } from "./AppShellRoute";

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
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShellRoute />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "scenarios", element: <ScenariosPage /> },
      { path: "scenarios/new", element: <NewScenarioPage /> },
      { path: "scenarios/:scenarioId", element: <ScenarioBuilderPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "runs/:runId", element: <RunDetailPage /> },
      { path: "suites", element: <SuitesPage /> },
      { path: "suites/:suiteId", element: <SuiteDetailPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
