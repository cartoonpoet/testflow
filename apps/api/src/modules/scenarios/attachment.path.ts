import { isAbsolute, resolve, sep } from "node:path";
import { AttachmentStorageKeySchema } from "@testflow/contracts";

/**
 * ★ 첨부파일 저장 키 → 실제 파일 경로. **증적(`artifacts.path.ts`)과 같은 3중 방어다.**
 *
 * ════════════════════════════════════════════════════════════════════
 * ## ★★ 왜 `resolveArtifactPath()` 를 재사용하지 않고 이 파일을 새로 만들었나
 *
 * `resolveArtifactPath()` 는 `StorageKeySchema`(= `STORAGE_KEY_PATTERN`) 를 쓴다.
 * 그 정규식은 **`GET /api/artifacts/:id` 의 traversal 1차 방어선**이다.
 * 첨부파일을 그 함수에 태우려면 `STORAGE_KEY_PATTERN` 에 `scenario-attachments/…` 를
 * **추가해야 하고, 그 순간 증적 다운로드의 허용 키 공간이 같이 넓어진다** —
 * 라운드 1이 명시적으로 경고한 지점이 바로 그것이다.
 *
 * 그래서 **패턴을 넓히지 않았다.** 대신:
 *  - `STORAGE_KEY_PATTERN` — **한 글자도 바꾸지 않았다**. `runs/<uuid>/<파일명>` 그대로다.
 *  - `ATTACHMENT_STORAGE_KEY_PATTERN` — 새로 만든 **별도** 정규식.
 *  - `resolveArtifactPath()` 와 `resolveAttachmentPath()` 는 **서로의 키를 거부한다.**
 *
 * 결과: 증적 다운로드의 공격 표면은 **넓어지지 않았다.** 첨부 다운로드는 자기 키만 받는다.
 * (두 함수가 닮은 것은 의도적이다 — `artifacts.path.ts` 와 `storage/adapter.ts` 도 이미
 * 같은 로직을 두 벌 갖고 있고, 그것이 이 레포의 규율이다: **방어는 겹쳐야 한다.**)
 *
 * ## 첨부 키는 traversal 이 원천적으로 불가능하다
 * `scenario-attachments/<uuid-36>/<uuid-36>.bin` — **두 토막이 전부 서버 생성 UUID** 다.
 * 사용자가 올린 한글 파일명은 DB 컬럼에만 살고 **경로에 한 글자도 들어가지 않는다.**
 * UUID 문자집합(`[0-9a-fA-F-]`)에는 `.`·`/`·`\` 가 없으므로 `..` 가 만들어질 수 없다.
 * 그럼에도 아래 3중 방어를 전부 유지한다 — "만들어질 수 없다"는 전제는 언젠가 깨진다.
 * ════════════════════════════════════════════════════════════════════
 */
export class AttachmentPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentPathError";
  }
}

/** 루트 자신과 그 하위만 허용한다. (`artifacts.path.ts` 의 `isInsideRoot` 와 같은 규칙) */
export function isInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(normalizedRoot + sep);
}

/**
 * `scenario_attachments.storage_key` → 실제 파일 경로.
 *
 * 3중 방어:
 *  1. **형식 검증** — `AttachmentStorageKeySchema` (UUID 두 토막 + `.bin`, `..` 금지)
 *  2. **절대경로 거부** — `/etc/…` · `C:\…`
 *  3. **resolve 후 접두 검사** — 결과가 `ARTIFACT_ROOT` 밖이면 거부
 *
 * 심볼릭 링크 탈출은 파일이 존재할 때만 확인할 수 있으므로 서비스가 `stat` 직후 한 번 더 본다.
 */
export function resolveAttachmentPath(root: string, storageKey: string): string {
  const parsed = AttachmentStorageKeySchema.safeParse(storageKey);
  if (!parsed.success) {
    throw new AttachmentPathError(
      `허용되지 않은 첨부 storage_key 입니다: ${parsed.error.issues[0]?.message ?? "형식 오류"}`,
    );
  }
  if (isAbsolute(storageKey) || /^[A-Za-z]:/.test(storageKey)) {
    throw new AttachmentPathError("storage_key 에 절대 경로를 쓸 수 없습니다.");
  }

  const resolved = resolve(root, storageKey);
  if (!isInsideRoot(root, resolved)) {
    throw new AttachmentPathError("storage_key 가 ARTIFACT_ROOT 밖을 가리킵니다.");
  }
  return resolved;
}
