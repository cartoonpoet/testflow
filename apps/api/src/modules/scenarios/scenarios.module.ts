import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProjectEntity, ScenarioEntity, TestStepEntity } from "@testflow/db";
import { ScenariosController } from "./scenarios.controller.js";
import { ScenariosService } from "./scenarios.service.js";
import { StepsController } from "./steps.controller.js";
import { StepsService } from "./steps.service.js";

/** 스텝은 시나리오의 하위 리소스라 별도 모듈을 만들지 않고 같은 모듈에 둔다. */
@Module({
  imports: [TypeOrmModule.forFeature([ScenarioEntity, TestStepEntity, ProjectEntity])],
  controllers: [ScenariosController, StepsController],
  providers: [ScenariosService, StepsService],
  exports: [ScenariosService, StepsService],
})
export class ScenariosModule {}
