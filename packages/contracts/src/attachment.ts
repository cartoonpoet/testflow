/**
 * 시나리오 첨부파일(테스트 데이터) 계약 — 라운드 3.
 *
 * ════════════════════════════════════════════════════════════════════
 * ## 왜 필요한가
 * 사용자의 실제 테스트 10건 중 **8건이 파일 업로드를 테스트한다**:
 *
 * ```ts
 * await page.locator('input[type="file"]')
 *   .setInputFiles(['테스트용 파일-1.docx', '테스트용 파일-2.docx']);
 * ```
 *
 * 코드 본문(`scenario_codes.content`)만으로는 이 코드가 절대 돌지 않는다 —
 * **파일 실물이 실행 디렉토리에 있어야 한다.**
 *
 * ## ★ 실측한 사실 — `setInputFiles` 의 상대 경로 기준은 `process.cwd()` 다
 * 추측하지 않고 Playwright 1.63.0 으로 직접 쟀다(07-attachments.md §Playwright 실측):
 *
 * | 파일을 둔 곳 | 결과 |
 * |---|---|
 * | 테스트 프로세스의 **cwd** | **OK** (`name=marker.txt size=11`) |
 * | `testDir`(spec 과 같은 디렉토리) | `ENOENT: stat 'marker.txt'` |
 * | config / rootDir | `ENOENT: stat 'marker.txt'` |
 *
 * Runner 의 cwd 는 **작업공간 루트**다 — local 은 `spawn(..., {cwd: ws.dir})`,
 * docker 는 `-v <ws>:/ws -w /ws`. 그래서 첨부파일은 **작업공간 루트**에 푼다.
 * (spec 은 `specs/` 아래에 있지만 그건 상관없다 — 기준은 cwd 지 spec 위치가 아니다.)
 *
 * ## ★ `STORAGE_KEY_PATTERN` 을 넓히지 않았다 — 별도 패턴을 새로 뒀다
 * 라운드 1이 경고한 지점이 여기다. `STORAGE_KEY_PATTERN` 은
 * `resolveArtifactPath()`(= `GET /api/artifacts/:id` 의 traversal 1차 방어선)가
 * **그대로 쓰는 정규식**이라, 그것을 넓히면 증적 다운로드의 공격 표면이 같이 넓어진다.
 *
 * 그래서 `STORAGE_KEY_PATTERN` 은 **한 글자도 건드리지 않고**
 * `ATTACHMENT_STORAGE_KEY_PATTERN` 을 **따로** 만들었다. 두 패턴은 서로를 모른다:
 *
 * ```
 * STORAGE_KEY_PATTERN            ^runs/<uuid-36>/[A-Za-z0-9._-]+$        ← 무변경
 * ATTACHMENT_STORAGE_KEY_PATTERN ^scenario-attachments/<uuid-36>/<uuid-36>.bin$
 * ```
 *
 * → `resolveArtifactPath()` 는 여전히 `runs/…` 만 받는다. 증적 다운로드의 방어는
 *   **넓어지지 않았다**(실측: 07-attachments.md §traversal).
 *
 * ## ★ 첨부 키에는 사용자 문자열이 **한 글자도** 들어가지 않는다
 * 키의 두 토막이 전부 **서버가 만든 UUID** 다. 한글 파일명(`테스트용 파일-1.docx`)은
 * DB 컬럼(`scenario_attachments.filename`)에만 살고 **경로에는 절대 쓰이지 않는다.**
 * 그 결과:
 *  - 키에 `.`·`/`·`\`·NUL 이 원천적으로 존재할 수 없다 → traversal 이 성립하지 않는다.
 *  - 저장소가 로캘·파일시스템 정규화(NFC/NFD)에 영향받지 않는다
 *    (macOS 는 NFD 로 저장한다 — 한글 파일명이 키였다면 왕복이 깨진다).
 *  - 같은 이름의 파일을 다시 올려도 DB 행 하나만 갱신된다.
 *
 * 원래 파일명은 **Runner 가 작업공간에 풀 때**와 **다운로드 헤더**에서만 복원된다.
 * ════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import type { CodeValidationIssue } from "./code-validation.js";

/* ── 용량 상한 ───────────────────────────────────────────────── */

