import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ScenarioAttachmentEntity } from "@testflow/db";
import {
  AttachmentFilenameSchema,
  MAX_ATTACHMENTS_PER_SCENARIO,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  attachmentLimitMessage,
  buildAttachmentStorageKey,
  normalizeAttachmentContentType,
} from "@testflow/contracts";
import type { ScenarioAttachment, ScenarioAttachmentList } from "@testflow/contracts";
import { REPO_ROOT_DIR } from "../../common/config/env.js";
import { AttachmentPathError, isInsideRoot, resolveAttachmentPath } from "./attachment.path.js";
import { ScenariosService } from "./scenarios.service.js";

export interface AttachmentStream {
  stream: NodeJS.ReadableStream;
  contentType: string;
  filename: string;
  sizeBytes: number;
}

/**
 * 시나리오 첨부파일(테스트 데이터) 서비스.
 *
 * ════════════════════════════════════════════════════════════════════
 * ## ★ 이 서비스가 `ScenariosService` 와 분리된 이유
 * `scenario-code.service.ts` 와 같은 논리다 — `scenarios` 목록 조회가 첨부 리포지토리를
 * 실수로 건드리는 경로를 **구조적으로** 없앤다. `ScenariosService` 는
 * `ScenarioAttachmentEntity` 를 주입받지 않는다.
 *
 * ## ★ 새 의존성을 추가하지 않는다 — `multer`/`busboy` 없음
 * 라운드 2가 코드 본문 업로드에서 지킨 기조 그대로다. 다만 **코드는 텍스트였고
 * 첨부는 바이너리(.docx)** 라 `File.text()` 경로를 그대로 쓸 수 없다. 선택지 비교:
 *
 * | 방법 | 새 의존성 | 오버헤드 | 판정 |
 * |---|---|---|---|
 * | `multipart/form-data` | **`multer` 필요** | 없음 | ✗ `.npmrc` 검역 게이트 + 기조 위반 |
 * | JSON + base64 | 없음 | **+33%** · 10MiB → 13.3MiB JSON | ✗ 얻는 것 없이 본문만 부풀린다 |
 * | **`application/octet-stream` raw body** | **없음** | **0%** | **✓ 채택** |
 *
 * `express.raw()` 는 `@nestjs/platform-express` 가 이미 가진 body-parser 다
 * (`main.ts` 의 `app.useBodyParser("raw", …)` — 한 줄로 켠다). 파일명은 **쿼리스트링**으로
 * 넘긴다 — 헤더로 넘기면 한글이 latin1 로 깨지고(`ERR_INVALID_CHAR`), 쿼리스트링은
 * 퍼센트 인코딩이 규격이라 한글이 무손실로 왕복한다.
 *
 * ## 저장 위치 — `ARTIFACT_ROOT` 아래, 그러나 `runs/` 와 **형제**
 * ```
 * $ARTIFACT_ROOT/
 *   runs/<runId>/…                              ← 증적 (건드리지 않는다)
 *   scenario-attachments/<scenarioId>/<id>.bin  ← 첨부 (이번에 추가)
 * ```
 * 같은 볼륨을 쓰는 이유: **API 와 Runner 가 `ARTIFACT_ROOT` 를 공유한다**는 전제가 이미
 * 서 있다(02-context (b) 부가 제약). 새 공유 볼륨을 만들면 배포 전제가 하나 늘어난다.
 *
 * ★ 그럼에도 **`ARTIFACT_ROOT` 는 컨테이너에 마운트되지 않는다.** 라운드 1·2 규율 그대로다 —
 *   Runner 가 호스트 쪽에서 읽어 **작업공간으로 복사**한다(`code-attachments.ts`).
 * ════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class ScenarioAttachmentService {
  /** 상대 경로면 **레포 루트 기준**(API 의 `ArtifactsService` 와 한 글자도 같은 규칙). */
  private readonly root = resolve(REPO_ROOT_DIR, process.env["ARTIFACT_ROOT"] ?? "./artifacts");

  constructor(
    @InjectRepository(ScenarioAttachmentEntity)
    private readonly attachments: Repository<ScenarioAttachmentEntity>,
    private readonly scenarios: ScenariosService,
  ) {}

  get artifactRoot(): string {
    return this.root;
  }

  /** `GET /api/scenarios/:id/attachments` — 메타만. 바이트는 싣지 않는다. */
  async list(scenarioId: string): Promise<ScenarioAttachmentList> {
    await this.scenarios.mustFind(scenarioId);
    const rows = await this.attachments.find({
      where: { scenarioId },
      order: { filename: "ASC" },
    });
    return {
      items: rows.map(toScenarioAttachment),
      totalBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
      maxTotalBytes: MAX_ATTACHMENT_TOTAL_BYTES,
      maxCount: MAX_ATTACHMENTS_PER_SCENARIO,
      maxFileBytes: MAX_ATTACHMENT_BYTES,
    };
  }

  /**
   * `POST /api/scenarios/:id/attachments?filename=…` — 업로드(같은 이름이면 덮어쓴다).
   *
   * 상한 3종을 **전부** 본다. 하나만 두면 상한이 닫히지 않는다:
   *  - 개당(`MAX_ATTACHMENT_BYTES`) — 없으면 1건이 디스크를 채운다
   *  - 개수(`MAX_ATTACHMENTS_PER_SCENARIO`) — 없으면 실행마다 복사가 무한정 길어진다
   *  - 합계(`MAX_ATTACHMENT_TOTAL_BYTES`) — 없으면 개당×개수(=200MiB)가 허용된다
   *
   * ★ 덮어쓰기는 **같은 `id`(= 같은 storage key)를 재사용한다.** 새 UUID 를 발급하면
   *   옛 파일이 디스크에 고아로 남고 아무도 지우지 않는다(디스크가 조용히 찬다).
   */
  async upload(
    scenarioId: string,
    rawFilename: string,
    contentType: string | undefined,
    data: Buffer,
  ): Promise<ScenarioAttachment> {
    const scenario = await this.scenarios.mustFind(scenarioId);
    if (scenario.sourceType !== "code") {
      throw new BadRequestException(
        "첨부파일은 코드 시나리오에만 붙일 수 있습니다. 녹화(steps) 시나리오는 스텝이 입력값을 갖습니다.",
      );
    }

    const parsedName = AttachmentFilenameSchema.safeParse(rawFilename);
    if (!parsedName.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: "Bad Request",
        message: "첨부파일 이름이 올바르지 않습니다.",
        details: parsedName.error.issues.map((issue) => ({
          path: "filename",
          message: issue.message,
        })),
      });
    }
    const filename = parsedName.data;

    if (data.byteLength === 0) {
      throw new BadRequestException("빈 파일은 올릴 수 없습니다.");
    }
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException(attachmentLimitMessage("file", data.byteLength));
    }

    const existing = await this.attachments.findOne({ where: { scenarioId, filename } });
    const siblings = await this.attachments.find({ where: { scenarioId } });

    if (existing === null && siblings.length >= MAX_ATTACHMENTS_PER_SCENARIO) {
      throw new PayloadTooLargeException(attachmentLimitMessage("count", siblings.length));
    }
    // 덮어쓰기면 **기존 크기를 빼고** 새 크기를 더한다(같은 파일을 다시 올릴 때 두 번 세지 않는다).
    const othersBytes = siblings
      .filter((row) => row.id !== existing?.id)
      .reduce((sum, row) => sum + row.sizeBytes, 0);
    const nextTotal = othersBytes + data.byteLength;
    if (nextTotal > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new PayloadTooLargeException(attachmentLimitMessage("total", nextTotal));
    }

    const id = existing?.id ?? randomUUID();
    const storageKey = buildAttachmentStorageKey(scenarioId, id);

    // ★ 디스크에 먼저 쓰고 DB 를 커밋한다. 순서가 뒤집히면 "행은 있는데 파일이 없는"
    //   상태가 생기고, 그건 실행 시점에야 드러난다. 반대(파일만 있고 행이 없음)는
    //   고아 파일 하나일 뿐 실행을 깨뜨리지 않는다.
    const filePath = this.pathFor(storageKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);

    const entity =
      existing ??
      this.attachments.create({
        id,
        scenarioId,
        filename,
      });
    entity.contentType = normalizeAttachmentContentType(contentType);
    entity.sizeBytes = data.byteLength;
    entity.storageKey = storageKey;

    return toScenarioAttachment(await this.attachments.save(entity));
  }

  /** `DELETE /api/scenarios/:sid/attachments/:aid` — 204. DB 행과 디스크 파일을 함께 지운다. */
  async remove(scenarioId: string, attachmentId: string): Promise<void> {
    await this.scenarios.mustFind(scenarioId);
    const row = await this.attachments.findOne({ where: { id: attachmentId, scenarioId } });
    if (row === null) {
      throw new NotFoundException(`첨부파일을 찾을 수 없습니다: ${attachmentId}`);
    }

    await this.attachments.delete({ id: row.id });
    // ★ DB 를 먼저 지운다. 파일 삭제가 실패해도 목록에서는 사라진다(고아 파일 1개).
    //   반대로 하면 파일은 없는데 행이 남아 실행이 깨진다.
    try {
      await rm(this.pathFor(row.storageKey), { force: true });
    } catch {
      // 키가 이상하면 `pathFor` 가 던진다 — 그건 이미 DB 행을 지운 뒤라 목록은 깨끗하다.
    }
  }

  /**
   * `GET /api/scenarios/:sid/attachments/:aid` — 파일 스트림.
   *
   * 경로 방어는 `attachment.path.ts` 가 전담하고, 여기서는 `stat` 으로 실제 파일인지
   * (디렉토리·심볼릭 링크 탈출 아님) 한 번 더 본다 — `ArtifactsService.openFile()` 과 같다.
   */
  async openFile(scenarioId: string, attachmentId: string): Promise<AttachmentStream> {
    await this.scenarios.mustFind(scenarioId);
    const row = await this.attachments.findOne({ where: { id: attachmentId, scenarioId } });
    if (row === null) {
      throw new NotFoundException(`첨부파일을 찾을 수 없습니다: ${attachmentId}`);
    }

    const filePath = this.pathFor(row.storageKey);
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      throw new NotFoundException("첨부파일이 디스크에 없습니다.");
    }
    // 심볼릭 링크로 root 를 빠져나가는 경우까지 막는다(stat 은 링크를 따라간다).
    if (!isInsideRoot(this.root, filePath)) {
      throw new BadRequestException("storage_key 가 ARTIFACT_ROOT 밖을 가리킵니다.");
    }

    return {
      stream: createReadStream(filePath),
      contentType: row.contentType,
      filename: row.filename,
      sizeBytes: info.size,
    };
  }

  /**
   * ★ 시나리오가 삭제될 때 **디스크의 첨부 파일까지** 지운다.
   *
   * DB 행은 `fk_scenario_attachments_scenario … ON DELETE CASCADE` 가 알아서 지우지만
   * **파일은 아무도 지우지 않는다.** 실측으로 확인했다 — 검증 중 시나리오 8건을 지운 뒤
   * `artifacts/scenario-attachments/` 에 **97MB 가 고아로 남아 있었다.**
   * 고아 파일은 용량 상한(개당·개수·합계)을 통째로 무의미하게 만든다: 상한은 "살아 있는
   * 시나리오"만 세는데 디스크는 죽은 것까지 이고 있기 때문이다.
   *
   * ★ 증적(`runs/…`)은 이렇게 하지 않는다 — `runs` 이력은 append-only 이고 시나리오가
   *   지워져도 남는 것이 계약이다(`runs.scenario_id` 가 NULL 이 된다). 첨부는 반대로
   *   **시나리오에 종속**이라 시나리오가 없으면 존재 이유가 없다.
   *
   * 실패해도 던지지 않는다 — 파일이 안 지워졌다고 시나리오 삭제를 막으면 사용자는
   * 시나리오를 영영 못 지운다. 고아 파일 하나가 그보다 낫다.
   */
  async purgeScenarioFiles(scenarioId: string): Promise<void> {
    // 경로를 문자열로 조립하지 않는다 — 유효한 키를 한 번 만들어 검증기를 통과시킨 뒤
    // 그 **부모 디렉토리**를 쓴다. scenarioId 가 오염돼도 검증기가 먼저 막는다.
    const probeKey = buildAttachmentStorageKey(scenarioId, PROBE_ATTACHMENT_ID);
    let dir: string;
    try {
      dir = dirname(resolveAttachmentPath(this.root, probeKey));
    } catch {
      // 키가 만들어지지 않는 scenarioId = 애초에 우리가 쓴 적 없는 값이다.
      return;
    }
    if (!isInsideRoot(this.root, dir)) return;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  /** 키 → 경로. `AttachmentPathError` 는 400 으로 옮긴다. */
  private pathFor(storageKey: string): string {
    try {
      return resolveAttachmentPath(this.root, storageKey);
    } catch (error) {
      if (error instanceof AttachmentPathError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}

/**
 * `purgeScenarioFiles()` 가 디렉토리 경로를 얻기 위해 쓰는 더미 UUID.
 * 실제로 존재하지 않아도 된다 — 필요한 것은 **부모 디렉토리**뿐이다.
 */
const PROBE_ATTACHMENT_ID = "00000000-0000-4000-8000-000000000000";

export function toScenarioAttachment(entity: ScenarioAttachmentEntity): ScenarioAttachment {
  return {
    id: entity.id,
    scenarioId: entity.scenarioId,
    filename: entity.filename,
    contentType: entity.contentType,
    sizeBytes: entity.sizeBytes,
    url: `/api/scenarios/${entity.scenarioId}/attachments/${entity.id}`,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
