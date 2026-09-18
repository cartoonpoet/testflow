import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LiveStreamInfoSchema,
  LiveStreamServerMessageSchema,
  type LiveStreamInfo,
  type RunStatus,
} from "@testflow/contracts";
import { api, queryKeys } from "@/lib";
import { classifyClose, decodeFrame, type DecodedFrame } from "@/features/recorder";

/**
 * 실행 라이브 스트림 구독 (`WS /live/:runId`) — 라운드 2 Task 5.5.
 *
 * ## 접속 절차 (04-gen-4 §10 전달사항 그대로)
 * ```
 * GET /api/runs/:id/live → { wsUrl, expiresAt }     # 종료된 run 은 404
 * new WebSocket(wsUrl)                              # ?token= 이 이미 들어 있다
 * ```
 * 토큰은 **한 번 쓰고 버린다.** 다시 붙으려면 `GET …/live` 를 다시 불러야 한다
 * (키가 하나라 재발급 즉시 이전 토큰이 무효다). TTL 120초.
 *
 * ## 받는 것 — 두 종류뿐이다
 * - **바이너리**: 25바이트 봉투 + JPEG. `features/recorder/frame.ts` 디코더를 **무수정** 재사용한다.
 * - **텍스트**: `{t:"state", state, runStatus?}` · `{t:"error", code, message}`.
 *
 * ## ★ 보내는 것은 없다 — 단방향이다
 * `useInputBridge`/`useImeBridge` 를 붙이지 않는다. 코드 실행 화면은 **보기만** 한다.
 * 원격 조작을 허용하면 실행 중인 테스트가 깨진다(03-phases 쟁점 3).
 * 서버도 C→S 메시지를 파싱조차 하지 않는다(04-gen-4 §5.2).
 *
 * ## ★ `onopen` 이 떠도 안심하지 않는다
 * 4401(토큰)·4404(세션 없음)는 **핸드셰이크 성공 뒤 close** 로 온다(04-gen-7 규약).
 * 그래서 `onclose.code` 를 반드시 본다. `1000` 은 **정상**이다 — 오류로 분류해
 * 캔버스를 지우면 안 된다(실행이 끝난 화면이 검게 죽는다).
 *
 * ## 이펙트는 여기 한 곳에만 있다
 * 화면 컴포넌트에 WS 생명주기를 흩뿌리지 않는다(`useRunEvents` 와 같은 구조).
 */

/**
 * `between-tests` 오버레이를 **띄우기 전에 기다리는 시간**.
 *
 * 04-gen-4 실측상 테스트 경계의 전환 공백은 **0.1초 ~ 2.5초**다. 0.1초짜리를 그대로
 * 그리면 오버레이가 깜빡이기만 하고 읽히지 않는다. 그래서 이 시간만큼 이어질 때만 띄운다.
 *
 * ★ 단, **첫 프레임 전에는 즉시 띄운다.** 그 구간은 최대 15초(run 이 큐에 있는 동안)이고
 *   캔버스가 비어 있어 깜빡일 대상 자체가 없다 — 오히려 안 띄우면 "멈췄다"로 읽힌다.
 */
export const BETWEEN_TESTS_SHOW_DELAY_MS = 400;

/**
 * ★ 라운드 4 — 비정상 종료 뒤 **자동 재연결** 횟수 상한.
 *
 * 라운드 2는 자동 재시도를 전부 껐다. 근거는 "토큰이 1회용이고 재발급이 곧 이전 토큰
 * 무효화"였는데, 그 전제가 **라운드 4에서 바뀌었다** — 서버가 같은 run 의 토큰을 여러 개
 * 인정한다(`liveStreamTokenMemberKey`). 이제 재발급이 다른 탭을 끊지 않는다.
 *
 * 재연결이 필요한 이유는 실측 가능한 것이다: 실행이 **토큰 TTL(120초)보다 길면**
 * 그 사이 소켓이 한 번 끊겼을 때 사용자가 "다시 연결"을 누르기 전까지 화면이 영영 죽는다.
 * 상한을 두는 이유는 반대쪽이다 — 서버가 아예 없을 때 무한 재시도는 콘솔을 오류로 채운다.
 */
export const LIVE_RECONNECT_MAX_ATTEMPTS = 5;
/** 지수 백오프(1s → 2s → 4s → 8s → 10s 상한). 프레임 지연과 무관한 값이라 넉넉히 둔다. */
export const LIVE_RECONNECT_BASE_DELAY_MS = 1_000;
export const LIVE_RECONNECT_MAX_DELAY_MS = 10_000;

