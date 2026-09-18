import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { attachmentContentDisposition } from "@testflow/contracts";
import type { ScenarioAttachment, ScenarioAttachmentList } from "@testflow/contracts";
import { ScenarioAttachmentService } from "./scenario-attachment.service.js";

/**
 * 시나리오 첨부파일(테스트 데이터) 엔드포인트.
 *
 * ERDify 규약 — `@Controller()` 빈 인자 + 메서드마다 전체 경로. 인증·Guard 없음(비회원제).
 *
 * ## ★ 업로드는 `application/octet-stream` **raw body** 다 — multipart 가 아니다
 * `multer`/`busboy` 를 추가하지 않기 위해서다(라운드 1·2 기조). `main.ts` 가
 * `app.useBodyParser("raw", { type: "application/octet-stream", limit: … })` 한 줄로 켠다.
 * 근거 표는 `scenario-attachment.service.ts` 상단에 있다.
 *
 * ## ★ 파일명은 **쿼리스트링**으로 받는다 — 헤더가 아니다
 * `테스트용 파일-1.docx` 같은 한글 이름을 커스텀 헤더로 보내면 HTTP 헤더가
 * latin1 로 해석되어 깨지고, Node 는 `ERR_INVALID_CHAR` 를 던지기도 한다.
 * 쿼리스트링은 퍼센트 인코딩이 규격이라 **한글이 무손실로 왕복한다**(실측 확인).
 */
@Controller()
export class ScenarioAttachmentController {
  constructor(private readonly attachments: ScenarioAttachmentService) {}

  @Get("scenarios/:id/attachments")
  list(@Param("id") id: string): Promise<ScenarioAttachmentList> {
    return this.attachments.list(id);
  }

  /**
   * `POST /api/scenarios/:id/attachments?filename=<urlencoded>`
   *
   * 400 이 되는 경우: 파일명 규칙 위반 · 빈 본문 · 코드 시나리오가 아님.
   * 413 이 되는 경우: 개당·개수·합계 상한 초과.
   */
  @Post("scenarios/:id/attachments")
  upload(
    @Param("id") id: string,
    @Query("filename") filename: string | undefined,
    @Query("contentType") contentType: string | undefined,
    @Req() req: Request,
  ): Promise<ScenarioAttachment> {
    if (filename === undefined || filename === "") {
      throw new BadRequestException("filename 쿼리 파라미터가 필요합니다.");
    }
    // `express.raw()` 가 채운 Buffer. 파서가 안 돌았으면(Content-Type 불일치) Buffer 가 아니다.
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException(
        "요청 본문을 읽지 못했습니다. Content-Type 을 application/octet-stream 으로 보내 주세요.",
      );
    }
    // ★ 원본 `File.type` 은 **쿼리로** 온다. 요청의 `Content-Type` 은 raw 파서를 켜기 위해
    //   `application/octet-stream` 으로 고정돼 있어 그 자리에 실을 수 없다.
    //   헤더로 되돌려 보낼 수 있는 값인지는 `normalizeAttachmentContentType()` 이 본다.
    return this.attachments.upload(id, filename, contentType, body);
  }

  @Delete("scenarios/:id/attachments/:attachmentId")
  @HttpCode(204)
  remove(
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
  ): Promise<void> {
    return this.attachments.remove(id, attachmentId);
  }

  /**
   * `GET /api/scenarios/:id/attachments/:attachmentId` — 파일 스트림.
   *
   * ★ 첨부는 **항상 `attachment`** 다(증적과 다르다). 사용자가 올린 임의 바이트를
   *   `inline` 으로 내보내면 브라우저가 우리 오리진에서 그것을 렌더링할 수 있다 —
   *   `.svg`·`.html` 을 올리면 저장된 XSS 가 된다. 다운로드로만 나간다.
   *
   * ★ 한글 파일명은 `filename*=UTF-8''…`(RFC 5987) 로 나간다. 헤더 조립은
   *   contracts 의 `attachmentContentDisposition()` 하나가 전담한다(규칙이 두 벌이 되지 않게).
   */
  @Get("scenarios/:id/attachments/:attachmentId")
  async download(
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.attachments.openFile(id, attachmentId);

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", attachmentContentDisposition(file.filename, "attachment"));
    res.setHeader("Content-Length", String(file.sizeBytes));
    // 업로드한 바이트가 우리 오리진에서 스크립트로 해석되지 않게 한다.
    res.setHeader("X-Content-Type-Options", "nosniff");

    file.stream.pipe(res);
  }
}
