import { useCallback, useEffect, useState } from "react";

/**
 * 라이브 화면 **확대 모드** 상태 (라운드 3).
 *
 * ## 왜 Radix `Dialog` 가 아닌가 ★
 * `Modal`(Radix `Dialog`)은 `Dialog.Portal` 로 내용을 **body 로 옮긴다.** 그 순간
 * React 는 `<LiveCanvas>` 를 언마운트하고 새로 마운트한다. 그러면 두 가지가 동시에 깨진다.
 *
 *   1. **캔버스 백버퍼가 날아간다** — 지금까지 그린 픽셀이 사라져 "마지막 프레임 유지"
 *      (`LiveCanvas` 주석 · 04-gen-5 §1.2)가 무효가 된다. 확대할 때마다 화면이 검게 깜빡인다.
 *   2. **라이브 토큰을 다시 받는다** — `useLiveStream` 의 접속 정보 쿼리는 `gcTime: 0` 이라
 *      리마운트가 곧 `GET /runs/:id/live` 재호출이고, 토큰은 **1회용**이다
 *      (`useLiveStream` 주석). 확대 한 번에 소켓을 새로 맺게 된다.
 *
 * 그래서 확대는 **DOM 을 옮기지 않고 CSS 만 바꾼다**(`tf-live-backdrop` + `position:fixed`).
 * 같은 React 엘리먼트가 같은 자리에 남아 있으므로 캔버스도 소켓도 그대로다.
 *
 * ## 이 훅이 맡는 것은 `Esc` 하나다
 * 스크롤 잠금은 `globals.css` 의 `body:has([data-expanded="true"])` 가 CSS 로 처리한다.
 * 포커스 트랩은 두지 않았다 — 확대 화면은 **읽기 전용**이고 조작 가능한 요소가
 * 닫기 버튼 하나뿐이라, 트랩이 막을 사고가 없다(입력 폼인 `Modal` 과 다른 판단이다).
 */
export type ExpandHandle = {
  readonly expanded: boolean;
  readonly expand: () => void;
  readonly collapse: () => void;
  readonly toggle: () => void;
};

export function useExpand(): ExpandHandle {
  const [expanded, setExpanded] = useState(false);

  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => setExpanded(false), []);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  /*
   * `Esc` 는 문서 전역 키다. 확대 중일 때만 듣고, 닫히면 리스너를 건다는 사실 자체가
   * 없어진다 — 전역 리스너가 화면 수명을 넘겨 살아남지 않게 하기 위해서다.
   */
  useEffect(() => {
    if (!expanded) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setExpanded(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  return { expanded, expand, collapse, toggle };
}
