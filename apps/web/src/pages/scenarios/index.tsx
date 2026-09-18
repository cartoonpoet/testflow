import { useState } from "react";
import { Link } from "react-router-dom";
import { bulkDeleteSummary, type ScenarioListItem } from "@testflow/contracts";
import { ProjectGate } from "@/components";
import { Button, PageHead, StateView } from "@/components/ui";
import { RunDialog } from "@/pages/runs/RunDialog";
import { toast } from "@/hooks/useToast";
import {
  SCENARIO_PAGE_SIZE,
  useBulkDeleteScenarios,
  useScenarioFeatures,
  useScenarioFilters,
  useScenarioList,
} from "@/hooks/useScenarios";
import { ScenarioDeleteDialog, type ScenarioDeleteTarget } from "./ScenarioDeleteDialog";
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
   * ★ 라운드 7 — 다중 선택 실행. **라운드 8 에서 그 선택을 삭제에도 쓴다.**
   *
   * id 만이 아니라 **행의 요약까지** 들고 있는 이유는 페이지네이션이다. 2페이지에서 고른
   * 시나리오를 1페이지로 돌아와 실행·삭제할 수 있어야 하는데, 그때 2페이지 목록은 이미
   * 캐시 밖일 수 있다. 선택은 화면을 넘나들며 살아남는다.
   * (URL 에 넣지 않는다 — 선택은 공유할 상태가 아니고, 링크가 길어지기만 한다.)
   *
   * ★ 라운드 8 — 값이 `name` 문자열에서 **요약 객체**로 넓어졌다. 삭제 확인 대화상자가
   *   "무엇이 지워지는가"를 코드·스텝 수까지 적어야 하는데, 이름만 들고 있으면
   *   **선택 상태를 두 벌 만들거나** 개수를 지어내게 된다. 선택은 한 벌이다.
   */
  const [selection, setSelection] = useState<Readonly<Record<string, ScenarioDeleteTarget>>>({});
  const [runOpen, setRunOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const bulkDelete = useBulkDeleteScenarios();

  const selectedIds = Object.keys(selection);
  const selectedSet = new Set(selectedIds);
  const selectedTargets = Object.values(selection);

  const toggle = (item: ScenarioDeleteTarget) => {
    setSelection((prev) => {
      if (!Object.hasOwn(prev, item.id)) return { ...prev, [item.id]: item };
      const next = { ...prev };
      delete next[item.id];
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
                  {/*
                    ★ 라운드 8 — 같은 선택 상태에서 곧바로 삭제한다.
                      위치는 "선택 실행" **왼쪽**이다: 파괴적인 버튼을 주 동작(실행) 자리에
                      두지 않는다. 라벨도 `삭제` 가 아니라 **"선택 삭제"** 라 무엇을 지우는지
                      한 단어로 읽힌다(이 화면의 다른 `삭제` 와 섞이지 않는다).
                  */}
                  <Button
                    variant="danger"
                    data-testid="scenario-selection-delete"
                    onClick={() => {
                      setDeleteOpen(true);
                    }}
                  >
                    선택 삭제
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
                  if (item !== undefined) toggle(toTarget(item));
                }}
                onToggleAll={(checked) => {
                  setSelection((prev) => {
                    const next = { ...prev };
                    for (const item of list.data?.items ?? []) {
                      if (checked) next[item.id] = toTarget(item);
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
          <>
            <RunDialog
              open={runOpen}
              onOpenChange={setRunOpen}
              target={{ scenarioIds: selectedIds }}
              targetName={selectionLabel(selectedTargets)}
              scenarioCount={selectedIds.length}
            />

            {/*
              ★ 부분 성공이 정상 응답이다 — 진행 중인 실행이 걸린 시나리오는 서버가
                `skipped` 로 돌려준다. 그래서 성공 결과를 **읽어서** 알린다.
                지워진 것만 선택에서 빼고, 건너뛴 것은 **선택에 남긴다** —
                사용자가 취소한 뒤 다시 누를 수 있어야 한다.
            */}
            <ScenarioDeleteDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              targets={selectedTargets}
              pending={bulkDelete.isPending}
              onConfirm={() => {
                bulkDelete.mutate(selectedIds, {
                  onSuccess: (result) => {
                    setSelection((prev) => {
                      const next = { ...prev };
                      for (const id of result.deleted) delete next[id];
                      return next;
                    });
                    setDeleteOpen(false);
                    toast(
                      result.skipped.length === 0
                        ? bulkDeleteSummary(result, "시나리오")
                        : `${bulkDeleteSummary(result, "시나리오")} ${result.skipped[0]?.message ?? ""}`,
                      {
                        label: "삭제",
                        tone: result.skipped.length === 0 ? "default" : "danger",
                      },
                    );
                  },
                  onError: (error: Error) => {
                    toast(error.message, { label: "삭제 실패", tone: "danger" });
                  },
                });
              }}
            />
          </>
        )}
      </ProjectGate>
    </>
  );
}

/** 목록 1행 → 실행·삭제가 함께 쓰는 선택 항목. 개수는 **목록 응답이 주는 것만** 담는다. */
function toTarget(item: ScenarioListItem): ScenarioDeleteTarget {
  return {
    id: item.id,
    name: item.name,
    code: item.code,
    sourceType: item.sourceType,
    stepCount: item.stepCount,
  };
}

/** 다이얼로그 제목 아래 줄. 이름을 다 늘어놓지 않고 앞 두 건 + 나머지 수로 줄인다. */
function selectionLabel(targets: readonly ScenarioDeleteTarget[]): string {
  const names = targets.map((target) => target.name);
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
