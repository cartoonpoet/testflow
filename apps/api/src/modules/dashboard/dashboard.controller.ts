import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import type { DashboardReadiness, DashboardSummary } from "@testflow/contracts";
import { zodBody } from "../../common/pipes/zod-validation.pipe.js";
import { DASHBOARD_RANGES, DashboardService } from "./dashboard.service.js";

/**
 * 쿼리 스키마는 contracts 에 두지 않았다 — `range` 는 **이 화면 전용 조회 옵션**이고
 * web·runner 가 공유하는 도메인 타입이 아니다(health 응답과 같은 범주).
 * 응답 스키마(`DashboardSummary` / `DashboardReadiness`)는 contracts 의 것을 쓴다.
 */
const DashboardQuerySchema = z.object({
  projectId: z.uuid().optional(),
  range: z.enum(DASHBOARD_RANGES).default("today"),
});
type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("dashboard/summary")
  summary(@Query(zodBody(DashboardQuerySchema)) query: DashboardQuery): Promise<DashboardSummary> {
    return this.dashboard.summary(query.projectId, query.range);
  }

  @Get("dashboard/readiness")
  readiness(
    @Query(zodBody(DashboardQuerySchema)) query: DashboardQuery,
  ): Promise<DashboardReadiness> {
    return this.dashboard.readiness(query.projectId);
  }
}
