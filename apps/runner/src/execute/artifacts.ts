import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARTIFACT_CONTENT_TYPE, buildRunArtifactKey, buildStepScreenshotKey } from "@testflow/contracts";
import type { ArtifactType } from "@testflow/contracts";
import type { BrowserContext, ConsoleMessage, Page, Request, Response } from "playwright";
import { LocalDiskStorage } from "../storage/index.js";
import type { RunnerStorageAdapter } from "../storage/index.js";
import type { RunReporter } from "./reporter.js";

/**
 * 증적(Artifact) 수집 (03-phases Task 6.5 / FR-008).
 *
 * ## 정책 — **실패했을 때만 전량 수집**
 * 성공한 실행의 video/trace 까지 남기면 디스크가 금방 찬다(영상 1건이 수 MB~수십 MB).
 * 기본은 실패 시에만 screenshot·video·trace·console_log·network_log 를 전부 남기고,
 * 성공 실행은 `KEEP_ARTIFACTS_ON_SUCCESS=true` 일 때만 보존한다.
 *
 * ## 수집은 "항상 켜고, 버릴 때 버린다"
 * video·trace 는 **실행이 끝난 뒤에 소급해서 켤 수 없다.** 그래서 녹화·트레이싱은 항상
 * 켠 채로 시작하고, 성공이면 임시 디렉토리째 지운다. 반대로 하면(실패를 감지한 뒤 켜기)
 * 정작 실패한 그 실행의 증적이 없다.
 *
 * ## 경로 규칙
 * 저장 키는 `runs/<runId>/<파일명>` 뿐이다(하위 디렉토리 불가). API 의 traversal 방어
 * 정규식(`STORAGE_KEY_PATTERN`)이 그 형태만 허용하기 때문이다 — `storage/adapter.ts` 참조.
 */

/** 콘솔/네트워크 로그가 무한정 커지지 않게 거는 상한. */
const MAX_CONSOLE_LINES = 5000;
const MAX_NETWORK_ENTRIES = 3000;

export interface NetworkEntry {
  method: string;
  url: string;
  status: number | null;
  at: string;
}

/**
 * 실행 1건의 증적 수집기.
 *
 * 수명주기: `create()` → (실행) → `captureFailureScreenshot()` → `finalize()`
 */
export class ArtifactCollector {
  private readonly consoleLines: string[] = [];
  private readonly networkEntries: NetworkEntry[] = [];
  private readonly screenshots: { sequence: number; key: string; size: number }[] = [];
  private consoleTruncated = false;
  private networkTruncated = false;

  private constructor(
    private readonly runId: string,
    private readonly storage: RunnerStorageAdapter,
    private readonly reporter: RunReporter,
    /** video·trace 가 떨어지는 임시 디렉토리. 실행 종료 시 반드시 지운다. */
    readonly workDir: string,
    private readonly keepOnSuccess: boolean,
  ) {}

  static async create(params: {
    runId: string;
    artifactRoot: string;
    reporter: RunReporter;
    keepOnSuccess: boolean;
  }): Promise<ArtifactCollector> {
    const workDir = await mkdtemp(join(tmpdir(), `testflow-run-${params.runId.slice(0, 8)}-`));
    return new ArtifactCollector(
      params.runId,
      new LocalDiskStorage(params.artifactRoot),
      params.reporter,
      workDir,
      params.keepOnSuccess,
    );
  }

  /** `browser.newContext()` 에 넘길 녹화 옵션. `size` 는 뷰포트와 같아야 한다. */
  videoOptions(viewport: { width: number; height: number }): {
    dir: string;
    size: { width: number; height: number };
  } {
    return { dir: join(this.workDir, "video"), size: viewport };
  }

  get tracePath(): string {
    return join(this.workDir, "trace.zip");
  }

