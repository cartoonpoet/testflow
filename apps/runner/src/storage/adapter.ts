import { isAbsolute, resolve, sep } from "node:path";
import { StorageKeySchema } from "@testflow/contracts";
import type { StorageAdapter } from "@testflow/contracts";

/**
 * 증적 저장소 어댑터 계약.
 *
 * 기본 인터페이스(`put`/`get`/`getStream`/`delete`/`exists`)는 **`@testflow/contracts` 가
 * 단일 소스**다(02-context "(b) Artifact 저장소"). 여기서 재정의하지 않고 재노출만 한다 —
 * API 도 같은 타입을 보기 때문이다.
 *
 * ## S3 / MinIO 구현체는 만들지 않는다
 * `apps/runner/src/storage/s3.ts` 는 **존재하지 않는다**(03-phases Task 6.1 완료 기준).
 * 사내 단일 서버 배포 전제에서 로컬 디스크 대비 얻는 것이 없다는 사용자 결정 (b) 때문이다.
 * Runner 를 다른 호스트로 분리하는 순간 이 인터페이스를 구현한 파일 하나만 추가하면 된다.
 */
export type { StorageAdapter };

/**
 * Runner 가 추가로 필요로 하는 연산.
 *
 * Playwright 는 video·trace 를 **파일로 떨어뜨린다.** 그걸 `put()` 에 넘기려면 통째로
 * 메모리에 올려야 하는데 영상은 수십 MB 가 될 수 있다. 파일→파일 경로를 따로 둔다.
 */
export interface RunnerStorageAdapter extends StorageAdapter {
  /**
   * 디스크의 파일을 그대로 저장소로 옮긴다(스트림 복사, 메모리에 올리지 않는다).
   * @returns 저장된 바이트 수
   */
  putFile(key: string, sourcePath: string): Promise<number>;
  /** 저장된 바이트 수. 없으면 null. */
  sizeOf(key: string): Promise<number | null>;
}

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageKeyError";
  }
}

/**
 * ★ `storage_key` → 실제 파일 경로. **API 의 `artifacts.path.ts` 와 같은 3중 방어를 쓴다.**
 *
 * API 는 `resolveArtifactPath()` 에서 `StorageKeySchema`(`runs/<uuid-36>/<파일명>` 정규식) +
 * 절대경로 거부 + resolve 후 root 접두 검사를 한다. **Runner 가 그 정규식을 만족하지 않는
 * 키로 쓰면 파일은 만들어지는데 API 가 400 으로 거부한다** — 증적이 조용히 사라진다.
 * 그래서 쓰는 쪽에서도 같은 검증을 통과시킨다.
 *
 * 특히 **하위 디렉토리를 만들 수 없다**(`runs/<runId>/a/b.png` 는 정규식 불통과).
 * 파일명에 쓸 수 있는 문자는 `[A-Za-z0-9._-]` 뿐이다.
 */
export function resolveStorageKey(root: string, key: string): string {
  const parsed = StorageKeySchema.safeParse(key);
  if (!parsed.success) {
    throw new StorageKeyError(
      `허용되지 않은 storage_key 입니다(API 가 거부한다): ${key} — ${
        parsed.error.issues[0]?.message ?? "형식 오류"
      }`,
    );
  }
  if (isAbsolute(key) || /^[A-Za-z]:/.test(key)) {
    throw new StorageKeyError("storage_key 에 절대 경로를 쓸 수 없습니다.");
  }

  const normalizedRoot = resolve(root);
  const resolved = resolve(normalizedRoot, key);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) {
    throw new StorageKeyError("storage_key 가 ARTIFACT_ROOT 밖을 가리킵니다.");
  }
  return resolved;
}

/**
 * 임의의 파일명을 `storage_key` 파일명 규칙(`[A-Za-z0-9._-]`)으로 강제 변환한다.
 * 한글 시나리오 이름 등이 파일명에 섞여 들어오는 경로를 막는다.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-{2,}/g, "-");
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned.slice(0, 120);
}
