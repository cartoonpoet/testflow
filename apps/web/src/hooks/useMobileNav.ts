import { useCallback, useState } from "react";

export type MobileNav = {
  readonly open: boolean;
  readonly openNav: () => void;
  readonly closeNav: () => void;
};

/**
 * 760px 이하 오프캔버스 사이드바 상태.
 *
 * 라우트가 바뀔 때 닫는 동작은 `useEffect` 로 location 을 감시하지 않고
 * NavLink 의 onClick(`closeNav`)으로 처리한다 — 사용자 행동이 원인이므로
 * 이펙트가 아니라 이벤트 핸들러가 맞는 자리다.
 */
export function useMobileNav(): MobileNav {
  const [open, setOpen] = useState(false);
  const openNav = useCallback(() => setOpen(true), []);
  const closeNav = useCallback(() => setOpen(false), []);
  return { open, openNav, closeNav };
}
