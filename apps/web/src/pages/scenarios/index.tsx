import { Link } from "react-router-dom";
import { ProjectGate } from "@/components";
import { Button, PageHead, StateView } from "@/components/ui";
import {
  SCENARIO_PAGE_SIZE,
  useScenarioFeatures,
  useScenarioFilters,
  useScenarioList,
} from "@/hooks/useScenarios";
import { ScenarioToolbar } from "./ScenarioToolbar";
import { ScenarioTable, ScenarioTableSkeleton } from "./ScenarioTable";

/**
 * 화면 2 · 테스트 시나리오 목록 (시안 `#scenarios`).
 *
 *   .page-head + .toolbar + .table-wrap
 *
 * 필터는 **URL 쿼리가 단일 진실**이다(`useScenarioFilters`). 새로고침·뒤로가기·링크
 * 공유에서 같은 목록이 나온다. react-query 키에도 같은 필터가 들어가므로
 * 필터 조합마다 캐시가 따로 잡힌다.
 */
export function ScenariosPage() {
  const { filters, setFilters, reset, isFiltered } = useScenarioFilters();
  const list = useScenarioList(filters);
  const features = useScenarioFeatures();
  const now = new Date();

  const totalPages =
    list.data === undefined ? 1 : Math.max(1, Math.ceil(list.data.total / SCENARIO_PAGE_SIZE));

  return (
    <>
      <PageHead
        title="테스트 시나리오"
        description="업무 흐름 기준으로 테스트를 검색하고 관리합니다."
        action={
          <Button variant="primary" asChild>
            <Link to="/scenarios/new">＋ 시나리오 만들기</Link>
          </Button>
        }
      />

      <ProjectGate>
        <ScenarioToolbar filters={filters} onChange={setFilters} features={features.data ?? []} />

        {list.isPending ? <ScenarioTableSkeleton /> : null}

        {list.isError ? (
          <div className="rounded-table border border-line bg-panel">
            <StateView
              tone="error"
              title="시나리오 목록을 불러오지 못했습니다"
              description={list.error.message}
              onRetry={() => void list.refetch()}
            />
          </div>
        ) : null}

        {list.data !== undefined && !list.isError ? (
          list.data.items.length === 0 ? (
            <div className="rounded-table border border-line bg-panel">
              {isFiltered ? (
                <StateView
                  title="조건에 맞는 시나리오가 없습니다"
                  description="검색어나 필터를 바꿔 보세요."
                  onRetry={reset}
                  retryLabel="필터 초기화"
                />
              ) : (
                <StateView
                  title="아직 시나리오가 없습니다"
                  description="브라우저 조작을 녹화해 첫 시나리오를 만들어 보세요."
                  action={
                    <Button variant="primary" asChild>
                      <Link to="/scenarios/new">＋ 시나리오 만들기</Link>
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <>
              <ScenarioTable
                items={list.data.items}
                dimmed={list.isPlaceholderData}
                now={now}
              />
              <Pager
                page={list.data.page}
                totalPages={totalPages}
                total={list.data.total}
                onChange={(page) => {
                  setFilters({ page });
                }}
              />
            </>
          )
        ) : null}
      </ProjectGate>
    </>
  );
}

/**
 * 페이지네이션. 시안에 없는 요소라 **툴바·버튼 토큰만으로** 최소 형태로 만들었다.
 * 1페이지뿐이면 개수만 보여 준다 — 누를 수 없는 버튼 두 개를 띄우지 않는다.
 */
function Pager({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div
      data-slot="pager"
      className="mt-[14px] flex items-center justify-between gap-[10px] text-[11px] text-muted"
    >
      <span>전체 {String(total)}건</span>
      {totalPages <= 1 ? null : (
        <div className="flex items-center gap-[9px]">
          <Button
            disabled={page <= 1}
            onClick={() => {
              onChange(page - 1);
            }}
          >
            이전
          </Button>
          <span className="text-[11px]">
            {String(page)} / {String(totalPages)}
          </span>
          <Button
            disabled={page >= totalPages}
            onClick={() => {
              onChange(page + 1);
            }}
          >
            다음
          </Button>
        </div>
      )}
    </div>
  );
}
