/**
 * 실행 라이브 스트림 세션 레지스트리 + 상태 기계 (03-phases Task 4.3).
 *
 * ## 무엇이 녹화와 공유되고 무엇이 분리되는가 (쟁점 3)
 * | | 녹화 `/rec/:sessionId` | 실행 `/live/:runId` |
 * |---|---|---|
 * | WS 서버·포트 (`RUNNER_WS_PORT`) | 공유 | 공유 |
 * | 프레임 봉투 25바이트 (`encodeFrame`) | 공유 | 공유 |
 * | 백프레셔 드롭 상한 (`MAX_BUFFERED_BYTES`) | 공유 | 공유 |
 * | 15fps 스로틀 (`maxFrameRate()`) | 공유 | 공유 |
 * | **세션 레지스트리** | `RecordingSession` | **이 파일** |
 * | **Redis 토큰 키 공간** | `testflow:rec:token:` | **`testflow:run:token:`** |
 * | C→S 입력 | `input-bridge` 로 역주입 | **없다 — 단방향** |
 *
 * 공유하는 네 가지를 복사하지 않는 이유: 두 벌이 되는 순간 둘이 어긋나고,
 * 어긋나면 **한쪽 화면만 조용히 깨진다**(디코더가 같은 봉투를 기대하기 때문이다).
 *
 * ## ★ 상태 기계 — `between-tests` 판정을 "프레임 공백"으로 하지 않는 이유
 * PoC 는 전환 구간을 "page 닫힘 ~ 새 page 첫 프레임"으로 관측했다. 그것을
 * **"마지막 프레임 이후 N ms 동안 프레임 없음"** 으로 근사하면 **틀린다** —
 * screencast 는 화면이 변할 때만 프레임을 내므로 **가만히 있는 페이지는 프레임이 0장**이다.
 * (`page.waitForTimeout(3000)` 중인 정상 테스트가 "다음 테스트 준비 중"으로 표시된다.)
 *
 * 그래서 판정 기준을 **부착된 page 수**로 둔다 — 그것이 전환 구간의 정의 그대로다.
 * ```
 *  attachedPages === 0                        → between-tests   ("다음 테스트 준비 중")
 *  attachedPages > 0 이고 프레임을 한 장 받음  → live
 *  실행 종료                                   → ended (+ runStatus)
 * ```
 * page 가 붙었지만 첫 프레임이 아직 안 온 구간도 `between-tests` 다 — 사용자가 보는 것이
 * "아직 화면이 없다"라는 점에서 같기 때문이다.
 *
 * ## ★ 종료 시 캔버스를 비우지 않는다
 * `{t:"state", state:"ended"}` 를 보내고 **`LIVE_STREAM_ENDED_LINGER_MS` 뒤에 close 1000**
 * (정상 종료)한다. 비정상 close code 를 주면 웹의 close 분류가 "오류"로 읽고 화면을 지운다.
 * 마지막 프레임은 **실패 직전 화면**이라 정보가 가장 많다(쟁점 3).
 *
 * ## ★★ 라운드 4 — 늦게 붙은 뷰어에게 **첫 프레임을 보장**한다
 * `page.screencast` 는 **변경분만** 송출한다(04-gen-3 실측 기록). 화면이 정지한 순간
 * (assertion 대기·`waitForTimeout`)에 새 뷰어가 붙으면 **프레임이 한 장도 오지 않는다** —
 * 실행 중인데도 캔버스가 검은 채로 남는다. 실측으로 확인된 버그다.
 *
 * 두 겹으로 막는다:
 *  1. **마지막 프레임 캐시** — 세션이 최근 JPEG **1장**(수십 KB)을 들고 있다가 `attach()`
 *     즉시 보낸다. 비용이 0 이고 화면에 개입하지 않는다.
 *  2. **키프레임 강제 캡처** — 캐시가 비었을 때만(= 이 page 의 첫 프레임이 아직 없을 때)
 *     `keyframeProvider` 로 CDP `Page.captureScreenshot` 을 1회 요청한다. 실행 중인 페이지에
 *     개입하는 비용이 있어 **캐시가 비었을 때만** 쓴다(조합 전략).
 *
 * ## ★★ 라운드 4 — sink 1개 제약을 풀었다 (다중 뷰어)
 * 04-gen-4 결정 7은 "최신이 이긴다"(sink 1개)였다. 두 탭에서 같은 run 을 열면 **먼저 연 탭이
 * 끊긴다.** 관전이 실제 요구가 됐으므로 `Set<LiveStreamSink>` 브로드캐스트로 바꿨다.
 * 프레임 1장을 N 개 소켓에 `send` 할 뿐이고, **백프레셔 판단은 여전히 소켓별**이다
 * (`ws-server.ts` 가 각자 `bufferedAmount` 를 본다) — 느린 뷰어가 빠른 뷰어를 끌어내리지 않는다.
 */
