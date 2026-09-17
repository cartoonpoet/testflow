import { MetricCard } from "@/components";
import { Skeleton, StateView } from "@/components/ui";
import { formatDurationMs, formatRatioPercent } from "@/lib";
import { useDashboardReadiness, useDashboardSummary } from "@/hooks/useDashboard";

/**
 * 시안 `.metrics` — `grid-template-columns: 1.2fr 1fr 1fr 1fr`, gap 14px, margin-bottom 20px.
 * 유틸은 `tf-metrics`(globals.css). 1050px 이하 2열, 760px 이하 2열 + gap 9px.
 *
 * 지표 4종은 `GET /api/dashboard/summary` 가 그대로 준다.
 *
 * ★ **`delta` 를 지어내지 않았다.** 시안은 "지난주 대비 +2.4%", "18초 단축" 처럼
 *   비교 지표를 보여 주지만 API 에 이전 기간 값이 없다(04-gen-5 `DashboardSummary` 4필드).
 *   없는 수치를 계산해 넣으면 화면은 시안과 같아 보이지만 **틀린 숫자**가 된다.
 *   그래서 delta 자리에는 그 수치의 **집계 기준**을 적었다 — 자리는 채우고 거짓말은 안 한다.
 */
export function MetricGrid() {
  const summary = useDashboardSummary();
  const readiness = useDashboardReadiness();

  if (summary.isPending) {
    return (
      <div className="tf-metrics mb-[20px]" data-slot="metric-grid">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-metric border border-line bg-panel p-[19px] max-mobile:p-[15px]"
          >
            <Skeleton className="h-[11px] w-[56px]" />
            <Skeleton className="mt-[10px] h-[27px] w-[92px]" />
            <Skeleton className="mt-[6px] h-[11px] w-[110px]" />
          </div>
        ))}
      </div>
    );
  }

  if (summary.isError) {
    return (
      <div
        className="mb-[20px] rounded-metric border border-line bg-panel"
        data-slot="metric-grid"
      >
        <StateView
          tone="error"
          title="지표를 불러오지 못했습니다"
          description={summary.error.message}
          onRetry={() => void summary.refetch()}
        />
      </div>
    );
  }

  const { todayRuns, successRate, automatedScenarios, avgDurationMs } = summary.data;
  const totalScenarios = readiness.data?.totalScenarios;

  return (
    <div className="tf-metrics mb-[20px]" data-slot="metric-grid">
      <MetricCard
        featured
        label="오늘 실행"
        value={`${String(todayRuns)}회`}
        delta="오늘 00시 이후 요청 기준"
      />
      <MetricCard
        label="성공률"
        value={formatRatioPercent(successRate)}
        delta="종료된 실행 기준"
      />
      <MetricCard
        label="자동화 시나리오"
        value={String(automatedScenarios)}
        delta={
          totalScenarios === undefined
            ? "발행된 시나리오"
            : `발행됨 ${String(automatedScenarios)} / 전체 ${String(totalScenarios)}`
        }
      />
      <MetricCard
        label="평균 실행 시간"
        value={avgDurationMs === 0 ? "—" : formatDurationMs(avgDurationMs)}
        delta="완료된 실행의 평균"
      />
    </div>
  );
}
