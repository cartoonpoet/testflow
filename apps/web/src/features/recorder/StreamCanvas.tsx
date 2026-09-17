import type * as React from "react";
import { cn } from "cn";
import type { RemoteViewport } from "./frame";
import type { CanvasMouseHandlers } from "./useInputBridge";
import type { ImeInputHandlers } from "./useImeBridge";

/**
 * 원격 브라우저 화면 (Task 10.5).
 *
 * 렌더 루프(프레임 드롭 포함)는 `useFrameRenderer` 가 갖고 있고, 이 컴포넌트는
 * **캔버스 한 장 + 숨은 IME 입력란**을 놓는 표시 계층이다. 그래야 배율·레이아웃을
 * 바꿔도 렌더 루프를 건드리지 않는다.
 *
 * ★ 캔버스의 `width`/`height` **속성**은 원격 뷰포트 해상도(1280×800)이고,
 *   **CSS 표시 크기**는 배율에 따라 다르다. 좌표 변환은 **CSS 크기**를 쓴다.
 */

/** 배율 선택지. `"fit"` 은 패널 폭에 맞춘다. */
export const CANVAS_SCALES = ["fit", "0.7", "1", "1.3"] as const;
export type CanvasScale = (typeof CANVAS_SCALES)[number];

export const CANVAS_SCALE_LABEL = {
  fit: "화면 맞춤",
  "0.7": "70%",
  "1": "100%",
  "1.3": "130%",
} as const satisfies Record<CanvasScale, string>;

/** 배율 → CSS 표시 폭. `tf-stream-canvas` 에 `--tf-canvas-width` 로 넘어간다. */
export function canvasCssWidth(scale: CanvasScale, remote: RemoteViewport): string {
  if (scale === "fit") return "100%";
  return `${String(Math.round(remote.w * Number(scale)))}px`;
}

export type StreamCanvasProps = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  remote: RemoteViewport;
  scale: CanvasScale;
  mouse: CanvasMouseHandlers;
  /**
   * 숨은 IME 입력란에 붙일 콜백 ref 와 핸들러.
   * `ImeBridge` 객체를 통째로 받아 `ime.attachInput` 처럼 쓰면 react-hooks 규칙이
   * "렌더 중 ref 접근"으로 본다. 그래서 **평평한 props 두 개**로 받는다.
   */
  attachImeInput: (element: HTMLInputElement | null) => void;
  imeHandlers: ImeInputHandlers;
  /** 녹화 중인지. 아니면 캔버스를 흐리게 하고 안내를 덮는다. */
  live: boolean;
  /** 연결 중·대기 중에 캔버스 위에 띄울 안내. */
  overlay?: React.ReactNode;
};

export function StreamCanvas({
  canvasRef,
  remote,
  scale,
  mouse,
  attachImeInput,
  imeHandlers,
  live,
  overlay,
}: StreamCanvasProps) {
  return (
    <div
      data-slot="stream-canvas"
      className="relative overflow-auto rounded-step border border-line bg-browser"
    >
      <canvas
        ref={canvasRef}
        width={remote.w}
        height={remote.h}
        aria-label="원격 브라우저 화면"
        data-testid="stream-canvas"
        data-live={live ? "true" : "false"}
        className={cn("tf-stream-canvas", live ? "" : "opacity-60")}
        style={{ "--tf-canvas-width": canvasCssWidth(scale, remote) } as React.CSSProperties}
        {...mouse}
      />

      {/*
        ★ 보이지 않는 IME 입력란 (A안).
        `display:none` 이면 포커스를 받을 수 없어 IME 가 붙지 않는다. 그래서 1px·투명이다.
        값은 조합이 끝나는 즉시 비운다(`useImeBridge` 주석 — 비밀번호가 DOM 에 남지 않게).
      */}
      <input
        ref={attachImeInput}
        type="text"
        data-testid="ime-input"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="pointer-events-none absolute left-0 top-0 h-[1px] w-[1px] border-0 bg-transparent p-0 opacity-0 outline-none"
        {...imeHandlers}
      />

      {overlay == null ? null : (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-[20px]">
          {overlay}
        </div>
      )}
    </div>
  );
}
