import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";
import { z } from "zod";
import {
  ArtifactSchema,
  CreateRunResponseSchema,
  RunDetailSchema,
  RunListItemSchema,
  RunQueueStatusSchema,
  isTerminalRunStatus,
  type Artifact,
  type CreateRunRequest,
  type CreateRunResponse,
  type RunDetail,
  type RunListItem,
  type RunQueueStatus,
  type RunStatus,
} from "@testflow/contracts";
import { api, queryKeys } from "@/lib";
import { useCurrentProject } from "./useProject";

const RunListSchema = z.array(RunListItemSchema);
const ArtifactListSchema = z.array(ArtifactSchema);

/** 목록 기본 크기. 서버 상한은 100 이다(`RunListQuerySchema.limit`). */
export const RUN_LIST_LIMIT = 30;

export type RunListFilters = {
  status: RunStatus | "";
};

/**
 * 실행 이력 목록 (`GET /api/runs`).
 *
 * ★ 이 목록은 **SSE 를 쓰지 않는다.** 응답(`RunListItem`)에 `batchId` 도 스텝 정보도 없어
 *   이벤트를 반영할 대상이 없고, 목록 화면에서 N개 run 에 각각 SSE 를 여는 것은
 *   브라우저의 오리진당 동시 연결 한도(HTTP/1.1 에서 6)를 바로 잡아먹는다.
 *   진행 중인 실행이 하나라도 있으면 폴링으로 갱신하고, 실시간 반영은 상세 화면이 한다.
 */
export function useRunList(filters: RunListFilters) {
  const { projectId } = useCurrentProject();
  const query = {
    projectId,
    status: filters.status === "" ? undefined : filters.status,
    limit: RUN_LIST_LIMIT,
  };

  return useQuery({
    queryKey: queryKeys.runs(query),
    queryFn: () => api.get<RunListItem[]>("/runs", { query, schema: RunListSchema }),
    enabled: projectId !== undefined,
    refetchInterval: (query_) => {
      const items = query_.state.data;
      if (items === undefined) return false;
      return items.some((item) => !isTerminalRunStatus(item.status)) ? 2000 : false;
    },
  });
}

/**
 * 실행 상세 (`GET /api/runs/:id`).
 *
 * `staleTime: 0` — SSE 재연결 시 `onDesync` 가 전체 재조회를 걸어야 하는데,
 * 기본 30초 staleTime 이면 `invalidateQueries` 가 네트워크를 타지 않고 캐시로 끝난다.
 * 그러면 재연결로 메우려던 유실분이 그대로 남는다.
 */
export function useRunDetail(
  runId: string | undefined,
  options: {
    /**
     * 진행 중인 동안 2초마다 다시 읽는다.
     * ★ **상세 화면은 이걸 쓰지 않는다**(SSE 가 있다). 묶음(batch) 목록처럼
     *   run 여러 건을 동시에 보는 화면 전용이다 — 거기서 SSE 를 N 개 열면
     *   오리진당 동시 연결 한도에 먼저 걸린다.
     */
    poll?: boolean;
  } = {},
) {
  return useQuery({
    queryKey: queryKeys.run(runId ?? ""),
    queryFn: () =>
      api.get<RunDetail>(`/runs/${String(runId)}`, { schema: RunDetailSchema }),
    enabled: runId !== undefined,
    staleTime: 0,
    refetchInterval:
      options.poll === true
        ? (query) => {
            const data = query.state.data;
            if (data === undefined) return false;
            return isTerminalRunStatus(data.status) ? false : 2000;
          }
        : false,
  });
}

/**
 * ★ 라운드 7 — 묶음(batch) 화면용. run 여러 건의 상세를 **한 번에** 구독한다.
 *
 * `useRunDetail` 을 행마다 부르면 부모가 집계(몇 건이 도는 중인가)를 할 수 없다.
 * 그렇다고 부모가 또 부르면 훅을 반복문에서 부르게 된다 — `useQueries` 가 그 자리다.
 * 폴링 규칙은 `useRunDetail` 과 **같은 값**이다(종료되면 멈춘다).
 */
