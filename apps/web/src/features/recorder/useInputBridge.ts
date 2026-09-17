import { useCallback, useEffect, useRef } from "react";
import type * as React from "react";
import type { RecorderClientMessage } from "@testflow/contracts";
import { toRemotePoint, type RemoteViewport } from "./frame";

/**
 * 캔버스 입력 → 원격 브라우저 역주입 (Task 10.6).
 *
 * PoC-1 `poc/client/index.html` 의 `toRemote()` + 리스너 묶음을 승격한 것이다.
 * 좌표 공식 본체는 `frame.ts`(`toRemotePoint`) 에 있고 단위 테스트가 붙어 있다.
 *
 * ★ 마우스 이동은 30ms 스로틀. 원격은 60fps 로 move 를 받아 봐야 쓸모가 없고,
 *   스로틀이 없으면 이동만으로 소켓이 밀려 클릭이 늦는다.
 *
 * ★ `wheel` 은 React 합성 이벤트로 `preventDefault()` 가 되지 않는다(루트에 passive 로
 *   붙는다). 그래서 이 이벤트만 `addEventListener(..., {passive:false})` 로 직접 단다.
 */

const MOUSE_MOVE_THROTTLE_MS = 30;

export type SendInput = (message: RecorderClientMessage) => boolean;

export type CanvasMouseHandlers = {
  onMouseMove: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseDown: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLCanvasElement>) => void;
};

export type UseInputBridgeOptions = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  remote: RemoteViewport;
  send: SendInput;
  /** 녹화 중이 아닐 때는 아무것도 보내지 않는다. */
  enabled: boolean;
  /**
   * 캔버스를 누른 순간 호출된다. IME 브리지의 숨은 입력란에 포커스를 옮기는 용도.
   * (`mousedown` 에서 `preventDefault` 하므로 브라우저 기본 포커스 이동이 일어나지 않는다.)
   */
  onPress?: () => void;
};

export function useInputBridge({
  canvasRef,
  remote,
  send,
  enabled,
  onPress,
}: UseInputBridgeOptions): CanvasMouseHandlers {
  const lastMoveAtRef = useRef(0);

  /**
   * ★ 값(remote/enabled/send)을 ref 에 담아 두지 않고 **의존성으로 받는다.**
   *   렌더 중 ref 쓰기는 react-hooks 규칙 위반이고, 여기서는 굳이 필요하지도 않다 —
   *   이 핸들러들은 DOM 에 직접 붙는 props 라 정체성이 바뀌어도 리바인딩뿐이다.
   *   (정체성 고정이 꼭 필요한 곳은 WS effect 하나뿐이고 거기서만 ref 를 쓴다.)
   */
  const remoteW = remote.w;
  const remoteH = remote.h;

  /** 이벤트의 화면 좌표 → 원격 뷰포트 좌표. `getBoundingClientRect()` 를 매번 다시 잰다. */
  const point = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (canvas === null) return null;
      // ★ rect.width 로 나눈다 — canvas.width 가 아니다 (frame.ts 주석).
      return toRemotePoint(clientX, clientY, canvas.getBoundingClientRect(), {
        w: remoteW,
        h: remoteH,
      });
    },
    [canvasRef, remoteH, remoteW],
  );

  const onMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!enabled) return;
      const now = performance.now();
      if (now - lastMoveAtRef.current < MOUSE_MOVE_THROTTLE_MS) return;
      lastMoveAtRef.current = now;

      const p = point(event.clientX, event.clientY);
      if (p === null) return;
      send({
        t: "mouse",
        kind: "move",
        x: p.x,
        y: p.y,
        button: "left",
        clickCount: 0,
        modifiers: 0,
      });
    },
    [enabled, point, send],
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      onPress?.();
      if (!enabled) return;
      const p = point(event.clientX, event.clientY);
      if (p === null) return;
      send({
        t: "mouse",
        kind: "down",
        x: p.x,
        y: p.y,
        button: "left",
        clickCount: event.detail > 0 ? event.detail : 1,
        modifiers: 0,
      });
    },
    [enabled, onPress, point, send],
  );

  const onMouseUp = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      if (!enabled) return;
      const p = point(event.clientX, event.clientY);
      if (p === null) return;
      send({
        t: "mouse",
        kind: "up",
        x: p.x,
        y: p.y,
        button: "left",
        clickCount: event.detail > 0 ? event.detail : 1,
        modifiers: 0,
      });
    },
    [enabled, point, send],
  );

  const onMouseLeave = useCallback(() => {
    lastMoveAtRef.current = 0;
  }, []);

  const onContextMenu = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    // 원격 화면 위에서 로컬 컨텍스트 메뉴가 뜨면 조작이 끊긴다.
    event.preventDefault();
  }, []);

  /** wheel 만 네이티브 리스너다 — `preventDefault()` 가 필요하기 때문(위 주석). */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!enabled) return;
      const p = toRemotePoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), {
        w: remoteW,
        h: remoteH,
      });
      send({
        t: "wheel",
        x: p.x,
        y: p.y,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [canvasRef, enabled, remoteH, remoteW, send]);

  return { onMouseMove, onMouseDown, onMouseUp, onMouseLeave, onContextMenu };
}
