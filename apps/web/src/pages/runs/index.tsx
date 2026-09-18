import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  RUN_STATUSES,
  bulkDeleteSummary,
  isTerminalRunStatus,
  type RunDetail,
  type RunListItem,
  type RunStatus,
} from "@testflow/contracts";
import { ProjectGate, RunRow, StepStatusIcon } from "@/components";
import { Button, PageHead, Panel, Select, Skeleton, StateView, StatusDot } from "@/components/ui";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, formatDurationMs, formatRelativeTime } from "@/lib";
import { toast } from "@/hooks/useToast";
import {
  useBulkDeleteRuns,
  useRunArtifactsMany,
  useRunDetails,
  useRunList,
  useRunQueue,
} from "@/hooks/useRuns";
import { RunDeleteDialog, type RunDeleteTarget } from "./RunDeleteDialog";

export { RunDetailPage } from "./RunDetail";

/**
 * 화면 4 · 실행 목록 (`/runs`).
 *
 * 시안은 실행 **상세**만 준다(화면 4). 목록은 시안 화면 1 의 "최근 실행" 패널을 그대로
 * 확장한 것이다 — `RunRow`(`tf-run-row` 5열)와 패널·툴바 토큰을 재사용했고
 * **새 색·새 반경을 만들지 않았다.**
 *
 * ## 묶음(batch) 실행 결과
 * 스위트를 실행하면 run 이 N 건 생기고 전부 같은 `batch_id` 를 갖는다(04-gen-5 실측).
 * 그런데 목록 응답(`RunListItem`)에는 `batchId` 가 없어 "이 묶음만" 을 서버에 물어볼 수 없다.
 * → `RunDialog` 가 방금 받은 `runIds` 를 `?batch=…&ids=…` 로 넘겨 주고, 이 화면이
 *   그 id 로 각각 상세를 읽어 **묶음 패널**을 그린다. (계약에 필드를 추가하면 API 도
 *   함께 고쳐야 하는데 이번 Gen-Phase 의 범위 밖이라, 화면 쪽에서 닫았다.)
 */
export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const status = parseStatus(params.get("status"));
  const batchId = params.get("batch");
  const batchIds = (params.get("ids") ?? "").split(",").filter((id) => id !== "");

  const list = useRunList({ status });
  const now = new Date();

  /*
   * ★ 라운드 8 — 실행 이력 다중 선택(삭제용).
   *
   * 시나리오 목록의 선택 상태(#14)와 **같은 짜임**이다: id → 행 요약. 페이지를 넘나들어도
   * 살아남고(이 화면은 페이지네이션이 없지만 상태 필터가 목록을 갈아 끼운다),
   * 확인 대화상자가 `RUN-…` 과 시나리오 이름을 적는 데 쓴다.
   *
   * ★ **진행 중인 실행은 애초에 고를 수 없다.** 서버가 409 로 막는 것을 화면에서도
   *   같은 규칙으로 막는다 — 고를 수 있게 해 놓고 "지울 수 없다"고 돌려주면
   *   사용자는 이유를 알 수 없는 실패를 본다.
   */
  const [selection, setSelection] = useState<Readonly<Record<string, RunSelection>>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const bulkDelete = useBulkDeleteRuns();

  const selectedIds = Object.keys(selection);
  const artifactQueries = useRunArtifactsMany(selectedIds, deleteOpen);
  const deleteTargets: RunDeleteTarget[] = selectedIds.map((id, index) => ({
    ...(selection[id] as RunSelection),
    artifacts: artifactQueries[index]?.data,
  }));

  const toggleRun = (item: RunListItem) => {
    setSelection((prev) => {
      if (!Object.hasOwn(prev, item.id)) {
        return {
          ...prev,
          [item.id]: { id: item.id, runCode: item.runCode, scenarioName: item.scenarioName },
        };
      }
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  };

  return (
    <>
      <PageHead
        title="실행 현황"
        description="진행 중인 실행과 최근 결과를 확인합니다."
        action={
          <Select
            variant="filter"
            aria-label="상태 필터"
            data-slot="run-status-filter"
            value={status}
            onChange={(event) => {
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  if (event.target.value === "") next.delete("status");
                  else next.set("status", event.target.value);
                  return next;
                },
                { replace: true },
              );
            }}
          >
            <option value="">전체 상태</option>
            {RUN_STATUSES.map((value) => (
              <option key={value} value={value}>
                {RUN_STATUS_LABEL[value]}
              </option>
            ))}
          </Select>
        }
      />

      <ProjectGate>
        {batchIds.length > 0 ? (
          <BatchPanel batchId={batchId ?? ""} runIds={batchIds} />
        ) : null}

        {selectedIds.length === 0 ? null : (
          <div
            data-slot="run-selection-bar"
            data-selected-count={selectedIds.length}
            className="mb-[12px] flex flex-wrap items-center gap-[10px] rounded-table border border-line bg-panel px-[15px] py-[11px]"
          >
            <strong className="text-[12px]">실행 {String(selectedIds.length)}건 선택됨</strong>
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted">
              삭제하면 각 실행의 증적(영상·trace·스크린샷)도 디스크에서 함께 사라집니다.
              시나리오는 지워지지 않습니다.
            </span>
            <Button
              data-testid="run-selection-clear"
              onClick={() => {
                setSelection({});
              }}
            >
              선택 해제
            </Button>
            <Button
              variant="danger"
              data-testid="run-selection-delete"
              onClick={() => {
                setDeleteOpen(true);
              }}
            >
              선택 삭제
            </Button>
          </div>
        )}

        {selectedIds.length === 0 ? null : (
          <RunDeleteDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            targets={deleteTargets}
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
                      ? bulkDeleteSummary(result, "실행 이력")
                      : `${bulkDeleteSummary(result, "실행 이력")} ${result.skipped[0]?.message ?? ""}`,
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
        )}

        <Panel title="실행 이력">
          {list.isPending ? <RunListSkeleton /> : null}

          {list.isError ? (
            <StateView
              tone="error"
              title="실행 이력을 불러오지 못했습니다"
              description={list.error.message}
              onRetry={() => void list.refetch()}
            />
          ) : null}

          {list.data !== undefined && list.data.length === 0 ? (
            <StateView
              title={status === "" ? "아직 실행 이력이 없습니다" : "조건에 맞는 실행이 없습니다"}
              description={
                status === ""
                  ? "시나리오를 발행하고 실행을 요청하면 여기에 쌓입니다."
                  : "상태 필터를 바꿔 보세요."
              }
            />
          ) : null}

          {list.data?.map((run) => {
            /*
             * ★ 진행 중인 실행은 **고를 수 없다** — 서버가 409 로 거부하는 것을 화면도
             *   같은 규칙으로 막는다. 고를 수 있게 해 놓고 "지울 수 없다"고 돌려주면
             *   사용자는 이유를 알 수 없는 실패를 본다.
             *   체크 칸을 **비우지는 않는다**(끄고 이유를 붙인다) — 근거는 `RunRow` 의
             *   `selectDisabledReason` 주석.
             */
            const active = !isTerminalRunStatus(run.status);
            return (
              <RunRow
                key={run.id}
                run={run}
                now={now}
                selected={Object.hasOwn(selection, run.id)}
                onToggle={
                  active
                    ? undefined
                    : () => {
                        toggleRun(run);
                      }
                }
                selectDisabledReason={
                  active
                    ? "진행 중인 실행은 삭제할 수 없습니다. 먼저 실행을 중단하세요."
                    : undefined
                }
              />
            );
          })}
        </Panel>
      </ProjectGate>
    </>
  );
}

