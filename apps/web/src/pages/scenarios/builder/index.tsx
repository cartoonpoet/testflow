import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ProjectGate } from "@/components";
import { Button, PageHead, Panel, StateView } from "@/components/ui";
import { toast } from "@/hooks/useToast";
import { useCurrentProject } from "@/hooks/useProject";
import { useHealth } from "@/hooks/useHealth";
import { useRecording } from "@/hooks/useRecording";
import {
  moveItem,
  useAdvancedScenarioDetail,
  useScenarioBuilderMutations,
  useScenarioDetail,
} from "@/hooks/useScenarioBuilder";
import { BuilderHeader } from "./BuilderHeader";
import { Inspector } from "./Inspector";
import { RecorderPanel } from "./RecorderPanel";
import { StepList } from "./StepList";

/**
 * 화면 3 · 시나리오 만들기 (시안 `#builder`).
 *
 * ```
 * .builder  grid: minmax(0,1fr) 330px   (1050px 미만 1단, 인스펙터 static)
 *   좌: .builder-main  = 제목/기록배지 + [녹화 화면] + 스텝 카드 + ＋ 다음 스텝 추가
 *   우: .inspector     = sticky top:88px
 * ```
 *
 * 해피패스(01-clarify "UX 결정사항")를 이 한 화면에서 끝낸다 —
 * **녹화 시작 → 원격 브라우저 직접 조작 → 좌측에 스텝이 실시간으로 쌓임 →
 * 녹화 종료 → 인스펙터에서 다듬기 → 발행.**
 *
 * ★ 실행(Run)은 이 화면의 일이 아니다 — Gen-Phase 11.
 */
export function ScenarioBuilderPage() {
  const { scenarioId = "" } = useParams<{ scenarioId: string }>();
  const { project } = useCurrentProject();
  const health = useHealth();

  const detail = useScenarioDetail(scenarioId);
  const mutations = useScenarioBuilderMutations(scenarioId);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const advancedDetail = useAdvancedScenarioDetail(scenarioId, advanced);

  const recording = useRecording({
    scenarioId,
    onStopped: (steps) => {
      void detail.refetch();
      toast(`${String(steps.length)}개 단계가 시나리오에 반영되었습니다.`, { label: "녹화 종료" });
    },
  });

  // `?? []` 를 그대로 쓰면 렌더마다 새 배열이라 아래 useCallback 이 매번 다시 만들어진다.
  const steps = useMemo(() => detail.data?.steps ?? [], [detail.data]);
  // 선택값을 명시하지 않았으면 마지막 단계를 고른다(시안도 마지막 스텝이 선택돼 있다).
  // 기본값을 `useEffect` 로 밀어 넣지 않고 **파생**으로 둔다.
  const effectiveStepId = selectedStepId ?? steps[steps.length - 1]?.id ?? null;
  const selectedStep = steps.find((step) => step.id === effectiveStepId);
  const advancedStep = advancedDetail.data?.steps.find((step) => step.id === effectiveStepId);

  const onMove = useCallback(
    (fromIndex: number, toIndex: number) => {
      const ids = steps.map((step) => step.id).filter((id): id is string => id !== undefined);
      if (ids.length !== steps.length) return;
      mutations.reorderSteps.mutate(moveItem(ids, fromIndex, toIndex), {
        onSuccess: () => {
          toast("단계 순서를 바꿨습니다.", { label: "순서 변경" });
        },
        onError: (error: Error) => {
          toast(error.message, { label: "순서 변경 실패", tone: "danger" });
        },
      });
    },
    [mutations.reorderSteps, steps],
  );

  const busy =
    mutations.reorderSteps.isPending ||
    mutations.patchStep.isPending ||
    mutations.deleteStep.isPending ||
    mutations.insertStep.isPending;

  const runnerReady = health.data?.runner === "ok";

  return (
    <>
      <PageHead
        title="시나리오 만들기"
        description="기록한 행동을 업무 단계로 정리하고 기대 결과를 추가하세요."
        action={
          <div className="flex gap-[8px]">
            <Button
              data-testid="save-draft"
              disabled={detail.data === undefined || mutations.renameScenario.isPending}
              onClick={() => {
                toast("현재 내용이 저장되어 있습니다.", { label: "임시 저장" });
              }}
            >
              임시 저장
            </Button>
            <Button
              variant="primary"
              data-testid="publish"
              disabled={detail.data === undefined || mutations.publishScenario.isPending}
              onClick={() => {
                mutations.publishScenario.mutate(undefined, {
                  onSuccess: (result) => {
                    toast(`버전 ${String(result.version)} 으로 발행했습니다.`, { label: "발행" });
                  },
                  onError: (error: Error) => {
                    toast(error.message, { label: "발행 실패", tone: "danger" });
                  },
                });
              }}
            >
              발행하기
            </Button>
          </div>
        }
      />

      <ProjectGate>
        {detail.isError ? (
          <Panel>
            <StateView
              tone="error"
              title="시나리오를 불러오지 못했습니다"
              description={detail.error.message}
              onRetry={() => void detail.refetch()}
            />
          </Panel>
        ) : (
          <div className="tf-builder">
            <div className="overflow-hidden rounded-panel border border-line bg-panel">
              <BuilderHeader
                name={detail.data?.name ?? ""}
                recordState={recording.badgeState}
                disabled={detail.data === undefined}
                onRename={(name) => {
                  mutations.renameScenario.mutate(name, {
                    onSuccess: () => {
                      toast("시나리오 이름을 바꿨습니다.", { label: "저장" });
                    },
                    onError: (error: Error) => {
                      toast(error.message, { label: "저장 실패", tone: "danger" });
                    },
                  });
                }}
              />

              <RecorderPanel
                recording={recording}
                runnerReady={runnerReady}
                runnerUnknown={health.data === undefined}
                defaultStartUrl={project?.baseUrl ?? ""}
              />

              <StepList
                steps={steps}
                draftSteps={recording.draftSteps}
                selectedStepId={effectiveStepId}
                onSelect={setSelectedStepId}
                onMove={onMove}
                onAdd={() => {
                  mutations.insertStep.mutate(
                    { afterSequence: steps.length },
                    {
                      onSuccess: (created) => {
                        setSelectedStepId(created.id ?? null);
                        toast("확인 단계를 추가했습니다.", { label: "스텝 추가" });
                      },
                      onError: (error: Error) => {
                        toast(error.message, { label: "스텝 추가 실패", tone: "danger" });
                      },
                    },
                  );
                }}
                busy={busy}
                recording={recording.phase !== "idle"}
                loading={detail.isPending}
              />
            </div>

            <Inspector
              step={selectedStep}
              advanced={advanced}
              onAdvancedChange={setAdvanced}
              advancedStep={advancedStep}
              busy={busy}
              onApply={(stepId, dto) => {
                mutations.patchStep.mutate(
                  { stepId, dto },
                  {
                    onSuccess: () => {
                      toast("변경 사항을 적용했습니다.", { label: "적용" });
                    },
                    onError: (error: Error) => {
                      toast(error.message, { label: "적용 실패", tone: "danger" });
                    },
                  },
                );
              }}
              onDelete={(stepId) => {
                mutations.deleteStep.mutate(stepId, {
                  onSuccess: () => {
                    setSelectedStepId(null);
                    toast("단계를 삭제했습니다.", { label: "삭제" });
                  },
                  onError: (error: Error) => {
                    toast(error.message, { label: "삭제 실패", tone: "danger" });
                  },
                });
              }}
            />
          </div>
        )}
      </ProjectGate>
    </>
  );
}
