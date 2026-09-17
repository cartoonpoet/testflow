import { Link } from "react-router-dom";
import { AppShell, DEFAULT_PROJECT_NAME } from "@/components/layout";
import { Button } from "@/components/ui";
import { useCurrentProject } from "@/hooks/useProject";

/**
 * 라우트에 꽂히는 셸.
 *
 * ★ 04-gen-8 이 남긴 미결 2건을 여기서 정한다.
 *
 * 1) **프로젝트명** — Gen-Phase 8 은 고정 문자열이었다. 이제 `GET /api/projects` 의
 *    첫 건 이름을 브레드크럼에 쓴다. 아직 로딩 중이면 Gen-Phase 8 의 기본값을 쓴다
 *    (빈 문자열로 두면 브레드크럼이 한 프레임 무너진다).
 *
 * 2) **탑바 액션 주입 경로** — Context 도 라우트별 shell 래핑도 쓰지 않는다.
 *    **시안의 `.top-actions` 는 topbar 안, 즉 `.page` 바깥에 있어서 4개 화면 전부에서
 *    같은 버튼("? 사용 안내" / "＋ 새 시나리오")이다.** 화면별로 바뀌는 것은
 *    `.page-head` 우측 버튼이고, 그건 각 페이지가 `PageHead action` 으로 그린다.
 *    즉 시안 자체가 "탑바 액션은 전역"이라고 말하고 있으므로 전역으로 둔다.
 *    (화면별 탑바 액션이 실제로 필요해지는 Phase 가 오면 그때 Context 를 도입한다.
 *     지금 넣으면 쓰지도 않는 배선만 남는다.)
 *
 * `AppShell` 자체는 Gen-Phase 8 산출물 그대로다 — 수정하지 않았다.
 */
export function AppShellRoute() {
  const { project } = useCurrentProject();

  return (
    <AppShell
      projectName={project?.name ?? DEFAULT_PROJECT_NAME}
      topActions={
        <Button variant="primary" asChild>
          <Link to="/scenarios/new">＋ 새 시나리오</Link>
        </Button>
      }
    />
  );
}
