import { Link, useSearchParams } from "react-router-dom";
import { RUN_STATUSES, type RunStatus } from "@testflow/contracts";
import { ProjectGate, RunRow, StepStatusIcon } from "@/components";
import { PageHead, Panel, Select, Skeleton, StateView, StatusDot } from "@/components/ui";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, formatDurationMs, formatRelativeTime } from "@/lib";
import { useRunDetail, useRunList } from "@/hooks/useRuns";

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

          {list.data?.map((run) => (
            <RunRow key={run.id} run={run} now={now} />
          ))}
        </Panel>
      </ProjectGate>
    </>
  );
}

/**
 * 묶음 실행 패널.
 *
 * 각 행은 상세를 **폴링**으로 읽는다(2초, 종료되면 멈춘다). SSE 를 행마다 열지 않는 이유는
 * `useRuns.ts` 의 주석에 적어 두었다 — HTTP/1.1 에서 오리진당 동시 연결이 6개다.
 */
function BatchPanel({ batchId, runIds }: { batchId: string; runIds: readonly string[] }) {
  return (
    <Panel
      title={`묶음 실행 · ${String(runIds.length)}건`}
      action={batchId === "" ? undefined : `batch ${batchId.slice(0, 8)}`}
      className="mb-[18px]"
    >
      {runIds.map((runId, index) => (
        <BatchRunRow key={runId} runId={runId} order={index + 1} total={runIds.length} />
      ))}
    </Panel>
  );
}

function BatchRunRow({
  runId,
  order,
  total,
}: {
  runId: string;
  order: number;
  total: number;
}) {
  const detail = useRunDetail(runId, { poll: true });
  const run = detail.data;

  return (
    <div
      data-slot="batch-run"
      data-run-id={runId}
      data-status={run?.status ?? "loading"}
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
