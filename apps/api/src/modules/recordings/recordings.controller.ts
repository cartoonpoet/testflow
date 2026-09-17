import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CreateRecordingDtoSchema } from "@testflow/contracts";
import type {
  ApiTestStep,
  CreateRecordingDto,
  CreateRecordingResponse,
  RecordingSession,
} from "@testflow/contracts";
import { zodBody } from "../../common/pipes/zod-validation.pipe.js";
import { RecordingsService } from "./recordings.service.js";

@Controller()
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  /** `POST /api/scenarios/:id/recordings` → `{sessionId, wsUrl, expiresAt, viewport}` */
  @Post("scenarios/:id/recordings")
  @HttpCode(201)
  create(
    @Param("id") scenarioId: string,
    @Body(zodBody(CreateRecordingDtoSchema)) dto: CreateRecordingDto,
  ): Promise<CreateRecordingResponse> {
    return this.recordings.create(scenarioId, dto);
  }

  @Get("recordings/:sessionId")
  findOne(@Param("sessionId") sessionId: string): Promise<RecordingSession> {
    return this.recordings.findOne(sessionId);
  }

  @Post("recordings/:sessionId/stop")
  @HttpCode(200)
  stop(@Param("sessionId") sessionId: string): Promise<{ steps: ApiTestStep[] }> {
    return this.recordings.stop(sessionId);
  }

  @Delete("recordings/:sessionId")
  @HttpCode(204)
  remove(@Param("sessionId") sessionId: string): Promise<void> {
    return this.recordings.remove(sessionId);
  }
}