/** 선택된 실행 1건의 요약. 목록이 갈려도(상태 필터) 선택이 살아남게 값을 들고 있는다. */
type RunSelection = {
  id: string;
  runCode: string;
  scenarioName: string;
};

/**
 * 묶음 실행 패널.
 *
 * 상세는 **폴링**으로 읽는다(2초, 종료되면 멈춘다). SSE 를 행마다 열지 않는 이유는
 * `useRuns.ts` 의 주석에 적어 두었다 — HTTP/1.1 에서 오리진당 동시 연결이 6개다.
 *
 * ## ★ 라운드 7 — **"병렬"이 실제로 몇 개인지 숨기지 않는다**
 * run 을 5건 만들어 놓고 "병렬 실행"이라고만 적으면, 동시성 2인 Runner 에서
 * 3건이 큐에 멈춰 있는 동안 사용자는 화면이 고장난 줄 안다. 그래서 이 패널은
 *  - 머리말에 **실행 중 / 대기 / 완료 건수와 Runner 의 동시 실행 한도**를,
 *  - 대기 중인 행에는 **큐에서 몇 번째인지**를 적는다(`GET /runs/queue` 의 관측값).
 * 한도를 모르면(Runner 미기동 등) 숫자를 지어내지 않고 모른다고 쓴다.
 */
