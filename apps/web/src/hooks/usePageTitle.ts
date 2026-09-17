import { useLocation } from "react-router-dom";
import { PAGE_TITLES } from "@/components/layout/Sidebar";

/**
 * 현재 경로 → 브레드크럼에 쓸 화면 이름.
 * 정확히 일치하는 메뉴가 없으면(`/runs/<id>` 같은 상세 경로) 가장 긴 접두 메뉴를 쓴다.
 */
export function usePageTitle(fallback = "TestFlow"): string {
  const { pathname } = useLocation();

  const exact = PAGE_TITLES[pathname];
  if (exact !== undefined) return exact;

  let best = "";
  for (const path of Object.keys(PAGE_TITLES)) {
    if (path === "/") continue;
    if (pathname.startsWith(`${path}/`) && path.length > best.length) best = path;
  }

  return best === "" ? fallback : (PAGE_TITLES[best] ?? fallback);
}
