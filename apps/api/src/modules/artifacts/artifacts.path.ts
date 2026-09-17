import { isAbsolute, resolve, sep } from "node:path";
import { StorageKeySchema } from "@testflow/contracts";

/**
 * ★ 경로 순회(path traversal) 방어 — **`storage_key` 를 절대 그대로 fs 경로로 쓰지 않는다.**
 *
 * `artifacts.storage_key` 는 DB 컬럼이다. Runner 가 쓰지만 DB 를 건드릴 수 있는 경로가
 * 하나라도 생기면 `../../etc/passwd` 가 들어온다. **"내부에서 온 값이니 안전하다"는 전제는
 * 두지 않는다** — 파일을 내보내는 쪽이 최종 방어선이다.
 *
 * 3중 방어:
 *  1. **형식 검증** — contracts 의 `StorageKeySchema`(`runs/<uuid>/<파일명>` 정규식 +
 *     `..` 금지). 백슬래시·절대경로·상위 이동이 여기서 전부 걸린다.
 *  2. **절대경로 거부** — 윈도우 드라이브 표기(`C:\…`)나 `/etc/…` 를 명시적으로 막는다.
 *     (정규식만 믿지 않는다. 방어는 겹쳐야 한다.)
 *  3. **resolve 후 접두 검사** — `resolve(root, key)` 결과가 root 밖이면 거부.
 *     심볼릭 링크까지 막으려면 `realpath` 가 필요하지만, 그건 파일이 존재할 때만 되므로
 *     서비스 계층에서 `stat` 직후 한 번 더 본다.
 */
export class ArtifactPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactPathError";
  }
}

/** 루트 자신과 그 하위만 허용한다. */
export function isInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(normalizedRoot + sep);
}

/**
 * `storage_key` → 실제 파일 경로. 조금이라도 수상하면 `ArtifactPathError` 를 던진다
 * (컨트롤러가 400 으로 바꾼다).
 */
export function resolveArtifactPath(root: string, storageKey: string): string {
  const parsed = StorageKeySchema.safeParse(storageKey);
  if (!parsed.success) {
    throw new ArtifactPathError(
      `허용되지 않은 storage_key 입니다: ${parsed.error.issues[0]?.message ?? "형식 오류"}`,
    );
  }
  if (isAbsolute(storageKey) || /^[A-Za-z]:/.test(storageKey)) {
    throw new ArtifactPathError("storage_key 에 절대 경로를 쓸 수 없습니다.");
  }

  const resolved = resolve(root, storageKey);
  if (!isInsideRoot(root, resolved)) {
    throw new ArtifactPathError("storage_key 가 ARTIFACT_ROOT 밖을 가리킵니다.");
  }
  return resolved;
}

/**
 * `Content-Disposition` 용 파일명. `storage_key` 의 마지막 토막을 쓴다.
 * 형식 검증을 통과한 뒤라 따옴표·개행 같은 헤더 인젝션 문자는 이미 존재할 수 없다.
 */
export function artifactFileName(storageKey: string): string {
  return storageKey.slice(storageKey.lastIndexOf("/") + 1);
}
