import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  CodeValidationIssueSchema,
  ScenarioCodeSchema,
  type CodeValidationIssue,
  type PutScenarioCodeDto,
  type ScenarioCode,
} from "@testflow/contracts";
import { ApiError, api, queryKeys } from "@/lib";

/**
 * 코드 시나리오 본문 조회·저장 (`GET`/`PUT /api/scenarios/:id/code`).
 *
 * ★ **업로드 전용 엔드포인트는 없다.** 파일은 브라우저에서 `File.text()` 로 읽어
 *   같은 `PUT` 으로 보낸다(04-gen-2 §5 — multipart 를 받으려면 API 의 `bodyParser:false`
 *   부트스트랩에 미들웨어를 얹어야 하고, 코드는 애초에 텍스트다).
 *
 * ★ 본문은 **시나리오 상세와 다른 쿼리 키**다. 목록·상세가 코드 본문을 끌고 오지 않는
 *   서버 구조(1:1 분리 테이블)를 화면 캐시에서도 깨지 않기 위해서다.
 */

const IssueListSchema = z.array(CodeValidationIssueSchema);

/**
 * 400 응답에서 `CodeValidationIssue[]` 를 뽑는다.
 *
 * ★ `ZodValidationPipe` 의 400 은 `details: [{path, message}]` 라 **모양이 다르다**
 *   (04-gen-2 전달 10번). 여기서는 `CodeValidationIssueSchema` 로 파싱을 시도하고
 *   실패하면 빈 배열을 돌려준다 — 모양이 다른 400 은 `ApiError.message` 가 이미 설명한다.
 */
export function extractCodeIssues(error: unknown): CodeValidationIssue[] {
  if (!(error instanceof ApiError)) return [];
  const body: unknown = error.body;
  if (typeof body !== "object" || body === null) return [];
  const parsed = IssueListSchema.safeParse((body as { details?: unknown }).details);
  return parsed.success ? parsed.data : [];
}

/**
 * 본문 조회. **아직 저장한 적이 없으면 404** 이고, 그건 오류가 아니라 "비었다" 다.
 * 그래서 404 만 `null` 로 바꿔 화면이 빈 에디터를 열 수 있게 한다.
 */
export function useScenarioCode(scenarioId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scenarioCode(scenarioId ?? ""),
    queryFn: async (): Promise<ScenarioCode | null> => {
      try {
        return await api.get<ScenarioCode>(`/scenarios/${String(scenarioId)}/code`, {
          schema: ScenarioCodeSchema,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: scenarioId !== undefined && scenarioId !== "",
  });
}

export function useSaveScenarioCode(scenarioId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (dto: PutScenarioCodeDto) =>
      api.put<ScenarioCode>(`/scenarios/${scenarioId}/code`, dto, {
        schema: ScenarioCodeSchema,
      }),
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.scenarioCode(scenarioId), saved);
      // 발행 가능 여부·수정일이 바뀐다.
      void client.invalidateQueries({ queryKey: queryKeys.scenario(scenarioId) });
    },
  });
}
