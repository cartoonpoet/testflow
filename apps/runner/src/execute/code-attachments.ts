/**
 * 시나리오 첨부파일(테스트 데이터)을 실행 작업공간에 푼다 (라운드 3).
 *
 * ════════════════════════════════════════════════════════════════════
 * ## ★★ 어디에 풀어야 하는가 — **실측한 사실**
 *
 * Playwright 의 `setInputFiles('테스트용 파일-1.docx')` 가 상대 경로를 무엇 기준으로
 * 푸는지 **추측하지 않고 Playwright 1.63.0 으로 직접 쟀다**:
 *
 * ```
 * 파일을 cwd 에만 두고 실행     → OK   (name=marker.txt size=11)
 * 파일을 testDir(specs/) 에만   → FAIL (ENOENT: stat 'marker.txt')
 * 파일을 config/rootDir 에만    → FAIL (ENOENT: stat 'marker.txt')
 * ```
 *
 * → **기준은 테스트 프로세스의 `process.cwd()`** 다. spec 파일의 위치도, `testDir` 도,
 *   config 의 위치도 아니다. (`setInputFiles` 는 클라이언트 쪽에서 `fs.stat` 하므로
 *   Node 의 기본 상대 경로 해석, 즉 cwd 를 그대로 따른다.)
 *
 * Runner 의 cwd 는 **두 모드 모두 작업공간 루트**다:
 *  - `local`  : `spawn(node, [cli, "test", …], { cwd: ws.dir })`
 *  - `docker` : `-v <ws>:/ws` + **`-w /ws`** (`code-container.ts`)
 *
 * → 그래서 첨부파일은 **작업공간 루트에 평평하게** 푼다. spec 은 `specs/` 아래에 있지만
 *   그건 상관없다 — 기준이 cwd 이기 때문이다. **두 모드가 같은 코드로 동작한다.**
 *
 * ## ★ `ARTIFACT_ROOT` 를 컨테이너에 마운트하지 않는다 (라운드 1·2 규율 유지)
 * 첨부 원본은 `ARTIFACT_ROOT/scenario-attachments/…` 에 있지만 그 디렉토리를
 * 컨테이너에 노출하지 않는다 — **호스트 쪽 Runner 가 작업공간으로 복사**하고,
 * 컨테이너는 이미 마운트된 `/ws` 에서 그것을 본다. 마운트 목록은 여전히 2개다.
 * (증적이 `/ws/out` 에 쌓였다가 호스트가 꺼내는 것과 **방향만 반대인 같은 구조**다.)
 *
 * ## 정리
 * 별도 정리 코드가 **없다.** 첨부는 작업공간 안에 있고 작업공간은
 * `CodeWorkspace.dispose()` 가 어떤 경로로 끝나도 지운다(성공·실패·취소·타임아웃·예외).
 * 정리 경로를 하나 더 만들면 그 하나가 언젠가 빠진다.
 * ════════════════════════════════════════════════════════════════════
 */
import { copyFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  AttachmentStorageKeySchema,
  MAX_ATTACHMENTS_PER_SCENARIO,
  MAX_ATTACHMENT_TOTAL_BYTES,
  isSafeAttachmentFilename,
} from "@testflow/contracts";
import type { DataSource } from "typeorm";

export interface ScenarioAttachmentRow {
  readonly filename: string;
  readonly storageKey: string;
  readonly sizeBytes: number;
}

export interface MaterializeResult {
  /** 실제로 작업공간에 놓인 파일명(코드가 참조할 이름). */
  readonly placed: readonly string[];
  /** 놓지 못한 것 — `[파일명, 사유]`. **조용히 넘기지 않는다.** */
  readonly skipped: readonly (readonly [string, string])[];
  readonly totalBytes: number;
}

/**
 * `scenario_attachments` 에서 메타를 읽는다. 큐 페이로드에는 첨부 정보가 없다
 * (코드 본문을 큐에 싣지 않는 것과 같은 이유 — 04-gen-2 §4.1).
 */
export async function loadScenarioAttachments(
  dataSource: DataSource,
  scenarioId: string,
): Promise<ScenarioAttachmentRow[]> {
  const rows = (await dataSource.query(
    `SELECT filename, storage_key, size_bytes
       FROM scenario_attachments
      WHERE scenario_id = ?
      ORDER BY filename ASC
      LIMIT ?`,
    // ★ `LIMIT` 를 건다. DB 에 직접 INSERT 된 1000행이 실행을 마비시키지 못하게 한다.
    [scenarioId, MAX_ATTACHMENTS_PER_SCENARIO],
  )) as { filename: string; storage_key: string; size_bytes: string | number }[];

  return rows.map((row) => ({
    filename: row.filename,
    storageKey: row.storage_key,
    sizeBytes: Number(row.size_bytes),
  }));
}

