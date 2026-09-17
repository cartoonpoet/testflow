import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  CreateScenarioDtoSchema,
  PatchScenarioDtoSchema,
  ScenarioListQuerySchema,
} from "@testflow/contracts";
import type {
  CreateScenarioDto,
  PatchScenarioDto,
  PublishScenarioResponse,
  Scenario,
  ScenarioListQuery,
  ScenarioListResponse,
} from "@testflow/contracts";
import { zodBody } from "../../common/pipes/zod-validation.pipe.js";
import { ScenariosService } from "./scenarios.service.js";
import type { ScenarioDetailResponse } from "./scenarios.service.js";
import { parseAdvancedFlag } from "./step.mapper.js";

/**
 * ERDify 규약 — `@Controller()` 빈 인자 + 메서드마다 전체 경로.
 * 중첩 리소스(`projects/:projectId/scenarios`)와 평면 리소스(`scenarios/:id`)를
 * 한 컨트롤러에서 함께 노출하기 위한 선택이다.
 *
 * 인증·권한·Guard·CurrentUser 는 **없다**(비회원제).
 */
@Controller()
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get("projects/:projectId/scenarios")
  list(
    @Param("projectId") projectId: string,
    @Query(zodBody(ScenarioListQuerySchema)) query: ScenarioListQuery,
  ): Promise<ScenarioListResponse> {
    return this.scenarios.list(projectId, query);
  }

  @Post("projects/:projectId/scenarios")
  create(
    @Param("projectId") projectId: string,
    @Body(zodBody(CreateScenarioDtoSchema)) dto: CreateScenarioDto,
  ): Promise<Scenario> {
    return this.scenarios.create(projectId, dto);
  }

  @Get("scenarios/:id")
  findOne(
    @Param("id") id: string,
    @Query("advanced") advanced?: string,
  ): Promise<ScenarioDetailResponse> {
    return this.scenarios.findOne(id, parseAdvancedFlag(advanced));
  }

  @Patch("scenarios/:id")
  patch(
    @Param("id") id: string,
    @Body(zodBody(PatchScenarioDtoSchema)) dto: PatchScenarioDto,
  ): Promise<Scenario> {
    return this.scenarios.patch(id, dto);
  }

  @Delete("scenarios/:id")
  @HttpCode(204)
  remove(@Param("id") id: string): Promise<void> {
    return this.scenarios.remove(id);
  }

  @Post("scenarios/:id/publish")
  @HttpCode(200)
  publish(@Param("id") id: string): Promise<PublishScenarioResponse> {
    return this.scenarios.publish(id);
  }
}
