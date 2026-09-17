import { Link } from "react-router-dom";
import { ProjectGate } from "@/components";
import { Button, PageHead } from "@/components/ui";
import { MetricGrid } from "./MetricGrid";
import { RecentRunsPanel } from "./RecentRunsPanel";
import { ReadinessPanel } from "./ReadinessPanel";

/**
 * 화면 1 · 대시보드 (시안 `#dashboard`).
 *
 *   .page-head   제목 + 설명 + 우측 주 액션
 *   .metrics     1.2fr 1fr 1fr 1fr       → `tf-metrics`
 *   .main-grid   1.45fr .75fr            → `tf-main-grid` (1050px 이하 1단)
 *                좌: 최근 실행 / 우: 준비도 + amber notice
 *
 * ★ 패널마다 **자기 로딩·에러를 스스로** 그린다. 페이지 전체를 한 덩어리로 묶으면
 *   `/runs` 하나가 죽었을 때 멀쩡한 지표까지 사라진다.
 */
export function DashboardPage() {
  return (
    <>
      <PageHead
        title="대시보드"
        description="오늘의 실행 상태와 확인이 필요한 테스트를 모았습니다."
        action={
          <Button variant="primary" asChild>
            <Link to="/scenarios">▤ 시나리오 보기</Link>
          </Button>
        }
      />

      <ProjectGate>
        <MetricGrid />

        <div className="tf-main-grid">
          <RecentRunsPanel />
          <aside>
            <ReadinessPanel />
          </aside>
        </div>
      </ProjectGate>
    </>
  );
}
