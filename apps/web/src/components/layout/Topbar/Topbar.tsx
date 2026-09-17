import type * as React from "react";
import { Breadcrumb } from "../Breadcrumb";
import { Button } from "../../ui/Button";

/**
 * 시안 `.topbar` 1:1.
 *   height 68px / rgba(255,255,255,.93) + backdrop-filter blur(12px)
 *   하단 1px var(--line) / position sticky top 0 / padding 0 28px
 *   760px 이하: height 60px / padding 0 14px
 */
export type TopbarProps = {
  project: string;
  page: string;
  /** 760px 이하에서만 보이는 햄버거 버튼 핸들러. */
  onOpenNav: () => void;
  /** 우측 액션 영역 (`.top-actions`). 화면마다 다르다. */
  actions?: React.ReactNode;
};

export function Topbar({ project, page, onOpenNav, actions }: TopbarProps) {
  return (
    <header
      data-slot="topbar"
      className={[
        "sticky top-0 z-[15] flex items-center justify-between",
        "h-topbar px-[28px] bg-topbar border-b border-line backdrop-blur-[12px]",
        "max-mobile:h-topbar-sm max-mobile:px-[14px]",
      ].join(" ")}
    >
      <div className="flex items-center gap-[8px]">
        <Button
          size="icon"
          onClick={onOpenNav}
          aria-label="메뉴 열기"
          className="hidden max-mobile:inline-flex"
        >
          ☰
        </Button>
        <Breadcrumb project={project} page={page} />
      </div>
      <div className="flex gap-[9px]">{actions}</div>
    </header>
  );
}
