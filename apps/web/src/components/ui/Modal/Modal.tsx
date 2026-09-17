import type * as React from "react";
import { Dialog } from "radix-ui";
import { cn } from "cn";
import { Button } from "../Button";

/**
 * 모달 다이얼로그.
 *
 * 시안에는 다이얼로그가 없다(4개 화면 모두 전체 페이지다). 그래서 **새 색·새 반경을
 * 만들지 않고** 기존 토큰만으로 조립했다.
 *   - 오버레이: `--color-overlay` (시안 760px 오프캔버스 오버레이와 같은 값)
 *   - 본체: `--color-panel` + `--radius-panel` + `--shadow-panel` + `--color-line`
 *   - 헤더/푸터 구분선: `--color-line` (패널 헤더와 같다)
 *
 * Radix `Dialog` 를 쓰는 이유는 Select 때(04-gen-8 결정 4번)와 판단이 다르기 때문이다.
 * 네이티브 `<dialog>` 는 포커스 트랩·스크롤 락·`aria-modal`·Esc 처리를 **브라우저마다
 * 다르게** 주고, 이 화면은 비밀번호를 입력받는 폼이라 포커스가 뒤로 새면 안 된다.
 * 애니메이션은 넣지 않았다 — `prefers-reduced-motion` 처리가 따라붙을 이유가 없어진다.
 */
export type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** 하단 액션 영역. 없으면 푸터를 그리지 않는다. */
  footer?: React.ReactNode;
  /** 넓은 폼(스위트 시나리오 선택 등)에 쓴다. */
  size?: "default" | "wide";
  children: React.ReactNode;
};

const widthClass = {
  default: "w-[min(520px,calc(100vw-28px))]",
  wide: "w-[min(720px,calc(100vw-28px))]",
} as const;

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  footer,
  size = "default",
  children,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-slot="modal-overlay"
          className="fixed inset-0 z-[30] bg-overlay"
        />
        <Dialog.Content
          data-slot="modal"
          className={cn(
            "fixed left-1/2 top-1/2 z-[31] -translate-x-1/2 -translate-y-1/2",
            "max-h-[90vh] overflow-auto rounded-panel border border-line bg-panel shadow-panel",
            "outline-none",
            widthClass[size],
          )}
        >
          <div className="flex items-start justify-between gap-[12px] border-b border-line px-[20px] py-[18px]">
            <div>
              <Dialog.Title className="text-panel-title font-bold">{title}</Dialog.Title>
              {description == null ? null : (
                <Dialog.Description className="m-0 mt-[5px] text-[11px] leading-[1.6] text-muted">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="닫기">
                ✕
              </Button>
            </Dialog.Close>
          </div>

          <div className="px-[20px] py-[18px]">{children}</div>

          {footer == null ? null : (
            <div className="flex items-center justify-end gap-[9px] border-t border-line px-[20px] py-[15px]">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
