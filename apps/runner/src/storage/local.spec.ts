import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "./local.js";
import { StorageKeyError, resolveStorageKey, sanitizeFileName } from "./adapter.js";

const RUN_ID = "0407001b-e36c-489a-baff-e51e54ffcb42";
let root = "";
let storage: LocalDiskStorage;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tf-storage-spec-"));
  storage = new LocalDiskStorage(root);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalDiskStorage", () => {
  const key = `runs/${RUN_ID}/step-01.png`;

  it("put 하면 $ARTIFACT_ROOT/runs/<id>/... 에 실제 파일이 생긴다", async () => {
    await storage.put(key, new Uint8Array([1, 2, 3, 4]));
    const info = await stat(join(root, "runs", RUN_ID, "step-01.png"));
    expect(info.isFile()).toBe(true);
    expect(info.size).toBe(4);
  });

  it("exists / get / sizeOf", async () => {
    expect(await storage.exists(key)).toBe(true);
    expect([...(await storage.get(key))]).toEqual([1, 2, 3, 4]);
    expect(await storage.sizeOf(key)).toBe(4);
  });

  it("getStream 은 AsyncIterable<Uint8Array> 다(contracts 규약)", async () => {
    const stream = await storage.getStream(key);
    const chunks: number[] = [];
    for await (const chunk of stream) chunks.push(...chunk);
    expect(chunks).toEqual([1, 2, 3, 4]);
  });

  it("없는 키는 exists=false, sizeOf=null, getStream 은 던진다", async () => {
    const missing = `runs/${RUN_ID}/nope.png`;
    expect(await storage.exists(missing)).toBe(false);
    expect(await storage.sizeOf(missing)).toBeNull();
    await expect(storage.getStream(missing)).rejects.toThrow();
  });

  it("putFile 은 디스크의 파일을 옮기고 바이트 수를 돌려준다", async () => {
    const src = join(root, "source.webm");
    await writeFile(src, "0123456789");
    const size = await storage.putFile(`runs/${RUN_ID}/video.webm`, src);
    expect(size).toBe(10);
    expect(await storage.exists(`runs/${RUN_ID}/video.webm`)).toBe(true);
  });

  it("delete 후 exists=false (없는 키를 지워도 던지지 않는다)", async () => {
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });
});

describe("resolveStorageKey — API 의 traversal 방어와 같은 규칙", () => {
  const cases: [string, string][] = [
    ["상위 이동", `runs/${RUN_ID}/../../etc/passwd`],
    ["상대 탈출", "../../etc/passwd"],
    ["절대 경로", "/etc/passwd"],
    ["윈도우 드라이브", "C:\\Windows\\win.ini"],
    ["백슬래시", `runs\\${RUN_ID}\\a.png`],
    ["runs/ 미접두", `foo/${RUN_ID}/a.png`],
    ["★ 하위 디렉토리(API 정규식이 거부한다)", `runs/${RUN_ID}/sub/a.png`],
    ["한글 파일명", `runs/${RUN_ID}/스크린샷.png`],
    ["빈 파일명", `runs/${RUN_ID}/`],
  ];

  for (const [label, key] of cases) {
    it(`거부: ${label}`, () => {
      expect(() => resolveStorageKey("/tmp/root", key)).toThrow(StorageKeyError);
    });
  }

  it("정상 키는 root 아래 절대 경로로 풀린다", () => {
    expect(resolveStorageKey("/tmp/root", `runs/${RUN_ID}/step-01.png`)).toBe(
      `/tmp/root/runs/${RUN_ID}/step-01.png`,
    );
  });

  it("★ 접두사만 같은 형제 디렉토리로 새지 않는다", () => {
    // resolve 결과가 `/tmp/root-evil/...` 이 되는 입력은 정규식 단계에서 이미 막힌다.
    expect(() => resolveStorageKey("/tmp/root", `runs/${RUN_ID}/../../../root-evil/x.png`)).toThrow(
      StorageKeyError,
    );
  });
});

describe("sanitizeFileName", () => {
  it("허용 문자 외는 하이픈으로 바꾼다", () => {
    expect(sanitizeFileName("로그인 성공.png")).toBe("-.png");
  });
  it("허용 문자는 보존한다", () => {
    expect(sanitizeFileName("step-01_v2.png")).toBe("step-01_v2.png");
  });
  it("빈 결과는 file 로 떨어진다", () => {
    expect(sanitizeFileName("...")).toBe("...");
    expect(sanitizeFileName("")).toBe("file");
  });
});
