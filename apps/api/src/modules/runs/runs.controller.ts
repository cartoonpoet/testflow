import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import {
  BulkDeleteRequestSchema,
  CreateRunRequestSchema,
  RunListQuerySchema,
} from "@testflow/contracts";
import type {
  BulkDeleteRequest,
  BulkDeleteResult,
  CreateRunRequest,
  CreateRunResponse,
  RunDetail,
  RunListItem,
  RunListQuery,
  RunQueueStatus,
} from "@testflow/contracts";
import { zodBody } from "../../common/pipes/zod-validation.pipe.js";
import { runBulkDelete } from "../../common/utils/bulk-delete.js";
import { ArtifactsService } from "../artifacts/artifacts.service.js";
import { RunsService } from "./runs.service.js";

/** ERDify 규약 — `@Controller()` 빈 인자 + 메서드마다 전체 경로. 인증·Guard 없음(비회원제). */
@Controller()
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    /** 실행 삭제 시 디스크의 증적 파일까지 지우기 위해 주입한다 — `remove()` 주석 참조. */
    private readonly artifacts: ArtifactsService,
  ) {}

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

  /**
   * `POST /api/runs/bulk-delete` — 다중 삭제 (라운드 8).
   *
   * ★ **`runs/:id` 보다 먼저 선언해야 한다** — `runs/queue` 와 같은 이유다.
   *   (`POST runs/:id` 라우트는 없지만, 순서 규율을 깨 두면 다음 사람이 밟는다.)
   *
   * 형태를 `DELETE …?ids=` 가 아니라 행위형 POST 로 고른 근거는
   * `@testflow/contracts` 의 `delete.ts` 머리 주석에 표로 적어 두었다. 요약하면
   * **부분 성공**(3건 삭제 · 1건 진행 중 · 1건 이미 없음)을 204 로는 말할 수 없기 때문이다.
   *
   * 그래서 이 엔드포인트는 **던지지 않는다.** 한 건이 409 라고 나머지를 되돌리면
   * 지울 수 있었던 것까지 사용자가 다시 골라야 한다.
   */
  @Post("runs/bulk-delete")
  @HttpCode(200)
  bulkRemove(
    @Body(zodBody(BulkDeleteRequestSchema)) body: BulkDeleteRequest,
  ): Promise<BulkDeleteResult> {
    return runBulkDelete(
      body.ids,
      (id) => this.purgeAndRemove(id),
      "이미 삭제된 실행입니다.",
    );
  }

  @Get("runs/:id")
  findOne(@Param("id") id: string): Promise<RunDetail> {
    return this.runs.findOne(id);
  }

  /**
   * `DELETE /api/runs/:id` — 204. **되돌릴 수 없다**(soft delete 가 아니다).
   *
   * ★ 순서가 이 메서드의 전부다 — **① 삭제 가능 판정 → ② 디스크 파일 → ③ DB.**
   *   - ①이 먼저여야 한다: 진행 중이라 **지우지 않기로 한** 실행의 증적을 먼저 날리면
   *     409 를 돌려주고도 파일은 이미 없다.
   *   - ②가 ③보다 먼저여야 한다: 뒤집으면 "DB 삭제 성공 + 파일 삭제 실패"에서
   *     어느 run 의 파일인지 알 방법이 사라진다(행이 이미 없다).
   *     `ScenariosController.remove()` 가 07-attachments §8 에서 세운 규칙과 같다.
   *
   * ★ 오케스트레이션을 **컨트롤러에서** 한다. `RunsService` 에 `ArtifactsService` 를
   *   주입하면 "실행 서비스는 증적 저장소를 보지 않는다"는 경계가 무너지고,
   *   삭제 순서가 서비스 내부로 숨어 다음 사람이 읽을 수 없게 된다.
   */
  @Delete("runs/:id")
  @HttpCode(204)
  async remove(@Param("id") id: string): Promise<void> {
    await this.purgeAndRemove(id);
  }

  @Post("runs/:id/cancel")
  @HttpCode(200)
  cancel(@Param("id") id: string): Promise<{ status: "cancelled" }> {
    return this.runs.cancel(id);
  }

  /** 단건·다중이 **같은 경로**를 쓴다. 갈래가 둘이면 삭제 순서가 두 벌이 된다. */
  private async purgeAndRemove(id: string): Promise<void> {
    const run = await this.runs.assertDeletable(id);
    await this.artifacts.purgeRunFiles(run.id);
    await this.runs.removeRow(run);
  }
}
