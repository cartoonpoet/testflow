import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service.js";
import type { HealthResponse } from "./health.service.js";

/**
 * 경로를 `@Controller()`(빈 인자)에 두지 않고 메서드마다 전체 경로를 적는다 (ERDify 규약).
 * 전역 prefix 는 `main.ts` 의 `setGlobalPrefix("api")` 다 → 실제 경로는 `/api/health`.
 */
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("health")
  check(): Promise<HealthResponse> {
    return this.health.check();
  }
}
