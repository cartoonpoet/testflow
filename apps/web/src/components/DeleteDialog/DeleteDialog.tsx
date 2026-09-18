import type * as React from "react";
import { Button, Modal } from "@/components/ui";
import { NoticeBox, NoticeLine } from "@/components/NoticeBox";

/**
 * 삭제 확인 대화상자 — 시나리오·실행 이력이 **한 벌을 같이 쓴다** (라운드 8).
 *
 * ════════════════════════════════════════════════════════════════════
 * ## ★ 새 라이브러리도 새 색도 없다
 * 본체는 `ui/Modal`(Radix `Dialog`, `RunDialog` 가 이미 쓰는 것) 그대로이고,
 * 경고 박스는 시안의 amber `NoticeBox` 다. **새 토큰 0개.**
 *
 * ## ★ 이 컴포넌트가 강제하는 것 — "되돌릴 수 없다"
 * soft delete 가 아니다. DB 행도 디스크 파일도 그 자리에서 사라진다. 그 사실을
 * **호출부의 선택에 맡기지 않고** 여기서 항상 그린다 — 네 곳 중 한 곳만 빠뜨려도
 * 사용자는 "휴지통에 있겠지" 라고 읽는다.
 *
 * ## 호출부가 채우는 것 — **무엇이 지워지는가**
 * `children` 에 대상의 실체를 적는다(이름 · 코드 · 딸린 것의 **실제 개수**).
 * 개수를 모르면 쓰지 않는다 — 지어낸 숫자는 확인 대화상자를 거짓말로 만든다.
 * ════════════════════════════════════════════════════════════════════
 */
export type DeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 예: `"이 실행 이력을 삭제할까요?"` */
  title: string;
  /** 제목 아래 한 줄. 대상 식별자(`RUN-0042` 등)를 적는다. */
  description?: React.ReactNode;
  /** 경고 박스에 덧붙일 문장. 무엇이 **함께** 사라지는지. */
  warning?: React.ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  /** 대상의 실체(목록·개수). */
  children: React.ReactNode;
  /** 검증 스크립트가 잡을 손잡이. 화면마다 다르게 준다. */
  confirmTestId?: string;
};

export function DeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  warning,
  confirmLabel = "삭제",
  pending = false,
  onConfirm,
  children,
  confirmTestId,
}: DeleteDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            취소
          </Button>
          <Button
            variant="danger"
            data-testid={confirmTestId}
            data-slot="delete-confirm"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "삭제 중…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div data-slot="delete-target">{children}</div>

      <NoticeBox title="이 작업은 되돌릴 수 없습니다" data-slot="delete-warning">
        <NoticeLine>
          휴지통이 없습니다. 삭제하면 <strong>DB 행과 디스크 파일이 그 자리에서 사라지고</strong>{" "}
          복구할 방법이 없습니다.
        </NoticeLine>
        {warning === undefined ? null : <NoticeLine>{warning}</NoticeLine>}
      </NoticeBox>
    </Modal>
  );
}

/**
 * 대화상자 안의 대상 1줄. 다중 삭제에서 목록으로 쌓인다.
 *
 * 제목(굵게) + 부제(작게)는 시안 테이블의 `.scenario-title` / `small` 과 같은 짜임이다.
 */
export function DeleteTargetRow({
  title,
  detail,
}: {
  title: string;
  detail: React.ReactNode;
}) {
  return (
    <li
      data-slot="delete-target-row"
      className="flex items-baseline justify-between gap-[10px] border-b border-hairline py-[7px] last:border-b-0"
    >
      <span className="min-w-0 flex-1 truncate text-[12px] font-750">{title}</span>
      <span className="shrink-0 text-[10px] text-muted">{detail}</span>
    </li>
  );
}

/** 대상 목록 컨테이너. 건수가 많아도 대화상자가 화면을 넘기지 않게 스크롤을 둔다. */
export function DeleteTargetList({ children }: { children: React.ReactNode }) {
  return (
    <ul
      data-slot="delete-target-list"
      className="m-0 max-h-[240px] list-none overflow-auto p-0"
    >
      {children}
    </ul>
  );
}
