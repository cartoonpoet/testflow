import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import {
  CreateRecordingResponseSchema,
  DEFAULT_VIEWPORT,
  PublicTestStepSchema,
  type CreateRecordingResponse,
  type DraftStep,
  type PublicTestStep,
} from "@testflow/contracts";
import { api } from "@/lib";
import type { RecordBadgeState } from "@/components/RecordBadge";
import {
  useFrameRenderer,
  useImeBridge,
  useInputBridge,
  useRecorderSocket,
  type CanvasMouseHandlers,
  type FrameRenderer,
  type ImeBridge,
  type RecorderSocketStatus,
  type StreamStats,
} from "@/features/recorder";
import { toast as showToast } from "./useToast";

/**
 * 녹화 세션 제어 (Task 10.8).
 *
 * ```
 * POST /api/scenarios/:id/recordings  →  {sessionId, wsUrl, expiresAt, viewport}
 *        ↓ wsUrl 로 Runner 직결 WS
 *   프레임(바이너리) · {t:'step'} 초안 · {t:'nav'}
 *        ↓
 * POST /api/recordings/:sessionId/stop  →  확정된 스텝
 * ```
 *
 * ★ 초안은 **`{t:'step'}` 를 받는 즉시** 화면에 그린다. 재조회하지 않는다 —
 *   그래야 "조작 → 좌측에 스텝이 쌓임"이 눈으로 이어진다.
 *   서버는 같은 스텝을 갱신할 때 **같은 `index`** 로 다시 보내므로(디바운스로 합쳐진 입력),
 *   `index` 자리에 덮어쓰면 글자마다 스텝이 늘어나지 않는다.
 *
 * ★ 유휴 타임아웃은 기본 5분이고 **어떤 C→S 메시지든 시계를 리셋한다**
 *   (`session.ts` `dispatch` → `touch()`). 화면만 보고 있는 시간이 5분을 넘으면
 *   세션이 접히므로, 같은 크기의 `resize` 를 keepalive 로 보낸다 —
 *   `resize` 는 크기가 같으면 **early-return 하는 완전한 무해 메시지**다.
 */

const KEEPALIVE_INTERVAL_MS = 60_000;

/** `stop` 응답은 항상 공개형(css 제거)이다 — 컨트롤러에 `advanced` 파라미터가 없다. */
const StopRecordingResponsePublicSchema = z.object({
  steps: z.array(PublicTestStepSchema),
});
type StopRecordingResponsePublic = z.infer<typeof StopRecordingResponsePublicSchema>;

export type RecordingPhase = "idle" | "starting" | "connecting" | "live" | "stopping";

export type UseRecordingOptions = {
  scenarioId: string;
  /** 녹화가 확정되어 시나리오에 반영된 뒤 호출된다(목록 갱신·토스트용). */
  onStopped?: (steps: PublicTestStep[]) => void;
};

export type RecordingController = {
  phase: RecordingPhase;
  badgeState: RecordBadgeState;
  session: CreateRecordingResponse | null;
  /** 녹화 중 실시간으로 쌓이는 초안. 종료하면 비운다. */
  draftSteps: readonly DraftStep[];
  /** 메인 프레임이 마지막으로 이동한 URL. */
  navUrl: string | null;
  socketStatus: RecorderSocketStatus;
  renderer: FrameRenderer;
  stats: StreamStats;
  mouse: CanvasMouseHandlers;
  ime: ImeBridge;
  start: (startUrl: string) => void;
  stop: () => void;
  discard: () => void;
  isStarting: boolean;
  isStopping: boolean;
  startError: Error | null;
};

