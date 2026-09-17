import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CreateRunRequestSchema, RunListQuerySchema } from "@testflow/contracts";
import type {
  CreateRunRequest,
  CreateRunResponse,
  RunDetail,
  RunListItem,
  RunListQuery,
} from "@testflow/contracts";
import { zodBody } from "../../common/pipes/zod-validation.pipe.js";
import { RunsService } from "./runs.service.js";

/** ERDify 규약 — `@Controller()` 빈 인자 + 메서드마다 전체 경로. 인증·Guard 없음(비회원제). */
@Controller()
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  /**
   * `POST /api/runs` → **202 Accepted**.
   *
   * 큐 등록만 하고 즉시 반환한다. 실행 진행은 `GET /api/runs/:id/events`(SSE) 로만 본다.
   * 스위트 실행이면 `runIds` 에 N건, `batchId` 에 묶음 id 가 실린다.
   */
  @Post("runs")
  @HttpCode(202)
  create(@Body(zodBody(CreateRunRequestSchema)) request: CreateRunRequest): Promise<CreateRunResponse> {
    return this.runs.create(request);
  }

  @Get("runs")
  list(@Query(zodBody(RunListQuerySchema)) query: RunListQuery): Promise<RunListItem[]> {
    return this.runs.list(query);
  }

  @Get("runs/:id")
  findOne(@Param("id") id: string): Promise<RunDetail> {
    return this.runs.findOne(id);
  }

  @Post("runs/:id/cancel")
  @HttpCode(200)
  cancel(@Param("id") id: string): Promise<{ status: "cancelled" }> {
    return this.runs.cancel(id);
  }
}
