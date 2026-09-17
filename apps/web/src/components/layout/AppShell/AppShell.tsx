import type * as React from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "../Sidebar";
import { Topbar } from "../Topbar";
import { Toaster } from "../Toaster";
import { useMobileNav } from "@/hooks/useMobileNav";
import { usePageTitle } from "@/hooks/usePageTitle";

/**
 * 시안 `.app` 1:1.
 *   min-height 100vh / grid-template-columns 232px 1fr
 *   `.content` padding 30px / max-width 1500px / margin 0 auto
 *   760px 이하: display block + 사이드바 오프캔버스 + 오버레이 rgba(0,0,0,.3)
 *
 * 프로젝트명은 MVP 가 단일 공용 워크스페이스라 고정값이다.
 * Gen-Phase 9 에서 `GET /api/projects` 결과로 바꾼다.
 */
export type AppShellProps = {
  projectName?: string;
  topActions?: React.ReactNode;
};

export const DEFAULT_PROJECT_NAME = "TestFlow 워크스페이스";

export function AppShell({
  projectName = DEFAULT_PROJECT_NAME,
  topActions,
}: AppShellProps) {
  const { open, openNav, closeNav } = useMobileNav();
  const page = usePageTitle();

  return (
    <div
      data-slot="app"
      className="grid min-h-screen grid-cols-[var(--spacing-sidebar)_1fr] max-mobile:block"
    >
      <Sidebar projectName={projectName} open={open} onNavigate={closeNav} />

      {/* 시안 `.overlay.show` — 760px 이하에서 사이드바가 열렸을 때만 */}
      {open ? (
        <button
          type="button"
          aria-label="메뉴 닫기"
          onClick={closeNav}
          className="fixed inset-0 z-[19] hidden bg-overlay max-mobile:block"
        />
      ) : null}

      <div className="col-start-2 min-w-0 max-mobile:col-auto">
        <Topbar
          project={projectName}
          page={page}
          onOpenNav={openNav}
          actions={topActions}
        />
        <main className="mx-auto max-w-[var(--spacing-content-max)] p-[30px] max-mobile:px-[13px] max-mobile:py-[18px]">
          <Outlet />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
