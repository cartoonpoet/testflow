import { Controller, Get, Headers, HttpStatus, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import type { Artifact } from "@testflow/contracts";
import { ArtifactsService, RangeNotSatisfiableError } from "./artifacts.service.js";

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
   *
   * ## ★ 라운드 4 — Range 요청을 지원한다 (`<video>` 의 seek)
   * `<video>` 는 탐색할 때 `Range: bytes=…` 를 보낸다. 언제나 200 + 전체를 주면
   * **진행 바를 끌어도 되감기지 않거나** 파일을 통째로 다시 받는다. 그래서
   *  - `Accept-Ranges: bytes` 를 **항상** 알린다(브라우저가 탐색 가능 여부를 이걸로 판단한다),
   *  - Range 가 오면 **206 + `Content-Range`** 로 그 구간만 준다,
   *  - 만족할 수 없는 범위는 **416 + `Content-Range`(전체 크기 표기)** 다.
   */
  @Get("artifacts/:id")
  async download(
    @Param("id") id: string,
    @Res() res: Response,
    @Query("download") download?: string,
    @Headers("range") range?: string,
  ): Promise<void> {
    let file;
    try {
      file = await this.artifacts.openFile(id, range);
    } catch (error) {
      if (error instanceof RangeNotSatisfiableError) {
        res.setHeader("Content-Range", `bytes */${String(error.sizeBytes)}`);
        res.setHeader("Accept-Ranges", "bytes");
        res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).end();
        return;
      }
      throw error;
    }
    const disposition = download === "1" || download === "true" ? "attachment" : "inline";

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `${disposition}; filename="${file.fileName}"`);
    // ★ Range 를 안 쓴 응답에도 붙인다 — 이 헤더가 없으면 브라우저는 seek 을 시도조차 않는다.
    res.setHeader("Accept-Ranges", "bytes");

    if (file.range === null) {
      if (file.sizeBytes !== null) res.setHeader("Content-Length", String(file.sizeBytes));
    } else {
      const { start, end } = file.range;
      res.setHeader("Content-Length", String(end - start + 1));
      res.setHeader("Content-Range", `bytes ${String(start)}-${String(end)}/${String(file.sizeBytes ?? 0)}`);
      res.status(HttpStatus.PARTIAL_CONTENT);
    }

    file.stream.pipe(res);
  }
}
