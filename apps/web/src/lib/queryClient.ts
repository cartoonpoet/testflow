import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

/**
 * 서버 상태는 전부 react-query 로 둔다. 로컬 state 는 편집 중 임시값뿐이다.
 *
 * - `staleTime` 30초: 대시보드·목록은 실시간성이 요구되지 않는다.
 *   실행 중 상태는 polling 이 아니라 SSE(`lib/sse.ts`)로 받는다.
 * - 4xx 는 재시도하지 않는다 — 요청이 잘못된 것이므로 반복해도 같다.
 */
export const DEFAULT_STALE_TIME_MS = 30_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/**
 * 쿼리 키 사전.
 * Gen-Phase 9~11 이 새 키를 만들 때도 여기에 추가한다 — 무효화 대상을 한눈에 보기 위함.
 */
export const queryKeys = {
  projects: () => ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  scenarios: (projectId: string, filters?: Readonly<Record<string, unknown>>) =>
    ["projects", projectId, "scenarios", filters ?? {}] as const,
  scenario: (id: string) => ["scenarios", id] as const,
  suites: (projectId: string) => ["projects", projectId, "suites"] as const,
  suite: (id: string) => ["suites", id] as const,
  runs: (filters?: Readonly<Record<string, unknown>>) =>
    ["runs", filters ?? {}] as const,
  run: (id: string) => ["runs", id] as const,
  runArtifacts: (id: string) => ["runs", id, "artifacts"] as const,
  dashboardSummary: (range: string) => ["dashboard", "summary", range] as const,
  dashboardReadiness: () => ["dashboard", "readiness"] as const,
  recording: (sessionId: string) => ["recordings", sessionId] as const,
  health: () => ["health"] as const,
} as const;
