import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";
import { DataSource } from "typeorm";
import { DraftStepsSchema } from "@testflow/contracts";
import type { DraftStep, RecorderClientMessage, Viewport } from "@testflow/contracts";
import { RecordingSessionEntity } from "@testflow/db";
import { REPO_ROOT_DIR } from "../env.js";
import type { RunnerConfig } from "../env.js";
import { createInputBridge } from "./input-bridge.js";
import type { InputBridge } from "./input-bridge.js";
import { startScreencast } from "./screencast.js";
import type { ScreencastHandle } from "./screencast.js";
import { mergeConsecutiveFills, toDraftStep } from "./step-mapper.js";
import type { RecordedAction, RecordedEvent } from "./step-mapper.js";

/**
 * 녹화 세션 수명주기 (03-phases Task 7.1 · 7.6)
 *
 * **브라우저 컨텍스트 1개 = 세션 1개.** 세션 레코드(`recording_sessions`)는 API 가 미리
 * 만들어 두고(Task 5.4), Runner 는 WS 가 붙는 순간 그 행을 집어 브라우저를 연다.
 *
 * ## 이 파일이 조립하는 것
 * ```
 *  [원격 페이지]  injected.js  ──__tfEmit──▶  step-mapper ──▶ draft_steps(DB)
 *        ▲                                                         │
 *        │ input-bridge (CDP)                                      ▼
 *  [WS 클라이언트] ◀── screencast 프레임(15fps 상한) ──── ws-server
 * ```
 *
 * ## ★ `resize` 는 **여기**가 처리한다 (04-gen-3 이슈 5번)
 * `resize` 는 화면을 그리는 명령이 아니라 **브라우저 상태를 바꾸는** 명령이다.
 * 화면 전달 계층(`screencast.ts`/`input-bridge.ts`)이 브라우저 상태를 건드리면, PoC 가
 * 실패해 1번(별도 창) 방식으로 후퇴할 때 교체 범위가 그 두 파일 밖으로 새어 나간다.
 * 그래서 `input-bridge.dispatch()` 는 `resize` 를 의도적으로 무시하고 세션이 받는다.
 *
 * ## ★ 송출 fps 상한 (04-gen-3 전달사항 2번)
 * PoC-1 은 60fps 를 그대로 흘려 **세션당 14.6~33.1 Mbps** 를 썼다. 합격 기준은 10fps 다.
 * `RECORD_MAX_FPS`(기본 **15**) 로 상한을 두면 대역폭이 약 1/4 이 되고 기준(≤200ms, ≥10fps)은
 * 그대로 유지된다. 드롭은 "최신 프레임이 언제나 옳다" 원칙으로 **버리는 쪽**이다 — 큐에 쌓으면
 * 지연이 단조 증가해 "느린 화면"이 된다.
 *
 * ## ★ 초안은 **즉시** DB 에 쓴다
 * `POST /api/recordings/:id/stop` 은 API 가 `recording_sessions.draft_steps` 를 **읽어서**
 * 시나리오에 반영한다(`recordings.service.ts`). 즉 API 가 그 행을 읽는 시점에 초안이 이미
 * DB 에 있어야 한다. Runner 가 "종료 신호를 받고 나서" 저장하면 **경합에 져서 초안이 통째로
 * 사라진다.** 그래서 초안이 하나 생길 때마다(짧은 합치기 창 뒤에) 바로 flush 한다.
 * 세션 중간에 Runner 가 죽어도 직전까지의 초안이 남는 것은 그 부수 효과다.
 */

/* ────────────────────────────────────────────────────────────
 * 옵션 / 타입
 * ──────────────────────────────────────────────────────────── */

export interface SessionSink {
  /** JPEG 프레임 1장. 봉투 인코딩과 `bufferedAmount` 드롭은 ws-server 의 책임이다. */
  frame(frame: {
    data: Buffer;
    capturedAtMs: number;
    viewportWidth: number;
    viewportHeight: number;
  }): void;
  /** `{t:'step'|'nav'|'error'}` — `RecorderServerMessage` 중 JSON 으로 나가는 것들. */
  message(message: unknown): void;
}

export interface RecordingSessionOptions {
  sessionId: string;
  scenarioId: string;
  startUrl: string;
  viewport: Viewport;
  config: RunnerConfig;
  dataSource: DataSource;
  log: (message: string) => void;
}

export type SessionEndReason = "stopped" | "disposed" | "expired" | "error";

/** 초안이 하나 생긴 뒤 DB flush 까지 기다리는 시간. 연속 초안을 한 번의 UPDATE 로 묶는다. */
const FLUSH_DEBOUNCE_MS = 150;

