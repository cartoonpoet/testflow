import type * as React from "react";
import { cn } from "cn";

/**
 * 시안 `.mini-status` 1:1.
 *   inline-flex / gap 5px / font-size 10px / font-weight 750
 *   앞에 6px 원형 점 (배경 currentColor)
 *   green → --success / red → --danger / gray → #7d8985 (토큰 --color-dot-gray)
 */
export type StatusTone = "green" | "red" | "gray";

export type StatusDotProps = React.ComponentProps<"span"> & {
  tone?: StatusTone;
};

const toneClass: Record<StatusTone, string> = {
  green: "text-success",
  red: "text-danger",
  gray: "text-dot-gray",
};

export function StatusDot({
  tone = "gray",
  className,
  children,
  ...props
}: StatusDotProps) {
  return (
    <span
      data-slot="status-dot"
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-[5px] text-th font-750 tracking-normal",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="w-[6px] h-[6px] rounded-full bg-current shrink-0"
      />
      {children}
    </span>
  );
}