import type { LiveStreamServerMessage, LiveStreamState, RunStatus } from "@testflow/contracts";

/**
 * `ended` 메시지를 보낸 뒤 소켓을 정상 종료(1000)하기까지 기다리는 시간.
 *
 * 0 으로 두면 `send()` 직후 `close()` 가 같은 tick 에 큐잉되는데, `ws` 는 그래도 순서를
 * 지켜 flush 하므로 이론상 안전하다. 그럼에도 여유를 두는 이유는 **클라이언트 쪽**이다 —
 * 마지막 프레임의 JPEG 디코드(`createImageBitmap`)가 비동기라, 프레임 직후 close 가 오면
 * 디코드 완료 전에 `onclose` 핸들러가 먼저 뛰어 "연결 종료" 화면 전환이 마지막 프레임을
 * 앞지른다. 1.5초는 15fps 프레임 간격(66ms)의 20배 이상이라 그 경합이 남지 않는다.
 */
export const LIVE_STREAM_ENDED_LINGER_MS = 1_500;

/** 프레임 1장. `record/ws-server.ts` 의 `encodeFrame()` 인자와 같은 모양이다. */
export interface LiveStreamFrame {
  readonly data: Buffer;
  readonly capturedAtMs: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/**
 * 뷰어 소켓 쪽 어댑터. WS 서버가 구현한다.
 *
 * ★ `frame` 은 **동기**이고 아무것도 돌려주지 않는다 — 백프레셔 드롭은 소켓을 아는
 *   쪽(`ws-server.ts`)만 판단할 수 있다. 여기서 큐를 만들면 드롭 정책이 두 벌이 된다.
 */
export interface LiveStreamSink {
  frame(frame: LiveStreamFrame): void;
  message(message: LiveStreamServerMessage): void;
  /** **정상 종료(1000)**. 마지막 프레임은 클라이언트 캔버스에 그대로 남는다. */
  finish(): void;
}

export interface LiveStreamStats {
  state: LiveStreamState;
  attachedPages: number;
  framesForwarded: number;
  framesDroppedNoViewer: number;
  ended: boolean;
  viewerCount: number;
  /** ★ 캐시된 마지막 프레임을 그대로 보내 준 횟수(늦게 붙은 뷰어 수와 같다). */
  cachedFramesReplayed: number;
  /** ★ 캐시가 비어 CDP 캡처를 요청한 횟수. */
  keyframesRequested: number;
  /** 그중 실제로 프레임을 얻은 횟수. */
  keyframesDelivered: number;
}

/**
 * 캐시가 비었을 때 **지금 화면 1장**을 만들어 주는 공급자. `code-browser.ts` 가 꽂는다.
 *
 * 없거나(`null`) 붙은 page 가 없으면 `null` 을 돌려준다 — 그때는 진짜로 보여 줄 화면이 없다
 * (`between-tests`). 실패해도 **던지지 않는다**: 라이브는 실행의 전제가 아니다.
 */
export type LiveKeyframeProvider = () => Promise<LiveStreamFrame | null>;

/**
 * 키프레임 캡처를 이 간격보다 자주 하지 않는다.
 *
 * 뷰어 여러 개가 동시에 붙으면(새로고침 연타·두 탭 동시 열기) 같은 화면을 여러 번 찍게 된다.
 * `Page.captureScreenshot` 은 실행 중인 페이지의 렌더러를 잠깐 쓰므로 공짜가 아니다.
 * 이 간격 안의 요청은 **직전 결과(= 캐시)** 로 답한다.
 */
export const LIVE_KEYFRAME_MIN_INTERVAL_MS = 700;

/**
 * run 1건의 스트림 세션.
 *
 * 수명은 **실행 수명과 같다** — `code-executor` 가 열고 닫는다. 뷰어는 그 안에서 붙었다
 * 떨어진다(뷰어가 없어도 세션은 살아 있고, 프레임은 버려진다).
 */
export class LiveStreamSession {
  private readonly sinks = new Set<LiveStreamSink>();
  private state: LiveStreamState = "between-tests";
  private attachedPages = 0;
  private sawFrameOnCurrentPage = false;
  private ended = false;
  private endedStatus: RunStatus | null = null;
  private lingerTimer: NodeJS.Timeout | null = null;
  private framesForwarded = 0;
  private framesDroppedNoViewer = 0;

  /**
   * ★ 마지막으로 흘려보낸 프레임 1장. **늦게 붙은 뷰어의 첫 화면**이 된다.
   *
   * 메모리는 JPEG 한 장(q60·1280×800 실측 20~60KB)뿐이고 세션당 1개다. 프레임이 올 때마다
   * 덮어쓰므로 누적되지 않는다.
   */
  private lastFrame: LiveStreamFrame | null = null;
  private keyframeProvider: LiveKeyframeProvider | null = null;
  /** 진행 중인 캡처. 뷰어 N 명이 동시에 붙어도 캡처는 1회다. */
  private keyframeInFlight: Promise<void> | null = null;
  private lastKeyframeAtMs = 0;
  private cachedFramesReplayed = 0;
  private keyframesRequested = 0;
  private keyframesDelivered = 0;

