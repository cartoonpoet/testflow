/**
 * 사이드바 메뉴 정의 — 시안 "공통 UI 요소 > 사이드바 구성" 1:1.
 *
 * `enabled: false` 는 01-clarify "MVP 범위 > 제외" 에 따른 미구현 화면이다.
 * 라우트를 아예 빼지 않고 비활성으로 남기는 이유: 시안 레이아웃(그룹 4개)을 유지하면서
 * 테스터가 "없는 기능"인지 "아직인 기능"인지 구분할 수 있게 하기 위함.
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
  {
    label: "MANAGE",
    items: [
      { label: "테스트 스위트", icon: "◇", to: "/suites", enabled: true },
      { label: "실행 환경", icon: "◎", to: "/environments", enabled: false },
      { label: "테스트 데이터", icon: "⌘", to: "/test-data", enabled: false },
      { label: "프로젝트 설정", icon: "⚙", to: "/settings", enabled: false },
    ],
  },
];

/** 브레드크럼·문서 타이틀용 경로 → 화면 이름 사전. */
export const PAGE_TITLES: Readonly<Record<string, string>> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.to, i.label]),
);
