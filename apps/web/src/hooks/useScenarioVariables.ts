import { useQuery } from "@tanstack/react-query";
import {
  ScenarioVariablesResponseSchema,
  type ScenarioVariablesResponse,
} from "@testflow/contracts";
import { api, queryKeys } from "@/lib";

/**
 * 실행에 필요한 변수 목록 (`GET /api/scenarios/:id/variables`).
 *
 * ★ **시나리오 상세와 다른 쿼리 키**다. 서버가 상세에 얹지 않은 것과 같은 이유이고
 *   (`scenario-variables.service.ts` 머리 주석), 캐시에서도 그 분리를 유지한다.
 *
 * ★ `staleTime` 을 길게 잡지 않는다 — 코드를 고치고 바로 실행하는 것이 이 도구의 흐름이라
 *   방금 추가한 `TESTFLOW_VAR_*` 가 다이얼로그에 안 뜨면 "안 되는 기능"으로 읽힌다.
 *   다이얼로그를 열 때만 도는 쿼리라 비용도 작다(`enabled`).
 *
 * ★ **다이얼로그가 열렸을 때만 켠다.** 목록 화면이 행마다 이걸 부르면 코드 본문을
 *   행 수만큼 읽게 된다.
 */
export function useScenarioVariables(scenarioId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.scenarioVariables(scenarioId ?? ""),
    queryFn: () =>
      api.get<ScenarioVariablesResponse>(`/scenarios/${String(scenarioId)}/variables`, {
        schema: ScenarioVariablesResponseSchema,
      }),
    enabled: enabled && scenarioId !== undefined && scenarioId !== "",
    staleTime: 0,
  });
}
