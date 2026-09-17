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
 * ★ `PATCH` 는 **모르는 키를 거부**한다 (03-phases Task 2.1 완료기준 ③ — `forbidNonWhitelisted`).
 *
 * `sourceType` 은 생성 후 변경할 수 없다. zod 의 기본 동작은 모르는 키를 **조용히 버리는 것**이라
 * `PATCH {sourceType:"steps"}` 가 200 으로 성공한 것처럼 보인다 — 그러면 사용자는 바뀐 줄 안다.
 * 400 으로 명시 거부한다.
 *
 * `contracts` 의 `PatchScenarioDtoSchema` 자체는 건드리지 않았다(다른 소비자의 동작이 바뀐다).
 * strict 는 **이 엔드포인트의 판단**이므로 호출부에 둔다.
 */
const PatchScenarioBodySchema = PatchScenarioDtoSchema.strict();

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
    @Body(zodBody(PatchScenarioBodySchema)) dto: PatchScenarioDto,
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
