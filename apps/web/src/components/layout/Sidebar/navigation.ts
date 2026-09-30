/**
 * 사이드바에 실제로 노출할 메뉴 정의.
 *
 * 관리 화면은 라우트와 기능을 유지하되 현재 내비게이션에서는 숨긴다. 숨긴 화면의 제목은
 * `HIDDEN_PAGE_TITLES` 에 따로 둬 직접 URL 접근 시 브레드크럼이 깨지지 않게 한다.
 */
export type NavEntry = {
  readonly label: string;
  readonly icon: string;
  readonly to: string;
  /** false 면 클릭 불가 + 흐리게 표시. MVP 제외 화면. */
  readonly enabled: boolean;
  /** `/` 처럼 하위 경로를 모두 먹으면 안 되는 항목. */
  readonly end?: boolean;
};

export type NavGroup = {
  readonly label: string;
  readonly items: readonly NavEntry[];
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "WORKSPACE",
    items: [
      { label: "대시보드", icon: "⌂", to: "/", enabled: true, end: true },
      { label: "테스트 시나리오", icon: "▤", to: "/scenarios", enabled: true, end: true },
      { label: "시나리오 만들기", icon: "＋", to: "/scenarios/new", enabled: true },
      { label: "실행 현황", icon: "▶", to: "/runs", enabled: true },
    ],
  },
  /**
   * 도움말은 작업 메뉴와 성격이 달라 별도 그룹으로 유지한다.
   */
  {
    label: "HELP",
    items: [{ label: "가이드", icon: "?", to: "/guide", enabled: true }],
  },
];

const HIDDEN_PAGE_TITLES: Readonly<Record<string, string>> = {
  "/suites": "테스트 스위트",
  "/environments": "실행 환경",
  "/test-data": "테스트 데이터",
  "/settings": "프로젝트 설정",
};

/** 브레드크럼·문서 타이틀용 경로 → 화면 이름 사전. */
export const PAGE_TITLES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.to, i.label])),
  ...HIDDEN_PAGE_TITLES,
};
