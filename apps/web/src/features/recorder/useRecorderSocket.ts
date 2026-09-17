import { useCallback, useEffect, useRef, useState } from "react";
import {
  RecorderServerMessageSchema,
  WS_CLOSE_SESSION_GONE,
  WS_CLOSE_UNAUTHORIZED,
  type DraftStep,
  type RecorderClientMessage,
} from "@testflow/contracts";
import { decodeFrame, type DecodedFrame } from "./frame";

/**
 * 녹화 WS 연결 (Runner 직결 — API 를 중계로 끼우지 않는다).
 *
 * ```
 * ws://<RUNNER_WS_HOST>:<RUNNER_WS_PORT>/rec/<sessionId>?token=<평문토큰>
 * ```
 * `wsUrl` 은 `POST /api/scenarios/:id/recordings` 응답에 **통째로** 들어 있다.
 * 클라이언트가 조립하지 않는다(nginx 뒤에서는 `RUNNER_WS_PUBLIC_URL` 로 모양이 달라진다).
 *
 * ★ **`onopen` 이 떠도 안심하면 안 된다.** 토큰 거부(4401)·세션 종료(4404) 는 둘 다
 *   **핸드셰이크가 성공한 뒤** close 로 통보된다(04-gen-7). `onclose` 의 `code` 를 반드시 본다.
 *
 * ★ 입력 백프레셔 — 소켓이 밀리면 **`mouse.move` 만** 버린다. 클릭·키는 절대 버리지 않는다.
 *   이동을 버리면 커서가 조금 튀지만, 클릭을 버리면 녹화 자체가 틀어진다.
 */

/** 이 이상 밀려 있으면 마우스 이동을 버린다. PoC-1 과 같은 값. */
export const INPUT_BACKPRESSURE_BYTES = 64 * 1024;

export type RecorderSocketStatus = "idle" | "connecting" | "open" | "closed";

export type RecorderSocketClose = {
  code: number;
  reason: string;
  /** 토큰 거부(4401) / 세션 없음(4404) / 그 밖의 비정상 종료인지. */
  kind: "unauthorized" | "session-gone" | "normal" | "abnormal";
};

export function classifyClose(code: number, reason: string): RecorderSocketClose {
  if (code === WS_CLOSE_UNAUTHORIZED) return { code, reason, kind: "unauthorized" };
  if (code === WS_CLOSE_SESSION_GONE) return { code, reason, kind: "session-gone" };
  if (code === 1000 || code === 1005) return { code, reason, kind: "normal" };
  return { code, reason, kind: "abnormal" };
}

export type RecorderSocketHandlers = {
  onFrame: (frame: DecodedFrame) => void;
  onStep: (step: DraftStep, index: number) => void;
  onNav?: (url: string) => void;
  onServerError?: (code: string, message: string) => void;
  onClose?: (info: RecorderSocketClose) => void;
};

export type RecorderSocket = {
  status: RecorderSocketStatus;
  /** 보냈으면 true. 소켓이 닫혔거나 백프레셔로 버렸으면 false. */
  send: (message: RecorderClientMessage) => boolean;
  /** 정상 종료(1000)로 닫는다. 서버는 이때 브라우저를 접지 않는다(유휴 타임아웃이 최종 방어선). */
  close: () => void;
};

export function useRecorderSocket(
  wsUrl: string | null,
  handlers: RecorderSocketHandlers,
): RecorderSocket {
  const socketRef = useRef<WebSocket | null>(null);

  /**
   * 상태는 **어떤 url 의 상태인지**까지 같이 들고 있는다.
   * 그래야 effect 본문에서 `setState("connecting")` 을 부르지 않고도
   * "새 세션은 아직 connecting" 을 **파생**으로 표현할 수 있다
   * (effect 안의 동기 setState 는 연쇄 렌더를 만든다 — react-hooks 규칙).
   */
  const [socketState, setSocketState] = useState<{
    url: string | null;
    status: RecorderSocketStatus;
  }>({ url: null, status: "idle" });

  /**
   * 핸들러는 렌더마다 새 함수다. effect 의존성에 넣으면 그때마다 WS 를 다시 연결한다
   * (= 녹화 세션이 계속 끊긴다). ref 로 최신 것만 가리키게 하고 effect 는 `wsUrl` 만 본다.
   * ref 쓰기는 **렌더 중이 아니라 effect 안에서** 한다.
   */
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (wsUrl === null) return;

    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    socket.onopen = () => {
      setSocketState({ url: wsUrl, status: "open" });
    };

    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeFrame(event.data);
        if (frame !== null) handlersRef.current.onFrame(frame);
        return;
      }
      if (typeof event.data !== "string") return;

      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      // 판별 필드가 `t` 인 discriminated union 이라 텍스트 메시지 3종만 여기로 갈린다.
      const parsed = RecorderServerMessageSchema.safeParse(raw);
      if (!parsed.success) return;

      const message = parsed.data;
      if (message.t === "step") handlersRef.current.onStep(message.step, message.index);
      else if (message.t === "nav") handlersRef.current.onNav?.(message.url);
      else if (message.t === "error") {
        handlersRef.current.onServerError?.(message.code, message.message);
      }
    };

    socket.onclose = (event: CloseEvent) => {
      setSocketState({ url: wsUrl, status: "closed" });
      socketRef.current = null;
      handlersRef.current.onClose?.(classifyClose(event.code, event.reason));
    };

    return () => {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onopen = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "client navigated away");
      }
      socketRef.current = null;
    };
  }, [wsUrl]);

  const send = useCallback((message: RecorderClientMessage): boolean => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    // ★ 밀릴 때 버리는 것은 이동뿐이다.
    if (
      message.t === "mouse" &&
      message.kind === "move" &&
      socket.bufferedAmount > INPUT_BACKPRESSURE_BYTES
    ) {
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const close = useCallback(() => {
    socketRef.current?.close(1000, "client stopped recording");
  }, []);

  const status: RecorderSocketStatus =
    wsUrl === null ? "idle" : socketState.url === wsUrl ? socketState.status : "connecting";

  return { status, send, close };
}
