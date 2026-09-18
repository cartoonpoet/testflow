import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_STORAGE_KEY_PATTERN,
  AttachmentFilenameSchema,
  AttachmentStorageKeySchema,
  DEFAULT_ATTACHMENT_CONTENT_TYPE,
  MAX_ATTACHMENTS_PER_SCENARIO,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  attachmentContentDisposition,
  attachmentLimitMessage,
  buildAttachmentStorageKey,
  checkAttachmentReferences,
  encodeRfc5987,
  findSetInputFilesReferences,
  isSafeAttachmentFilename,
  normalizeAttachmentContentType,
  toAsciiFallbackName,
} from "./attachment.js";
import { STORAGE_KEY_PATTERN, StorageKeySchema } from "./storage.js";

const SCENARIO_ID = "11111111-2222-4333-8444-555555555555";
const ATTACHMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const KOREAN = "테스트용 파일-1.docx";

describe("AttachmentFilenameSchema — 한글은 통과, 경로는 거부", () => {
  it("★ 사용자의 실제 파일명 4종이 전부 통과한다", () => {
    for (const name of [
      "테스트용 파일-1.docx",
      "테스트용 파일-2.docx",
      "테스트용 파일-3.docx",
      "테스트용 파일-4.docx",
    ]) {
      expect(AttachmentFilenameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("공백·괄호·영문·숫자·확장자 여러 종을 통과시킨다", () => {
    for (const name of ["a.docx", "report (2).pdf", "데이터 2026.xlsx", "x-1_2.bin"]) {
      expect(isSafeAttachmentFilename(name)).toBe(true);
    }
  });

  const rejected: [string, string][] = [
    ["상위 이동", "../../etc/passwd"],
    ["상대 이동 1단", "../a.docx"],
    ["절대 경로", "/etc/passwd"],
    ["하위 디렉토리", "fixtures/a.docx"],
    ["백슬래시", "fixtures\\a.docx"],
    ["윈도우 드라이브", "C:\\Windows\\win.ini"],
    ["점 하나", "."],
    ["점 둘", ".."],
    ["숨김 파일", ".npmrc"],
    ["따옴표(헤더 탈출)", 'a".docx'],
    ["개행(헤더 인젝션)", "a\r\nX-Evil: 1.docx"],
    ["NUL(경로 절단)", "a\u0000.docx"],
    ["빈 문자열", ""],
    ["앞뒤 공백", " a.docx"],
    ["예약 이름", "playwright.config.mjs"],
    ["예약 디렉토리", "node_modules"],
  ];

  for (const [label, name] of rejected) {
    it(`거부: ${label}`, () => {
      expect(isSafeAttachmentFilename(name)).toBe(false);
    });
  }

  it("255자를 넘기면 거부한다", () => {
    expect(isSafeAttachmentFilename(`${"가".repeat(256)}.docx`)).toBe(false);
  });
});

describe("★ STORAGE_KEY_PATTERN 을 넓히지 않았다 — 두 패턴은 서로를 거부한다", () => {
  it("증적 패턴은 라운드 1·2 그대로다(문자열 동일)", () => {
    expect(STORAGE_KEY_PATTERN.source).toBe(
      "^runs\\/[0-9a-fA-F-]{36}\\/[A-Za-z0-9._-]+$",
    );
  });

  it("증적 키 스키마는 첨부 키를 **거부한다**", () => {
    const key = buildAttachmentStorageKey(SCENARIO_ID, ATTACHMENT_ID);
    expect(StorageKeySchema.safeParse(key).success).toBe(false);
  });

  it("첨부 키 스키마는 증적 키를 **거부한다**", () => {
    expect(
      AttachmentStorageKeySchema.safeParse(`runs/${SCENARIO_ID}/video.webm`).success,
    ).toBe(false);
  });

  it("첨부 키는 자기 형태만 통과한다", () => {
    const key = buildAttachmentStorageKey(SCENARIO_ID, ATTACHMENT_ID);
    expect(key).toBe(`scenario-attachments/${SCENARIO_ID}/${ATTACHMENT_ID}.bin`);
    expect(ATTACHMENT_STORAGE_KEY_PATTERN.test(key)).toBe(true);
    expect(AttachmentStorageKeySchema.safeParse(key).success).toBe(true);
  });

  const badKeys: [string, string][] = [
    ["상위 이동", `scenario-attachments/${SCENARIO_ID}/../../etc/passwd`],
    ["상대 탈출", "../../etc/passwd"],
    ["절대 경로", "/etc/passwd"],
    ["윈도우 드라이브", "C:\\Windows\\win.ini"],
    ["백슬래시", `scenario-attachments\\${SCENARIO_ID}\\${ATTACHMENT_ID}.bin`],
    ["접두사 없음", `foo/${SCENARIO_ID}/${ATTACHMENT_ID}.bin`],
    ["하위 디렉토리", `scenario-attachments/${SCENARIO_ID}/sub/${ATTACHMENT_ID}.bin`],
    ["★ 한글 파일명(키에는 못 들어간다)", `scenario-attachments/${SCENARIO_ID}/${KOREAN}`],
    ["확장자 다름", `scenario-attachments/${SCENARIO_ID}/${ATTACHMENT_ID}.php`],
    ["빈 파일명", `scenario-attachments/${SCENARIO_ID}/`],
    ["널 바이트", `scenario-attachments/${SCENARIO_ID}/${ATTACHMENT_ID}\u0000.bin`],
    ["접두사 형제(유사 이름)", `scenario-attachments-evil/${SCENARIO_ID}/${ATTACHMENT_ID}.bin`],
  ];

  for (const [label, key] of badKeys) {
    it(`첨부 키 거부: ${label}`, () => {
      expect(AttachmentStorageKeySchema.safeParse(key).success).toBe(false);
    });
  }
});

describe("Content-Disposition — 한글 왕복 + 헤더 인젝션", () => {
  it("★ 한글 파일명을 RFC 5987 로 싣고 ASCII 대체본을 같이 낸다", () => {
    const header = attachmentContentDisposition(KOREAN, "attachment");
    expect(header.startsWith("attachment; ")).toBe(true);
    expect(header).toContain("filename*=UTF-8''");
    // 디코드하면 원본으로 되돌아온다.
    const encoded = header.slice(header.indexOf("UTF-8''") + 7);
    expect(decodeURIComponent(encoded)).toBe(KOREAN);
  });

  it("헤더 값 전체에 CR/LF 가 없다", () => {
    const header = attachmentContentDisposition(KOREAN, "attachment");
    expect(header.includes("\r")).toBe(false);
    expect(header.includes("\n")).toBe(false);
  });

  it("ASCII 대체본은 [A-Za-z0-9._-] 만 남기고 선두 점을 뗀다", () => {
    expect(toAsciiFallbackName(KOREAN)).toBe("_______-1.docx");
    expect(toAsciiFallbackName("...hidden")).toBe("hidden");
    expect(toAsciiFallbackName("한글만")).toBe("___");
  });

  it("encodeRfc5987 은 attr-char 가 아닌 !'()* 도 퍼센트 인코딩한다", () => {
    expect(encodeRfc5987("a'b(c)d!e*f")).toBe("a%27b%28c%29d%21e%2Af");
  });
});

describe("content type 정규화 — 헤더 인젝션 방어", () => {
  it("정상 MIME 은 그대로 둔다", () => {
    expect(
      normalizeAttachmentContentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("파라미터가 붙으면 앞토막만 쓴다", () => {
    expect(normalizeAttachmentContentType("text/plain; charset=utf-8")).toBe("text/plain");
  });

  it("빈 값·null·CR/LF·공백은 기본값으로 떨어진다", () => {
    for (const bad of ["", null, undefined, "text/plain\r\nX-Evil: 1", "not a mime", "<script>"]) {
      expect(normalizeAttachmentContentType(bad)).toBe(DEFAULT_ATTACHMENT_CONTENT_TYPE);
    }
  });
});

describe("용량 상한 — 세 개가 다 있어야 닫힌다", () => {
  it("개당 10MiB · 개수 20 · 합계 50MiB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_ATTACHMENTS_PER_SCENARIO).toBe(20);
    expect(MAX_ATTACHMENT_TOTAL_BYTES).toBe(50 * 1024 * 1024);
  });

  it("★ 합계 상한이 개당×개수보다 작다 — 그래야 상한이 실제로 닫힌다", () => {
    expect(MAX_ATTACHMENT_TOTAL_BYTES).toBeLessThan(
      MAX_ATTACHMENT_BYTES * MAX_ATTACHMENTS_PER_SCENARIO,
    );
  });

  it("거부 문구 3종이 한국어로 나온다", () => {
    expect(attachmentLimitMessage("file", 20 * 1024 * 1024)).toContain("20.0MB");
    expect(attachmentLimitMessage("count", 20)).toContain("20개");
    expect(attachmentLimitMessage("total", 60 * 1024 * 1024)).toContain("60.0MB");
  });
});

describe("findSetInputFilesReferences — 사용자 실제 코드로", () => {
  it("★ 배열 2개(사용자 실제 코드)", () => {
    const code = `await page.locator('input[type="file"]').setInputFiles(['테스트용 파일-1.docx', '테스트용 파일-2.docx']);`;
    expect(findSetInputFilesReferences(code).map((r) => r.path)).toEqual([
      "테스트용 파일-1.docx",
      "테스트용 파일-2.docx",
    ]);
  });

  it("★ 단일 문자열(사용자 실제 코드)", () => {
    const code = `await page.locator('input[type="file"]').setInputFiles('테스트용 파일-1.docx');`;
    expect(findSetInputFilesReferences(code).map((r) => r.path)).toEqual(["테스트용 파일-1.docx"]);
  });

  it("쌍따옴표·치환 없는 템플릿 리터럴도 잡는다", () => {
    expect(findSetInputFilesReferences('setInputFiles("a.docx")').map((r) => r.path)).toEqual([
      "a.docx",
    ]);
    expect(findSetInputFilesReferences("setInputFiles([`b.docx`])").map((r) => r.path)).toEqual([
      "b.docx",
    ]);
  });

  it("줄·열 번호는 1부터 센다", () => {
    const code = "line1\nawait x.setInputFiles('a.docx');";
    const ref = findSetInputFilesReferences(code)[0];
    expect(ref?.line).toBe(2);
    expect(code.split("\n")[1]?.slice((ref?.column ?? 1) - 1)).toContain("'a.docx'");
  });

  it("★ 포기하는 형태들 — 경고를 만들지 않는다", () => {
    expect(findSetInputFilesReferences("setInputFiles(files)")).toEqual([]);
    expect(findSetInputFilesReferences("setInputFiles(`${dir}/a.docx`)")).toEqual([]);
    expect(
      findSetInputFilesReferences("setInputFiles({ name, mimeType, buffer })"),
    ).toEqual([]);
  });

  it("`setInputFiles` 라는 글자가 호출이 아니면 무시한다", () => {
    expect(findSetInputFilesReferences("// setInputFiles 를 쓰세요")).toEqual([]);
  });
});

describe("checkAttachmentReferences — 경고만, 오류 없음", () => {
  const code = `test("t", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(['테스트용 파일-1.docx', '테스트용 파일-2.docx']);
});`;

  it("첨부가 다 있으면 issue 0건", () => {
    expect(checkAttachmentReferences(code, ["테스트용 파일-1.docx", "테스트용 파일-2.docx"])).toEqual(
      [],
    );
  });

  it("★ 없는 파일은 severity=warning 으로 잡는다", () => {
    const issues = checkAttachmentReferences(code, ["테스트용 파일-1.docx"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.code).toBe("missing_attachment");
    expect(issues[0]?.message).toContain("테스트용 파일-2.docx");
  });

  it("★ severity 가 error 인 issue 를 절대 만들지 않는다(저장을 막지 않는다)", () => {
    const issues = checkAttachmentReferences(code, []);
    expect(issues.every((issue) => issue.severity === "warning")).toBe(true);
  });

  it("경로가 든 참조는 건너뛴다(우리가 판단할 근거가 없다)", () => {
    expect(checkAttachmentReferences("setInputFiles('fixtures/a.docx')", [])).toEqual([]);
  });

  it("같은 이름을 여러 번 써도 경고는 1건이다", () => {
    const dup = "setInputFiles('a.docx');\nsetInputFiles('a.docx');";
    expect(checkAttachmentReferences(dup, [])).toHaveLength(1);
  });
});
