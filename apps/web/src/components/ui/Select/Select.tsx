import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * 네이티브 `<select>` 기반.
 *
 * 시안은 두 가지 형태를 쓴다.
 *   field  — `.field select` : radius 9px / min-height 39px / padding 0 10px  (인스펙터)
 *   filter — `.filter`       : radius 10px / min-height 40px / padding 0 12px (툴바)
 *
 * Radix Select 를 쓰지 않은 이유는 Select/index.ts 옆 주석이 아니라
 * 04-gen-8 아티팩트 "이슈/결정사항" 에 적어 두었다.
 */
const selectVariants = cva(
  [
    "w-full appearance-none border border-line bg-panel text-ink",
    "outline-none transition-[border-color,box-shadow] duration-150",
    "focus:border-brand focus:shadow-focus-ring",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        field: "rounded-input min-h-[39px] px-[10px]",
        filter: "rounded-btn min-h-[40px] px-[12px] text-filter-ink w-auto",
      },
    },
    defaultVariants: { variant: "field" },
  },
);

export type SelectProps = React.ComponentProps<"select"> &
  VariantProps<typeof selectVariants>;

export function Select({ className, variant, children, ...props }: SelectProps) {
  return (
    <select
      data-slot="select"
      className={cn(selectVariants({ variant, className }))}
      {...props}
    >
      {children}
    </select>
  );
}

export { selectVariants };
