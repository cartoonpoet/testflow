import type * as React from "react";
import { cn } from "cn";

/**
 * 시안 `.panel` / `.panel-head` 1:1.
 *   panel      radius var(--radius)=16px / 1px solid var(--line) / overflow hidden
 *   panel-head padding 18px 20px / 하단 1px 라인 / h2 16px
 */
export type PanelProps = React.ComponentProps<"section"> & {
  /** 패널 제목. 주면 `.panel-head` 가 렌더된다. */
  title?: React.ReactNode;
  /** 헤더 우측 보조 영역 (시안의 "전체 보기 →"). */
  action?: React.ReactNode;
  /** 헤더를 직접 조립하고 싶을 때. `title` 보다 우선한다. */
  head?: React.ReactNode;
  /** 본문 wrapper 에 붙일 클래스. 패딩은 화면마다 다르므로 기본값이 없다. */
  bodyClassName?: string;
};

export function Panel({
  title,
  action,
  head,
  className,
  bodyClassName,
  children,
  ...props
}: PanelProps) {
  const header = head ?? (title == null ? null : <PanelHeadContent title={title} action={action} />);

  return (
    <section
      data-slot="panel"
      className={cn(
        "bg-panel border border-line rounded-panel overflow-hidden",
        className,
      )}
      {...props}
    >
      {header}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

function PanelHeadContent({
  title,
  action,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="panel-head"
      className="flex items-center justify-between px-[20px] py-[18px] border-b border-line"
    >
      <h2 className="text-panel-title">{title}</h2>
      {action == null ? null : (
        <span className="text-[12px] text-muted">{action}</span>
      )}
    </div>
  );
}
