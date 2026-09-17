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
  async openFile(id: string): Promise<ArtifactStream> {
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

    return {
      stream: createReadStream(filePath),
      contentType: artifact.contentType,
      fileName: artifactFileName(artifact.storageKey),
      sizeBytes: info.size,
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
