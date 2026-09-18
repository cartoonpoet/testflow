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
  /** 툴바 "기능" 선택지. 목록 필터와 달리 **필터 없이** 한 번만 읽는다. */
  scenarioFeatures: (projectId: string) =>
    ["projects", projectId, "scenario-features"] as const,
  /**
   * 빌더가 읽는 시나리오 상세.
   * `advanced` 가 키에 들어간다 — 같은 시나리오라도 **응답 모양이 다르기 때문**이다
   * (기본 응답은 css 후보가 제거된 `PublicTestStep`, `?advanced=1` 은 원본 `TestStep`).
   * 한 키에 두 모양을 섞으면 고급 설정을 껐다 켤 때 캐시가 서로를 덮어쓴다.
   */
  scenario: (id: string, advanced = false) =>
    (advanced ? ["scenarios", id, "advanced"] : ["scenarios", id]) as readonly string[],
  /**
   * 코드 시나리오 본문(`GET /api/scenarios/:id/code`). 라운드 2 추가.
   * 상세(`scenario`)와 **분리한다** — 목록·상세가 코드 본문을 끌고 오지 않는 서버 구조
   * (04-gen-2 §6)를 캐시에서도 깨지 않기 위해서다.
   */
  scenarioCode: (id: string) => ["scenarios", id, "code"] as const,
  /**
   * 실행 라이브 스트림 접속 정보(`GET /api/runs/:id/live`). 토큰이 실려 있어 캐시 수명이 짧다.
   *
   * ★ **일부러 `["runs", id, …]` 아래에 두지 않는다** (Gen-Phase 6 에서 실측으로 발견한 버그).
   *   `useRunEvents` 는 `run.finished` 와 SSE desync 에서
   *   `invalidateQueries({ queryKey: queryKeys.run(id) })` 를 부르는데, react-query 의
   *   무효화는 **접두 일치**라 `["runs", id, "live"]` 까지 함께 무효화된다.
   *   그러면 —
   *     ① 토큰 쿼리가 다시 돌아 **새 토큰이 발급되고**, 키가 하나라 **지금 붙어 있는
   *        소켓의 토큰이 무효**가 된다(04-gen-5 결정 3이 막으려던 바로 그 동작이다).
   *     ② 실행이 이미 끝난 뒤라면 `GET …/live` 가 **404**(종료된 run)라서
   *        브라우저 콘솔에 실패가 한 줄 남는다 — 실측: `+8494ms 404 …/live`.
   *   키 공간을 분리하면 접두가 겹치지 않아 둘 다 사라진다.
   *   (`staleTime: Infinity` 는 무효화를 막지 못한다 — 무효화는 stale 여부와 무관하다.)
   */
  runLive: (id: string) => ["run-live", id] as const,
  suites: (projectId: string) => ["projects", projectId, "suites"] as const,
  suite: (id: string) => ["suites", id] as const,
  runs: (filters?: Readonly<Record<string, unknown>>) =>
    ["runs", filters ?? {}] as const,
  run: (id: string) => ["runs", id] as const,
  runArtifacts: (id: string) => ["runs", id, "artifacts"] as const,
  /**
   * `projectId` 를 키에 넣는다 — 서버가 `?projectId` 로 집계를 좁히므로
   * 프로젝트가 바뀌면 다른 값이다. (Gen-Phase 9 에서 인자 1개 → 2개로 넓혔다.)
   */
  dashboardSummary: (projectId: string | undefined, range: string) =>
    ["dashboard", "summary", projectId ?? "all", range] as const,
  dashboardReadiness: (projectId: string | undefined) =>
    ["dashboard", "readiness", projectId ?? "all"] as const,
  recording: (sessionId: string) => ["recordings", sessionId] as const,
  health: () => ["health"] as const,
} as const;
