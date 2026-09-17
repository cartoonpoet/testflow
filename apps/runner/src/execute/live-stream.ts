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
}

/**
 * run 1건의 스트림 세션.
 *
 * 수명은 **실행 수명과 같다** — `code-executor` 가 열고 닫는다. 뷰어는 그 안에서 붙었다
 * 떨어진다(뷰어가 없어도 세션은 살아 있고, 프레임은 버려진다).
 */
export class LiveStreamSession {
  private sink: LiveStreamSink | null = null;
  private state: LiveStreamState = "between-tests";
  private attachedPages = 0;
  private sawFrameOnCurrentPage = false;
  private ended = false;
  private endedStatus: RunStatus | null = null;
  private lingerTimer: NodeJS.Timeout | null = null;
  private framesForwarded = 0;
  private framesDroppedNoViewer = 0;

  constructor(readonly runId: string) {}

  /* ── 뷰어 ─────────────────────────────────────────────── */

  /**
   * 뷰어를 붙인다. **sink 는 1개다**(04-gen-7 이슈 4번과 같은 제약 — 관전 기능이 생기면
   * 그때 다중 sink 로 넓힌다). 새 뷰어가 오면 **최신이 이긴다** — 새로고침으로 만든
   * 두 번째 연결을 거부하면 이전 소켓이 아직 닫히지 않은 사이에 사용자가 화면을 못 본다.
   */
  attach(sink: LiveStreamSink): LiveStreamSink | null {
    const previous = this.sink;
    this.sink = sink;
    // 붙는 즉시 현재 상태를 알려 준다 — 그래야 첫 프레임 전에도 오버레이가 맞는다.
    sink.message({
      t: "state",
      state: this.state,
      ...(this.endedStatus === null ? {} : { runStatus: this.endedStatus }),
    });
    if (this.ended) this.scheduleFinish();
    return previous;
  }

  detach(sink: LiveStreamSink): void {
    if (this.sink === sink) this.sink = null;
  }

  get viewerCount(): number {
    return this.sink === null ? 0 : 1;
  }

  /* ── page 수명 (code-browser 가 호출한다) ─────────────── */

  pageAttached(): void {
    this.attachedPages += 1;
    this.sawFrameOnCurrentPage = false;
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
    if (!this.sawFrameOnCurrentPage) {
      this.sawFrameOnCurrentPage = true;
      this.setState("live");
    }
    const sink = this.sink;
    if (sink === null) {
      this.framesDroppedNoViewer += 1;
      return;
    }
    this.framesForwarded += 1;
    sink.frame(frame);
  }

  /* ── 오류 / 종료 ──────────────────────────────────────── */

  /**
   * 뷰어에게만 알린다. **실행에는 영향을 주지 않는다** — 라이브는 관찰 수단이지
   * 실행의 전제가 아니다(Task 4.4 규칙).
   */
  error(code: string, message: string): void {
    this.sink?.message({ t: "error", code, message: message.slice(0, 300) });
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
    this.sink?.message({ t: "state", state: "ended", runStatus });
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
    if (this.ended && this.lingerTimer !== null) return;
    if (this.lingerTimer !== null) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    this.sink?.finish();
    this.sink = null;
  }

  stats(): LiveStreamStats {
    return {
      state: this.state,
      attachedPages: this.attachedPages,
      framesForwarded: this.framesForwarded,
      framesDroppedNoViewer: this.framesDroppedNoViewer,
      ended: this.ended,
      viewerCount: this.viewerCount,
    };
  }

  /* ── 내부 ─────────────────────────────────────────────── */

  private setState(next: LiveStreamState): void {
    if (this.ended || this.state === next) return;
    this.state = next;
    this.sink?.message({ t: "state", state: next });
  }

  private scheduleFinish(): void {
    if (this.lingerTimer !== null) return;
    this.lingerTimer = setTimeout(() => {
      this.lingerTimer = null;
      this.sink?.finish();
      this.sink = null;
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