/**
 * 파일 1개 상한 — **10MiB**.
 *
 * 근거: 이 기능의 대상은 "테스트 데이터"다. 사용자의 실제 시나리오가 올리는 것은
 * `.docx` 견본 4개이고 실물은 수십 KB 다. 한편 법무 시스템의 실제 첨부는 스캔 PDF 가
 * 섞이므로 그 정도는 받아야 한다 — 국내 전자소송(대법원 ECFS)의 첨부 1건 상한이 10MB 라
 * **그보다 큰 파일을 업로드 테스트에 쓸 일이 없다**. 그 선에 맞춘다.
 *
 * 상한을 두지 않으면 디스크가 찬다. `ARTIFACT_ROOT` 는 증적과 볼륨을 공유하므로
 * 첨부파일이 디스크를 채우면 **증적 저장이 같이 죽는다.**
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * 시나리오 1건당 파일 **개수** 상한 — 20개.
 *
 * 근거: 첨부 전량이 **실행 1건마다 작업공간으로 복사된다.** 개수가 곧 실행 지연이다.
 * 사용자 시나리오의 최대 참조 수는 4개(`테스트용 파일-1~4.docx`)이고,
 * 20개면 그 5배 여유다. 파일 목록 UI 도 스크롤 없이 보인다.
 */
export const MAX_ATTACHMENTS_PER_SCENARIO = 20;

/**
 * 시나리오 1건당 **합계** 상한 — 50MiB.
 *
 * 근거: 개수 상한과 개당 상한만으로는 20 × 10MiB = **200MiB** 가 허용된다. 그 시나리오를
 * 돌릴 때마다 200MiB 를 복사하고(작업공간), docker 모드면 bind mount 를 통해 한 번 더 읽는다.
 * 실행 1건의 총 I/O 를 50MiB 로 묶는다 — 개당·개수·합계 **세 개를 다 두어야** 상한이 닫힌다.
 */
export const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;

/* ── 파일명 ─────────────────────────────────────────────────── */

/**
 * ★ 첨부 파일명 규칙 — **한글을 허용해야 한다.**
 *
 * `ScenarioCodeFilenameSchema`(`[A-Za-z0-9._-]` + `.spec.ts`)를 그대로 쓸 수 없다.
 * 사용자 코드가 `setInputFiles('테스트용 파일-1.docx')` 라고 적혀 있으므로
 * **그 이름 그대로** 작업공간에 나타나야 한다. 한 글자라도 바꾸면 테스트가 깨진다.
 *
 * 그래서 허용 문자를 나열하는 대신 **금지 문자를 나열한다**(deny-list 가 아니라
 * "위험한 구조"를 거부하는 것이다 — 아래 전부가 구조적 위험이다):
 *
 * | 거부 | 이유 |
 * |---|---|
 * | `/` `\` | 경로 구분자. 하위 디렉토리·상위 이동의 입구 |
 * | `..` 전체 이름 · `.` 전체 이름 | 상위/현재 디렉토리 그 자체 |
 * | 선행 `.` | 숨김 파일(`.bashrc`·`.npmrc`)을 작업공간에 심는 경로 |
 * | NUL · 제어문자(`\x00-\x1F`,`\x7F`) | 경로 절단 · **HTTP 헤더 인젝션**(CR/LF) |
 * | `"` | `Content-Disposition` 의 따옴표 탈출 |
 * | 윈도우 드라이브(`C:`) | 절대 경로 |
 * | 예약 이름(`playwright.config.mjs` 등) | 작업공간의 우리 파일을 덮어쓴다 (§RESERVED) |
 *
 * 그리고 **이 검증만 믿지 않는다.** Runner 가 작업공간에 쓰기 직전에
 * `resolve()` 후 작업공간 접두 검사를 한 번 더 한다(라운드 1 storage 3중 방어와 같은 규율) —
 * `scenario_attachments` 행은 DB 에 직접 INSERT 될 수 있기 때문이다.
 */
