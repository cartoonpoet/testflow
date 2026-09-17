import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { resolveStorageKey } from "./adapter.js";
import type { RunnerStorageAdapter } from "./adapter.js";

/**
 * 로컬 디스크 구현 — `ARTIFACT_ROOT` 아래에 `storage_key` 를 상대 경로로 해석한다.
 *
 * ★ **API 와 같은 호스트에서 같은 디렉토리를 공유한다**는 전제 위에 서 있다
 *   (02-context "(b) 부가 제약"). Runner 가 여기에 쓴 파일을 API 가
 *   `GET /api/artifacts/:id` 로 그대로 스트리밍한다. 그래서 경로 규칙이
 *   API 의 `artifacts.path.ts` 와 한 글자도 어긋나면 안 된다 — `resolveStorageKey()` 참조.
 */
export class LocalDiskStorage implements RunnerStorageAdapter {
  constructor(private readonly root: string) {}

  get rootDir(): string {
    return this.root;
  }

  /** 검증된 절대 경로. 테스트·진단용으로 공개한다. */
  pathFor(key: string): string {
    return resolveStorageKey(this.root, key);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async putFile(key: string, sourcePath: string): Promise<number> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    // rename 은 다른 파일시스템(컨테이너 볼륨 경계) 을 넘지 못한다 → 스트림 복사로 통일한다.
    await pipeline(createReadStream(sourcePath), createWriteStream(path));
    const info = await stat(path);
    return info.size;
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  async getStream(key: string): Promise<AsyncIterable<Uint8Array>> {
    const path = this.pathFor(key);
    // 존재하지 않으면 여기서 던진다(스트림을 넘겨 준 뒤에 터지면 호출부가 처리하기 어렵다).
    await stat(path);
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.pathFor(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async sizeOf(key: string): Promise<number | null> {
    try {
      const info = await stat(this.pathFor(key));
      return info.isFile() ? info.size : null;
    } catch {
      return null;
    }
  }
}