  /** 콘솔·네트워크 수집 리스너를 붙인다. page 가 새로 열릴 때마다 호출한다. */
  attach(page: Page): void {
    page.on("console", (message: ConsoleMessage) => {
      if (this.consoleLines.length >= MAX_CONSOLE_LINES) {
        this.consoleTruncated = true;
        return;
      }
      // ★ 콘솔에 비밀번호가 찍히는 페이지가 실제로 있다. 저장 전에 마스킹한다.
      this.consoleLines.push(
        `[${new Date().toISOString()}] ${message.type()}: ${this.reporter.mask(message.text())}`,
      );
    });

    page.on("pageerror", (error: Error) => {
      if (this.consoleLines.length >= MAX_CONSOLE_LINES) {
        this.consoleTruncated = true;
        return;
      }
      this.consoleLines.push(
        `[${new Date().toISOString()}] pageerror: ${this.reporter.mask(error.message)}`,
      );
    });

    page.on("requestfinished", (request: Request) => {
      void this.recordNetwork(request);
    });
    page.on("requestfailed", (request: Request) => {
      void this.recordNetwork(request);
    });
  }

  private async recordNetwork(request: Request): Promise<void> {
    if (this.networkEntries.length >= MAX_NETWORK_ENTRIES) {
      this.networkTruncated = true;
      return;
    }
    let status: number | null;
    try {
      const response: Response | null = await request.response();
      status = response === null ? null : response.status();
    } catch {
      status = null;
    }
    // URL 의 쿼리스트링에 토큰이 실리는 경우가 있어 마스킹을 거친다.
    this.networkEntries.push({
      method: request.method(),
      url: this.reporter.mask(request.url()).slice(0, 1000),
      status,
      at: new Date().toISOString(),
    });
  }

  /**
   * ★ 실패 스텝 스크린샷. 실패를 감지한 **그 자리에서** 찍어야 한다 —
   * 컨텍스트를 닫은 뒤에는 화면이 없다.
   */
  async captureFailureScreenshot(page: Page, sequence: number): Promise<void> {
    try {
      const buffer = await page.screenshot({ fullPage: false, timeout: 5000 });
      const key = buildStepScreenshotKey(this.runId, sequence);
      await this.storage.put(key, buffer);
      this.screenshots.push({ sequence, key, size: buffer.byteLength });
    } catch (error) {
      // 스크린샷 실패가 실행 실패를 덮어쓰면 안 된다. 삼키고 기록만 한다.
      this.consoleLines.push(
        `[${new Date().toISOString()}] runner: 스크린샷 수집 실패 — ${shortMessage(error)}`,
      );
    }
  }