export type LiveStreamPhase =
  /** 코드 실행이 아니거나 이미 끝난 실행 — 스트림을 열지 않는다. */
  | "idle"
  /** 토큰 발급 · WS 핸드셰이크 중. */
  | "connecting"
  /** 프레임이 흐르는 중. */
  | "live"
  /** page 가 닫히고 다음 테스트의 page 를 기다리는 중. */
  | "between-tests"
  /** 실행 종료. **마지막 프레임을 그대로 두고** 배지만 덮는다. */
  | "ended"
  /** 라이브를 열 수 없다(토큰 거부 · 세션 없음 · CDP 부착 실패). 실행 자체와는 무관하다. */
  | "unavailable";

export type LiveStreamHandle = {
  phase: LiveStreamPhase;
  /** `ended` 와 함께 서버가 알려 준 최종 run 상태. */
  endedStatus: RunStatus | null;
  /** 화면에 그대로 보여 줄 한국어 사유. 서버 문구 또는 close code 분류 문구. */
  notice: string | null;
  /** 진단 속성(`data-live-connection`)에 그대로 싣는 값. */
  connection: "idle" | "connecting" | "open" | "closed";
  /** 프레임이 한 장이라도 캔버스에 그려졌는가. 마지막 프레임 유지 판정의 근거다. */
  hasFrame: boolean;
  /** 전환 오버레이를 실제로 띄울지(짧은 깜빡임 억제 뒤의 결과). */
  showBetweenTests: boolean;
  /** ★ 자동 재연결을 몇 번째 시도 중인가. 0 이면 재연결 중이 아니다. */
  reconnectAttempt: number;
  /** 토큰을 새로 받아 다시 붙는다. 자동 재연결과 같은 경로다. */
  retry: () => void;
};

type InternalState = {
  wsUrl: string | null;
  phase: LiveStreamPhase;
  endedStatus: RunStatus | null;
  notice: string | null;
  connection: "idle" | "connecting" | "open" | "closed";
  hasFrame: boolean;
  showBetweenTests: boolean;
};

const INITIAL: InternalState = {
  wsUrl: null,
  phase: "idle",
  endedStatus: null,
  notice: null,
  connection: "idle",
  hasFrame: false,
  showBetweenTests: false,
};

const CLOSE_NOTICE = {
  unauthorized:
    "라이브 화면에 접속할 권한이 없습니다. 실행 결과와 증적은 정상적으로 기록됩니다.",
  "session-gone":
    "라이브 화면을 열 수 없습니다. 실행이 이미 끝났거나 아직 시작되지 않았습니다. 실행이 끝나면 영상 증적으로 확인할 수 있습니다.",
  abnormal: "라이브 화면 연결이 끊겼습니다. 실행은 계속되며 결과와 증적은 그대로 기록됩니다.",
} as const;

export type LiveStreamOptions = {
  /** 코드 실행이고 아직 끝나지 않았을 때만 true. */
  enabled: boolean;
  /** 디코드된 프레임 1장. `useFrameRenderer().handleFrame` 을 그대로 넘긴다. */
  onFrame: (frame: DecodedFrame) => void;
};

