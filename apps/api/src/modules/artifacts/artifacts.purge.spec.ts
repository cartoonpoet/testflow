import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactsService } from "./artifacts.service.js";

/**
 * `ArtifactsService.purgeRunFiles()` — **증적 파일이 디스크에서 실제로 사라지는가.**
 *
 * 07-attachments §8 의 고아 파일 97MB 사고와 같은 구조를 실행 삭제에서 반복하지 않기
 * 위한 테스트다. DB 는 건드리지 않는다 — 이 함수가 보는 것은 파일 시스템뿐이다.
 */
const RUN_ID = "0407001b-e36c-489a-baff-e51e54ffcb42";
const OTHER_RUN_ID = "11111111-2222-4333-8444-555555555555";

let root = "";
let service: ArtifactsService;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tf-purge-spec-"));
  // 절대 경로를 주면 `resolve(REPO_ROOT_DIR, …)` 가 그대로 이 경로를 쓴다.
  process.env["ARTIFACT_ROOT"] = root;
  service = new ArtifactsService(null as never, null as never, null as never);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  delete process.env["ARTIFACT_ROOT"];
});

async function seedRun(runId: string, files: Record<string, number>): Promise<void> {
  const dir = join(root, "runs", runId);
  await mkdir(dir, { recursive: true });
  for (const [name, size] of Object.entries(files)) {
    await writeFile(join(dir, name), Buffer.alloc(size, 1));
  }
}

describe("purgeRunFiles", () => {
  it("★ runs/<runId>/ 디렉토리를 통째로 지우고 지운 양을 돌려준다", async () => {
    await seedRun(RUN_ID, { "video.webm": 4096, "trace.zip": 1024, "step-01.png": 512 });

    const before = await stat(join(root, "runs", RUN_ID));
    expect(before.isDirectory()).toBe(true);

    const purged = await service.purgeRunFiles(RUN_ID);

    expect(purged).toEqual({ files: 3, bytes: 4096 + 1024 + 512 });
    await expect(stat(join(root, "runs", RUN_ID))).rejects.toThrow();
  });

  it("★ 다른 실행의 증적은 건드리지 않는다", async () => {
    await seedRun(RUN_ID, { "video.webm": 10 });
    await seedRun(OTHER_RUN_ID, { "video.webm": 20 });

    await service.purgeRunFiles(RUN_ID);

    const survivor = await stat(join(root, "runs", OTHER_RUN_ID, "video.webm"));
    expect(survivor.size).toBe(20);
    await service.purgeRunFiles(OTHER_RUN_ID);
  });

  it("★ DB 행이 없는 파일(고아)도 함께 지워진다 — 디렉토리를 지우기 때문이다", async () => {
    // Runner 가 파일은 썼는데 INSERT 전에 죽은 경우를 흉내낸다.
    await seedRun(RUN_ID, { "orphan-no-db-row.png": 64 });

    const purged = await service.purgeRunFiles(RUN_ID);

    expect(purged.files).toBe(1);
    await expect(stat(join(root, "runs", RUN_ID))).rejects.toThrow();
  });

  it("증적이 하나도 없는 실행은 0 을 돌려준다(에러가 아니다)", async () => {
    expect(await service.purgeRunFiles(OTHER_RUN_ID)).toEqual({ files: 0, bytes: 0 });
  });

  it("★ 경로 조작 runId 는 검증기가 막는다 — 아무것도 지우지 않는다", async () => {
    await seedRun(RUN_ID, { "video.webm": 8 });

    for (const bad of ["../../etc", "..", "/etc/passwd", "not-a-uuid"]) {
      expect(await service.purgeRunFiles(bad)).toEqual({ files: 0, bytes: 0 });
    }

    // 정상 디렉토리는 그대로 살아 있다.
    expect((await stat(join(root, "runs", RUN_ID, "video.webm"))).size).toBe(8);
    await service.purgeRunFiles(RUN_ID);
  });
});
