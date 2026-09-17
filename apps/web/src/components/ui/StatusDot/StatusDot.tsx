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
        /*
         * ★ `text-th` 를 쓰면 안 된다 (Gen-Phase 9 에서 실측으로 발견한 버그).
         *
         * `cn`(tailwind-merge) 은 `text-*` 가 글자 크기인지 색인지 **이름만 보고** 판정한다.
         * `th` 는 t-shirt 사이즈도 임의값도 아니라 **색으로 분류**되고,
         * 뒤에 오는 `toneClass`(`text-success` …)와 같은 그룹으로 묶여 **조용히 제거된다.**
         * 그 결과 시안 10px 이어야 할 `.mini-status` 가 부모(td 12px)를 상속했다.
         *
         * `text-[length:var(--text-th)]` 는 `length:` 힌트 덕에 글자 크기로 분류되어
         * 색 클래스와 충돌하지 않는다. 값은 여전히 토큰(`--text-th`)이다.
         *
         * letter-spacing 은 시안 `.mini-status` 에 없으므로 body 의 `-.018em` 을 그대로 상속한다
         * (기존 `tracking-normal` 은 `text-th` 가 딸려 오게 하던 `.04em` 을 지우려던 것이라 함께 뺐다).
         */
        "inline-flex items-center gap-[5px] text-[length:var(--text-th)] font-750",
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
