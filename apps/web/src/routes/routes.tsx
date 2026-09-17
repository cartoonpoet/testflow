import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout";
import { PagePlaceholder } from "./PagePlaceholder";

/**
 * 라우터 골격만 둔다. 각 화면의 실제 내용은 후속 Gen-Phase 담당이다.
 * 경로는 `components/layout/Sidebar/navigation.ts` 의 `to` 값과 1:1 이어야 한다.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: (
          <PagePlaceholder
            title="대시보드"
            description="오늘의 실행 상태와 확인이 필요한 테스트를 모았습니다."
            phase="Gen-Phase 9"
          />
        ),
      },
      {
        path: "scenarios",
        element: (
          <PagePlaceholder
            title="테스트 시나리오"
            description="등록된 시나리오를 검색하고 상태를 확인합니다."
            phase="Gen-Phase 9"
          />
        ),
      },
      {
        path: "scenarios/new",
        element: (
          <PagePlaceholder
            title="시나리오 만들기"
            description="브라우저를 직접 조작해 테스트 단계를 기록합니다."
            phase="Gen-Phase 10"
          />
        ),
      },
      {
        path: "scenarios/:scenarioId",
        element: (
          <PagePlaceholder
            title="시나리오 편집"
            description="기록된 단계를 업무 용어로 다듬습니다."
            phase="Gen-Phase 10"
          />
        ),
      },
      {
        path: "runs",
        element: (
          <PagePlaceholder
            title="실행 현황"
            description="진행 중인 실행과 최근 결과를 확인합니다."
            phase="Gen-Phase 11"
          />
        ),
      },
      {
        path: "runs/:runId",
        element: (
          <PagePlaceholder
            title="실행 상세"
            description="단계별 진행 상황과 실패 증적을 확인합니다."
            phase="Gen-Phase 11"
          />
        ),
      },
      {
        path: "suites",
        element: (
          <PagePlaceholder
            title="테스트 스위트"
            description="여러 시나리오를 하나의 회귀 묶음으로 실행합니다."
            phase="Gen-Phase 11"
          />
        ),
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