/**
 * ★ 작업공간에 쓸 최종 경로를 만든다 — **3중 방어의 마지막 겹**.
 *
 * API 의 `AttachmentFilenameSchema` 가 이미 막았지만 여기서 한 번 더 막는다.
 * 근거는 가정이 아니라 경로다: `scenario_attachments` 행은 **DB 에 직접 INSERT 될 수 있다**
 * (마이그레이션·운영 스크립트·수동 수정). 그 행의 `filename` 이 `../../etc/passwd` 면
 * 여기가 마지막 방어선이고, 여기를 뚫으면 **Runner 호스트에 임의 파일 쓰기**가 된다.
 *
 * 형식 검증(1) + 절대경로 거부(2) + resolve 후 작업공간 접두 검사(3).
 * `assertSafeSpecFilename()`(코드 본문)과 **같은 규율**이다.
 */
export function resolveAttachmentTarget(workspaceDir: string, filename: string): string {
  if (!isSafeAttachmentFilename(filename)) {
    throw new Error(`작업공간에 놓을 수 없는 첨부 파일명입니다: ${JSON.stringify(filename)}`);
  }
  const root = resolve(workspaceDir);
  const target = resolve(root, filename);
  if (target === root || !target.startsWith(root + sep)) {
    throw new Error(`첨부 파일 경로가 작업공간 밖을 가리킵니다: ${JSON.stringify(filename)}`);
  }
  // 작업공간 **바로 아래**여야 한다 — cwd 기준 해석이라 하위 디렉토리는 의미가 없다.
  if (target.slice(root.length + 1).includes(sep)) {
    throw new Error(`첨부 파일명에 하위 디렉토리를 쓸 수 없습니다: ${JSON.stringify(filename)}`);
  }
  return target;
}

/**
 * 첨부파일을 **작업공간 루트**에 복사한다.
 *
 * ★ 한 건이 실패해도 **실행을 죽이지 않는다.** `skipped` 에 사유를 담아 돌려주고
 *   호출부가 로그에 남긴다. 그 편이 낫다 — 첨부 1개가 없으면 그 테스트만 실패하는데,
 *   실행 자체를 `error` 로 접으면 나머지 테스트의 결과까지 사라진다.
 *   다만 **조용히 넘기지는 않는다**: 사용자가 "왜 파일을 못 찾지"를 로그에서 볼 수 있어야 한다.
 */
export async function materializeAttachments(params: {
  workspaceDir: string;
  artifactRoot: string;
  attachments: readonly ScenarioAttachmentRow[];
}): Promise<MaterializeResult> {
  const placed: string[] = [];
  const skipped: (readonly [string, string])[] = [];
  let totalBytes = 0;

  for (const row of params.attachments) {
    try {
      // (1) 저장 키 형식 — API 와 같은 정규식. DB 직접 INSERT 를 막는 겹.
      const parsedKey = AttachmentStorageKeySchema.safeParse(row.storageKey);
      if (!parsedKey.success) {
        skipped.push([row.filename, `저장 키 형식 위반 — ${parsedKey.error.issues[0]?.message ?? ""}`]);
        continue;
      }

      const artifactRoot = resolve(params.artifactRoot);
      const source = resolve(artifactRoot, parsedKey.data);
      // (2) 원본이 `ARTIFACT_ROOT` 안인지 — 정규식만 믿지 않는다.
      if (!source.startsWith(artifactRoot + sep)) {
        skipped.push([row.filename, "원본 경로가 ARTIFACT_ROOT 밖을 가리킨다"]);
        continue;
      }

      const info = await stat(source).catch(() => null);
      if (info === null || !info.isFile()) {
        skipped.push([row.filename, "원본 파일이 디스크에 없다"]);
        continue;
      }

      // (3) 합계 상한 — DB 에 직접 INSERT 되어 상한을 넘긴 경우를 여기서 자른다.
      if (totalBytes + info.size > MAX_ATTACHMENT_TOTAL_BYTES) {
        skipped.push([row.filename, "첨부 합계 상한을 넘겨 더 놓지 않는다"]);
        continue;
      }

      const target = resolveAttachmentTarget(params.workspaceDir, row.filename);
      await copyFile(source, target);
      placed.push(row.filename);
      totalBytes += info.size;
    } catch (error) {
      skipped.push([row.filename, error instanceof Error ? error.message : String(error)]);
    }
  }

  return { placed, skipped, totalBytes };
}
