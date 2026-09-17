import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProjectEntity, SuiteEntity, SuiteScenarioEntity } from "@testflow/db";
import { SuitesController } from "./suites.controller.js";
import { SuitesService } from "./suites.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([SuiteEntity, SuiteScenarioEntity, ProjectEntity])],
  controllers: [SuitesController],
  providers: [SuitesService],
  exports: [SuitesService],
})
export class SuitesModule {}