  constructor(readonly runId: string) {}

  /* ── 뷰어 ─────────────────────────────────────────────── */

  /**
   * ★ 키프레임 공급자를 꽂는다(`code-browser.ts`). 없으면 캐시만으로 동작한다 —
   * 그 경우에도 "정지 화면 + 캐시 있음"은 즉시 보인다.
   */
  setKeyframeProvider(provider: LiveKeyframeProvider | null): void {
    this.keyframeProvider = provider;
  }

  /**
   * 뷰어를 붙인다. **여러 명이 동시에 붙을 수 있다**(라운드 4 — sink 1개 제약 해제).
   * 기존 뷰어를 끊지 않는다: 두 탭에서 같은 run 을 열면 **둘 다** 본다.
   *
   * 붙는 즉시 세 가지를 준다 —
   *  ① 현재 상태 메시지(첫 프레임 전에도 오버레이가 맞는다),
   *  ② 캐시된 마지막 프레임(있으면) — **이 한 줄이 "늦게 접속해도 즉시 보인다"의 전부다**,
   *  ③ 캐시가 없으면 키프레임 캡처 요청(비동기. page 가 없으면 아무 일도 일어나지 않는다).
   */
  attach(sink: LiveStreamSink): void {
    this.sinks.add(sink);
    sink.message({
      t: "state",
      state: this.state,
      ...(this.endedStatus === null ? {} : { runStatus: this.endedStatus }),
    });

    const cached = this.lastFrame;
    if (cached !== null) {
      this.cachedFramesReplayed += 1;
      sink.frame(cached);
    } else if (!this.ended) {
      this.requestKeyframe();
    }

    if (this.ended) this.scheduleFinish();
  }

  detach(sink: LiveStreamSink): void {
    this.sinks.delete(sink);
  }

  get viewerCount(): number {
    return this.sinks.size;
  }

  /* ── page 수명 (code-browser 가 호출한다) ─────────────── */

  pageAttached(): void {
    this.attachedPages += 1;
    this.sawFrameOnCurrentPage = false;
    /*
     * ★ 새 page 가 붙었는데 그 화면이 정지해 있으면 screencast 가 프레임을 내지 않는다.
     *   보고 있던 뷰어는 **이전 테스트의 마지막 화면**에 멈춘 채로 남는다.
     *   그래서 뷰어가 있을 때만 키프레임을 한 장 당겨 온다(없으면 비용을 치르지 않는다).
     */
    if (this.sinks.size > 0 && !this.ended) this.requestKeyframe();
  }

  pageDetached(): void {
    this.attachedPages = Math.max(0, this.attachedPages - 1);
    if (this.attachedPages === 0) {
      this.sawFrameOnCurrentPage = false;
      // ★ 전환 구간의 시작. 이 신호가 없으면 사용자는 "멈췄다"로 오인한다.
      this.setState("between-tests");
    }
  }

  /* ── 프레임 ───────────────────────────────────────────── */

  pushFrame(frame: LiveStreamFrame): void {
    if (this.ended) return;
    // ★ 뷰어가 없어도 캐시는 채운다 — 다음에 붙는 뷰어의 첫 화면이 여기서 나온다.
    this.lastFrame = frame;
    if (!this.sawFrameOnCurrentPage) {
      this.sawFrameOnCurrentPage = true;
      this.setState("live");
    }
    if (this.sinks.size === 0) {
      this.framesDroppedNoViewer += 1;
      return;
    }
    this.framesForwarded += 1;
    // 백프레셔 판단은 소켓별이다(`ws-server.ts`). 느린 뷰어가 빠른 뷰어를 끌어내리지 않는다.
    for (const sink of [...this.sinks]) sink.frame(frame);
  }

  /* ── 오류 / 종료 ──────────────────────────────────────── */

  /**
   * 뷰어에게만 알린다. **실행에는 영향을 주지 않는다** — 라이브는 관찰 수단이지
   * 실행의 전제가 아니다(Task 4.4 규칙).
   */
  error(code: string, message: string): void {
    this.broadcast({ t: "error", code, message: message.slice(0, 300) });
  }

  /**
   * 실행이 끝났다. **소켓을 즉시 닫지 않는다** — `ended` 를 보내고 마지막 프레임을 남긴 채
   * 잠시 뒤 정상 종료(1000)한다.
   */
  end(runStatus: RunStatus): void {
    if (this.ended) return;
    this.ended = true;
    this.endedStatus = runStatus;
    this.state = "ended";
    this.broadcast({ t: "state", state: "ended", runStatus });
    this.scheduleFinish();
  }

