import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

/**
 * 시안 `.btn` 1:1.
 *   border:1px solid var(--line) / radius 10px / padding 9px 13px
 *   min-height:38px / font-weight:700 / gap:7px
 *   hover → border #aeb8b4, bg #fafbfa
 *
 * 색은 전부 globals.css 의 토큰을 참조한다. HEX 를 여기 쓰지 않는다.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-[7px] whitespace-nowrap",
    "rounded-btn border px-[13px] py-[9px] min-h-[38px] font-bold",
    "transition-colors duration-150 outline-none",
    "focus-visible:border-brand focus-visible:shadow-focus-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-line bg-panel text-ink hover:border-btn-hover-line hover:bg-btn-hover-bg",
        primary:
          "border-brand bg-brand text-white hover:border-brand-dark hover:bg-brand-dark",
        /** 시안 `.btn-danger` 는 테두리·배경은 기본값이고 **텍스트만** danger 다. */
        danger:
          "border-line bg-panel text-danger hover:border-btn-hover-line hover:bg-btn-hover-bg",
        ghost: "border-transparent bg-transparent text-ink hover:bg-btn-hover-bg",
      },
      size: {
        default: "",
        icon: "w-[38px] px-0",
        block: "w-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = "button",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "default"}
      className={cn(buttonVariants({ variant, size, className }))}
      {...(asChild ? {} : { type })}
      {...props}
    />
  );
}

export { buttonVariants };
