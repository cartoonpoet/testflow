import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  SCENARIO_STATUSES,
  ScenarioListResponseSchema,
  type ScenarioListResponse,
  type ScenarioStatus,
} from "@testflow/contracts";
import { api, queryKeys } from "@/lib";
import { useCurrentProject } from "./useProject";

/** 목록 1페이지 크기. 서버 기본값과 같다(`ScenarioListQuerySchema.size`). */
export const SCENARIO_PAGE_SIZE = 20;

/** 기능 선택지를 만들려고 한 번 읽는 크기. 서버 상한(100)과 같다. */
const FEATURE_SCAN_SIZE = 100;

/** 툴바의 "전체 상태" / "모든 기능" — 빈 문자열이 곧 미선택이다. */
export const FILTER_ALL = "";

export type ScenarioFilters = {
  q: string;
  status: ScenarioStatus | typeof FILTER_ALL;
  feature: string;
  page: number;
};

export type ScenarioFilterPatch = Partial<Omit<ScenarioFilters, "page">> & { page?: number };

function parseStatus(raw: string | null): ScenarioStatus | typeof FILTER_ALL {
  if (raw === null) return FILTER_ALL;
  return (SCENARIO_STATUSES as readonly string[]).includes(raw)
    ? (raw as ScenarioStatus)
    : FILTER_ALL;
}

function parsePage(raw: string | null): number {
  const page = Number(raw ?? "1");
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * 툴바 필터 ↔ URL 쿼리스트링 동기화.
 *
 * ★ **URL 이 단일 진실이다.** 로컬 state 사본을 두지 않았다 —
 *   사본을 두면 URL→state 를 맞추느라 `useEffect` 가 필요해지고(금지),
 *   뒤로가기·새로고침·링크 공유에서 값이 어긋난다.
 *
 * ★ 히스토리는 `replace` 다. 검색어는 한 글자마다 바뀌므로 push 로 쌓으면
 *   뒤로가기가 글자 단위로 되돌아가는 쓸모없는 히스토리가 된다.
 *
 * ★ q·status·feature 가 바뀌면 **page 를 1 로 되돌린다.** 3페이지에서 검색어를 치면
 *   결과가 1페이지뿐인데 3페이지를 요청해 빈 화면이 나오기 때문이다.
 */
export function useScenarioFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<ScenarioFilters>(
    () => ({
      q: searchParams.get("q") ?? "",
      status: parseStatus(searchParams.get("status")),
      feature: searchParams.get("feature") ?? "",
      page: parsePage(searchParams.get("page")),
    }),
    [searchParams],
  );

  const setFilters = useCallback(
    (patch: ScenarioFilterPatch) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const resetsPage = "q" in patch || "status" in patch || "feature" in patch;

          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === "" || value === 1) next.delete(key);
            else next.set(key, String(value));
          }
          if (resetsPage && patch.page === undefined) next.delete("page");

          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const reset = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const isFiltered =
    filters.q !== "" || filters.status !== FILTER_ALL || filters.feature !== "";

  return { filters, setFilters, reset, isFiltered };
}

/**
 * 시나리오 목록.
 *
 * `placeholderData: keepPreviousData` — 검색어를 한 글자 칠 때마다 쿼리 키가 바뀌는데,
 * 그때마다 테이블이 스켈레톤으로 돌아가면 화면이 깜빡인다. 이전 페이지를 유지하고
 * `isPlaceholderData` 로 흐리게만 표시한다.
 */
export function useScenarioList(filters: ScenarioFilters, size = SCENARIO_PAGE_SIZE) {
  const { projectId } = useCurrentProject();
  const query = {
    q: filters.q === "" ? undefined : filters.q,
    status: filters.status === FILTER_ALL ? undefined : filters.status,
    feature: filters.feature === "" ? undefined : filters.feature,
    page: filters.page,
    size,
  };

  return useQuery({
    queryKey: queryKeys.scenarios(projectId ?? "", query),
    queryFn: () =>
      api.get<ScenarioListResponse>(`/projects/${String(projectId)}/scenarios`, {
        query,
        schema: ScenarioListResponseSchema,
      }),
    enabled: projectId !== undefined,
    placeholderData: keepPreviousData,
  });
}

/**
 * 툴바 "기능" 선택지.
 *
 * 서버에 distinct 기능 목록 엔드포인트가 없다(04-gen-4·5 의 라우트 32개에 없음).
 * 그래서 **필터 없이 최대 100건**을 읽어 `feature` 를 distinct 한다.
 * 시나리오가 100건을 넘으면 뒤쪽 기능이 선택지에서 빠질 수 있다 —
 * 이건 알고 감수한 한계이고, 넘어가면 API 에 `GET /projects/:id/features` 를 추가해야 한다.
 */
export function useScenarioFeatures() {
  const { projectId } = useCurrentProject();

  return useQuery({
    queryKey: queryKeys.scenarioFeatures(projectId ?? ""),
    queryFn: async () => {
      const response = await api.get<ScenarioListResponse>(
        `/projects/${String(projectId)}/scenarios`,
        { query: { page: 1, size: FEATURE_SCAN_SIZE }, schema: ScenarioListResponseSchema },
      );
      const features = new Set<string>();
      for (const item of response.items) {
        if (item.feature !== null && item.feature !== "") features.add(item.feature);
      }
      return [...features].sort((a, b) => a.localeCompare(b, "ko"));
    },
    enabled: projectId !== undefined,
  });
}
