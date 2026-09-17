/**
 * 코드 실행의 증적 수집 (03-phases Task 3.6).
 *
 * ## 녹화 경로와 무엇이 다른가 — **수집만 다르고 적재는 같다** (쟁점 2)
 * 라운드 1(`artifacts.ts`)은 우리가 page 를 소유하므로 스크린샷을 직접 찍고 tracing 을 직접 켠다.
 * 코드 실행은 **Playwright 가 `outputDir` 에 파일로 떨어뜨린다**
 * (`use.video/trace/screenshot` = `retain-on-failure`/`only-on-failure`).
 * 그래서 이 모듈은 **디렉토리를 훑어 옮기는 일**만 하고, 적재는 라운드 1과 같은 경로를 탄다:
 * `storage.putFile()` → `RunReporter.artifactReady()`(= `artifacts` INSERT + `artifact.ready` publish).
 *
 * ## ★ 순서 규약 — `artifact.ready` 가 `run.finished` **보다 먼저**
 * 호출부(`code-executor.ts`)가 `collectPlaywrightArtifacts()` 를 `runFinished()` **앞에서** 부른다.
 * 뒤집으면 화면이 "완료"를 그린 뒤에 증적이 나타나 사용자는 이미 페이지를 떠나 있다.
 *
 * ## ★ 저장 키는 `runs/<runId>/<파일명>` 뿐이다 — 하위 디렉토리 불가
 * `STORAGE_KEY_PATTERN` 이 그 형태만 허용한다. Playwright 의 `outputDir` 는
 * `out/<테스트-제목-슬러그>/video.webm` 처럼 **디렉토리를 만든다.** 그래서 반드시
 * **평탄화 + 파일명 재작성**을 한다. 안 하면 파일은 만들어지는데 API 가 400 으로 거부해
 * 증적이 조용히 사라진다 (04-gen-6 이슈 9번).
 *
 * ## ★ console/network 로그는 수집하지 않는다 — 있는 척하지 않는다
 * 코드 실행에서는 page 를 우리가 소유하지 않아 `page.on("console")` 을 걸 자리가 없다
 * (브라우저는 worker 프로세스 안에서 뜬다). Gen-Phase 4 가 CDP 로 붙으면 리스너를 걸 자리가
 * 생기지만 **그때도 "붙기 전"의 로그는 못 받는다.** 그래서 이번에는 만들지 않는다 —
 * 빈 `console.log` 증적을 만들어 두면 사용자는 "콘솔에 아무것도 없었다"로 오독한다.
 */
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { ARTIFACT_CONTENT_TYPE, buildRunArtifactKey } from "@testflow/contracts";
import type { ArtifactType } from "@testflow/contracts";
import { LocalDiskStorage } from "../storage/index.js";
import type { RunnerStorageAdapter } from "../storage/index.js";
import type { RunReporter } from "./reporter.js";

/** 증적 1건이 아무리 커도 여기까지만 받는다(영상 폭주 방어). 640MB. */
const MAX_ARTIFACT_BYTES = 640 * 1024 * 1024;

/** 디렉토리 재귀 깊이 상한. Playwright 는 2단을 넘지 않는다. */
const MAX_SCAN_DEPTH = 4;

interface FoundFile {
  readonly path: string;
  readonly type: ArtifactType;
  readonly size: number;
}

/**
 * 확장자 → 증적 종류. Playwright 가 내는 것만 받는다(그 밖의 파일은 무시).
 *
 * ★ **`.jpeg`/`.jpg` 를 받지 않는다.** Playwright 의 사용자용 스크린샷은 **항상 `.png`** 다.
 *   jpeg 로 떨어지는 것은 **trace 의 screencast 프레임**(`.playwright-artifacts-N/*.jpeg`)이고,
 *   그건 trace.zip 안으로 들어갈 중간 산출물이다. 실측으로 대가를 봤다 — 취소 케이스에서
 *   **스크린샷 46건이 증적으로 올라갔다**(전부 trace 프레임이었다).
 */
function classify(fileName: string): ArtifactType | null {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".webm") return "video";
  if (ext === ".zip") return "trace";
  if (ext === ".png") return "screenshot";
  return null;
}

