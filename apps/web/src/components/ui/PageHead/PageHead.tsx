import type * as React from "react";
import { cn } from "cn";

/**
 * 시안 `.page-head` 1:1.
 *   display:flex / align-items:flex-end / justify-content:space-between / margin-bottom:24px
 *   h1 28px / -.045em / margin 0 0 5px   ·   p margin 0 / color var(--muted)
 *   760px 이하: align-items:flex-start + gap 12px (세로로 쌓임)
 */
export type PageHeadProps = {
  title: string;
  description?: React.ReactNode;
  /** 우측 주 액션 (시안의 `＋ 시나리오 만들기` 등). */
  action?: React.ReactNode;
};

export function PageHead({ title, description, action }: PageHeadProps) {
  return (
    <div
      data-slot="page-head"
      className={cn(
        "mb-[24px] flex items-end justify-between",
        "max-mobile:flex-col max-mobile:items-start max-mobile:gap-[12px]",
      )}
    >
      <div>
        <h1 className="mb-[5px]">{title}</h1>
        {description == null ? null : <p className="m-0 text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
