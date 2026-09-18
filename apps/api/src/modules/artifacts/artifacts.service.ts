import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import type { Artifact } from "@testflow/contracts";
import { ArtifactEntity, RunEntity } from "@testflow/db";
import { REPO_ROOT_DIR } from "../../common/config/env.js";
import { ArtifactPathError, artifactFileName, isInsideRoot, resolveArtifactPath } from "./artifacts.path.js";

interface ArtifactRow {
  id: string;
  run_id: string;
  step_result_id: string | null;
  artifact_type: Artifact["type"];
  storage_key: string;
  content_type: string;
  size_bytes: string | number | null;
  created_at: Date;
  step_sequence: number | null;
}

export interface ArtifactStream {
  stream: NodeJS.ReadableStream;
  contentType: string;
  fileName: string;
  sizeBytes: number | null;
  /**
   * ★ Range 요청으로 잘라 준 구간(`[start, end]`, 둘 다 포함). 전체를 준 경우 `null`.
   *
   * `<video>` 는 **seek 할 때 Range 를 쓴다.** 서버가 언제나 200 + 전체를 주면
   * 브라우저가 탐색을 포기하거나(진행 바가 안 움직인다) 파일을 통째로 다시 받는다.
   */
  range: { start: number; end: number } | null;
}

/**
 * `Range: bytes=…` 헤더 1개를 해석한다. **순수 함수 — 단위 테스트의 대상이다.**
 *
 * 지원하는 형태는 단일 구간뿐이다(`bytes=0-1000` · `bytes=500-` · `bytes=-500`).
 * 다중 구간(`bytes=0-9,20-29`)은 `multipart/byteranges` 응답을 만들어야 하는데
 * 브라우저의 미디어 재생은 그것을 쓰지 않는다 — **지원하는 척하지 않고** `null` 로
 * 떨어뜨려 전체를 준다(200). 잘못된 범위는 `"unsatisfiable"` 이며 **416** 이다.
 */
export function parseByteRange(
  header: string | undefined,
  sizeBytes: number,
): { start: number; end: number } | null | "unsatisfiable" {
  if (header === undefined || header === "") return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) return null;
  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (rawStart === "" && rawEnd === "") return null;
  if (sizeBytes <= 0) return "unsatisfiable";

  let start: number;
  let end: number;
  if (rawStart === "") {
    // `bytes=-500` = 마지막 500바이트.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return "unsatisfiable";
    start = Math.max(0, sizeBytes - suffix);
    end = sizeBytes - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? sizeBytes - 1 : Number(rawEnd);
    // 파일 끝을 넘겨 요청해도 끝까지만 준다(RFC 9110 — 초과분은 잘라 낸다).
    if (end > sizeBytes - 1) end = sizeBytes - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "unsatisfiable";
  if (start > end || start >= sizeBytes) return "unsatisfiable";
  return { start, end };
}

/** Range 가 만족될 수 없을 때 던진다 → 컨트롤러가 **416** 으로 옮긴다. */
export class RangeNotSatisfiableError extends Error {
  constructor(readonly sizeBytes: number) {
    super("요청한 바이트 범위를 만족할 수 없습니다.");
    this.name = "RangeNotSatisfiableError";
  }
}

/**
 * 증적(Artifact) 서비스.
 *
 * 저장소는 로컬 디스크(`ARTIFACT_ROOT`)다. **API 와 Runner 가 같은 호스트에서 이 디렉토리를
 * 공유한다**는 전제 위에 서 있다 — Runner 가 쓴 파일을 API 가 읽어 서빙하기 때문이다
 * (02-context "(b) 부가 제약"). Runner 를 다른 호스트로 분리하는 순간
 * `StorageAdapter` 의 S3/MinIO 구현체가 필요해진다.
 */
@Injectable()
export class ArtifactsService {
  /** 상대 경로면 **레포 루트 기준**으로 해석한다(cwd 가 진입점마다 달라 믿을 수 없다). */
  private readonly root = resolve(REPO_ROOT_DIR, process.env["ARTIFACT_ROOT"] ?? "./artifacts");

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ArtifactEntity) private readonly artifacts: Repository<ArtifactEntity>,
    @InjectRepository(RunEntity) private readonly runs: Repository<RunEntity>,
  ) {}

  get artifactRoot(): string {
    return this.root;
  }

  /** `GET /api/runs/:id/artifacts` */
  async listByRun(runId: string): Promise<Artifact[]> {
    const exists = await this.runs.exists({ where: { id: runId } });
    if (!exists) throw new NotFoundException(`실행을 찾을 수 없습니다: ${runId}`);

    const rows = (await this.dataSource.query(
      `SELECT a.id, a.run_id, a.step_result_id, a.artifact_type, a.storage_key,
              a.content_type, a.size_bytes, a.created_at,
              sr.sequence AS step_sequence
         FROM artifacts a
         LEFT JOIN step_results sr ON sr.id = a.step_result_id
        WHERE a.run_id = ?
        ORDER BY sr.sequence IS NULL, sr.sequence ASC, a.created_at ASC`,
      [runId],
    )) as ArtifactRow[];

    return rows.map(toArtifact);
  }

  /**
   * `GET /api/artifacts/:id?download=1` — 파일 스트림.
   *
   * 경로 방어는 `artifacts.path.ts` 가 전담한다. 여기서는 그 결과를 400/404 로 옮기고
   * `stat` 으로 실제 파일인지(디렉토리·심볼릭 링크 탈출 아님) 한 번 더 본다.
   */
  async openFile(id: string, rangeHeader?: string): Promise<ArtifactStream> {
    const artifact = await this.artifacts.findOne({ where: { id } });
    if (!artifact) throw new NotFoundException(`증적을 찾을 수 없습니다: ${id}`);

    let filePath: string;
    try {
      filePath = resolveArtifactPath(this.root, artifact.storageKey);
    } catch (error) {
      if (error instanceof ArtifactPathError) throw new BadRequestException(error.message);
      throw error;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      throw new NotFoundException("증적 파일이 디스크에 없습니다.");
    }
    // 심볼릭 링크로 root 를 빠져나가는 경우까지 막는다(stat 은 링크를 따라간다).
    if (!isInsideRoot(this.root, filePath)) {
      throw new BadRequestException("storage_key 가 ARTIFACT_ROOT 밖을 가리킵니다.");
    }

    const range = parseByteRange(rangeHeader, info.size);
    if (range === "unsatisfiable") throw new RangeNotSatisfiableError(info.size);

    return {
      // ★ Range 가 있으면 **그 구간만** 읽는다. 전체를 읽고 잘라 주면 200MB 영상의 마지막
      //   1초를 보려는 seek 이 200MB 디스크 읽기가 된다.
      stream:
        range === null
          ? createReadStream(filePath)
          : createReadStream(filePath, { start: range.start, end: range.end }),
      contentType: artifact.contentType,
      fileName: artifactFileName(artifact.storageKey),
      sizeBytes: info.size,
      range,
    };
  }
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    runId: row.run_id,
    stepResultId: row.step_result_id,
    type: row.artifact_type,
    storageKey: row.storage_key,
    contentType: row.content_type,
    // ★ BIGINT UNSIGNED 는 드라이버가 **문자열**로 준다 (04-gen-2 이슈 4번).
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    stepSequence: row.step_sequence === null ? null : Number(row.step_sequence),
    url: `/api/artifacts/${row.id}`,
    createdAt: row.created_at.toISOString(),
  };
}
