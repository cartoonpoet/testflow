import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { createQueryClient } from "@/lib/queryClient";
import { router } from "@/routes/routes";

/**
 * QueryClient 는 모듈 레벨에서 1회 생성한다.
 * 컴포넌트 안에서 만들면 리렌더마다 캐시가 날아간다.
 */
const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
