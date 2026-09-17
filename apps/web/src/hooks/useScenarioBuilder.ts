import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  DEFAULT_STEP_OPTIONS,
  PublicTestStepSchema,
  PublishScenarioResponseSchema,
  ScenarioSchema,
  TestStepSchema,
  type PatchStepDto,
  type PublicTestStep,
  type PublishScenarioResponse,
  type Scenario,
  type TestStep,
} from "@testflow/contracts";
import { api, queryKeys } from "@/lib";

/**
 * 빌더의 서버 상태 — 시나리오 상세 + 스텝 편집 mutation 묶음.
 *
 * ★ **응답 스키마를 contracts 조각으로 조립한다.** `ScenarioDetailSchema`(contracts)는
 *   `steps: TestStep[]` 인데, API 기본 응답의 스텝은 **css 가 제거된 `PublicTestStep`**
 *   (`target.primary` 가 null 일 수 있다)이라 그 스키마로 파싱하면 계약 위반으로 떨어진다.
 *   그래서 `ScenarioSchema` + `PublicTestStepSchema` 로 조립한다. **재정의가 아니라 조립**이다.
 */
const ScenarioDetailPublicSchema = ScenarioSchema.extend({
  steps: z.array(PublicTestStepSchema),
});
export type ScenarioDetailPublic = z.infer<typeof ScenarioDetailPublicSchema>;

/** `?advanced=1` 응답 — css 후보가 살아 있는 원본. 순서 변경 전송에만 쓴다(아래 주석). */
const ScenarioDetailAdvancedSchema = ScenarioSchema.extend({
  steps: z.array(TestStepSchema),
});
export type ScenarioDetailAdvanced = z.infer<typeof ScenarioDetailAdvancedSchema>;

export function useScenarioDetail(scenarioId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scenario(scenarioId ?? ""),
    queryFn: () =>
      api.get<ScenarioDetailPublic>(`/scenarios/${String(scenarioId)}`, {
        schema: ScenarioDetailPublicSchema,
      }),
    enabled: scenarioId !== undefined && scenarioId !== "",
  });
}

/**
 * 고급 설정(`?advanced=1`) 조회.
 *
 * ★ **토글이 켜졌을 때만 요청한다.** 꺼져 있으면 `enabled:false` 라 네트워크에
 *   css 문자열이 아예 오지 않는다. "화면에 안 그린다"가 아니라 "받지 않는다"가
 *   더 강한 보장이라 이렇게 갈랐다(02-context 제약).
 */
export function useAdvancedScenarioDetail(scenarioId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.scenario(scenarioId ?? "", true),
    queryFn: () =>
      api.get<ScenarioDetailAdvanced>(`/scenarios/${String(scenarioId)}`, {
        query: { advanced: 1 },
        schema: ScenarioDetailAdvancedSchema,
      }),
    enabled: enabled && scenarioId !== undefined && scenarioId !== "",
  });
}

function invalidateScenario(client: QueryClient, scenarioId: string): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.scenario(scenarioId) }),
    client.invalidateQueries({ queryKey: queryKeys.scenario(scenarioId, true) }),
  ]).then(() => undefined);
}

export type ScenarioBuilderMutations = ReturnType<typeof useScenarioBuilderMutations>;

