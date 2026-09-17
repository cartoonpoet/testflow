import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Artifact, RunDetail } from "@testflow/contracts";
import { appendArtifact, applyRunEvent, queryKeys, subscribeRunEvents } from "@/lib";

/**
 * 실행 진행 상황 SSE 구독 (`GET /api/runs/:id/events`).
 *
 * ## 왜 훅에 `useEffect` 가 있나
 * 전 Phase 의 규율은 "useEffect 자제" 지만, **SSE 는 외부 구독이라 생명주기가 필요하다.**
 * 대신 이펙트를 이 파일 한 곳에 가두고, 화면 컴포넌트에는 한 줄로 노출한다.
 *
 * ## 규율 3가지 (04-gen-10 "다음 Gen-Phase 에 전달할 사항" 1번)
 *  - **렌더 중 ref 를 쓰지 않는다.** 카운터는 이펙트 스코프의 지역 변수다
 *    (구독 1회 = 클로저 1개라 ref 가 필요 없다).
 *  - **이펙트 본문에서 동기 setState 를 하지 않는다.** 상태 변화는 전부 콜백 안에서 일어난다.
 *  - **연결 상태 초기화를 파생으로 표현한다.** `state.runId !== runId` 면 아직 이 run 의
 *    상태가 아니므로 `connecting` 으로 **계산**한다.
 *
 * ## 무엇을 캐시에 반영하나
 *  - `run.status` / `step.started` / `step.finished` / `run.finished` → `queryKeys.run(id)`
 *  - `artifact.ready` → `queryKeys.runArtifacts(id)` (04-gen-6 실측상 `run.finished` 보다 먼저 온다)
 *
 * ## 중복 방어 2겹
 *  1. `seq` 를 기억해 이미 본 이벤트는 버린다(여기).
 *  2. `applyRunEvent` 자체가 멱등이다(`lib/run-events.ts`).
 */
export type SseConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "failed";

export type RunEventsStatus = {
  connection: SseConnectionState;
  /** 재연결 시도 횟수. 0 이면 정상 연결. */
  attempt: number;
  /** 마지막으로 받은 SSE `id:` (= 서버 `seq`). 재연결 시 이 값 이후만 재전송된다. */
  lastEventId: number | null;
  /** 수신 이벤트 수(중복 포함). */
  received: number;
  /** `seq` 중복으로 **반영하지 않고 버린** 이벤트 수. */
  duplicates: number;
  /** 재연결로 전체 재조회를 건 횟수(`onDesync`). */
  resyncs: number;
  error: string | null;
};

type InternalState = RunEventsStatus & { runId: string | null };

const INITIAL: InternalState = {
  runId: null,
  connection: "idle",
  attempt: 0,
  lastEventId: null,
  received: 0,
  duplicates: 0,
  resyncs: 0,
  error: null,
};

export function useRunEvents(
  runId: string | undefined,
  options: { enabled: boolean },
): RunEventsStatus {
  const { enabled } = options;
  const queryClient = useQueryClient();
  const [state, setState] = useState<InternalState>(INITIAL);

  useEffect(() => {
    if (!enabled || runId === undefined) return;

    const seen = new Set<number>();
    let received = 0;
    let duplicates = 0;
    let resyncs = 0;

    const stream = subscribeRunEvents({
      runId,

      onOpen: () => {
        setState((prev) => ({
          ...prev,
          runId,
          connection: "open",
          attempt: 0,
          error: null,
        }));
      },

      onEvent: (event, seq) => {
        received += 1;

        if (seq >= 0 && seen.has(seq)) {
          duplicates += 1;
          setState((prev) => ({ ...prev, runId, received, duplicates }));
          return;
        }
        if (seq >= 0) seen.add(seq);

        queryClient.setQueryData<RunDetail>(queryKeys.run(runId), (prev) =>
          prev === undefined ? prev : applyRunEvent(prev, event),
        );

        if (event.event === "artifact.ready") {
          queryClient.setQueryData<Artifact[]>(queryKeys.runArtifacts(runId), (prev) =>
            prev === undefined ? prev : appendArtifact(prev, event.artifact),
          );
        }

        /*
         * ★ 종료 시 한 번 더 전체를 읽는다 (실측으로 드러난 필요).
         *
         * 취소·실패로 중단되면 **뒤 스텝들은 `step.finished` 없이** DB 에서만 `skipped` 가
         * 된다. 이벤트만으로 그린 화면은 그 스텝을 `pending`(대기 숫자)으로 남긴다 —
         * 실행이 끝났는데 "대기 중" 으로 보이는 잘못된 화면이다.
         * `run.finished` 뒤 한 번의 재조회로 서버 상태를 확정 반영한다.
         */
        if (event.event === "run.finished") {
          void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.runArtifacts(runId) });
        }

        setState((prev) => ({
          ...prev,
          runId,
          connection: "open",
          received,
          duplicates,
          lastEventId: seq >= 0 ? seq : prev.lastEventId,
        }));
      },

      onReconnect: (attempt) => {
        setState((prev) => ({ ...prev, runId, connection: "reconnecting", attempt }));
      },

      /*
       * 재연결에 성공해도 서버 버퍼(500건)를 넘겨 밀린 이벤트는 재전송되지 않는다.
       * 클라이언트는 유실 여부를 알 수 없으므로 재연결마다 전체 재조회를 건다
       * (04-gen-5·8 이 지시한 경로). `useRunDetail` 의 `staleTime: 0` 이 여기에 필요하다.
       */
      onDesync: () => {
        resyncs += 1;
        void queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.runArtifacts(runId) });
        setState((prev) => ({ ...prev, runId, resyncs }));
      },

      onError: (error) => {
        setState((prev) => ({
          ...prev,
          runId,
          connection: "failed",
          error: error.message,
        }));
      },
    });

    return () => {
      stream.close();
    };
  }, [enabled, runId, queryClient]);

  // 파생 — 다른 run 으로 넘어갔거나 아직 첫 이벤트 전이면 "연결 중" 이다.
  const isThisRun = state.runId === runId && runId !== undefined;
  return {
    ...(isThisRun ? state : INITIAL),
    connection: !enabled ? "idle" : isThisRun ? state.connection : "connecting",
  };
}
