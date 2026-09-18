import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { createQueryClient } from "@/lib/queryClient";
import { router } from "@/routes/routes";

/**
 * QueryClient 는 모듈 레벨에서 1회 생성한다.
 * 컴포넌트 안에서 만들면 리렌더마다 캐시가 날아간다.
 */
const queryClient = createQueryClient();

/**
 * ★ 루트 ErrorBoundary — **최후 방어선**이다.
 *
 * `RouterProvider` 바깥에 둔다. 라우터 자체가 던지거나(잘못된 라우트 설정·
 * `createBrowserRouter` 초기화 실패) 셸 컴포넌트가 깨지면 라우트 단위 경계는
 * 존재하지도 않는다 — 그게 정확히 흰 화면이 되는 경우다.
 *
 * 평소에 실제로 일하는 것은 **라우트 단위 경계**(`routes.tsx`)다. 그쪽이 먼저 잡으면
 * 사이드바·탑바가 살아 있고 본문만 안내로 바뀐다. 여기까지 올라오는 것은 그 바깥이
 * 깨졌을 때뿐이고, 그때는 화면 전체를 대신 그리는 것이 맞다.
 * 경계 설계 전문은 `components/ErrorBoundary/ErrorBoundary.tsx` 상단 주석에 있다.
 */
export function App() {
  return (
    <ErrorBoundary variant="root">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
