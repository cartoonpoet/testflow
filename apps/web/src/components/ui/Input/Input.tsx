import type * as React from "react";
import { cn } from "cn";

/**
 * 시안 `.field input` 1:1.
 *   border 1px var(--line) / radius 9px / min-height 39px / padding 0 10px
 *   focus → border-color var(--brand) + box-shadow 0 0 0 3px var(--soft)
 */
export type InputProps = React.ComponentProps<"input">;

export function Input({ className, type = "text", ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "w-full min-h-[39px] rounded-input border border-line bg-panel px-[10px] text-ink",
        "outline-none transition-[border-color,box-shadow] duration-150",
        "placeholder:text-muted",
        "focus:border-brand focus:shadow-focus-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
