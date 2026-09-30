import { describe, expect, it } from "vitest";
import { NAV_GROUPS, PAGE_TITLES } from "./navigation";

describe("사이드바 메뉴 노출", () => {
  it("MANAGE 그룹과 관리 메뉴를 노출하지 않는다", () => {
    expect(NAV_GROUPS.map((group) => group.label)).not.toContain("MANAGE");
    expect(NAV_GROUPS.flatMap((group) => group.items).map((item) => item.to)).not.toEqual(
      expect.arrayContaining(["/suites", "/environments", "/test-data", "/settings"]),
    );
  });

  it("숨긴 화면의 직접 URL 제목은 유지한다", () => {
    expect(PAGE_TITLES["/suites"]).toBe("테스트 스위트");
    expect(PAGE_TITLES["/environments"]).toBe("실행 환경");
    expect(PAGE_TITLES["/test-data"]).toBe("테스트 데이터");
    expect(PAGE_TITLES["/settings"]).toBe("프로젝트 설정");
  });
});
