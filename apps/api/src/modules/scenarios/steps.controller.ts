import { Body, Controller, Delete, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { CreateStepDtoSchema, PatchStepDtoSchema, PutStepsDtoSchema } from "@testflow/contracts";
import type { ApiTestStep, CreateStepDto, PatchStepDto, PutStepsDto } from "@testflow/contracts";
import { zodBody } from "../../common/pipes/zod-validation.pipe.js";
import { StepsService } from "./steps.service.js";
import { parseAdvancedFlag } from "./step.mapper.js";

@Controller()
export class StepsController {
  constructor(private readonly steps: StepsService) {}

  /**
   * **전량 치환.** 순서 변경과 삭제를 한 번에 처리한다.
   *
   * body 는 `PutStepsDtoSchema` → `TestStepArraySchema` 로 먼저 거른다.
   * `sequence` 가 1..n 연속이 아닌 배열(= `uq_test_steps_seq` 를 깨뜨릴 배열)은
   * **DB 에 닿기 전에** 400 으로 막힌다.
   */
  @Put("scenarios/:id/steps")
  replaceAll(
    @Param("id") id: string,
    @Body(zodBody(PutStepsDtoSchema)) dto: PutStepsDto,
    @Query("advanced") advanced?: string,
  ): Promise<{ steps: ApiTestStep[] }> {
    return this.steps
      .replaceAll(id, dto.steps, parseAdvancedFlag(advanced))
      .then((steps) => ({ steps }));
  }

  @Post("scenarios/:id/steps")
  insertAfter(
    @Param("id") id: string,
    @Body(zodBody(CreateStepDtoSchema)) dto: CreateStepDto,
    @Query("advanced") advanced?: string,
  ): Promise<ApiTestStep> {
    return this.steps.insertAfter(id, dto, parseAdvancedFlag(advanced));
  }

  @Patch("steps/:stepId")
  patch(
    @Param("stepId") stepId: string,
    @Body(zodBody(PatchStepDtoSchema)) dto: PatchStepDto,
    @Query("advanced") advanced?: string,
  ): Promise<ApiTestStep> {
    return this.steps.patch(stepId, dto, parseAdvancedFlag(advanced));
  }

  @Delete("steps/:stepId")
  @HttpCode(204)
  remove(@Param("stepId") stepId: string): Promise<void> {
    return this.steps.remove(stepId);
  }
}
