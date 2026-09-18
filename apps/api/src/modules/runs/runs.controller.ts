import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { CreateRunRequestSchema, RunListQuerySchema } from "@testflow/contracts";
import type {
  CreateRunRequest,
  CreateRunResponse,
  RunDetail,
  RunListItem,
  RunListQuery,
  RunQueueStatus,
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

  /**
   * `GET /api/runs/queue` — 큐 상태(대기·실행 중·Runner 동시 한도).
   *
   * ★ **`runs/:id` 보다 먼저 선언해야 한다.** Nest 는 선언 순서대로 매칭하므로
   *   뒤에 두면 `:id = "queue"` 로 잡혀 404(uuid 아님)가 난다.
   */
  @Get("runs/queue")
  queue(): Promise<RunQueueStatus> {
    return this.runs.queueStatus();
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