  /**
   * 실행 종료 후 증적을 저장소로 옮기고 `artifacts` 행 + `artifact.ready` 이벤트를 만든다.
   *
   * **반드시 `context.close()` 뒤에 호출한다** — Playwright 는 컨텍스트가 닫혀야
   * 영상 파일을 최종 기록(flush)한다.
   */
  async finalize(params: { failed: boolean; traceSaved: boolean }): Promise<number> {
    const keep = params.failed || this.keepOnSuccess;
    if (!keep) {
      /*
       * ★ 라운드 4 — 성공한 실행에서도 **영상만은 남긴다.**
       *
       * 사용자 요구가 "테스트 한 거를 다시 보고 싶다" 이고, 그것은 성공·실패를 가리지 않는다.
       * 코드 실행 경로도 같은 판단을 했다(`pw-config.ts` 의 `video: "on"`) — 두 경로가
       * 다른 정책을 쓰면 "어떤 실행은 다시 보기가 되고 어떤 실행은 안 되는" 꼴이 된다.
       *
       * trace·console·network 는 그대로 버린다. 그것들은 **디버깅** 자료라 성공한 실행에서
       * 볼 이유가 없고, trace 는 실행당 0.7MB 이상으로 영상보다 비싼 경우가 많다.
       */
      const successVideo = await this.findVideoFile();
      const publishedVideo =
        successVideo === null ? 0 : await this.store("video", "video.webm", successVideo);
      await this.cleanup();
      return publishedVideo;
    }

    let published = 0;

    // 1) 실패 스텝 스크린샷 (이미 디스크에 있다 — 행만 만든다)
    for (const shot of this.screenshots) {
      await this.reporter.artifactReady({
        type: "screenshot",
        storageKey: shot.key,
        contentType: ARTIFACT_CONTENT_TYPE.screenshot,
        sizeBytes: shot.size,
        stepSequence: shot.sequence,
      });
      published += 1;
    }

    // 2) 영상 — Playwright 가 임의 이름(`<hash>.webm`)으로 떨어뜨린다.
    const videoPath = await this.findVideoFile();
    if (videoPath !== null) {
      published += await this.store("video", "video.webm", videoPath);
    }

    // 3) Trace — `npx playwright show-trace` 로 열리는 zip.
    if (params.traceSaved) {
      published += await this.store("trace", "trace.zip", this.tracePath);
    }

    // 4) 콘솔 로그
    published += await this.storeText(
      "console_log",
      "console.log",
      this.consoleLines.length === 0
        ? "(콘솔 출력 없음)\n"
        : `${this.consoleLines.join("\n")}${this.consoleTruncated ? `\n… ${String(MAX_CONSOLE_LINES)}줄에서 잘렸습니다.` : ""}\n`,
    );

    // 5) 네트워크 로그
    published += await this.storeText(
      "network_log",
      "network.json",
      `${JSON.stringify(
        { truncated: this.networkTruncated, count: this.networkEntries.length, entries: this.networkEntries },
        null,
        2,
      )}\n`,
    );

    await this.cleanup();
    return published;
  }

  /** 임시 디렉토리 제거. 실패해도 실행 결과에 영향을 주지 않는다. */
  async cleanup(): Promise<void> {
    await rm(this.workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  /* ── 내부 ─────────────────────────────────────────────── */

  private async store(type: ArtifactType, fileName: string, sourcePath: string): Promise<number> {
    try {
      const key = buildRunArtifactKey(this.runId, fileName);
      const size = await this.storage.putFile(key, sourcePath);
      await this.reporter.artifactReady({
        type,
        storageKey: key,
        contentType: ARTIFACT_CONTENT_TYPE[type],
        sizeBytes: size,
        stepSequence: null,
      });
      return 1;
    } catch {
      // 파일이 없을 수 있다(trace 저장 실패 등). 증적 하나가 없다고 실행을 실패시키지 않는다.
      return 0;
    }
  }

  private async storeText(type: ArtifactType, fileName: string, text: string): Promise<number> {
    try {
      const key = buildRunArtifactKey(this.runId, fileName);
      const data = new TextEncoder().encode(text);
      await this.storage.put(key, data);
      await this.reporter.artifactReady({
        type,
        storageKey: key,
        contentType: ARTIFACT_CONTENT_TYPE[type],
        sizeBytes: data.byteLength,
        stepSequence: null,
      });
      return 1;
    } catch {
      return 0;
    }
  }

  private async findVideoFile(): Promise<string | null> {
    try {
      const dir = join(this.workDir, "video");
      const files = await readdir(dir);
      const webm = files.find((name) => name.endsWith(".webm"));
      return webm === undefined ? null : join(dir, webm);
    } catch {
      return null;
    }
  }
}

/**
 * 컨텍스트에 트레이싱을 켠다. 실패하면 false 를 돌려주고 실행은 계속한다
 * (트레이싱이 안 켜진다고 테스트를 못 돌릴 이유는 없다).
 */
export async function startTracing(context: BrowserContext): Promise<boolean> {
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    return true;
  } catch {
    return false;
  }
}

/** 트레이싱을 멈추고 zip 으로 떨군다. `context.close()` **전에** 호출해야 한다. */
export async function stopTracing(context: BrowserContext, path: string): Promise<boolean> {
  try {
    await context.tracing.stop({ path });
    return true;
  } catch {
    return false;
  }
}

function shortMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split("\n")[0]?.slice(0, 200) ?? "unknown";
}
