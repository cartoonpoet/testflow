import { useState } from "react";
import { Link } from "react-router-dom";
import { ProjectGate } from "@/components";
import { Button, PageHead, StateView } from "@/components/ui";
import { RunDialog } from "@/pages/runs/RunDialog";
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

  /*
   * ★ 라운드 7 — 다중 선택 실행.
   *
   * id 만이 아니라 **이름까지** 들고 있는 이유는 페이지네이션이다. 2페이지에서 고른
   * 시나리오를 1페이지로 돌아와 실행할 수 있어야 하는데, 그때 2페이지 목록은 이미
   * 캐시 밖일 수 있다. 선택은 화면을 넘나들며 살아남고 이름은 다이얼로그 제목에 쓴다.
   * (URL 에 넣지 않는다 — 선택은 공유할 상태가 아니고, 링크가 길어지기만 한다.)
   */
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>({});
  const [runOpen, setRunOpen] = useState(false);
  const selectedIds = Object.keys(selection);
  const selectedSet = new Set(selectedIds);

  const toggle = (id: string, name: string) => {
    setSelection((prev) => {
      if (!Object.hasOwn(prev, id)) return { ...prev, [id]: name };
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

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
              {selectedIds.length === 0 ? null : (
                <div
                  data-slot="scenario-selection-bar"
                  data-selected-count={selectedIds.length}
                  className="mb-[12px] flex flex-wrap items-center gap-[10px] rounded-table border border-line bg-panel px-[15px] py-[11px]"
                >
                  <strong className="text-[12px]">
                    시나리오 {String(selectedIds.length)}건 선택됨
                  </strong>
                  <span className="min-w-0 flex-1 truncate text-[10px] text-muted">
                    한 번에 실행하면 같은 묶음(batch)으로 요청되고, Runner 의 동시 실행 한도만큼
                    병렬로 돕니다. 나머지는 큐에서 차례를 기다립니다.
                  </span>
                  <Button
                    data-testid="scenario-selection-clear"
                    onClick={() => {
                      setSelection({});
                    }}
                  >
                    선택 해제
                  </Button>
                  <Button
                    variant="primary"
                    data-testid="scenario-selection-run"
                    onClick={() => {
                      setRunOpen(true);
                    }}
                  >
                    ▶ 선택 실행
                  </Button>
                </div>
              )}

              <ScenarioTable
                items={list.data.items}
                dimmed={list.isPlaceholderData}
                now={now}
                selected={selectedSet}
                onToggle={(id) => {
                  const item = list.data?.items.find((candidate) => candidate.id === id);
                  toggle(id, item?.name ?? id);
                }}
                onToggleAll={(checked) => {
                  setSelection((prev) => {
                    const next = { ...prev };
                    for (const item of list.data?.items ?? []) {
                      if (checked) next[item.id] = item.name;
                      else delete next[item.id];
                    }
                    return next;
                  });
                }}
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

        {/*
          ★ 실행 다이얼로그는 **단건과 같은 컴포넌트**다. 대상만 `scenarioIds` 로 바뀐다 —
            baseUrl·계정·비밀번호를 받는 규칙이 두 벌이 되면 한쪽에서 평문이 샌다.
        */}
        {selectedIds.length === 0 ? null : (
          <RunDialog
            open={runOpen}
            onOpenChange={setRunOpen}
            target={{ scenarioIds: selectedIds }}
            targetName={selectionLabel(selection)}
            scenarioCount={selectedIds.length}
          />
        )}
      </ProjectGate>
    </>
  );
}

/** 다이얼로그 제목 아래 줄. 이름을 다 늘어놓지 않고 앞 두 건 + 나머지 수로 줄인다. */
function selectionLabel(selection: Readonly<Record<string, string>>): string {
  const names = Object.values(selection);
  if (names.length <= 2) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} 외 ${String(names.length - 2)}건`;
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
