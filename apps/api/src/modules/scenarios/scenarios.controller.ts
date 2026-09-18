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
import { ScenarioAttachmentService } from "./scenario-attachment.service.js";
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
  constructor(
    private readonly scenarios: ScenariosService,
    /** 시나리오 삭제 시 디스크의 첨부 파일까지 지우기 위해 주입한다 — `remove()` 주석 참조. */
    private readonly attachments: ScenarioAttachmentService,
  ) {}

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

  /**
   * `DELETE /api/scenarios/:id` — 204.
   *
   * ★ **디스크의 첨부 파일도 함께 지운다.** DB 행은 FK CASCADE 가 지우지만 파일은
   *   아무도 지우지 않아 고아가 된다(실측: 검증 중 97MB 가 남았다).
   *
   * ★ 순서를 지킨다 — **파일 먼저, DB 나중.** 뒤집으면 DB 삭제 성공 + 파일 삭제 실패에서
   *   어느 시나리오의 파일인지 알 방법이 사라진다(행이 이미 없다).
   *
   * ★ 오케스트레이션을 **컨트롤러에서** 한다. `ScenariosService` 가 첨부 서비스를 주입받으면
   *   순환 의존이 된다(`ScenarioAttachmentService` 가 이미 `ScenariosService` 를 쓴다).
   *   그리고 `ScenariosService` 는 첨부 리포지토리를 보지 않는다는 규율이 유지된다.
   */
  @Delete("scenarios/:id")
  @HttpCode(204)
  async remove(@Param("id") id: string): Promise<void> {
    await this.attachments.purgeScenarioFiles(id);
    await this.scenarios.remove(id);
  }

  @Post("scenarios/:id/publish")
  @HttpCode(200)
  publish(@Param("id") id: string): Promise<PublishScenarioResponse> {
    return this.scenarios.publish(id);
  }
}
