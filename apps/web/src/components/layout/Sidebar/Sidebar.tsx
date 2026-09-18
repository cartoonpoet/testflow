import { cn } from "cn";
import { NavLink } from "react-router-dom";
import { NAV_GROUPS, type NavEntry } from "./navigation";

/**
 * 시안 `.sidebar` 1:1.
 *   position:fixed / width 232px / background var(--nav) / padding 22px 14px / z-index 20
 *   760px 이하에서는 오프캔버스(translateX(-100%)) + 햄버거로 연다.
 */
export type SidebarProps = {
  projectName: string;
  /** 760px 이하에서 오프캔버스가 열려 있는지. */
  open: boolean;
  /** 메뉴 선택 시 오프캔버스를 닫는다. */
  onNavigate: () => void;
};

export function Sidebar({ projectName, open, onNavigate }: SidebarProps) {
  return (
    <aside
      data-slot="sidebar"
      data-open={open}
      className={cn(
        "fixed inset-y-0 left-0 z-20 flex w-sidebar flex-col",
        "bg-nav text-white px-[14px] py-[22px]",
        "max-mobile:transition-transform max-mobile:duration-[220ms]",
        open ? "max-mobile:translate-x-0" : "max-mobile:-translate-x-full",
      )}
    >
      <div className="flex h-[42px] items-center gap-[11px] px-[10px] text-[18px] font-850 tracking-logo">
        <span className="grid h-[30px] w-[30px] place-items-center rounded-chip bg-logo-mark text-[12px] text-logo-mark-ink">
          TF
        </span>
        TestFlow
      </div>

      {/* 프로젝트 스위처 — MVP 는 단일 프로젝트라 표시 전용이다. */}
      <button
        type="button"
        disabled
        className={cn(
          "mx-[5px] mt-[20px] mb-[16px] w-[calc(100%-10px)]",
          "flex items-center justify-between rounded-switch",
          "border border-switch-line bg-switch-bg px-[12px] py-[11px] text-left text-white",
        )}
      >
        <span>
          <small className="mb-[3px] block text-[10px] text-switch-ink">
            현재 프로젝트
          </small>
          {projectName}
        </span>
        <b aria-hidden="true">⌄</b>
      </button>

      <nav className="tf-scrollbar-hidden min-h-0 flex-1 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="px-[12px] pt-[17px] pb-[7px] text-nav-label text-nav-label-ink">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavItem key={item.to} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </nav>

      {/*
       * 시안의 "사용자 정보" 자리.
       * 비회원제(단일 공용 워크스페이스)라 계정이 없으므로 레이아웃만 유지하고
       * 고정 텍스트로 대체한다. 아바타 이니셜도 사람 이름이 아닌 "공"이다.
       */}
      <div className="mt-auto flex items-center gap-[10px] border-t border-nav-line px-[8px] pt-[15px]">
        <span className="grid h-[32px] w-[32px] place-items-center rounded-avatar bg-avatar font-850 text-avatar-ink">
          공
        </span>
        <div className="min-w-0">
          <strong className="block truncate">공용 워크스페이스</strong>
          <small
            className="mt-[2px] block truncate text-[11px] text-nav-foot-ink"
            title="로그인 없이 모두가 함께 사용합니다"
          >
            비회원 공용 접속
          </small>
        </div>
      </div>
    </aside>
  );
}

function NavItem({
  item,
  onNavigate,
}: {
  item: NavEntry;
  onNavigate: () => void;
}) {
  const shared =
    "my-[2px] flex w-full items-center gap-[11px] rounded-btn px-[12px] py-[10px] text-left";

  if (!item.enabled) {
    return (
      <button
        type="button"
        disabled
        title="MVP 범위에 포함되지 않은 화면입니다"
        className={cn(shared, "cursor-not-allowed text-nav-ink opacity-40")}
      >
        <NavIcon glyph={item.icon} />
        {item.label}
      </button>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          shared,
          "transition-colors duration-150",
          isActive
            ? "bg-nav-active text-nav-active-ink font-750"
            : "text-nav-ink hover:bg-nav-hover hover:text-white",
        )
      }
    >
      <NavIcon glyph={item.icon} />
      {item.label}
    </NavLink>
  );
}

function NavIcon({ glyph }: { glyph: string }) {
  return (
    <span aria-hidden="true" className="w-[18px] text-center font-mono">
      {glyph}
    </span>
  );
}
