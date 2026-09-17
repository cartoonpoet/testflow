import { RunEventSchema, SSE_EVENT_NAMES, type RunEvent } from "@testflow/contracts";
import { API_BASE_URL } from "./api";

/**
 * 실행 이벤트 SSE 클라이언트.
 *
 * 서버 규약(04-gen-5 "SSE 이벤트 규약"):
 *   - `GET /api/runs/:id/events`, 5종 이벤트를 `event:` 이름으로 구분해 보낸다.
 *   - 각 프레임에 `id:` 가 붙는다(= Redis `INCR` 순번).
 *   - 서버가 `retry: 3000` 을 내려보낸다.
 *   - 재연결 시 `Last-Event-ID` 헤더 **또는** `?lastEventId=` 쿼리로 누락분을 재전송한다.
 *   - 재전송 버퍼는 500건이다. 그 이상 밀리면 재전송이 불가능하므로
 *     클라이언트가 `GET /api/runs/:id` 로 전체 상태를 다시 읽어야 한다.
 *
 * 브라우저 `EventSource` 는 **헤더를 붙일 수 없다.** 다만 스스로 끊어졌을 때는
 * 마지막 `id:` 를 `Last-Event-ID` 헤더로 자동 재전송한다. 문제는 그 자동 재연결이
 * 실패를 반복할 때 백오프가 없다는 점(항상 `retry` 간격)이다.
 * 그래서 이 래퍼는 **자동 재연결을 쓰지 않고** 끊길 때마다 인스턴스를 닫고
 * `?lastEventId=` 를 붙여 **지수 백오프**로 다시 연다. 서버가 쿼리 경로를 지원하므로
 * 헤더를 못 붙이는 제약이 문제가 되지 않는다.
 */
export type RunEventStreamOptions = {
  runId: string;
  onEvent: (event: RunEvent, seq: number) => void;
  /** 재연결을 시작할 때. UI 에 "연결 재시도 중" 을 띄우는 자리. */
  onReconnect?: (attempt: number, delayMs: number) => void;
  /** 연결이 열렸을 때(최초·재연결 공통). */
  onOpen?: (isReconnect: boolean) => void;
  /** 계약 파싱 실패 등 복구 불가 에러. */
  onError?: (error: Error) => void;
  /** 재전송 버퍼(500건)를 넘겨 이벤트가 유실됐을 수 있을 때. 전체 재조회 트리거. */
  onDesync?: () => void;
  /** 재연결 간격 기준값. 서버 `retry: 3000` 과 맞춰 둔다. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 이 횟수를 넘으면 포기하고 `onError` 를 부른다. */
  maxAttempts?: number;
};

export type RunEventStream = { close: () => void };

const DEFAULT_BASE_DELAY_MS = 3000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 10;

export function runEventsUrl(runId: string, lastEventId: number | null): string {
  const path = `${API_BASE_URL}/runs/${encodeURIComponent(runId)}/events`;
  return lastEventId === null ? path : `${path}?lastEventId=${lastEventId}`;
}

export function subscribeRunEvents(
  options: RunEventStreamOptions,
): RunEventStream {
  const {
    runId,
    onEvent,
    onReconnect,
    onOpen,
    onError,
    onDesync,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
  } = options;

  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastEventId: number | null = null;
  let attempt = 0;
  let closed = false;

  const handleMessage = (raw: MessageEvent<string>): void => {
    const seq = Number.parseInt(raw.lastEventId, 10);
    // 정상 수신 = 연결 건강함. 백오프를 되감는다.
    attempt = 0;

    let payload: unknown;
    try {
      payload = JSON.parse(raw.data) as unknown;
    } catch {
      onError?.(new Error("SSE payload 가 JSON 이 아닙니다"));
      return;
    }

    const parsed = RunEventSchema.safeParse(payload);
    if (!parsed.success) {
      onError?.(new Error(`SSE 이벤트가 계약과 다릅니다: ${parsed.error.message}`));
      return;
    }

    if (Number.isFinite(seq)) lastEventId = seq;
    onEvent(parsed.data, Number.isFinite(seq) ? seq : -1);
  };

  const open = (isReconnect: boolean): void => {
    if (closed) return;

    const es = new EventSource(runEventsUrl(runId, lastEventId));
    source = es;

    es.onopen = () => {
      onOpen?.(isReconnect);
      /*
       * 재연결이 성공해도 서버 버퍼(500건)를 넘겨 밀린 이벤트는 재전송되지 않는다.
       * 클라이언트는 유실 여부를 알 수 없으므로 **재연결마다** 전체 재조회를 알린다.
       * `GET /api/runs/:id` 한 번이 이벤트 유실로 멈춘 화면보다 싸다.
       */
      if (isReconnect) onDesync?.();
    };

    // 서버가 `event:` 이름을 붙이므로 기본 `message` 로는 오지 않는다.
    for (const name of SSE_EVENT_NAMES) {
      es.addEventListener(name, handleMessage as EventListener);
    }

    es.onerror = () => {
      // EventSource 의 자체 재연결을 쓰지 않는다 — 백오프를 우리가 관리한다.
      es.close();
      if (closed) return;

      attempt += 1;
      if (attempt > maxAttempts) {
        onError?.(
          new Error(`SSE 재연결 ${maxAttempts}회 실패 — 전체 재조회가 필요합니다`),
        );
        onDesync?.();
        return;
      }

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      onReconnect?.(attempt, delay);
      timer = setTimeout(() => open(true), delay);
    };
  };

  open(false);

  return {
    close: () => {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      source?.close();
      source = null;
    },
  };
}