export function useRecording({ scenarioId, onStopped }: UseRecordingOptions): RecordingController {
  const [session, setSession] = useState<CreateRecordingResponse | null>(null);
  const [draftSteps, setDraftSteps] = useState<readonly DraftStep[]>([]);
  const [navUrl, setNavUrl] = useState<string | null>(null);

  const renderer = useFrameRenderer();
  /** 의도적으로 끊는 중인지. 이때는 끊김 경고를 띄우지 않는다. */
  const closingRef = useRef(false);

  const socket = useRecorderSocket(session?.wsUrl ?? null, {
    onFrame: renderer.handleFrame,
    onStep: (step, index) => {
      setDraftSteps((prev) => {
        const next = prev.slice();
        if (index < next.length) next[index] = step;
        else next.push(step);
        return next;
      });
    },
    onNav: setNavUrl,
    onServerError: (code, message) => {
      showToast(message, { label: `녹화 오류 ${code}`, tone: "danger" });
    },
    onClose: (info) => {
      if (closingRef.current || info.kind === "normal") return;
      setSession(null);
      if (info.kind === "unauthorized") {
        showToast("녹화 세션 토큰이 거부되었습니다. 녹화를 다시 시작해 주세요.", {
          label: "연결 거부 (4401)",
          tone: "danger",
        });
      } else if (info.kind === "session-gone") {
        showToast("녹화 세션이 이미 종료되었거나 만료되었습니다.", {
          label: "세션 없음 (4404)",
          tone: "danger",
        });
      } else {
        showToast(`녹화 연결이 끊어졌습니다 (code ${String(info.code)}).`, {
          label: "연결 끊김",
          tone: "danger",
        });
      }
    },
  });

  const live = session !== null && socket.status === "open";

  const ime = useImeBridge({ send: socket.send, enabled: live });
  const mouse = useInputBridge({
    canvasRef: renderer.canvasRef,
    remote: renderer.remote,
    send: socket.send,
    enabled: live,
    onPress: ime.focus,
  });

  /**
   * keepalive — 유휴 타임아웃(기본 5분)이 조용히 세션을 접는 것을 막는다.
   *
   * 보내는 것은 **같은 크기의 `resize`** 다. `session.ts` 의 `resize` 는 크기가 같으면
   * early-return 하므로 부작용이 전혀 없고, `dispatch` 를 탔으니 `touch()` 로 시계만 리셋된다.
   * (마우스 이동을 쓰면 원격 커서가 움직여 hover 상태가 바뀔 수 있다.)
   */
  const { w: remoteW, h: remoteH } = renderer.remote;
  const { send: socketSend } = socket;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      socketSend({ t: "resize", w: remoteW, h: remoteH });
    }, KEEPALIVE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [live, remoteH, remoteW, socketSend]);

  const startMutation = useMutation({
    mutationFn: (startUrl: string) =>
      api.post<CreateRecordingResponse>(
        `/scenarios/${scenarioId}/recordings`,
        { startUrl, viewport: { w: DEFAULT_VIEWPORT.w, h: DEFAULT_VIEWPORT.h } },
        { schema: CreateRecordingResponseSchema },
      ),
    onSuccess: (created) => {
      closingRef.current = false;
      renderer.reset();
      setDraftSteps([]);
      setNavUrl(null);
      setSession(created);
    },
    onError: (error: Error) => {
      showToast(error.message, { label: "녹화 시작 실패", tone: "danger" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (sessionId: string) =>
      api.post<StopRecordingResponsePublic>(`/recordings/${sessionId}/stop`, undefined, {
        schema: StopRecordingResponsePublicSchema,
      }),
    onSuccess: (result) => {
      closingRef.current = true;
      socket.close();
      setSession(null);
      setDraftSteps([]);
      renderer.reset();
      onStopped?.(result.steps);
    },
    onError: (error: Error) => {
      showToast(error.message, { label: "녹화 종료 실패", tone: "danger" });
    },
  });

  const discardMutation = useMutation({
    mutationFn: (sessionId: string) => api.delete<void>(`/recordings/${sessionId}`),
    onSuccess: () => {
      closingRef.current = true;
      socket.close();
      setSession(null);
      setDraftSteps([]);
      renderer.reset();
    },
  });

  const start = useCallback(
    (startUrl: string) => {
      startMutation.mutate(startUrl);
    },
    [startMutation],
  );

  const stop = useCallback(() => {
    if (session === null) return;
    stopMutation.mutate(session.sessionId);
  }, [session, stopMutation]);

  const discard = useCallback(() => {
    if (session === null) return;
    discardMutation.mutate(session.sessionId);
  }, [discardMutation, session]);

  const phase: RecordingPhase = useMemo(() => {
    if (stopMutation.isPending || discardMutation.isPending) return "stopping";
    if (startMutation.isPending) return "starting";
    if (session === null) return "idle";
    return socket.status === "open" ? "live" : "connecting";
  }, [
    discardMutation.isPending,
    session,
    socket.status,
    startMutation.isPending,
    stopMutation.isPending,
  ]);

  const badgeState: RecordBadgeState =
    phase === "live" ? "recording" : phase === "idle" ? "stopped" : "connecting";

  return {
    phase,
    badgeState,
    session,
    draftSteps,
    navUrl,
    socketStatus: socket.status,
    renderer,
    stats: renderer.stats,
    mouse,
    ime,
    start,
    stop,
    discard,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending || discardMutation.isPending,
    startError: startMutation.error,
  };
}
