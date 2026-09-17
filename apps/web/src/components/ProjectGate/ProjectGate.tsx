import type * as React from "react";
import { StateView } from "@/components/ui";
import { useProjects } from "@/hooks/useProject";

/**
 * 프로젝트 조회 실패를 **화면 단위로** 드러내는 게이트.
 *
 * ## 왜 필요한가 (Gen-Phase 9 에서 실측으로 발견)
 * 대시보드·목록의 모든 쿼리는 `enabled: projectId !== undefined` 다.
 * 그런데 `GET /api/projects` 자체가 실패하면 `projectId` 가 영원히 `undefined` 라
 * 하위 쿼리는 **시작조차 하지 않는다** → 화면이 스켈레톤 상태로 **영원히 멈춘다.**
 * 실제로 API 를 503 으로 막아 보고 나서야 드러난 경로다.
 *
 * 그래서 프로젝트 조회의 실패·빈 결과는 여기서 한 번에 처리한다.
 * 페이지 본문은 "프로젝트가 있다"를 전제로 단순하게 남는다.
 */
export function ProjectGate({ children }: { children: React.ReactNode }) {
  const projects = useProjects();

  if (projects.isError) {
    return (
      <div className="rounded-table border border-line bg-panel">
        <StateView
          tone="error"
          title="서버에 연결하지 못했습니다"
          description={projects.error.message}
          onRetry={() => void projects.refetch()}
        />
      </div>
    );
  }

  if (projects.data !== undefined && projects.data.length === 0) {
    return (
      <div className="rounded-table border border-line bg-panel">
        <StateView
          title="프로젝트가 없습니다"
          description="테스트 대상 서비스를 등록해야 시나리오를 만들 수 있습니다."
        />
      </div>
    );
  }

  return <>{children}</>;
}
