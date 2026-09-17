import { cn } from "cn";

/**
 * 시안 `.crumb` 1:1 — `프로젝트명 / 현재 페이지`.
 *   gap 8px / color var(--muted) / font-size 13px, 현재 페이지만 var(--ink)
 *   760px 이하에서는 프로젝트명을 숨긴다(시안 `.crumb span { display:none }`).
 */
export type BreadcrumbProps = {
  project: string;
  page: string;
  className?: string;
};

export function Breadcrumb({ project, page, className }: BreadcrumbProps) {
  return (
    <nav
      aria-label="위치"
      className={cn("flex items-center gap-[8px] text-[13px] text-muted", className)}
    >
      <span className="max-mobile:hidden">{project}</span>
      <b aria-hidden="true" className="max-mobile:hidden">
        /
      </b>
      <strong className="text-ink">{page}</strong>
    </nav>
  );
}