export function useRunDetails(runIds: readonly string[]) {
  return useQueries({
    queries: runIds.map((runId) => ({
      queryKey: queryKeys.run(runId),
      queryFn: () => api.get<RunDetail>(`/runs/${runId}`, { schema: RunDetailSchema }),
      staleTime: 0,
      refetchInterval: (query: Query<RunDetail>) => {
        const data = query.state.data;
        if (data === undefined) return false;
        return isTerminalRunStatus(data.status) ? false : 2000;
      },
    })),
  });
}

/** 증적 목록 (`GET /api/runs/:id/artifacts`). 도착은 `artifact.ready` 이벤트가 알린다. */
export function useRunArtifacts(runId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.runArtifacts(runId ?? ""),
    queryFn: () =>
      api.get<Artifact[]>(`/runs/${String(runId)}/artifacts`, { schema: ArtifactListSchema }),
    enabled: runId !== undefined && enabled,
    staleTime: 0,
  });
}

/**
 * ★ 라운드 7 — 큐 상태 (`GET /api/runs/queue`).
 *
 * **"병렬로 여러 개"가 실제로 몇 개인지**를 화면이 말하기 위한 값이다. Runner 의
 * `RUNNER_CONCURRENCY` 가 기본 2 이므로 5건을 걸면 2건만 돌고 3건은 큐에서 기다린다.
 * 이 훅이 없으면 화면은 그 사실을 알 수 없고, "병렬 실행"이라는 표시가 거짓말이 된다.
 *
 * 폴링 주기는 묶음 행(2초)과 같다. 큐는 run 상태보다 빨리 변하지 않는다.
 */
export function useRunQueue(options: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.runQueue(),
    queryFn: () => api.get<RunQueueStatus>("/runs/queue", { schema: RunQueueStatusSchema }),
    enabled: options.enabled ?? true,
    staleTime: 0,
    refetchInterval: options.poll === true ? 2000 : false,
  });
}

/**
 * 실행 요청 (`POST /api/runs` → **202**).
 *
 * ★ `variables`(계정·비밀번호)는 **이 요청 body 가 유일한 경로**다.
 *   서버는 큐 페이로드로만 넘기고 `runs` 테이블에는 컬럼 자체가 없다.
 *   그래서 여기서도 **성공 응답을 캐시에 넣지 않는다** — 넣으면 요청 body 가
 *   react-query devtools·캐시 덤프에 남는다.
 */
export function useCreateRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateRunRequest) =>
      api.post<CreateRunResponse>("/runs", body, { schema: CreateRunResponseSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
  });
}

/**
 * 실행 취소 (`POST /api/runs/:id/cancel`).
 *
 * ★ **낙관적으로 `cancelled` 를 쓰지 않는다.** API 는 큐에 있을 때만 상태를 확정하고,
 *   이미 `running` 이면 Redis 취소 채널로 **신호만** 보낸다(04-gen-5 이슈 4).
 *   최종 상태는 Runner 가 브라우저를 끊고 확정한다(04-gen-6 실측: 신호 후 515ms).
 *   그 사이에 화면이 `cancelled` 를 먼저 그리면, 실제로는 아직 도는 실행을
 *   "끝났다"고 보여 주는 거짓말이 되고 SSE 가 도착할 때 표시가 되돌아간다.
 *   → 화면은 "취소 중" 으로 두고 `run.finished` 를 기다린다.
 */
export function useCancelRun(runId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<{ status: "cancelled" }>(`/runs/${String(runId)}/cancel`),
    onSuccess: () => {
      // 상태 확정은 SSE 가 한다. 스트림이 끊겨 있을 때를 대비해 재조회만 예약한다.
      void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId ?? "") });
    },
  });
}
