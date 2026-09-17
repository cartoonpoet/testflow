import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  DashboardReadinessSchema,
  DashboardSummarySchema,
  RunListItemSchema,
  type DashboardReadiness,
  type DashboardSummary,
  type RunListItem,
} from "@testflow/contracts";
import { api, queryKeys } from "@/lib";
import { useCurrentProject } from "./useProject";

/** `?range=` 는 화면 전용 조회 옵션이라 contracts 에 없다(04-gen-5 주석 참조). */
export type DashboardRange = "today" | "7d" | "30d";

/** 시안 "최근 실행" 패널이 보여 주는 행 수. */
export const RECENT_RUNS_LIMIT = 8;

const RunListSchema = z.array(RunListItemSchema);

/**
 * 대시보드 3개 조회를 한 훅에 묶는다.
 *
 * - **`useEffect` 없음.** 서버 상태는 전부 react-query 다.
 * - 세 쿼리는 **각각 독립적으로** 로딩·에러를 가진다. 하나가 죽어도 나머지 패널은 그린다
 *   (시안에 없는 에러 설계 — 04-gen-9 "로딩·빈 상태·에러 설계" 참조).
 * - `projectId` 가 아직 없으면(프로젝트 조회 중) `enabled:false` 로 대기한다.
 *   `?projectId` 없이 먼저 쏘면 전 프로젝트 집계가 잠깐 보였다가 값이 바뀐다.
 */
export function useDashboardSummary(range: DashboardRange = "today") {
  const { projectId } = useCurrentProject();

  return useQuery({
    queryKey: queryKeys.dashboardSummary(projectId, range),
    queryFn: () =>
      api.get<DashboardSummary>("/dashboard/summary", {
        query: { projectId, range },
        schema: DashboardSummarySchema,
      }),
    enabled: projectId !== undefined,
  });
}

export function useDashboardReadiness() {
  const { projectId } = useCurrentProject();

  return useQuery({
    queryKey: queryKeys.dashboardReadiness(projectId),
    queryFn: () =>
      api.get<DashboardReadiness>("/dashboard/readiness", {
        query: { projectId },
        schema: DashboardReadinessSchema,
      }),
    enabled: projectId !== undefined,
  });
}

export function useRecentRuns(limit: number = RECENT_RUNS_LIMIT) {
  const { projectId } = useCurrentProject();

  return useQuery({
    queryKey: queryKeys.runs({ projectId, limit }),
    queryFn: () =>
      api.get<RunListItem[]>("/runs", {
        query: { projectId, limit },
        schema: RunListSchema,
      }),
    enabled: projectId !== undefined,
  });
}
