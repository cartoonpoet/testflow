import { useCallback, useRef, useState } from "react";
import { DEFAULT_VIEWPORT } from "@testflow/contracts";
import type { DecodedFrame, RemoteViewport } from "./frame";

/**
 * 캔버스 렌더 루프 — PoC-1 `poc/client/index.html` 의 `pump()` 승격본.
 *
 * ★ **프레임 드롭 정책**이 이 훅의 존재 이유다.
 *   `createImageBitmap` 이 도는 동안 새 프레임이 오면 **대기 중이던 것을 버리고
 *   최신 1장만 남긴다.** 큐를 쌓으면 지연이 단조 증가해서, 손이 움직인 뒤 한참 있다가
 *   화면이 따라오는 상태가 된다(그리고 영원히 복구되지 않는다).
 *   "늦은 프레임"은 가치가 0 이고 **최신 프레임이 언제나 옳다.**
 *
 * 통계는 ref 에 쌓고 `STATS_PUBLISH_INTERVAL_MS` 마다만 state 로 올린다 —
 * 프레임마다 setState 하면 60fps 로 리렌더가 돈다.
 */

const STATS_PUBLISH_INTERVAL_MS = 500;

export type StreamStats = {
  /** WS 로 받은 프레임 수 */
  received: number;
  /** `drawImage` 까지 끝낸 프레임 수 */
  rendered: number;
  /** 렌더가 못 따라가서 버린 프레임 수 */
  droppedClient: number;
  bytes: number;
  /** capture → drawImage 완료 (ms). 서버와 같은 머신일 때만 의미가 있다. */
  lastLatencyMs: number | null;
  /** 최근 구간 실효 fps */
  fps: number;
};

const EMPTY_STATS: StreamStats = {
  received: 0,
  rendered: 0,
  droppedClient: 0,
  bytes: 0,
  lastLatencyMs: null,
  fps: 0,
};

export type FrameRenderer = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** 프레임 헤더가 알려 준 원격 뷰포트. 좌표 변환의 분자다. */
  remote: RemoteViewport;
  stats: StreamStats;
  /** WS 바이너리 수신 핸들러. */
  handleFrame: (frame: DecodedFrame) => void;
  /** 세션 종료 시 캔버스를 비우고 통계를 초기화한다. */
  reset: () => void;
};

export function useFrameRenderer(): FrameRenderer {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingRef = useRef<DecodedFrame | null>(null);
  const renderingRef = useRef(false);
  const remoteRef = useRef<RemoteViewport>({ w: DEFAULT_VIEWPORT.w, h: DEFAULT_VIEWPORT.h });
  const countersRef = useRef<StreamStats>({ ...EMPTY_STATS });
  const publishedAtRef = useRef(0);
  const windowRef = useRef({ startedAtMs: 0, rendered: 0 });

  const [remote, setRemote] = useState<RemoteViewport>(remoteRef.current);
  const [stats, setStats] = useState<StreamStats>(EMPTY_STATS);

  const publishStats = useCallback((nowMs: number) => {
    if (nowMs - publishedAtRef.current < STATS_PUBLISH_INTERVAL_MS) return;
    publishedAtRef.current = nowMs;

    const frame = windowRef.current;
    const elapsed = (nowMs - frame.startedAtMs) / 1000;
    const fps = elapsed > 0 ? frame.rendered / elapsed : 0;
    windowRef.current = { startedAtMs: nowMs, rendered: 0 };

    setStats({ ...countersRef.current, fps });
  }, []);

  /** 이름 있는 함수식 — 렌더가 끝나면 자기 자신을 다시 부른다(대기 중 프레임 소진). */
  const pump = useCallback(
    function pumpFrames(): void {
      if (renderingRef.current) return;
      const frame = pendingRef.current;
      if (frame === null) return;

      pendingRef.current = null;
      renderingRef.current = true;

      createImageBitmap(frame.blob)
        .then((bitmap) => {
          const canvas = canvasRef.current;
          if (canvas !== null) {
            // 내부 해상도는 원격 뷰포트와 1:1 이다. CSS 표시 크기는 별개(배율)이고,
            // 좌표 변환은 **CSS 크기**를 쓴다(frame.ts `toRemotePoint` 주석 참조).
            if (canvas.width !== frame.width) canvas.width = frame.width;
            if (canvas.height !== frame.height) canvas.height = frame.height;
            const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
            ctx?.drawImage(bitmap, 0, 0, frame.width, frame.height);
          }
          bitmap.close();

          const nowMs = performance.timeOrigin + performance.now();
          countersRef.current.rendered += 1;
          countersRef.current.lastLatencyMs = nowMs - frame.capturedAtMs;
          windowRef.current.rendered += 1;
          publishStats(nowMs);

          renderingRef.current = false;
          pumpFrames();
        })
        .catch(() => {
          renderingRef.current = false;
          pumpFrames();
        });
    },
    [publishStats],
  );

  const handleFrame = useCallback(
    (frame: DecodedFrame) => {
      countersRef.current.received += 1;
      countersRef.current.bytes += frame.bytes;

      if (frame.width !== remoteRef.current.w || frame.height !== remoteRef.current.h) {
        remoteRef.current = { w: frame.width, h: frame.height };
        setRemote(remoteRef.current);
      }

      // ★ 드롭 — 아직 그리지 못한 프레임이 남아 있으면 그것을 버린다.
      if (pendingRef.current !== null) countersRef.current.droppedClient += 1;
      pendingRef.current = frame;

      if (windowRef.current.startedAtMs === 0) {
        windowRef.current.startedAtMs = performance.timeOrigin + performance.now();
      }
      pump();
    },
    [pump],
  );

  const reset = useCallback(() => {
    pendingRef.current = null;
    countersRef.current = { ...EMPTY_STATS };
    windowRef.current = { startedAtMs: 0, rendered: 0 };
    publishedAtRef.current = 0;
    setStats(EMPTY_STATS);

    const canvas = canvasRef.current;
    if (canvas !== null) {
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  return { canvasRef, remote, stats, handleFrame, reset };
}
