import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import type { Artifact } from "@testflow/contracts";
import { ArtifactsService } from "./artifacts.service.js";

@Controller()
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get("runs/:id/artifacts")
  listByRun(@Param("id") runId: string): Promise<Artifact[]> {
    return this.artifacts.listByRun(runId);
  }

  /**
   * `GET /api/artifacts/:id` — 파일 스트림.
   *
   * 기본은 `inline`(브라우저가 스크린샷·영상을 바로 연다), `?download=1` 이면 `attachment`.
   * 파일명은 `storage_key` 의 마지막 토막이고 형식 검증을 통과한 문자만 남아 있어
   * 헤더 인젝션이 성립하지 않는다.
   */
  @Get("artifacts/:id")
  async download(
    @Param("id") id: string,
    @Res() res: Response,
    @Query("download") download?: string,
  ): Promise<void> {
    const file = await this.artifacts.openFile(id);
    const disposition = download === "1" || download === "true" ? "attachment" : "inline";

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `${disposition}; filename="${file.fileName}"`);
    if (file.sizeBytes !== null) res.setHeader("Content-Length", String(file.sizeBytes));

    file.stream.pipe(res);
  }
}
