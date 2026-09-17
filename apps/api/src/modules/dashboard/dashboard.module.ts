import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";

/**
 * 집계 전용 모듈. 원시 SQL 로 `DataSource` 를 직접 쓰므로 `TypeOrmModule.forFeature` 가 없다
 * (엔티티 리포지토리를 하나도 쓰지 않는다).
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
