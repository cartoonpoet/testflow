import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ProjectEntity,
  ScenarioAttachmentEntity,
  ScenarioCodeEntity,
  ScenarioEntity,
  TestStepEntity,
} from "@testflow/db";
import { ScenarioAttachmentController } from "./scenario-attachment.controller.js";
import { ScenarioAttachmentService } from "./scenario-attachment.service.js";
import { ScenarioCodeController } from "./scenario-code.controller.js";
import { ScenarioCodeService } from "./scenario-code.service.js";
import { ScenarioVariablesController } from "./scenario-variables.controller.js";
import { ScenarioVariablesService } from "./scenario-variables.service.js";
import { ScenariosController } from "./scenarios.controller.js";
import { ScenariosService } from "./scenarios.service.js";
import { StepsController } from "./steps.controller.js";
import { StepsService } from "./steps.service.js";

/**
 * 스텝은 시나리오의 하위 리소스라 별도 모듈을 만들지 않고 같은 모듈에 둔다.
 * 코드 본문(`scenario_codes`)도 같은 이유로 여기에 있다 — 다만 **서비스는 분리**했다
 * (`ScenariosService` 가 본문 리포지토리를 보지 못하게 — 03-phases 쟁점 1).
 * 첨부파일(`scenario_attachments`, 라운드 3)도 **같은 규율**로 서비스를 분리해 붙였다.
 * 실행 변수 탐지(`GET /api/scenarios/:id/variables`, 라운드 9)도 마찬가지다 —
 * 코드 본문과 스텝을 **둘 다** 읽어야 해서 어느 기존 서비스에도 얹을 수 없었다
 * (`scenario-variables.service.ts` 머리 주석).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScenarioEntity,
      ScenarioCodeEntity,
      ScenarioAttachmentEntity,
      TestStepEntity,
      ProjectEntity,
    ]),
  ],
  controllers: [
    ScenariosController,
    ScenarioCodeController,
    ScenarioAttachmentController,
    ScenarioVariablesController,
    StepsController,
  ],
  providers: [
    ScenariosService,
    ScenarioCodeService,
    ScenarioAttachmentService,
    ScenarioVariablesService,
    StepsService,
  ],
  exports: [
    ScenariosService,
    ScenarioCodeService,
    ScenarioAttachmentService,
    ScenarioVariablesService,
    StepsService,
  ],
})
export class ScenariosModule {}
