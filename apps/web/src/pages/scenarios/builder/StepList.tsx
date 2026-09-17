import type { DraftStep, PublicTestStep } from "@testflow/contracts";
import { AddStepButton, StepCard } from "@/components";
import { Skeleton, StateView } from "@/components/ui";

/**
 * 시안 `.steps` (Task 10.2).
 *
 * 두 종류를 한 흐름으로 보여 준다 —
 *  ① **확정 스텝**(`test_steps`): 선택·순서 변경·삭제가 된다.
 *  ② **녹화 초안**(`{t:'step'}` 로 실시간 도착): 아직 DB 의 `test_steps` 가 아니다.
 *     녹화를 끝내야(`stop`) 확정된다. 그래서 **번호는 이어 붙이되 조작은 막는다** —
 *     아직 `id` 가 없어서 PATCH/PUT 대상이 될 수 없기도 하다.
 *
 * ★ 순서 변경은 드래그 라이브러리 없이 **버튼 + Alt+↑/↓** 다(StepCard 주석 참조).
 *   요청은 `PUT /api/scenarios/:id/steps` **전량 치환** 1건으로 나간다.
 */
export type StepListProps = {
  steps: readonly PublicTestStep[];
  draftSteps: readonly DraftStep[];
  selectedStepId: string | null;
  onSelect: (stepId: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onAdd: () => void;
  busy: boolean;
  recording: boolean;
  loading?: boolean;
};

export function StepList({
  steps,
  draftSteps,
  selectedStepId,
  onSelect,
  onMove,
  onAdd,
  busy,
  recording,
  loading = false,
}: StepListProps) {
  if (loading) return <StepListSkeleton />;

  const empty = steps.length === 0 && draftSteps.length === 0;

  return (
    <div data-slot="steps" className="p-[18px]">
      {empty ? (
        <StateView
          title={recording ? "조작을 기다리고 있습니다" : "아직 기록된 단계가 없습니다"}
          description={
            recording
              ? "오른쪽(또는 아래) 화면에서 대상 서비스를 직접 조작하면 단계가 여기에 쌓입니다."
              : "녹화를 시작해 브라우저를 조작하거나, 아래에서 확인 단계를 직접 추가하세요."
          }
        />
      ) : null}

      <ol className="m-0 list-none p-0">
        {steps.map((step, index) => (
          <StepCard
            key={step.id ?? `seq-${String(step.sequence)}`}
            step={step}
            sequence={step.sequence}
            selected={step.id !== undefined && step.id === selectedStepId}
            onSelect={
              step.id === undefined
                ? undefined
                : () => {
                    onSelect(step.id as string);
                  }
            }
            busy={busy}
            {...(index > 0
              ? {
                  onMoveUp: () => {
                    onMove(index, index - 1);
                  },
                }
              : {})}
            {...(index < steps.length - 1
              ? {
                  onMoveDown: () => {
                    onMove(index, index + 1);
                  },
                }
              : {})}
          />
        ))}
      </ol>

      {draftSteps.length === 0 ? null : (
        <>
          <p className="mb-[8px] mt-[4px] text-[10px] font-750 tracking-caps text-danger">
            기록 중 · 녹화를 끝내면 확정됩니다
          </p>
          <ol data-slot="draft-steps" className="m-0 list-none p-0">
            {draftSteps.map((step, index) => (
              <StepCard
                key={`draft-${String(index)}`}
                step={step}
                sequence={steps.length + index + 1}
              />
            ))}
          </ol>
        </>
      )}

      <AddStepButton onClick={onAdd} disabled={busy || recording} />
    </div>
  );
}

/** 표와 같은 모양으로 자리를 잡아 둔다 — 데이터가 와도 화면이 튀지 않게. */
export function StepListSkeleton() {
  return (
    <div data-slot="steps-skeleton" className="p-[18px]">
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="mb-[10px] grid grid-cols-[34px_1fr_auto] items-center gap-[12px] rounded-step border border-line px-[14px] py-[13px]"
        >
          <Skeleton className="h-[28px] w-[28px] rounded-chip" />
          <div>
            <Skeleton className="h-[13px] w-[46%]" />
            <Skeleton className="mt-[6px] h-[11px] w-[64%]" />
          </div>
          <Skeleton className="h-[12px] w-[18px]" />
        </div>
      ))}
    </div>
  );
}
