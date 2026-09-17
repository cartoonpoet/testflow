import type * as React from "react";
import { cn } from "cn";
import { Button } from "../Button";

/**
 * 빈 상태 · 에러 상태 공통 블록.
 *
 * 시안이 주지 않은 화면이라 **시안 토큰 범위 안에서** 새로 설계했다.
 *  - 패널 본문 한가운데에 놓이는 세로 스택 하나로 통일한다. 화면마다 다른 그림을
 *    그리면 "빈 화면"과 "고장난 화면"을 구분하기 어려워진다.
 *  - 기호(`◇` / `!`)는 시안 사이드바·run-symbol 이 쓰는 텍스트 글리프 관례를 따랐다.
 *    아이콘 폰트나 SVG 세트를 새로 들이지 않는다.
 *  - 에러만 `--danger` 계열을 쓰고 빈 상태는 `--muted` 다.
 *    "데이터가 없다"는 정상이고 "불러오지 못했다"만 사고이기 때문이다.
 *  - 에러에는 **반드시 재시도 버튼**을 준다. react-query 의 `refetch` 를 그대로 물린다.
 */
export type StateViewProps = React.ComponentProps<"div"> & {
  tone?: "empty" | "error";
  title: string;
  description?: React.ReactNode;
  /** 재시도 핸들러. 주면 버튼이 렌더된다. */
  onRetry?: () => void;
  retryLabel?: string;
  /** 재시도 대신(또는 함께) 놓을 액션. */
  action?: React.ReactNode;
};

const glyph = { empty: "◇", error: "!" } as const;
const glyphClass = {
  empty: "bg-wait text-wait-ink",
  error: "bg-danger-soft text-danger",
} as const;

export function StateView({
  tone = "empty",
  title,
  description,
  onRetry,
  retryLabel = "다시 시도",
  action,
  className,
  ...props
}: StateViewProps) {
  return (
    <div
      data-slot="state-view"
      data-tone={tone}
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-[10px] px-[20px] py-[46px] text-center",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-[28px] w-[28px] place-items-center rounded-chip text-[11px] font-black",
          glyphClass[tone],
        )}
      >
        {glyph[tone]}
      </span>
      <strong className="text-[13px]">{title}</strong>
      {description == null ? null : (
        <p className="m-0 max-w-[420px] text-[11px] leading-[1.6] text-muted">{description}</p>
      )}
      {onRetry === undefined && action == null ? null : (
        <div className="mt-[4px] flex gap-[9px]">
          {onRetry === undefined ? null : (
            <Button onClick={onRetry} data-slot="state-retry">
              {retryLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