function BatchPanel({ batchId, runIds }: { batchId: string; runIds: readonly string[] }) {
  const details = useRunDetails(runIds);
  const runs = details.map((detail) => detail.data);
  const pending = runs.some((run) => run !== undefined && !isTerminalRunStatus(run.status));

  // 묶음이 다 끝나면 큐를 더 볼 이유가 없다 — 폴링을 멈춘다.
  const queue = useRunQueue({ poll: pending });
  const waitingRunIds = queue.data?.waitingRunIds ?? [];
  const concurrency = queue.data?.concurrency ?? null;

  const running = runs.filter((run) => run?.status === "running").length;
  const queued = runs.filter((run) => run?.status === "queued").length;
  const done = runs.filter((run) => run !== undefined && isTerminalRunStatus(run.status)).length;

  return (
    <Panel
      title={`묶음 실행 · ${String(runIds.length)}건`}
      action={batchId === "" ? undefined : `batch ${batchId.slice(0, 8)}`}
      className="mb-[18px]"
    >
      <p
        data-slot="batch-progress"
        data-running={running}
        data-queued={queued}
        data-concurrency={concurrency ?? ""}
        className="m-0 border-b border-hairline px-[12px] py-[10px] text-[11px] leading-[1.6] text-muted"
      >
        <strong className="text-ink">
          실행 중 {String(running)} · 대기 {String(queued)} · 완료 {String(done)}
        </strong>
        {concurrency === null
          ? " · Runner 의 동시 실행 한도를 확인할 수 없습니다(Runner 미기동일 수 있습니다)."
          : ` · Runner 는 한 번에 최대 ${String(concurrency)}건을 동시에 실행합니다. 나머지는 큐에서 차례를 기다립니다.`}
      </p>

      {runIds.map((runId, index) => (
        <BatchRunRow
          key={runId}
          runId={runId}
          run={runs[index]}
          order={index + 1}
          total={runIds.length}
          /*
           * 큐 안에서 몇 번째인가. `jobId = runId` 규약 덕에 id 로 바로 찾는다.
           * 큐에 없으면(이미 집어 갔거나 끝났으면) `null` 이고 순번을 쓰지 않는다.
           */
          queuePosition={
            waitingRunIds.indexOf(runId) < 0 ? null : waitingRunIds.indexOf(runId) + 1
          }
        />
      ))}
    </Panel>
  );
}

function BatchRunRow({
  runId,
  run,
  order,
  total,
  queuePosition,
}: {
  runId: string;
  run: RunDetail | undefined;
  order: number;
  total: number;
  queuePosition: number | null;
}) {
  return (
    <div
      data-slot="batch-run"
      data-run-id={runId}
      data-status={run?.status ?? "loading"}
      data-queue-position={queuePosition ?? ""}
      className="tf-exec-row border-b border-hairline px-[12px] py-[13px] last:border-b-0"
    >
      <StepStatusIcon
        status={run === undefined ? "pending" : batchIconStatus(run.status)}
        sequence={order}
      />

      <div className="min-w-0">
        <Link
          to={`/runs/${runId}`}
          className="block truncate text-[13px] font-750 text-ink hover:text-brand"
        >
          {run?.scenarioName ?? "불러오는 중…"}
        </Link>
        <span className="block truncate text-[11px] text-muted">
          {order} / {total} · {run?.runCode ?? ""}
          {run === undefined
            ? ""
            : ` · ${String(run.summary.currentStep)}/${String(run.summary.totalSteps)} 단계`}
          {/*
            ★ 큐 순번은 **대기 중일 때만** 쓴다. 이미 도는 실행 옆에 순번이 남아 있으면
              "아직 기다리는 중"으로 읽힌다.
          */}
          {run?.status === "queued" && queuePosition !== null
            ? ` · 큐 대기 ${String(queuePosition)}번째`
            : ""}
        </span>
      </div>

      <span className="text-right">
        {run === undefined ? (
          <Skeleton className="h-[10px] w-[34px]" />
        ) : (
          <>
            <StatusDot tone={RUN_STATUS_TONE[run.status]}>
              {RUN_STATUS_LABEL[run.status]}
            </StatusDot>
            <span className="mt-[3px] block font-mono text-[10px] text-muted">
              {run.durationMs === null
                ? formatRelativeTime(run.startedAt)
                : formatDurationMs(run.durationMs)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

/** run 상태를 스텝 아이콘의 5-상태에 대응시킨다(색을 새로 만들지 않기 위함). */
function batchIconStatus(status: RunStatus) {
  switch (status) {
    case "passed":
      return "passed" as const;
    case "failed":
    case "timeout":
    case "error":
      return "failed" as const;
    case "running":
      return "running" as const;
    case "cancelled":
      return "skipped" as const;
    default:
      return "pending" as const;
  }
}

function RunListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="tf-run-row border-b border-hairline px-[12px] py-[13px] last:border-b-0"
        >
          <Skeleton className="h-[28px] w-[28px] rounded-chip" />
          <div>
            <Skeleton className="h-[13px] w-[42%]" />
            <Skeleton className="mt-[6px] h-[11px] w-[22%]" />
          </div>
          <Skeleton className="h-[18px] w-[56px] max-compact:hidden" />
          <Skeleton className="h-[11px] w-[40px]" />
          <Skeleton className="h-[11px] w-[48px] justify-self-end max-mobile:hidden" />
        </div>
      ))}
    </>
  );
}

function parseStatus(raw: string | null): RunStatus | "" {
  if (raw === null) return "";
  return (RUN_STATUSES as readonly string[]).includes(raw) ? (raw as RunStatus) : "";
}
