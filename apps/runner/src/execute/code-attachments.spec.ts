import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAttachmentStorageKey } from "@testflow/contracts";
import { materializeAttachments, resolveAttachmentTarget } from "./code-attachments.js";

const SCENARIO_ID = "11111111-2222-4333-8444-555555555555";
const A1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const A2 = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
const KOREAN_1 = "테스트용 파일-1.docx";
const KOREAN_2 = "테스트용 파일-2.docx";

let root = "";
let artifactRoot = "";
let workspace = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tf-attach-spec-"));
  artifactRoot = join(root, "artifacts");
  workspace = join(root, "ws");
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(workspace, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seed(attachmentId: string, bytes: string): Promise<string> {
  const key = buildAttachmentStorageKey(SCENARIO_ID, attachmentId);
  const path = join(artifactRoot, key);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes);
  return key;
}

describe("resolveAttachmentTarget — ★ 3중 방어의 마지막 겹", () => {
  it("★ 한글 파일명을 작업공간 루트에 그대로 놓는다", () => {
    expect(resolveAttachmentTarget(workspace, KOREAN_1)).toBe(join(workspace, KOREAN_1));
  });

  const rejected: [string, string][] = [
    ["상위 이동", "../../etc/passwd"],
    ["한 단계 상위", "../evil.docx"],
    ["절대 경로", "/etc/passwd"],
    ["하위 디렉토리", "sub/a.docx"],
    ["백슬래시", "sub\\a.docx"],
    ["윈도우 드라이브", "C:\\Windows\\win.ini"],
    ["점 둘", ".."],
    ["숨김 파일", ".npmrc"],
    ["NUL", "a\u0000.docx"],
    ["개행", "a\nb.docx"],
    ["빈 문자열", ""],
    ["★ config 덮어쓰기", "playwright.config.mjs"],
    ["★ node_modules 덮어쓰기", "node_modules"],
    ["★ specs 덮어쓰기", "specs"],
    ["★ out 덮어쓰기", "out"],
  ];

  for (const [label, name] of rejected) {
    it(`거부: ${label}`, () => {
      expect(() => resolveAttachmentTarget(workspace, name)).toThrow();
    });
  }
});

describe("materializeAttachments", () => {
  it("★ 한글 파일 2건을 작업공간 루트에 그대로 푼다(바이트 일치)", async () => {
    const k1 = await seed(A1, "DOCX-ONE");
    const k2 = await seed(A2, "DOCX-TWO-2");

    const result = await materializeAttachments({
      workspaceDir: workspace,
      artifactRoot,
      attachments: [
        { filename: KOREAN_1, storageKey: k1, sizeBytes: 8 },
        { filename: KOREAN_2, storageKey: k2, sizeBytes: 10 },
      ],
    });

    expect(result.placed).toEqual([KOREAN_1, KOREAN_2]);
    expect(result.skipped).toEqual([]);
    expect(result.totalBytes).toBe(18);

    // 작업공간 **루트**다 — specs/ 아래가 아니다(setInputFiles 기준이 cwd 라서).
    expect((await readdir(workspace)).sort()).toEqual([KOREAN_1, KOREAN_2].sort());
    expect(await readFile(join(workspace, KOREAN_1), "utf8")).toBe("DOCX-ONE");
    expect(await readFile(join(workspace, KOREAN_2), "utf8")).toBe("DOCX-TWO-2");
  });

  it("★ DB 에 직접 INSERT 된 traversal 파일명을 막고 사유를 돌려준다", async () => {
    const key = await seed(A1, "EVIL");
    const result = await materializeAttachments({
      workspaceDir: workspace,
      artifactRoot,
      attachments: [{ filename: "../../etc/passwd", storageKey: key, sizeBytes: 4 }],
    });

    expect(result.placed).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(await readdir(workspace)).toEqual([]);
  });

  it("★ 저장 키가 규약 위반이면 파일을 만지지 않는다", async () => {
    const result = await materializeAttachments({
      workspaceDir: workspace,
      artifactRoot,
      attachments: [
        { filename: "a.docx", storageKey: "../../etc/passwd", sizeBytes: 1 },
        { filename: "b.docx", storageKey: `runs/${SCENARIO_ID}/video.webm`, sizeBytes: 1 },
      ],
    });

    expect(result.placed).toEqual([]);
    expect(result.skipped.map(([name]) => name)).toEqual(["a.docx", "b.docx"]);
    expect(result.skipped.every(([, reason]) => reason.includes("저장 키"))).toBe(true);
  });

  it("원본이 디스크에 없으면 건너뛰고 나머지는 계속 놓는다", async () => {
    const good = await seed(A1, "OK");
    const missing = buildAttachmentStorageKey(SCENARIO_ID, A2);

    const result = await materializeAttachments({
      workspaceDir: workspace,
      artifactRoot,
      attachments: [
        { filename: "missing.docx", storageKey: missing, sizeBytes: 5 },
        { filename: "good.docx", storageKey: good, sizeBytes: 2 },
      ],
    });

    expect(result.placed).toEqual(["good.docx"]);
    expect(result.skipped).toEqual([["missing.docx", "원본 파일이 디스크에 없다"]]);
  });

  it("첨부가 0건이면 작업공간을 건드리지 않는다", async () => {
    const result = await materializeAttachments({
      workspaceDir: workspace,
      artifactRoot,
      attachments: [],
    });
    expect(result.placed).toEqual([]);
    expect(await readdir(workspace)).toEqual([]);
  });
});
