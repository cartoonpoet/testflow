import { z } from "zod";

/**
 * 증적(Artifact) 저장소 계약.
 *
 * 저장은 로컬 디스크(`ARTIFACT_ROOT`) + `StorageAdapter` 추상화다
 * (02-context "★ 사용자 최종 결정" (b)). S3/MinIO 구현체는 만들지 않는다.
 * API 와 Runner 는 같은 호스트에서 `ARTIFACT_ROOT` 볼륨을 공유한다.
 */

export const ARTIFACT_TYPES = [
  "screenshot",
  "video",
  "trace",
  "console_log",
  "network_log",
] as const;
export const ArtifactTypeSchema = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ARTIFACT_CONTENT_TYPE = {
  screenshot: "image/png",
  video: "video/webm",
  trace: "application/zip",
  console_log: "text/plain; charset=utf-8",
  network_log: "application/json; charset=utf-8",
} as const satisfies Record<ArtifactType, string>;

/**
 * `artifacts.storage_key` — 어댑터 무관 논리 키.
 *
 * 형태: `runs/<runId>/<파일명>`
 *
 * ★ 경로 순회 방어의 1차 방어선이다. `..` · 절대경로 · 백슬래시를 모두 거부한다.
 *   API 는 이 검증에 더해 resolve 후 `ARTIFACT_ROOT` 접두 검사를 반드시 한 번 더 한다
 *   (03-phases Task 5.3).
 */
export const STORAGE_KEY_PATTERN = /^runs\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]+$/;

export const StorageKeySchema = z
  .string()
  .max(500)
  .regex(STORAGE_KEY_PATTERN, "허용되지 않은 storage_key 형식입니다.")
  .refine((key) => !key.includes(".."), "storage_key 에 '..' 를 포함할 수 없습니다.");

/** 실패 스텝 스크린샷 키. 예: `runs/<runId>/step-03.png` */
export function buildStepScreenshotKey(runId: string, sequence: number): string {
  return `runs/${runId}/step-${String(sequence).padStart(2, "0")}.png`;
}

/** run 단위 증적 키. 예: `runs/<runId>/video.webm` */
export function buildRunArtifactKey(runId: string, fileName: string): string {
  return `runs/${runId}/${fileName}`;
}

/**
 * `StorageAdapter` 구현체가 지켜야 할 시그니처.
 * 실제 구현(`LocalDiskStorage`)은 `apps/runner/src/storage/` 에 둔다 — Gen-Phase 6.
 */
export interface StorageAdapter {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Node 의 Readable 은 AsyncIterable<Uint8Array> 를 만족한다(contracts 는 node 타입에 의존하지 않는다). */
  getStream(key: string): Promise<AsyncIterable<Uint8Array>>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
