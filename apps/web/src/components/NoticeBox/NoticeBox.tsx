import type * as React from "react";
import { cn } from "cn";

/**
 * 시안 `.notice` 1:1 (화면 1 · amber 알림 박스).
 *
 *   margin-top 18px / background #fff8e9 / border 1px #f1ddb4 / radius 14px
 *   padding 16px 18px / color #80520d
 *   strong 12px   ·   p margin 5px 0 0 / 11px / line-height 1.5
 *
 * 토큰: `--color-notice` / `--color-notice-line` / `--color-notice-ink`.
 *
 * ★ 시안의 notice 는 **amber 한 종류뿐**이다. API 의 `notices[].level`
 *   (info/warn/danger)마다 색을 새로 만들지 않았다 — 시안에 없는 색을 지어내는 대신
 *   레벨은 **정렬 순서**로만 쓴다(danger 가 위). 지시받은 "amber notice" 를 지킨다.
 */
export type NoticeBoxProps = React.ComponentProps<"div"> & {
  title: React.ReactNode;
};

export function NoticeBox({ title, children, className, ...props }: NoticeBoxProps) {
  return (
    <div
      data-slot="notice"
      className={cn(
        "mt-[18px] rounded-metric border border-notice-line bg-notice px-[18px] py-[16px] text-notice-ink",
        className,
      )}
      {...props}
    >
      <strong className="text-[12px]">{title}</strong>
      {children}
    </div>
  );
}

/** 시안 `.notice p`. 여러 줄을 쌓을 수 있도록 분리해 두었다. */
export function NoticeLine({ children, className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="notice-line"
      className={cn("mt-[5px] mb-0 text-[11px] leading-[1.5]", className)}
      {...props}
    >
      {children}
    </p>
  );
}
