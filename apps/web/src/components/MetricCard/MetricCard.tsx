import type * as React from "react";
import { cn } from "cn";

/**
 * 시안 `.metric` 1:1 (화면 1 · 지표 카드).
 *
 *   .metric            border 1px var(--line) / radius 14px / padding 19px
 *   .metric small      color var(--muted) / 11px / weight 750
 *   .metric strong     display block / 27px / letter-spacing -.04em / margin-top 10px
 *   .metric .delta     display block / color var(--success) / 11px / margin-top 4px
 *   .metric.featured   background #18302a / color white / border-color #18302a
 *                      small #9eb3ac · delta #75d3af
 *   @760px             padding 15px / strong 22px
 *
 * 색은 전부 globals.css 토큰이다(`dark-panel`, `dark-panel-ink`, `dark-panel-delta`).
 */
export type MetricCardProps = React.ComponentProps<"article"> & {
  label: string;
  value: string;
  /** 시안 `.delta` — 수치 아래 한 줄 보조 설명. */
  delta?: string;
  /** 첫 카드만 다크. 시안은 `1.2fr` 자리에 오는 카드 하나만 featured 다. */
  featured?: boolean;
};

export function MetricCard({
  label,
  value,
  delta,
  featured = false,
  className,
  ...props
}: MetricCardProps) {
  return (
    <article
      data-slot="metric-card"
      data-featured={featured}
      className={cn(
        "rounded-metric border p-[19px] max-mobile:p-[15px]",
        featured ? "border-dark-panel bg-dark-panel text-white" : "border-line bg-panel",
        className,
      )}
      {...props}
    >
      <small className={cn("text-[11px] font-750", featured ? "text-dark-panel-ink" : "text-muted")}>
        {label}
      </small>
      <strong className="mt-[10px] block text-metric max-mobile:text-metric-sm">{value}</strong>
      {delta === undefined ? null : (
        <span
          data-slot="metric-delta"
          className={cn(
            "mt-[4px] block text-[11px]",
            featured ? "text-dark-panel-delta" : "text-success",
          )}
        >
          {delta}
        </span>
      )}
    </article>
  );
}
