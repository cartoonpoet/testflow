/**
 * `code-artifacts` 단위 테스트 — ★ 저장 키 규약과 평탄화.
 *
 * 여기서 틀리면 **파일은 만들어지는데 API 가 400 으로 거부해 증적이 조용히 사라진다**
 * (04-gen-6 이슈 9번). 그래서 생성한 키를 실제 `StorageKeySchema` 로 검증한다 —
 * "규약을 지켰다"고 주장하지 않고 계약 자체에 물어본다.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageKeySchema, buildRunArtifactKey } from "@testflow/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flattenArtifactName, scanPlaywrightOutput } from "./code-artifacts.js";

const RUN_ID = "8a1f0c2e-1111-4222-8333-444455556666";

describe("flattenArtifactName — ★ 하위 디렉토리를 만들 수 없다", () => {
  it("첫 번째는 기본 이름, 두 번째부터 번호가 붙는다", () => {
    expect(flattenArtifactName("video", 0)).toBe("video.webm");
    expect(flattenArtifactName("video", 1)).toBe("video-02.webm");
    expect(flattenArtifactName("trace", 0)).toBe("trace.zip");
    expect(flattenArtifactName("trace", 2)).toBe("trace-03.zip");
    expect(flattenArtifactName("screenshot", 0)).toBe("screenshot.png");
    expect(flattenArtifactName("screenshot", 9)).toBe("screenshot-10.png");
  });

  it("★ 만들어지는 키 전량이 STORAGE_KEY_PATTERN 을 통과한다", () => {
    for (const type of ["video", "trace", "screenshot"] as const) {
      for (let i = 0; i < 12; i += 1) {
        const key = buildRunArtifactKey(RUN_ID, flattenArtifactName(type, i));
        expect(StorageKeySchema.safeParse(key).success).toBe(true);
      }
    }
  });

  it("Playwright 의 원본 경로(한글 디렉토리 포함)를 키에 쓰면 거부된다 — 평탄화가 필요한 이유", () => {
    const raw = buildRunArtifactKey(RUN_ID, "rich-다양한-동작을-모두-한-번씩-쓴다/video.webm");
    expect(StorageKeySchema.safeParse(raw).success).toBe(false);
  });
});

describe("scanPlaywrightOutput", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tf-artifacts-spec-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("빈 디렉토리·없는 디렉토리에서 빈 배열을 돌려준다", async () => {
    expect(await scanPlaywrightOutput(dir)).toEqual([]);
    expect(await scanPlaywrightOutput(join(dir, "nope"))).toEqual([]);
  });

  it("★ Playwright 의 실제 레이아웃(테스트별 하위 디렉토리)을 재귀로 훑는다", async () => {
    // 실측한 실제 경로 모양: out/<spec>-<테스트-제목-슬러그>/{video.webm,trace.zip,test-failed-1.png}
    const testDir = join(dir, "rich-다양한-동작을-모두-한-번씩-쓴다");
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "video.webm"), "v");
    await writeFile(join(testDir, "trace.zip"), "t");
    await writeFile(join(testDir, "test-failed-1.png"), "p");

    const found = await scanPlaywrightOutput(dir);
    expect(found.map((f) => f.type).sort()).toEqual(["screenshot", "trace", "video"]);
  });

  it("Playwright 가 내지 않는 확장자와 0바이트 파일은 무시한다", async () => {
    await writeFile(join(dir, "error-context.md"), "x");
    await writeFile(join(dir, "notes.txt"), "x");
    await writeFile(join(dir, ".last-run.json"), "{}");
    await writeFile(join(dir, "empty.webm"), "");
    expect(await scanPlaywrightOutput(dir)).toEqual([]);
  });

  /**
   * ★ 실측으로 찾은 결함의 회귀 테스트.
   *   취소 케이스에서 `.playwright-artifacts-0/` 안의 trace screencast 프레임(jpeg)이
   *   **스크린샷 46건**으로 증적에 올라갔다. 두 겹으로 막는다: 점 디렉토리 제외 + jpeg 불허.
   */
  it("★ .playwright-artifacts-N/ 안의 trace 프레임을 증적으로 올리지 않는다", async () => {
    const internal = join(dir, ".playwright-artifacts-0");
    await mkdir(internal, { recursive: true });
    for (let i = 0; i < 46; i += 1) await writeFile(join(internal, `frame-${String(i)}.jpeg`), "f");
    await writeFile(join(internal, "trace.stacks"), "s");
    // 정상 산출물도 같이 둔다 — 그건 잡혀야 한다.
    const testDir = join(dir, "spec-테스트");
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "test-failed-1.png"), "p");

    const found = await scanPlaywrightOutput(dir);
    expect(found).toHaveLength(1);
    expect(found[0]?.type).toBe("screenshot");
    expect(found[0]?.path).toContain("test-failed-1.png");
  });

  it("★ jpeg/jpg 는 증적이 아니다 (Playwright 스크린샷은 항상 png)", async () => {
    await writeFile(join(dir, "a.jpeg"), "x");
    await writeFile(join(dir, "b.jpg"), "x");
    expect(await scanPlaywrightOutput(dir)).toEqual([]);
  });

  it("여러 테스트의 산출물이 종류·경로로 안정 정렬된다 (파일명 번호가 흔들리지 않는다)", async () => {
    for (const name of ["t-b", "t-a", "t-c"]) {
      await mkdir(join(dir, name), { recursive: true });
      await writeFile(join(dir, name, "video.webm"), "v");
    }
    const found = await scanPlaywrightOutput(dir);
    expect(found).toHaveLength(3);
    expect(found.map((f) => f.path.includes("t-a"))).toEqual([true, false, false]);
    // 두 번 훑어도 같은 순서다
    expect((await scanPlaywrightOutput(dir)).map((f) => f.path)).toEqual(found.map((f) => f.path));
  });
});