export const ATTACHMENT_FILENAME_MAX_LENGTH = 255;

/**
 * 작업공간 루트에 이미 존재하는(또는 존재하게 될) 우리 파일들. 첨부가 이 이름을 쓰면
 * **config·node_modules·증적 디렉토리를 덮어쓴다.** 덮어쓰기는 조용히 실행을 깨뜨린다.
 */
export const RESERVED_ATTACHMENT_FILENAMES: readonly string[] = [
  "playwright.config.mjs",
  "node_modules",
  "specs",
  "out",
  "package.json",
];

/** 제어문자 · 경로 구분자 · 따옴표. 한 글자라도 있으면 거부. */
export function hasForbiddenFilenameChar(name: string): boolean {
  for (const ch of name) {
    if (ch === "/" || ch === "\\" || ch === '"') return true;
    const code = ch.codePointAt(0) ?? 0;
    // C0 제어문자(CR·LF·NUL 포함) · DEL. 헤더 인젝션·경로 절단의 입구다.
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export const AttachmentFilenameSchema = z
  .string()
  .min(1, "파일명이 비어 있습니다.")
  .max(ATTACHMENT_FILENAME_MAX_LENGTH, `파일명은 ${String(ATTACHMENT_FILENAME_MAX_LENGTH)}자 이하여야 합니다.`)
  .refine((name) => !hasForbiddenFilenameChar(name), {
    message: "파일명에 경로 구분자(/ \\)·따옴표·제어문자를 쓸 수 없습니다.",
  })
  .refine((name) => name !== "." && name !== "..", {
    message: "파일명으로 '.' 또는 '..' 를 쓸 수 없습니다.",
  })
  .refine((name) => !name.startsWith("."), {
    message: "파일명은 '.' 로 시작할 수 없습니다(숨김 파일).",
  })
  .refine((name) => !/^[A-Za-z]:/.test(name), {
    message: "파일명에 드라이브 문자를 쓸 수 없습니다.",
  })
  .refine((name) => name.trim() === name, {
    message: "파일명의 앞뒤에 공백을 둘 수 없습니다.",
  })
  .refine((name) => !RESERVED_ATTACHMENT_FILENAMES.includes(name), {
    message: "실행 작업공간이 쓰는 이름이라 첨부파일 이름으로 쓸 수 없습니다.",
  });

/**
 * 파일명이 안전한지 boolean 으로만 묻는 편의 함수.
 * Runner 의 마지막 방어선이 쓴다(예외 메시지를 자기 것으로 만들기 위해).
 */
export function isSafeAttachmentFilename(name: string): boolean {
  return AttachmentFilenameSchema.safeParse(name).success;
}

/* ── 저장 키 ─────────────────────────────────────────────────── */

/** 첨부파일 저장 키의 접두 디렉토리. `runs/` 와 **형제**이고 섞이지 않는다. */
export const ATTACHMENT_KEY_PREFIX = "scenario-attachments";

/**
 * `scenario_attachments.storage_key` — 어댑터 무관 논리 키.
 *
 * 형태: `scenario-attachments/<scenarioId>/<attachmentId>.bin`
 *
 * ★ 두 토막이 전부 **서버 생성 UUID** 다. 사용자 입력이 들어갈 자리가 없다.
 *   확장자를 원본이 아니라 `.bin` 으로 고정하는 이유: 원본 확장자를 쓰면
 *   `.php`·`.html` 같은 이름이 디스크에 생기고, 저장소 디렉토리가 언젠가
 *   정적 서빙되면 그대로 실행 가능한 파일이 된다. 우리가 서빙하는 경로는
 *   `Content-Type` 을 DB 에서 읽어 붙이므로 디스크 확장자는 아무 의미가 없다.
 */
export const ATTACHMENT_STORAGE_KEY_PATTERN =
  /^scenario-attachments\/[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.bin$/;

export const AttachmentStorageKeySchema = z
  .string()
  .max(500)
  .regex(ATTACHMENT_STORAGE_KEY_PATTERN, "허용되지 않은 첨부 storage_key 형식입니다.")
  .refine((key) => !key.includes(".."), "storage_key 에 '..' 를 포함할 수 없습니다.");

export function buildAttachmentStorageKey(scenarioId: string, attachmentId: string): string {
  return `${ATTACHMENT_KEY_PREFIX}/${scenarioId}/${attachmentId}.bin`;
}

/* ── content type ───────────────────────────────────────────── */

/**
 * 저장하는 `content_type` 기본값.
 *
 * 브라우저가 `.docx` 를 인식하지 못하면 `File.type` 이 빈 문자열이 된다(실제로 흔하다).
 * 그때 빈 문자열을 그대로 저장하면 다운로드 응답의 `Content-Type` 이 비어 버린다.
 */
export const DEFAULT_ATTACHMENT_CONTENT_TYPE = "application/octet-stream";

/**
 * 헤더로 되돌려 보낼 수 있는 `content_type` 만 통과시킨다.
 *
 * ★ **헤더 인젝션 방어다.** 이 값은 `Content-Type:` 헤더에 그대로 실린다.
 *   CR/LF 가 들어가면 응답을 쪼갤 수 있다. 토큰 문법(RFC 9110)만 허용한다.
 */
const CONTENT_TYPE_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export const AttachmentContentTypeSchema = z
  .string()
  .max(255)
  .regex(CONTENT_TYPE_PATTERN, "허용되지 않은 content type 형식입니다.");

/** 들어온 값이 헤더로 안전하지 않으면 기본값으로 떨어뜨린다(거부하지 않는다). */
export function normalizeAttachmentContentType(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return DEFAULT_ATTACHMENT_CONTENT_TYPE;
  // `text/plain; charset=utf-8` 처럼 파라미터가 붙어 오면 앞토막만 쓴다.
  const base = raw.split(";")[0]?.trim() ?? "";
  return AttachmentContentTypeSchema.safeParse(base).success
    ? base
    : DEFAULT_ATTACHMENT_CONTENT_TYPE;
}

/* ── 리소스 ─────────────────────────────────────────────────── */

/** `GET /api/scenarios/:id/attachments` 의 원소. **본문(바이트)은 실리지 않는다.** */
export const ScenarioAttachmentSchema = z.object({
  id: z.uuid(),
  scenarioId: z.uuid(),
  /** ★ 원본 이름 그대로. 한글·공백 포함. 작업공간에 이 이름으로 나타난다. */
  filename: AttachmentFilenameSchema,
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** 다운로드 URL. `GET /api/scenarios/:sid/attachments/:aid`. */
  url: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ScenarioAttachment = z.infer<typeof ScenarioAttachmentSchema>;

/** 목록 응답 — 합계·상한을 같이 실어 화면이 계산하지 않게 한다. */
export const ScenarioAttachmentListSchema = z.object({
  items: z.array(ScenarioAttachmentSchema),
  totalBytes: z.number().int().nonnegative(),
  maxTotalBytes: z.number().int().positive(),
  maxCount: z.number().int().positive(),
  maxFileBytes: z.number().int().positive(),
});
export type ScenarioAttachmentList = z.infer<typeof ScenarioAttachmentListSchema>;

/** 사람이 읽는 상한 초과 사유. API 와 web 이 **같은 문구**를 쓴다. */
export function attachmentLimitMessage(
  kind: "file" | "count" | "total",
  actual: number,
): string {
  const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  switch (kind) {
    case "file":
      return `파일이 너무 큽니다 — ${mb(actual)} / 개당 상한 ${mb(MAX_ATTACHMENT_BYTES)}.`;
    case "count":
      return `첨부파일은 시나리오당 ${String(MAX_ATTACHMENTS_PER_SCENARIO)}개까지입니다 (현재 ${String(actual)}개).`;
    case "total":
      return `첨부파일 합계가 상한을 넘습니다 — ${mb(actual)} / 합계 상한 ${mb(MAX_ATTACHMENT_TOTAL_BYTES)}.`;
  }
}

/* ── `Content-Disposition` ───────────────────────────────────── */

/**
 * ★ 한글 파일명을 `Content-Disposition` 에 싣는다 (RFC 6266 + RFC 5987).
 *
 * `filename="테스트용 파일-1.docx"` 만 쓰면 **헤더는 ISO-8859-1(latin1) 로 해석**되어
 * 브라우저에 `í…ŒìŠ¤íŠ¸...` 같은 깨진 이름으로 저장된다. Node 는 non-latin1 바이트가 든
 * 헤더 값에 `ERR_INVALID_CHAR` 를 던지기도 한다.
 *
 * 그래서 **두 벌을 같이 낸다**:
 *  - `filename="<ASCII 대체본>"` — RFC 5987 을 모르는 아주 오래된 클라이언트용
 *  - `filename*=UTF-8''<퍼센트 인코딩>` — 최신 브라우저가 이쪽을 우선한다
 *
 * 인젝션: `AttachmentFilenameSchema` 가 CR/LF·따옴표를 이미 막았고,
 * 여기서 ASCII 대체본은 `[A-Za-z0-9._-]` 로 **한 번 더** 좁힌다. 방어는 겹쳐야 한다.
 */
export function attachmentContentDisposition(filename: string, disposition: "inline" | "attachment"): string {
  const ascii = toAsciiFallbackName(filename);
  const encoded = encodeRfc5987(filename);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** 비 ASCII·위험 문자를 `_` 로 바꾼 대체 이름. 비면 `download` 를 쓴다. */
export function toAsciiFallbackName(filename: string): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned === "" ? "download" : cleaned;
}

/**
 * RFC 5987 `ext-value` 인코딩.
 *
 * `encodeURIComponent` 는 `!'()*` 를 남기는데 그 문자들은 RFC 5987 의 `attr-char` 가 아니다.
 * 남겨 두면 엄격한 파서가 헤더를 통째로 버린다. 명시적으로 퍼센트 인코딩한다.
 */
export function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()!*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/* ── 검증기 연동 — `setInputFiles('X')` 의 X 가 첨부에 있는가 ──── */

/**
 * 코드 본문에서 `setInputFiles(...)` 에 **문자열 리터럴로** 적힌 파일 경로를 뽑는다.
 *
 * ## 무엇을 잡고 무엇을 포기하는가 (정직하게)
 * 잡는다:
 * ```ts
 * setInputFiles('테스트용 파일-1.docx')
 * setInputFiles("a.docx")
 * setInputFiles(['테스트용 파일-1.docx', '테스트용 파일-2.docx'])
 * setInputFiles([`a.docx`])                       // 치환 없는 템플릿 리터럴
 * ```
 * 포기한다(**경고를 내지 않는다**):
 * ```ts
 * setInputFiles(files)                            // 변수
 * setInputFiles(`${dir}/a.docx`)                  // 치환이 있는 템플릿
 * setInputFiles({ name, mimeType, buffer })       // 인메모리 파일 — 첨부가 필요 없다
 * ```
 *
 * ## ★ 그래서 결과는 **경고(warning)** 다 — 오류가 아니다
 * 파일명이 **동적으로 만들어지는 정상 코드**가 있다. 그것을 오류로 막으면 저장이 불가능해진다.
 * "이 이름이 첨부에 없다"는 사실만 알리고 저장은 통과시킨다.
 * (`validateScenarioCode()` 와 분리한 이유도 그것이다 — 그 함수는 본문만 보는 순수 함수이고
 * 여기서는 **첨부 목록이라는 바깥 상태**가 필요하다. 섞으면 서명이 오염된다.)
 */
export interface SetInputFilesReference {
  /** 코드에 적힌 그대로. */
  readonly path: string;
  /** 1부터 세는 줄 번호. */
  readonly line: number;
  /** 1부터 세는 열 번호. */
  readonly column: number;
}

/** 인자 안의 문자열 리터럴. 따옴표 3종을 모두 본다(템플릿은 치환이 없을 때만). */
const STRING_LITERAL = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\\n$]*)`/g;

export function findSetInputFilesReferences(content: string): SetInputFilesReference[] {
  const refs: SetInputFilesReference[] = [];
  const needle = "setInputFiles";

  let from = 0;
  for (;;) {
    const at = content.indexOf(needle, from);
    if (at === -1) break;
    from = at + needle.length;

    // `setInputFiles` 바로 뒤의 `(` 를 찾는다(공백 허용). 없으면 호출이 아니다.
    let open = from;
    while (open < content.length && /\s/.test(content[open] ?? "")) open += 1;
    if (content[open] !== "(") continue;

    // 괄호 균형으로 인자 구간을 자른다. 문자열 안의 괄호는 위 정규식이 따로 다루므로
    // 여기서는 깊이만 센다 — 인자에 괄호가 든 문자열이 있으면 구간이 길어질 뿐이고,
    // 결과는 "문자열 리터럴만 뽑는다"라 부작용이 없다.
    let depth = 0;
    let close = open;
    for (; close < content.length; close += 1) {
      const ch = content[close];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;

    const args = content.slice(open + 1, close);
    // 객체 리터럴(`{ name, mimeType, buffer }`)은 인메모리 파일이라 첨부가 필요 없다.
    if (args.trimStart().startsWith("{")) continue;

    STRING_LITERAL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STRING_LITERAL.exec(args)) !== null) {
      const value = match[1] ?? match[2] ?? match[3] ?? "";
      if (value === "") continue;
      const absolute = open + 1 + match.index;
      const before = content.slice(0, absolute);
      const line = before.split("\n").length;
      const lastNewline = before.lastIndexOf("\n");
      refs.push({ path: value, line, column: absolute - lastNewline });
    }
    from = close;
  }
  return refs;
}

/**
 * 코드가 참조하는 파일 중 **첨부 목록에 없는 것**을 경고로 만든다.
 *
 * `severity` 는 항상 `"warning"` 이다 — 위 JSDoc 의 근거대로 동적 파일명을 막지 않는다.
 * 경로 구분자가 든 참조(`fixtures/a.docx`)는 **건너뛴다**: 그건 첨부가 아니라
 * 사용자 코드가 스스로 만든 경로이고, 우리가 판단할 근거가 없다.
 */
export function checkAttachmentReferences(
  content: string,
  attachmentNames: readonly string[],
): CodeValidationIssue[] {
  const have = new Set(attachmentNames);
  const seen = new Set<string>();
  const issues: CodeValidationIssue[] = [];

  for (const ref of findSetInputFilesReferences(content)) {
    if (ref.path.includes("/") || ref.path.includes("\\")) continue;
    if (have.has(ref.path)) continue;
    if (seen.has(ref.path)) continue;
    seen.add(ref.path);
    issues.push({
      line: ref.line,
      column: ref.column,
      severity: "warning",
      code: "missing_attachment",
      message: `setInputFiles 가 '${ref.path}' 를 쓰는데 첨부파일 목록에 없습니다. 실행하면 파일을 찾지 못합니다(파일명을 코드에서 만들고 있다면 무시해도 됩니다).`,
    });
  }
  return issues;
}
