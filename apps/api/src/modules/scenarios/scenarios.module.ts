import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProjectEntity, ScenarioCodeEntity, ScenarioEntity, TestStepEntity } from "@testflow/db";
import { ScenarioCodeController } from "./scenario-code.controller.js";
import { ScenarioCodeService } from "./scenario-code.service.js";
import { ScenariosController } from "./scenarios.controller.js";
import { ScenariosService } from "./scenarios.service.js";
import { StepsController } from "./steps.controller.js";
import { StepsService } from "./steps.service.js";

/**
 * 스텝은 시나리오의 하위 리소스라 별도 모듈을 만들지 않고 같은 모듈에 둔다.
 * 코드 본문(`scenario_codes`)도 같은 이유로 여기에 있다 — 다만 **서비스는 분리**했다
 * (`ScenariosService` 가 본문 리포지토리를 보지 못하게 — 03-phases 쟁점 1).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ScenarioEntity, ScenarioCodeEntity, TestStepEntity, ProjectEntity]),
  ],
  controllers: [ScenariosController, ScenarioCodeController, StepsController],
  providers: [ScenariosService, ScenarioCodeService, StepsService],
  exports: [ScenariosService, ScenarioCodeService, StepsService],
})
export class ScenariosModule {}
