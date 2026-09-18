import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ScenarioAttachmentListSchema,
  ScenarioAttachmentSchema,
  type ScenarioAttachment,
  type ScenarioAttachmentList,
} from "@testflow/contracts";
import { api, queryKeys } from "@/lib";

/**
 * 시나리오 첨부파일(테스트 데이터) 목록·업로드·삭제 (라운드 3).
 *
 * ## ★ 업로드는 `application/octet-stream` **raw body** 다 — `FormData` 가 아니다
 * 서버에 `multer`/`busboy` 를 추가하지 않기 위해서다(라운드 1·2 기조). `api.ts` 가
 * 이미 갖고 있던 **`rawBody` 탈출구**를 처음으로 쓴다 — 새 클라이언트 코드도 없다.
 *
 * ## ★ 파일명·content type 은 **쿼리스트링**으로 간다
 * `테스트용 파일-1.docx` 를 커스텀 헤더로 보내면 헤더가 latin1 로 해석돼 깨진다
 * (`fetch` 는 non-ISO-8859-1 헤더 값을 거부하기도 한다). `buildUrl()` 의
 * `URLSearchParams` 가 퍼센트 인코딩을 해 주므로 한글이 **무손실로** 왕복한다.
 *
 * ## `File.arrayBuffer()` 를 쓴다 — base64 로 바꾸지 않는다
 * base64 는 33% 를 부풀리기만 하고 얻는 것이 없다. `Blob`/`ArrayBuffer` 는 `fetch` 의
 * `body` 로 그대로 나간다.
 */

export function useScenarioAttachments(scenarioId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scenarioAttachments(scenarioId ?? ""),
    queryFn: () =>
      api.get<ScenarioAttachmentList>(`/scenarios/${String(scenarioId)}/attachments`, {
        schema: ScenarioAttachmentListSchema,
      }),
    enabled: scenarioId !== undefined && scenarioId !== "",
  });
}

export function useUploadScenarioAttachment(scenarioId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (file: File): Promise<ScenarioAttachment> => {
      const bytes = await file.arrayBuffer();
      return api.post<ScenarioAttachment>(`/scenarios/${scenarioId}/attachments`, undefined, {
        rawBody: bytes,
        // ★ 이 값이 `application/octet-stream` 이어야 서버의 raw 파서가 돈다.
        //   원본 MIME 은 `contentType` 쿼리로 따로 보낸다.
        headers: { "Content-Type": "application/octet-stream" },
        query: { filename: file.name, contentType: file.type === "" ? undefined : file.type },
        schema: ScenarioAttachmentSchema,
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.scenarioAttachments(scenarioId) });
    },
  });
}

export function useDeleteScenarioAttachment(scenarioId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (attachmentId: string) =>
      api.delete<void>(`/scenarios/${scenarioId}/attachments/${attachmentId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.scenarioAttachments(scenarioId) });
    },
  });
}