/** 네비게이션이 직전 클릭/Enter 의 결과로 보이는 시간 창. 이 안이면 `goto` 스텝을 만들지 않는다. */
const NAV_AFTER_ACTION_MS = 2000;

/** 기본 유휴 타임아웃. 마지막 클라이언트 메시지로부터 이 시간이 지나면 브라우저를 접는다. */
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** 유휴 판정 주기. */
const IDLE_CHECK_INTERVAL_MS = 10_000;

export function idleTimeoutMs(): number {
  const raw = Number(process.env["RECORDING_IDLE_TIMEOUT_MS"] ?? DEFAULT_IDLE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_IDLE_TIMEOUT_MS;
}

/** 송출 fps 상한. 0 이하면 제한하지 않는다(PoC-1 과 같은 무제한 동작). */
export function maxFrameRate(): number {
  const raw = Number(process.env["RECORD_MAX_FPS"] ?? 15);
  return Number.isFinite(raw) ? Math.trunc(raw) : 15;
}

/**
 * `injected.js` 실제 경로.
 *
 * `addInitScript({path})` 는 **파일**을 요구한다. 산출물 위치가 빌드 구성에 따라 달라지므로
 * 후보를 순서대로 본다. 못 찾으면 **조용히 넘어가지 않고 던진다** — 주입이 빠지면 화면은
 * 멀쩡히 나오는데 스텝이 하나도 안 쌓이는, 원인을 찾기 가장 어려운 실패가 된다.
 */
export function resolveInjectedScriptPath(): string {
  const override = (process.env["TESTFLOW_INJECTED_JS"] ?? "").trim();
  const candidates = [
    ...(override === "" ? [] : [resolve(override)]),
    fileURLToPath(new URL("./injected.js", import.meta.url)),
    resolve(REPO_ROOT_DIR, "apps/runner/dist/record/injected.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `injected.js 를 찾지 못했습니다(${candidates.join(", ")}). ` +
      `\`yarn workspace @testflow/runner build\` 로 tsconfig.injected.json 을 빌드했는지 확인하세요.`,
  );
}

/* ────────────────────────────────────────────────────────────
 * 세션
 * ──────────────────────────────────────────────────────────── */

export class RecordingSession {
  readonly sessionId: string;
  readonly scenarioId: string;

  private readonly options: RecordingSessionOptions;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private screencast: ScreencastHandle | null = null;
  private input: InputBridge | null = null;
  private profileDir: string | null = null;

  private sink: SessionSink | null = null;
  private drafts: DraftStep[] = [];
  private lastActivityAtMs = Date.now();
  private lastActionAtMs = 0;
  private lastFrameSentAtMs = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private closing = false;
  private viewport: Viewport;

  private framesProduced = 0;
  private framesThrottled = 0;
  private framesSent = 0;
  private bytesSent = 0;

  constructor(options: RecordingSessionOptions) {
    this.options = options;
    this.sessionId = options.sessionId;
    this.scenarioId = options.scenarioId;
    this.viewport = { ...options.viewport };
  }

  /* ── 기동 ─────────────────────────────────────────────── */

  async open(): Promise<void> {
    const { config, startUrl } = this.options;
    // 실행(execute/browser.ts)과 같은 격리 방식 — 실행마다 새 프로필. 앞 세션의 로그인
    // 쿠키가 다음 녹화에 새지 않는다.
    this.profileDir = await mkdtemp(join(tmpdir(), `testflow-rec-${this.sessionId.slice(0, 8)}-`));
    const context = await chromium.launchPersistentContext(this.profileDir, {
      headless: config.headless,
      viewport: { width: this.viewport.w, height: this.viewport.h },
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    this.context = context;

    // ★ 페이지 → Node 단방향 채널. addInitScript 보다 먼저 등록해 둔다.
    await context.exposeBinding("__tfEmit", (_source, payload: unknown) => {
      this.onRecordedAction(payload);
    });
    // ★ 새 문서마다 자동 재주입된다 → 페이지 이동 후에도 리스너가 살아남는다.
    await context.addInitScript({ path: resolveInjectedScriptPath() });

    const page = context.pages()[0] ?? (await context.newPage());
    this.page = page;

    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.onNavigated(frame.url());
    });

    await this.startScreencast();
    this.input = await createInputBridge(page, {
      driver: "cdp",
      pageScaleProvider: () =>
        this.screencast?.getPageScale() ?? {
          pageScaleFactor: 1,
          scrollOffsetX: 0,
          scrollOffsetY: 0,
          offsetTop: 0,
        },
    });

    await this.markRunner();

    if (startUrl.trim() !== "") {
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((error: unknown) => {
        this.options.log(
          `세션 ${this.sessionId} 시작 URL 이동 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  }

  private async startScreencast(): Promise<void> {
    const page = this.page;
    if (!page) return;
    const limit = maxFrameRate();
    const minIntervalMs = limit > 0 ? 1000 / limit : 0;

    this.screencast = await startScreencast(page, {
      // ★ size 생략 금지 — 미지정 시 800×800 으로 축소돼 좌표 변환이 통째로 깨진다.
      size: { width: this.viewport.w, height: this.viewport.h },
      quality: 60,
      trackPageScale: true,
      onFrame: (frame) => {
        this.framesProduced += 1;
        const now = Date.now();
        // ★ fps 상한. 넘치는 프레임은 **버린다**(큐에 쌓지 않는다).
        if (minIntervalMs > 0 && now - this.lastFrameSentAtMs < minIntervalMs) {
          this.framesThrottled += 1;
          return;
        }
        this.lastFrameSentAtMs = now;
        this.framesSent += 1;
        this.bytesSent += frame.data.byteLength;
        this.sink?.frame({
          data: frame.data,
          capturedAtMs: frame.capturedAtMs,
          viewportWidth: frame.viewportWidth,
          viewportHeight: frame.viewportHeight,
        });
      },
    });
  }

  /* ── 클라이언트 ───────────────────────────────────────── */

  attach(sink: SessionSink): void {
    this.sink = sink;
    this.touch();
  }

  detach(sink: SessionSink): void {
    if (this.sink === sink) this.sink = null;
  }

  get hasClient(): boolean {
    return this.sink !== null;
  }

  /** WS 로 들어온 C→S 메시지 1건. 유휴 타임아웃 시계는 여기서만 리셋된다. */
  async dispatch(message: RecorderClientMessage): Promise<void> {
    this.touch();
    if (message.t === "resize") {
      await this.resize({ w: message.w, h: message.h });
      return;
    }
    await this.input?.dispatch(message);
  }

  /** ★ 뷰포트 변경은 세션의 책임이다. screencast `size` 도 함께 바꿔야 좌표계가 맞는다. */
  private async resize(viewport: Viewport): Promise<void> {
    const page = this.page;
    if (!page) return;
    if (viewport.w === this.viewport.w && viewport.h === this.viewport.h) return;

    this.viewport = viewport;
    await page.setViewportSize({ width: viewport.w, height: viewport.h });
    await this.screencast?.stop().catch(() => undefined);
    this.screencast = null;
    await this.startScreencast();
    await this.options.dataSource
      .getRepository(RecordingSessionEntity)
      .update({ id: this.sessionId }, { viewportW: viewport.w, viewportH: viewport.h })
      .catch(() => undefined);
    this.options.log(`세션 ${this.sessionId} 뷰포트 변경 → ${String(viewport.w)}×${String(viewport.h)}`);
  }

  private touch(): void {
    this.lastActivityAtMs = Date.now();
  }

  /* ── 행동 수집 ────────────────────────────────────────── */

  /**
   * `injected.js` 의 `__tfEmit` 진입점.
   *
   * ★ 여기서 payload 를 **절대 통째로 로그에 찍지 않는다.** 비밀번호 필드는 값을 보내지 않지만
   *   일반 입력값(이메일 등 개인정보)은 들어 있다.
   */
  private onRecordedAction(payload: unknown): void {
    if (!isRecordedAction(payload)) return;
    this.lastActionAtMs = Date.now();
    this.pushDraft(payload);
  }

  private onNavigated(url: string): void {
    this.sink?.message({ t: "nav", url });
    // 클릭/Enter 직후의 이동은 그 클릭의 **결과**다. `goto` 스텝을 겹쳐 만들면 재생 시
    // "클릭 → 이동" 이 두 번 일어난다.
    if (Date.now() - this.lastActionAtMs < NAV_AFTER_ACTION_MS) return;
    this.pushDraft({ kind: "goto", url: this.toPortableUrl(url), at: Date.now() });
  }

  /**
   * 시작 URL 과 같은 origin 이면 `{{baseUrl}}` 로 바꿔 둔다.
   * 그래야 같은 시나리오를 다른 환경(스테이징/운영)에 그대로 돌릴 수 있다 —
   * `interpreter.ts` 의 `resolveGotoUrl` 이 실행 시점의 `baseUrl` 로 되돌린다.
   */
  private toPortableUrl(url: string): string {
    try {
      const target = new URL(url);
      const base = new URL(this.options.startUrl);
      if (target.origin !== base.origin) return url;
      return `{{baseUrl}}${target.pathname}${target.search}`;
    } catch {
      return url;
    }
  }

  private pushDraft(event: RecordedEvent): void {
    const draft = toDraftStep(event);
    if (draft === null) return;

    const next = mergeConsecutiveFills([...this.drafts, draft]);
    const replaced = next.length === this.drafts.length;
    this.drafts = next;
    this.dirty = true;

    const index = this.drafts.length - 1;
    this.sink?.message({ t: "step", step: this.drafts[index], index });
    this.options.log(
      `세션 ${this.sessionId} 초안 ${replaced ? "갱신" : "추가"} #${String(index + 1)} ` +
        `(${draft.actionType}) — 총 ${String(this.drafts.length)}건`,
    );

    this.scheduleFlush();
  }

  /* ── 초안 영속화 ──────────────────────────────────────── */

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
    this.flushTimer.unref();
  }

  /** `recording_sessions.draft_steps` 갱신. 실패해도 세션을 죽이지 않는다(다음 초안에서 재시도). */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.options.dataSource
        .getRepository(RecordingSessionEntity)
        .update({ id: this.sessionId }, { draftSteps: DraftStepsSchema.parse(this.drafts) });
    } catch (error) {
      this.dirty = true;
      this.options.log(
        `세션 ${this.sessionId} 초안 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async markRunner(): Promise<void> {
    await this.options.dataSource
      .getRepository(RecordingSessionEntity)
      .update({ id: this.sessionId }, { runnerId: this.options.config.runnerId })
      .catch(() => undefined);
  }

  /* ── 종료 ─────────────────────────────────────────────── */

  /** 유휴 판정. ws-server 의 청소 타이머가 주기적으로 묻는다. */
  isIdle(now = Date.now()): boolean {
    return now - this.lastActivityAtMs > idleTimeoutMs();
  }

  stats(): {
    drafts: number;
    framesProduced: number;
    framesThrottled: number;
    framesSent: number;
    bytesSent: number;
  } {
    return {
      drafts: this.drafts.length,
      framesProduced: this.framesProduced,
      framesThrottled: this.framesThrottled,
      framesSent: this.framesSent,
      bytesSent: this.bytesSent,
    };
  }

  draftSteps(): readonly DraftStep[] {
    return this.drafts;
  }

  /**
   * 브라우저를 접고 세션 상태를 확정한다.
   *
   * - `stopped`  — 테스터가 `POST .../stop` 을 눌렀다. 초안은 API 가 이미 읽어 갔다.
   * - `disposed` — `DELETE`. 초안을 버린다(상태는 `stopped`).
   * - `expired`  — 유휴 타임아웃. **초안은 남긴다** (테스터가 잠깐 자리를 비운 것뿐일 수 있다).
   */
  async close(reason: SessionEndReason): Promise<void> {
    if (this.closing) return;
    this.closing = true;

    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (reason !== "disposed") await this.flush();

    await this.screencast?.stop().catch(() => undefined);
    await this.input?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    if (this.profileDir !== null) {
      await rm(this.profileDir, { recursive: true, force: true }).catch(() => undefined);
    }

    const status = reason === "expired" || reason === "error" ? "expired" : "stopped";
    await this.options.dataSource
      .getRepository(RecordingSessionEntity)
      .update({ id: this.sessionId }, { status, stoppedAt: new Date() })
      .catch(() => undefined);

    this.options.log(
      `세션 ${this.sessionId} 종료(${reason} → ${status}) — 초안 ${String(this.drafts.length)}건, ` +
        `프레임 ${String(this.framesSent)}/${String(this.framesProduced)} 송출`,
    );
    this.sink = null;
  }
}

export const IDLE_CHECK_MS = IDLE_CHECK_INTERVAL_MS;

/* ────────────────────────────────────────────────────────────
 * payload 검증 — 페이지에서 오는 값은 전부 신뢰하지 않는다
 * ──────────────────────────────────────────────────────────── */

const KINDS = new Set(["click", "fill", "select", "check", "uncheck", "press"]);

function isRecordedAction(value: unknown): value is RecordedAction {
  if (value === null || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  if (typeof action["kind"] !== "string" || !KINDS.has(action["kind"])) return false;
  const target = action["target"];
  if (target === null || typeof target !== "object") return false;
  return (target as Record<string, unknown>)["primary"] !== undefined;
}
