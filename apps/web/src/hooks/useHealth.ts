import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api, queryKeys } from "@/lib";

/**
 * `GET /api/health`.
 *
 * 빌더가 이걸 보는 이유는 하나다 — **Runner 가 떠 있지 않으면 녹화를 시작할 수 없다.**
 * 녹화 WS 는 Runner 직결이라 API 만 살아 있으면 세션 레코드만 만들어지고
 * 브라우저는 뜨지 않는다(테스터 눈에는 "검은 화면에서 아무 일도 안 일어남"으로 보인다).
 * 그 상태를 **시작 전에** 문장으로 알려 준다.
 *
 * `HealthResponse` 는 운영 진단 응답이라 contracts 에 없다(`health.service.ts` 주석).
 * 그래서 여기서 형태를 좁게 적는다 — 도메인 계약을 web 에서 재정의하는 것이 아니다.
 */
const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.enum(["ok", "down"]),
  redis: z.enum(["ok", "down"]),
  runner: z.enum(["ok", "down"]),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Runner heartbeat TTL 이 30초라, 그보다 짧게 본다. */
const HEALTH_REFRESH_MS = 15_000;

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: () => api.get<HealthResponse>("/health", { schema: HealthResponseSchema }),
    staleTime: HEALTH_REFRESH_MS,
    refetchInterval: HEALTH_REFRESH_MS,
  });
}