export function useScenarioBuilderMutations(scenarioId: string) {
  const client = useQueryClient();
  const settle = () => invalidateScenario(client, scenarioId);

  /** 제목 인라인 편집 / 임시 저장. */
  const renameScenario = useMutation({
    mutationFn: (name: string) =>
      api.patch<Scenario>(`/scenarios/${scenarioId}`, { name }, { schema: ScenarioSchema }),
    onSuccess: settle,
  });

  const publishScenario = useMutation({
    mutationFn: () =>
      api.post<PublishScenarioResponse>(`/scenarios/${scenarioId}/publish`, undefined, {
        schema: PublishScenarioResponseSchema,
      }),
    onSuccess: settle,
  });

  /** 인스펙터 "적용". */
  const patchStep = useMutation({
    mutationFn: ({ stepId, dto }: { stepId: string; dto: PatchStepDto }) =>
      api.patch<PublicTestStep>(`/steps/${stepId}`, dto, { schema: PublicTestStepSchema }),
    onSuccess: settle,
  });

  /**
   * 인스펙터 "삭제".
   *
   * `DELETE /api/steps/:id` 는 서버가 뒤 스텝의 `sequence` 를 당겨 준다.
   * 같은 일을 `PUT` 전량 치환으로 해도 되지만, 그러면 **지우려고 css 후보를 한 바퀴
   * 돌려야 한다**(아래 `reorderSteps` 주석). 삭제는 전용 엔드포인트가 더 안전하다.
   */
  const deleteStep = useMutation({
    mutationFn: (stepId: string) => api.delete<void>(`/steps/${stepId}`),
    onSuccess: settle,
  });

  /** "＋ 다음 스텝 추가" — 마지막(또는 선택한 스텝) 뒤에 확인 단계 1건을 넣는다. */
  const insertStep = useMutation({
    mutationFn: ({ afterSequence }: { afterSequence: number }) =>
      api.post<PublicTestStep>(
        `/scenarios/${scenarioId}/steps`,
        {
          afterSequence,
          step: {
            name: "새 확인 단계",
            // target 이 필요 없는 유일한 검증 동작이라 빈 스텝으로도 계약을 만족한다.
            actionType: "assert_url",
            input: { value: "", isSecret: false },
            options: DEFAULT_STEP_OPTIONS,
          },
        },
        { schema: PublicTestStepSchema },
      ),
    onSuccess: settle,
  });

  /**
   * 순서 변경 — `PUT /api/scenarios/:id/steps` **전량 치환**.
   *
   * ★ 여기가 이 파일에서 가장 조심스러운 곳이다. 두 가지 때문이다.
   *
   * ① **`sequence` 는 1부터 연속이어야 한다.** 어긋나면 `TestStepArraySchema` 가
   *    DB 에 닿기 전에 400 을 낸다(04-gen-4 실측). 그래서 순서대로 1..n 을 다시 매긴다.
   *
   * ② **화면이 들고 있는 스텝(공개형)을 그대로 PUT 하면 css fallback 이 사라진다.**
   *    기본 응답에는 css 후보가 없으므로, 그걸 되돌려 보내면 서버는 "css 가 없는 스텝"으로
   *    덮어쓴다 — 순서만 바꿨는데 Locator 체인이 조용히 열화된다. 심지어 primary 가
   *    원래 css 였던 스텝은 `primary:null` 이라 400 이 난다.
   *    → 전송 직전에 **`?advanced=1` 로 원본을 새로 읽어** 그것으로 보낸다.
   *    css 는 이 함수의 지역 변수로만 존재하고 **React 상태에도 DOM 에도 들어가지 않는다.**
   */
  const reorderSteps = useMutation({
    mutationFn: async (orderedStepIds: readonly string[]) => {
      const detail = await api.get<ScenarioDetailAdvanced>(`/scenarios/${scenarioId}`, {
        query: { advanced: 1 },
        schema: ScenarioDetailAdvancedSchema,
      });
      const byId = new Map(detail.steps.map((step) => [step.id, step] as const));

      const steps: TestStep[] = [];
      orderedStepIds.forEach((id, index) => {
        const step = byId.get(id);
        if (step === undefined) return;
        steps.push({ ...step, sequence: index + 1 });
      });
      if (steps.length !== detail.steps.length) {
        throw new Error("순서를 바꾸는 사이 스텝이 변경되었습니다. 새로고침 후 다시 시도하세요.");
      }

      return api.put(`/scenarios/${scenarioId}/steps`, { steps });
    },
    onSuccess: settle,
  });

  return {
    renameScenario,
    publishScenario,
    patchStep,
    deleteStep,
    insertStep,
    reorderSteps,
  };
}

/** 배열에서 `from` 위치를 `to` 로 옮긴 새 배열. 범위를 벗어나면 원본을 그대로 돌려준다. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(to, 0, moved);
  return next;
}
