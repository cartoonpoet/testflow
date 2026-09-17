import { Link } from "react-router-dom";
import { RunRow } from "@/components";
import { Panel, Skeleton, StateView } from "@/components/ui";
import { RECENT_RUNS_LIMIT, useRecentRuns } from "@/hooks/useDashboard";

/**
 * 시안 화면 1 좌측 "최근 실행" 패널.
 *   .panel-head   "최근 실행" + 우측 "전체 보기 →"
 *   .run-list     padding 0 8px
 *
 * 행 렌더는 `components/RunRow` 가 맡는다(시안 `.run-row` 5열).
 *
 * ★ `now` 를 **여기서 한 번 만들어** 모든 행에 내려 준다. 행마다 `new Date()` 를 부르면
 *   "8분 전 / 8분 전 / 9분 전" 처럼 기준 시각이 행마다 달라진다.
 */
export function RecentRunsPanel() {
  const runs = useRecentRuns();
  const now = new Date();

  return (
    <Panel
      title="최근 실행"
      action={
        <Link to="/runs" className="hover:text-ink">
          전체 보기 →
        </Link>
      }
      data-slot="recent-runs"
    >
      {renderBody()}
    </Panel>
  );

  function renderBody() {
    if (runs.isPending) {
      return (
        <div className="px-[8px]">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="tf-run-row border-b border-hairline px-[12px] py-[13px] last:border-b-0"
            >
              <Skeleton className="h-[28px] w-[28px] rounded-chip" />
              <span className="block">
                <Skeleton className="h-[13px] w-[62%]" />
                <Skeleton className="mt-[6px] h-[11px] w-[88px]" />
              </span>
              <Skeleton className="h-[18px] w-[52px] max-compact:hidden" />
              <Skeleton className="h-[11px] w-[36px]" />
              <Skeleton className="h-[11px] w-[48px] justify-self-end max-mobile:hidden" />
            </div>
          ))}
        </div>
      );
    }

    if (runs.isError) {
      return (
        <StateView
          tone="error"
          title="최근 실행을 불러오지 못했습니다"
          description={runs.error.message}
          onRetry={() => void runs.refetch()}
        />
      );
    }

    if (runs.data.length === 0) {
      return (
        <StateView
          title="아직 실행 이력이 없습니다"
          description="시나리오를 발행하고 한 번 실행하면 여기에 최근 결과가 쌓입니다."
        />
      );
    }

    return (
      <div className="px-[8px]" data-slot="run-list">
        {runs.data.slice(0, RECENT_RUNS_LIMIT).map((run) => (
          <RunRow key={run.id} run={run} now={now} />
        ))}
      </div>
    );
  }
}
