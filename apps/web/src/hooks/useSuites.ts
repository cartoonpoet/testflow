import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  SuiteDetailSchema,
  SuiteListItemSchema,
  type CreateSuiteDto,
  type PatchSuiteDto,
  type SuiteDetail,
  type SuiteListItem,
} from "@testflow/contracts";
import { api, queryKeys } from "@/lib";
import { useCurrentProject } from "./useProject";

const SuiteListSchema = z.array(SuiteListItemSchema);

/** 스위트 목록 (`GET /api/projects/:projectId/suites`). */
export function useSuiteList() {
  const { projectId } = useCurrentProject();

  return useQuery({
    queryKey: queryKeys.suites(projectId ?? ""),
    queryFn: () =>
      api.get<SuiteListItem[]>(`/projects/${String(projectId)}/suites`, {
        schema: SuiteListSchema,
      }),
    enabled: projectId !== undefined,
  });
}

/** 스위트 상세 (`GET /api/suites/:id`). `scenarios` 는 `sequence` 순서다. */
export function useSuiteDetail(suiteId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.suite(suiteId ?? ""),
    queryFn: () =>
      api.get<SuiteDetail>(`/suites/${String(suiteId)}`, { schema: SuiteDetailSchema }),
    enabled: suiteId !== undefined,
  });
}

/**
 * 스위트 변경 뮤테이션 묶음.
 *
 * ★ 순서 변경·시나리오 추가·제거를 **한 번의 `PATCH { scenarioIds }`** 로 한다.
 *   서버가 `suite_scenarios` 를 배열 순서대로 다시 깐다(04-gen-5 실측: 순서 뒤집기 +
 *   1건 제거가 한 요청에 반영). 빌더의 스텝 순서 변경(`PUT /steps` 전량 치환)과 달리
 *   **원본을 다시 읽을 필요가 없다** — 스위트가 들고 있는 것은 시나리오 id 뿐이라
 *   화면이 가진 값과 서버가 가진 값이 같기 때문이다(04-gen-10 이슈 1번의 css fallback
 *   같은 "화면에서 지워진 정보"가 없다).
 */
export function useSuiteMutations() {
  const queryClient = useQueryClient();
  const { projectId } = useCurrentProject();

  const invalidate = (suiteId?: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.suites(projectId ?? "") });
    if (suiteId !== undefined) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.suite(suiteId) });
    }
  };

  const create = useMutation({
    mutationFn: (dto: CreateSuiteDto) =>
      api.post<SuiteDetail>(`/projects/${String(projectId)}/suites`, dto, {
        schema: SuiteDetailSchema,
      }),
    onSuccess: (suite) => {
      invalidate(suite.id);
    },
  });

  const patch = useMutation({
    mutationFn: ({ suiteId, dto }: { suiteId: string; dto: PatchSuiteDto }) =>
      api.patch<SuiteDetail>(`/suites/${suiteId}`, dto, { schema: SuiteDetailSchema }),
    onSuccess: (suite) => {
      queryClient.setQueryData(queryKeys.suite(suite.id), suite);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (suiteId: string) => api.delete<void>(`/suites/${suiteId}`),
    onSuccess: () => {
      invalidate();
    },
  });

  return { create, patch, remove };
}

/**
 * 순서 변경 순수 함수는 빌더가 이미 갖고 있다(Gen-Phase 10).
 * 같은 규칙을 두 벌 두지 않고 그대로 재노출한다.
 */
export { moveItem } from "./useScenarioBuilder";