export function useLiveStream(
  runId: string | undefined,
  options: LiveStreamOptions,
): LiveStreamHandle {
  const { enabled, onFrame } = options;
  const [state, setState] = useState<InternalState>(INITIAL);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  /**
   * 접속 정보. **캐시하지 않는다** — 토큰이 1회용이라 재사용하면 4401 이 난다.
   * 재시도는 사용자가 누를 때만(`retry`) 한다.
   */
  const info = useQuery({
    queryKey: queryKeys.runLive(runId ?? ""),
    queryFn: () =>
      api.get<LiveStreamInfo>(`/runs/${String(runId)}/live`, {
        schema: LiveStreamInfoSchema,
      }),
    enabled: enabled && runId !== undefined,
    retry: false,
    /*
     * ★ `staleTime: Infinity` — 자동 재조회가 곧 **새 토큰 발급**이고, 키가 하나라
     *   그 순간 지금 붙어 있는 소켓의 토큰이 무효가 된다(재검증은 없으므로 당장 끊기지는
     *   않지만 재접속이 막힌다). 재발급은 사용자가 `retry()` 를 누를 때만 한다.
     *   `gcTime: 0` 이라 화면을 떠나면 토큰 정보가 캐시에 남지 않는다.
     */
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  /*
   * ★ `enabled` 로 이 값을 막지 않는다. 실행이 끝나면(`enabled` → false) 쿼리는 멈추지만
   *   **소켓은 서버가 `ended` 를 보내고 1.5초 뒤 스스로 닫을 때까지 살아 있어야 한다.**
   *   여기서 끊으면 마지막 프레임 위에 덮을 상태 배지를 받지 못한다(03-phases 쟁점 3).
   */
  const wsUrl = info.data?.wsUrl ?? null;

  /* 프레임 핸들러는 렌더마다 새 함수다. 의존성에 넣으면 매 렌더 WS 를 다시 연다. */
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  /*
   * ★ 재연결에 필요한 최신 값들. **이펙트 의존성에 넣지 않는다** — `enabled` 가 바뀌었다고
   *   소켓을 다시 열면 실행이 끝나는 순간(`enabled` → false) `ended` 를 못 받는다(결정 2).
   */
  const refetch = info.refetch;
  const refetchRef = useRef(refetch);
  const enabledRef = useRef(enabled);
  const attemptRef = useRef(0);
  useEffect(() => {
    refetchRef.current = refetch;
    enabledRef.current = enabled;
  }, [refetch, enabled]);

  useEffect(() => {
    if (wsUrl === null) return;

    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";
    /** 첫 프레임에만 state 를 올린다 — 프레임마다 setState 하면 15fps 로 리렌더가 돈다. */
    let sawFrame = false;
    let betweenTimer: ReturnType<typeof setTimeout> | undefined;

    const clearBetweenTimer = () => {
      if (betweenTimer !== undefined) clearTimeout(betweenTimer);
      betweenTimer = undefined;
    };

    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    socket.onopen = () => {
      // 붙었으면 백오프를 처음으로 돌린다 — 다음 끊김은 다시 1초부터다.
      attemptRef.current = 0;
      setReconnectAttempt(0);
      /*
       * ★ `idle` 에 머물지 않는다 — 실측으로 발견한 구멍이다.
       *   run 이 **큐에 있는 동안**에는 핸드셰이크는 끝났지만 Runner 가 아직 세션을 열지
       *   않아 `{t:"state"}` 가 오지 않는다(서버는 최대 15초 기다린다). 그 구간 내내
       *   `phase` 가 `idle`("스트림을 열지 않았다")로 남아 진단 속성이 사실과 어긋났다.
       *   소켓이 열렸으면 최소한 "연결됨, 첫 신호 대기 중" = `connecting` 이다.
       */
      setState((prev) => ({
        ...prev,
        wsUrl,
        connection: "open",
        phase: prev.phase === "idle" ? "connecting" : prev.phase,
      }));
    };

    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeFrame(event.data);
        if (frame === null) return;
        onFrameRef.current(frame);
        if (!sawFrame) {
          sawFrame = true;
          setState((prev) => ({ ...prev, wsUrl, hasFrame: true }));
        }
        return;
      }
      if (typeof event.data !== "string") return;

      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = LiveStreamServerMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;

      if (message.t === "error") {
        /*
         * ★ 실행 실패가 아니다. 04-gen-4 §4 가 "프레임 0장 + status=passed" 를
         *   같은 실행에서 실측했다. 서버가 준 한국어 문구를 그대로 보여 준다.
         */
        setState((prev) => ({
          ...prev,
          wsUrl,
          phase: prev.hasFrame ? prev.phase : "unavailable",
          notice: message.message,
        }));
        return;
      }

      if (message.state === "live") {
        clearBetweenTimer();
        setState((prev) => ({
          ...prev,
          wsUrl,
          phase: "live",
          showBetweenTests: false,
          notice: null,
        }));
        return;
      }

      if (message.state === "between-tests") {
        clearBetweenTimer();
        // 첫 프레임 전이면 즉시, 그 뒤에는 깜빡임을 견디고 나서 띄운다(상수 주석 참조).
        const immediate = !sawFrame;
        setState((prev) => ({
          ...prev,
          wsUrl,
          phase: "between-tests",
          showBetweenTests: immediate,
        }));
        if (!immediate) {
          betweenTimer = setTimeout(() => {
            setState((prev) =>
              prev.phase === "between-tests" ? { ...prev, showBetweenTests: true } : prev,
            );
          }, BETWEEN_TESTS_SHOW_DELAY_MS);
        }
        return;
      }

      // state === "ended" — 캔버스를 **비우지 않는다**. 배지만 덮는다.
      clearBetweenTimer();
      setState((prev) => ({
        ...prev,
        wsUrl,
        phase: "ended",
        endedStatus: message.runStatus ?? null,
        showBetweenTests: false,
      }));
    };

    socket.onclose = (event: CloseEvent) => {
      clearBetweenTimer();
      const info_ = classifyClose(event.code, event.reason);

      /*
       * ★ 자동 재연결 — **실행이 아직 살아 있을 때만** 한다.
       *
       * `1000`(정상 종료)은 실행이 끝났다는 뜻이라 다시 붙지 않는다. 그 밖의 close 는
       * 네트워크·프록시·토큰 만료 후 재접속 실패 등인데, 실행이 계속되는 한 화면은
       * 돌아와야 한다. 토큰은 재발급으로 갱신되므로 **TTL 120초보다 긴 실행도 덮인다.**
       */
      const shouldReconnect =
        info_.kind !== "normal" &&
        enabledRef.current &&
        attemptRef.current < LIVE_RECONNECT_MAX_ATTEMPTS;
      if (shouldReconnect) {
        attemptRef.current += 1;
        const attempt = attemptRef.current;
        setReconnectAttempt(attempt);
        const delay = Math.min(
          LIVE_RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
          LIVE_RECONNECT_MAX_DELAY_MS,
        );
        reconnectTimer = setTimeout(() => {
          // 새 토큰을 받아 온다 → `wsUrl` 이 바뀌고 이 이펙트가 다시 돈다.
          void refetchRef.current();
        }, delay);
      }

      setState((prev) => ({
        ...prev,
        wsUrl,
        connection: "closed",
        showBetweenTests: false,
        // 1000 은 정상 종료다(`ended` 뒤 1.5초 linger). 이미 ended 면 그대로 둔다.
        phase:
          info_.kind === "normal"
            ? prev.phase === "ended"
              ? "ended"
              : prev.hasFrame
                ? "ended"
                : "unavailable"
            : prev.hasFrame
              ? "ended"
              : "unavailable",
        notice:
          info_.kind === "normal"
            ? prev.notice
            : shouldReconnect
              ? null
              : CLOSE_NOTICE[info_.kind],
      }));
    };

    return () => {
      clearBetweenTimer();
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      socket.onclose = null;
      socket.onmessage = null;
      socket.onopen = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "client navigated away");
      }
    };
  }, [wsUrl]);

  const retry = useCallback(() => {
    // 수동 재시도는 백오프를 처음으로 되돌린다(사용자가 명시적으로 다시 해 보라고 말한 것이다).
    attemptRef.current = 0;
    setReconnectAttempt(0);
    void refetch();
  }, [refetch]);

  /*
   * 파생 — 아직 이 wsUrl 의 상태가 아니면 "연결 중" 이다.
   * (이펙트 본문에서 동기 setState 를 하지 않기 위한 라운드 1 패턴 그대로.)
   */
  const settled = state.wsUrl === wsUrl && wsUrl !== null;
  if (wsUrl === null) {
    return {
      phase: info.isError ? "unavailable" : enabled ? "connecting" : "idle",
      endedStatus: null,
      notice: info.isError ? CLOSE_NOTICE["session-gone"] : null,
      connection: info.isError ? "closed" : enabled ? "connecting" : "idle",
      hasFrame: false,
      showBetweenTests: false,
      reconnectAttempt,
      retry,
    };
  }
  if (!settled) {
    return {
      phase: "connecting",
      endedStatus: null,
      notice: null,
      connection: "connecting",
      /*
       * ★ `hasFrame` 은 소켓이 아니라 **캔버스**의 성질이다 — 재연결하는 동안에도
       *   지금까지 그린 픽셀은 그대로 있다. 여기서 false 로 떨어뜨리면 재연결 1초 사이에
       *   캔버스가 숨고 "화면이 없습니다" 안내가 번쩍인다(라운드 2 버그와 같은 꼴).
       */
      hasFrame: state.hasFrame,
      showBetweenTests: false,
      reconnectAttempt,
      retry,
    };
  }
  return {
    phase: state.phase,
    endedStatus: state.endedStatus,
    notice: state.notice,
    connection: state.connection,
    hasFrame: state.hasFrame,
    showBetweenTests: state.showBetweenTests,
    reconnectAttempt,
    retry,
  };
}
