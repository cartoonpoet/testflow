import type { ScenarioSourceType } from "@testflow/contracts";
import { DeleteDialog, DeleteTargetList, DeleteTargetRow } from "@/components";

/**
 * 시나리오 삭제 확인 — **목록(다중)·빌더·코드 편집 화면이 같은 것을 쓴다** (라운드 8).
 *
 * ════════════════════════════════════════════════════════════════════
 * ## ★ 무엇이 지워지는지를 **실제 개수로** 적는다
 * "정말 삭제하시겠습니까?" 는 아무것도 알려 주지 않는다. 여기서는 대상마다
 * **코드 · 이름 · 딸린 것의 개수**를 적는다. 개수를 **모르면 쓰지 않는다** —
 * 목록 화면은 첨부 개수를 모르고(목록 응답에 없다), 코드 편집 화면은 안다.
 * 지어낸 숫자는 확인 대화상자를 거짓말로 만든다.
 *
 * ## ★ 실행 이력은 남는다는 사실을 **그 자리에서** 말한다
 * `runs.scenario_id` 는 `ON DELETE SET NULL` 이라 이력은 살아남는다(증적이므로).
 * 이 말을 안 하면 사용자는 둘 중 하나로 오해한다 — "이력도 지워지겠지"(놀람) 또는
 * "실행 이력을 지우려면 시나리오를 지워야겠네"(잘못된 조작).
 * ════════════════════════════════════════════════════════════════════
 */
export type ScenarioDeleteTarget = {
  id: string;
  name: string;
  code: string;
  sourceType: ScenarioSourceType;
  stepCount: number;
  /** 아는 화면만 준다(코드 편집 화면). `undefined` = 모른다 — 숫자를 쓰지 않는다. */
  attachmentCount?: number;
  /** 아는 화면만 준다. `undefined` = 모른다. */
  hasCode?: boolean;
};

export type ScenarioDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: readonly ScenarioDeleteTarget[];
  pending?: boolean;
  onConfirm: () => void;
};

export function ScenarioDeleteDialog({
  open,
  onOpenChange,
  targets,
  pending = false,
  onConfirm,
}: ScenarioDeleteDialogProps) {
  const single = targets.length === 1 ? targets[0] : undefined;

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        single === undefined
          ? `시나리오 ${String(targets.length)}건을 삭제할까요?`
          : "이 시나리오를 삭제할까요?"
      }
      description={
        single === undefined
          ? `아래 ${String(targets.length)}건과 각각에 딸린 것이 모두 삭제됩니다.`
          : `${single.code} · ${single.name}`
      }
      warning={
        <>
          시나리오에 딸린 <strong>스텝 · 코드 본문 · 첨부파일</strong>이 함께 사라집니다.
          다만 <strong>실행 이력(RUN-…)은 그대로 남습니다</strong> — 이력은 증적이라 지우지
          않습니다. 이력까지 지우려면 실행 목록에서 따로 삭제하세요.
        </>
      }
      confirmLabel={single === undefined ? `${String(targets.length)}건 삭제` : "삭제"}
      confirmTestId="scenario-delete-confirm"
      pending={pending}
      onConfirm={onConfirm}
    >
      <DeleteTargetList>
        {targets.map((target) => (
          <DeleteTargetRow
            key={target.id}
            title={target.name}
            detail={`${target.code} · ${belongings(target)}`}
          />
        ))}
      </DeleteTargetList>
    </DeleteDialog>
  );
}

/**
 * "무엇이 딸려 있는가" 한 줄.
 *
 * - 녹화 시나리오: `스텝 N개` (목록·상세 응답 모두가 주는 값이다).
 * - 코드 시나리오: `stepCount` 는 **언제나 0**이라(테이블에 행이 없다) 쓰면 오해를 만든다.
 *   본문 유무를 아는 화면에서만 그것을 적고, 모르면 종류만 적는다.
 * - 첨부는 아는 화면에서만.
 */
export function belongings(target: ScenarioDeleteTarget): string {
  const parts: string[] = [];

  if (target.sourceType === "code") {
    parts.push(
      target.hasCode === undefined
        ? "코드 시나리오"
        : target.hasCode
          ? "코드 본문 1건"
          : "코드 본문 없음",
    );
  } else {
    parts.push(`스텝 ${String(target.stepCount)}개`);
  }

  if (target.attachmentCount !== undefined) {
    parts.push(`첨부 ${String(target.attachmentCount)}개`);
  }
  return parts.join(" · ");
}