  /**
   * 레지스트리에서 내려갈 때.
   *
   * ★ `end()` 를 이미 거쳤고 linger 가 돌고 있으면 **건드리지 않는다.** 여기서 소켓을 닫으면
   *   `ended` 메시지·마지막 프레임과 close 가 같은 tick 에 몰려 클라이언트가 마지막 프레임을
   *   그리기 전에 종료 처리를 한다(= 화면이 검게 죽는다). run 이 끝나자마자 레지스트리에서
   *   내려가는 것이 정상 경로이므로, 이 분기가 사실상 기본 경로다.
   */
  dispose(): void {
    this.keyframeProvider = null;
    if (this.ended && this.lingerTimer !== null) return;
    if (this.lingerTimer !== null) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    this.finishAll();
  }

  stats(): LiveStreamStats {
    return {
      state: this.state,
      attachedPages: this.attachedPages,
      framesForwarded: this.framesForwarded,
      framesDroppedNoViewer: this.framesDroppedNoViewer,
      ended: this.ended,
      viewerCount: this.viewerCount,
      cachedFramesReplayed: this.cachedFramesReplayed,
      keyframesRequested: this.keyframesRequested,
      keyframesDelivered: this.keyframesDelivered,
    };
  }

  /** 테스트·진단용. 캐시가 채워졌는지만 본다(바이트는 노출하지 않는다). */
  hasCachedFrame(): boolean {
    return this.lastFrame !== null;
  }

  /* ── 내부 ─────────────────────────────────────────────── */

  private broadcast(message: LiveStreamServerMessage): void {
    for (const sink of [...this.sinks]) sink.message(message);
  }

  private finishAll(): void {
    for (const sink of [...this.sinks]) sink.finish();
    this.sinks.clear();
  }

  private setState(next: LiveStreamState): void {
    if (this.ended || this.state === next) return;
    this.state = next;
    this.broadcast({ t: "state", state: next });
  }

  /**
   * ★ 키프레임 1장을 당겨 온다. **동기로 돌려주지 않는다** — `attach()` 가 이것을 기다리면
   *   상태 메시지조차 늦어진다. 결과는 `pushFrame()` 을 통해 **모든 뷰어**에게 간다
   *   (그 과정에서 캐시도 채워지므로 다음 뷰어는 캡처 없이 즉시 본다).
   *
   * 실패·부재는 **조용히 넘긴다.** page 가 없으면 진짜로 보여 줄 화면이 없고, 그 사실은
   * `between-tests` 상태가 이미 말하고 있다.
   */
  private requestKeyframe(): void {
    const provider = this.keyframeProvider;
    if (provider === null || this.keyframeInFlight !== null) return;
    const now = Date.now();
    if (now - this.lastKeyframeAtMs < LIVE_KEYFRAME_MIN_INTERVAL_MS) return;
    this.lastKeyframeAtMs = now;
    this.keyframesRequested += 1;

    this.keyframeInFlight = provider()
      .then((frame) => {
        if (frame === null || this.ended) return;
        this.keyframesDelivered += 1;
        this.pushFrame(frame);
      })
      .catch(() => undefined)
      .finally(() => {
        this.keyframeInFlight = null;
      });
  }

  private scheduleFinish(): void {
    if (this.lingerTimer !== null) return;
    this.lingerTimer = setTimeout(() => {
      this.lingerTimer = null;
      this.finishAll();
    }, LIVE_STREAM_ENDED_LINGER_MS);
    this.lingerTimer.unref();
  }
}

/**
 * runId → 세션. **녹화 세션 레지스트리와 별개다**(쟁점 3 "분리되는 것").
 *
 * WS 서버가 `get()` 으로 읽고, `code-executor` 가 `open()`/`close()` 한다. 같은 프로세스에서
 * 도는 두 축(BullMQ Worker · WS 서버)이 이 Map 하나로 만난다 — 04-gen-7 의 녹화 세션과 같은 구조다.
 */
export class LiveStreamRegistry {
  private readonly sessions = new Map<string, LiveStreamSession>();

  open(runId: string): LiveStreamSession {
    const existing = this.sessions.get(runId);
    if (existing !== undefined) return existing;
    const session = new LiveStreamSession(runId);
    this.sessions.set(runId, session);
    return session;
  }

  get(runId: string): LiveStreamSession | undefined {
    return this.sessions.get(runId);
  }

  close(runId: string): void {
    const session = this.sessions.get(runId);
    if (session === undefined) return;
    this.sessions.delete(runId);
    session.dispose();
  }

  size(): number {
    return this.sessions.size;
  }

  closeAll(): void {
    for (const runId of [...this.sessions.keys()]) this.close(runId);
  }
}
