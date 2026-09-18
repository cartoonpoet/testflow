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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectPlaywrightArtifacts,
  flattenArtifactName,
  isPlayableWebm,
  scanPlaywrightOutput,
} from "./code-artifacts.js";
import type { RunReporter } from "./reporter.js";

const RUN_ID = "8a1f0c2e-1111-4222-8333-444455556666";

/** EBML 매직 + Cluster ID 로 "재생 가능한 모양"의 webm 을 흉내낸다. */
function playableWebmBytes(size = 8 * 1024): Buffer {
  const buffer = Buffer.alloc(size, 0x11);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(buffer, 0);
  Buffer.from([0x1f, 0x43, 0xb6, 0x75]).copy(buffer, 512);
  return buffer;
}

/** 헤더만 있고 Cluster 가 없는 webm — 프레임 0장. */
function headerOnlyWebmBytes(size = 8 * 1024): Buffer {
  const buffer = Buffer.alloc(size, 0x11);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(buffer, 0);
  return buffer;
}

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

/**
 * ★★ 강제 종료 뒤의 수습 — **"파일이 있다"와 "재생된다"는 다르다.**
 *
 * 0바이트/헤더뿐인 webm 을 증적으로 올리면 화면은 `<video>` 를 그리고 사용자는
 * `MEDIA_ERR_SRC_NOT_SUPPORTED` 를 본다. 없는 것보다 나쁘다 — 그래서 버린다.
 */
describe("isPlayableWebm — 부분 영상 검증", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tf-webm-spec-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("EBML 헤더 + Cluster 가 있고 충분히 크면 통과한다", async () => {
    const path = join(dir, "ok.webm");
    await writeFile(path, playableWebmBytes());
    expect(await isPlayableWebm(path)).toBe(true);
  });

  it("★ 0바이트는 버린다", async () => {
    const path = join(dir, "zero.webm");
    await writeFile(path, "");
    expect(await isPlayableWebm(path)).toBe(false);
  });

  it("★ 4KB 미만(헤더만 쓰이다 끊긴 것)은 버린다", async () => {
    const path = join(dir, "tiny.webm");
    await writeFile(path, playableWebmBytes(1024));
    expect(await isPlayableWebm(path)).toBe(false);
  });

  it("★ Cluster 가 없으면(프레임 0장) 버린다", async () => {
    const path = join(dir, "header-only.webm");
    await writeFile(path, headerOnlyWebmBytes());
    expect(await isPlayableWebm(path)).toBe(false);
  });

  it("★ webm 이 아닌 쓰레기는 버린다", async () => {
    const path = join(dir, "junk.webm");
    await writeFile(path, Buffer.alloc(8 * 1024, 0x5a));
    expect(await isPlayableWebm(path)).toBe(false);
  });

  it("없는 파일은 false", async () => {
    expect(await isPlayableWebm(join(dir, "nope.webm"))).toBe(false);
  });
});

describe("collectPlaywrightArtifacts — salvage", () => {
  let outputDir: string;
  let artifactRoot: string;

  const reporter = (): { reporter: RunReporter; calls: { type: string; key: string }[] } => {
    const calls: { type: string; key: string }[] = [];
    const stub = {
      artifactReady: vi.fn((input: { type: string; storageKey: string }) => {
        calls.push({ type: input.type, key: input.storageKey });
        return Promise.resolve();
      }),
    };
    return { reporter: stub as unknown as RunReporter, calls };
  };

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "tf-salvage-spec-"));
    outputDir = join(root, "out");
    artifactRoot = join(root, "artifacts");
    await mkdir(outputDir, { recursive: true });
    await mkdir(artifactRoot, { recursive: true });
  });
  afterEach(async () => {
    await rm(join(outputDir, ".."), { recursive: true, force: true });
  });

  it("★ salvage 를 켜지 않으면 내부 디렉토리를 건드리지 않는다(정상 종료 경로)", async () => {
    const internal = join(outputDir, ".playwright-artifacts-0");
    await mkdir(internal, { recursive: true });
    await writeFile(join(internal, "abc.webm"), playableWebmBytes());

    const { reporter: stub, calls } = reporter();
    const result = await collectPlaywrightArtifacts({
      runId: RUN_ID,
      outputDir,
      artifactRoot,
      reporter: stub,
    });
    expect(result.published).toBe(0);
    expect(calls).toEqual([]);
  });

  it("★ 강제 종료 뒤 제자리 영상이 없으면 내부 디렉토리의 재생 가능한 부분 영상을 올린다", async () => {
    const internal = join(outputDir, ".playwright-artifacts-0");
    await mkdir(internal, { recursive: true });
    await writeFile(join(internal, "abc.webm"), playableWebmBytes());

    const { reporter: stub, calls } = reporter();
    const result = await collectPlaywrightArtifacts({
      runId: RUN_ID,
      outputDir,
      artifactRoot,
      reporter: stub,
      salvage: true,
    });
    expect(result.published).toBe(1);
    expect(calls[0]?.type).toBe("video");
    // 저장 키는 언제나 `runs/<runId>/<파일명>` 이다 — 수습 경로에서도 같다.
    expect(StorageKeySchema.safeParse(calls[0]?.key).success).toBe(true);
  });

  it("★ 재생 불가한 부분 영상은 올리지 않는다 — 깨진 영상이 없는 것보다 나쁘다", async () => {
    const internal = join(outputDir, ".playwright-artifacts-0");
    await mkdir(internal, { recursive: true });
    await writeFile(join(internal, "broken.webm"), headerOnlyWebmBytes());
    await writeFile(join(internal, "zero.webm"), "");

    const { reporter: stub, calls } = reporter();
    const result = await collectPlaywrightArtifacts({
      runId: RUN_ID,
      outputDir,
      artifactRoot,
      reporter: stub,
      salvage: true,
    });
    expect(result.published).toBe(0);
    expect(calls).toEqual([]);
  });

  it("★ 제자리 영상이 이미 있으면 수습하지 않는다(같은 화면이 두 벌이 되지 않게)", async () => {
    const testDir = join(outputDir, "spec-테스트");
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "video.webm"), playableWebmBytes());
    const internal = join(outputDir, ".playwright-artifacts-0");
    await mkdir(internal, { recursive: true });
    await writeFile(join(internal, "abc.webm"), playableWebmBytes());

    const { reporter: stub, calls } = reporter();
    const result = await collectPlaywrightArtifacts({
      runId: RUN_ID,
      outputDir,
      artifactRoot,
      reporter: stub,
      salvage: true,
    });
    expect(result.published).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("★ 내부 디렉토리의 jpeg(trace 프레임)는 수습 대상이 아니다", async () => {
    const internal = join(outputDir, ".playwright-artifacts-0");
    await mkdir(internal, { recursive: true });
    for (let i = 0; i < 20; i += 1) {
      await writeFile(join(internal, `frame-${String(i)}.jpeg`), playableWebmBytes());
    }

    const { reporter: stub, calls } = reporter();
    const result = await collectPlaywrightArtifacts({
      runId: RUN_ID,
      outputDir,
      artifactRoot,
      reporter: stub,
      salvage: true,
    });
    expect(result.published).toBe(0);
    expect(calls).toEqual([]);
  });
});
