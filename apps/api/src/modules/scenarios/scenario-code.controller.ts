import { Body, Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { PutScenarioCodeDtoSchema } from "@testflow/contracts";
import type { PutScenarioCodeDto, ScenarioCode } from "@testflow/contracts";
import { zodBody } from "../../common/pipes/zod-validation.pipe.js";
import { ScenarioCodeService } from "./scenario-code.service.js";

/**
 * 코드 시나리오 본문 엔드포인트.
 *
 * ERDify 규약 — `@Controller()` 빈 인자 + 메서드마다 전체 경로. 인증·Guard 없음(비회원제).
 *
 * ★ **업로드 전용 경로(multipart)는 없다.** 웹의 "파일 선택"은 `File.text()` 로 읽어
 *   `PUT …/code` 로 보낸다 — 근거는 `scenario-code.service.ts` 의 `put()` JSDoc 에 있다.
 */
@Controller()
export class ScenarioCodeController {
  constructor(private readonly codes: ScenarioCodeService) {}

  @Get("scenarios/:id/code")
  findOne(@Param("id") id: string): Promise<ScenarioCode> {
    return this.codes.findOne(id);
  }

  /**
   * `PUT /api/scenarios/:id/code` — upsert.
   *
   * 400 이 되는 경우 3가지:
   *  - `filename` 규칙 위반 (`zodBody` 가 막는다 — `../../etc/passwd` 등)
   *  - 시나리오가 `sourceType:"code"` 가 아님
   *  - `validateScenarioCode()` 의 `severity:"error"` 존재 → `details` 에 줄·열 번호가 실린다
   */
  @Put("scenarios/:id/code")
  put(
    @Param("id") id: string,
    @Body(zodBody(PutScenarioCodeDtoSchema)) dto: PutScenarioCodeDto,
  ): Promise<ScenarioCode> {
    return this.codes.put(id, dto);
  }

  @Delete("scenarios/:id/code")
  @HttpCode(204)
  remove(@Param("id") id: string): Promise<void> {
    return this.codes.remove(id);
  }
}