/**
 * ★ Playwright 내부 임시 디렉토리는 훑지 않는다.
 *
 * `outputDir` 안에 `.playwright-artifacts-<n>/` 를 만들어 trace 조립용 중간 파일을 쌓는다.
 * 정상 종료 시에는 trace.zip 으로 packing 하고 지우지만, **취소·SIGKILL 로 끊기면 그대로 남는다**
 * (실측). 점으로 시작하는 디렉토리는 전부 내부용이므로 통째로 건너뛴다.
 */
function isInternalDir(name: string): boolean {
  return name.startsWith(".");
}

/** `outputDir` 를 재귀로 훑어 증적 후보를 모은다. */
export async function scanPlaywrightOutput(dir: string, depth = 0): Promise<FoundFile[]> {
  if (depth > MAX_SCAN_DEPTH) return [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const found: FoundFile[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    let info;
    try {
      info = await stat(path);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      if (isInternalDir(entry)) continue;
      found.push(...(await scanPlaywrightOutput(path, depth + 1)));
      continue;
    }
    const type = classify(entry);
    if (type === null) continue;
    if (info.size === 0 || info.size > MAX_ARTIFACT_BYTES) continue;
    found.push({ path, type, size: info.size });
  }
  // 종류·경로로 정렬해 순서가 실행마다 흔들리지 않게 한다(파일명 번호가 안정된다).
  return found.sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type.localeCompare(b.type)));
}

/** 증적 종류 → `runs/<runId>/` 아래에서 쓸 기본 파일명. */
const BASE_NAME: Readonly<Record<string, string>> = {
  video: "video.webm",
  trace: "trace.zip",
  screenshot: "screenshot.png",
};

/**
 * ★ 평탄화 — 같은 종류가 여러 개면 번호를 붙인다.
 * `video.webm` · `video-02.webm` · `video-03.webm` …
 * (테스트가 여러 개인 spec 은 실패 테스트마다 영상이 하나씩 나온다.)
 */
export function flattenArtifactName(type: ArtifactType, index: number): string {
  const base = BASE_NAME[type] ?? "artifact.bin";
  if (index === 0) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? "" : base.slice(dot);
  return `${stem}-${String(index + 1).padStart(2, "0")}${ext}`;
}

export interface CodeArtifactResult {
  readonly published: number;
  readonly byType: Readonly<Record<string, number>>;
}

/**
 * `outputDir` 의 Playwright 산출물을 저장소로 옮기고 `artifacts` 행 + `artifact.ready` 를 만든다.
 *
 * **반드시 `playwright test` 프로세스가 완전히 종료한 뒤** 호출한다 — Playwright 는
 * 프로세스 종료 시점에 영상·trace 를 최종 기록(flush)한다.
 *
 * `stepSequence` 는 **항상 `null`** 이다. Playwright 의 파일명(`test-failed-1.png`)은
 * 테스트 단위이지 우리 스텝 번호 단위가 아니다 — 억지로 묶으면 틀린 스텝에 증적이 붙는다.
 */
export async function collectPlaywrightArtifacts(params: {
  runId: string;
  outputDir: string;
  artifactRoot: string;
  reporter: RunReporter;
  log?: (message: string) => void;
}): Promise<CodeArtifactResult> {
  const storage: RunnerStorageAdapter = new LocalDiskStorage(params.artifactRoot);
  const files = await scanPlaywrightOutput(params.outputDir);

  const counters = new Map<ArtifactType, number>();
  const byType: Record<string, number> = {};
  let published = 0;

  for (const file of files) {
    const index = counters.get(file.type) ?? 0;
    counters.set(file.type, index + 1);
    const key = buildRunArtifactKey(params.runId, flattenArtifactName(file.type, index));
    try {
      const size = await storage.putFile(key, file.path);
      await params.reporter.artifactReady({
        type: file.type,
        storageKey: key,
        contentType: ARTIFACT_CONTENT_TYPE[file.type],
        sizeBytes: size,
        stepSequence: null,
      });
      published += 1;
      byType[file.type] = (byType[file.type] ?? 0) + 1;
    } catch (error) {
      // 증적 하나가 실패해도 실행 결과를 뒤집지 않는다. 다만 **조용히 넘기지 않는다** —
      // 키 규약 위반은 로그가 유일한 단서다.
      params.log?.(
        `증적 적재 실패 — ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { published, byType };
}
