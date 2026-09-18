import { z } from "zod";
import { ArtifactSchema, RunStatusSchema, StepResultSchema } from "./run.js";
import { ArtifactTypeSchema } from "./storage.js";
import { DraftStepSchema } from "./step.js";

/* ════════════════════════════════════════════════════════════
 * A. SSE — 실행 진행 상황 (단방향, `GET /api/runs/:id/events`)
 *
 *   재연결은 `Last-Event-ID` 로 한다. API 는 최근 N 건을 Redis List 에 버퍼링한다.
 *   ★ 모든 payload 는 `mask.ts` 를 통과한 뒤 전송된다.
 * ════════════════════════════════════════════════════════════ */

export const SSE_EVENT_NAMES = [
  "run.status",
  "step.started",
  "step.finished",
  "run.finished",
  "artifact.ready",
] as const;
export const SseEventNameSchema = z.enum(SSE_EVENT_NAMES);
export type SseEventName = z.infer<typeof SseEventNameSchema>;

export const RunStatusEventSchema = z.object({
  event: z.literal("run.status"),
  runId: z.uuid(),
  status: RunStatusSchema,
  runnerId: z.string().nullable().optional(),
  at: z.iso.datetime(),
});

export const StepStartedEventSchema = z.object({
  event: z.literal("step.started"),
  runId: z.uuid(),
  sequence: z.number().int().positive(),
  name: z.string(),
  totalSteps: z.number().int().nonnegative(),
  at: z.iso.datetime(),
});

export const StepFinishedEventSchema = z.object({
  event: z.literal("step.finished"),
  runId: z.uuid(),
  sequence: z.number().int().positive(),
  result: StepResultSchema,
  at: z.iso.datetime(),
});

export const RunFinishedEventSchema = z.object({
  event: z.literal("run.finished"),
  runId: z.uuid(),
  status: RunStatusSchema,
  passedSteps: z.number().int().nonnegative(),
  totalSteps: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** 마스킹된 메시지만 들어온다. */
  errorMessage: z.string().nullable(),
  at: z.iso.datetime(),
});

export const ArtifactReadyEventSchema = z.object({
  event: z.literal("artifact.ready"),
  runId: z.uuid(),
  type: ArtifactTypeSchema,
  artifact: ArtifactSchema,
  at: z.iso.datetime(),
});

export const RunEventSchema = z.discriminatedUnion("event", [
  RunStatusEventSchema,
  StepStartedEventSchema,
  StepFinishedEventSchema,
  RunFinishedEventSchema,
  ArtifactReadyEventSchema,
]);
export type RunEvent = z.infer<typeof RunEventSchema>;

/** Redis pub/sub 채널 이름. runner 가 publish 하고 api 가 subscribe 한다. */
export function runEventChannel(runId: string): string {
  return `run:${runId}`;
}

/** `Last-Event-ID` 재전송용 버퍼 키. */
export function runEventBufferKey(runId: string): string {
  return `run:${runId}:events`;
}

/**
 * SSE `id:` 값을 만드는 단조 증가 카운터 키.
 *
 * `INCR` 결과가 그대로 `seq` 이자 SSE 의 `id:` 가 된다. 1 부터 시작한다.
 */
export function runEventSeqKey(runId: string): string {
  return `run:${runId}:seq`;
}

/** 실행 취소 신호 채널. api 가 publish 하고 runner 가 subscribe 한다(Gen-Phase 6 Task 6.7). */
export function runCancelChannel(runId: string): string {
  return `run:${runId}:cancel`;
}

/** 이벤트 버퍼에 남기는 최대 건수. `Last-Event-ID` 재전송이 커버하는 범위다. */
export const RUN_EVENT_BUFFER_MAX = 500;

/** 이벤트 버퍼 · 카운터 키의 TTL(초). 실행이 끝나도 잠시 남아 재연결을 받아 준다. */
export const RUN_EVENT_BUFFER_TTL_SEC = 3600;

/**
 * ★ pub/sub 로 오가는 **봉투(envelope)**. 채널에 흘리는 JSON 이 곧 이 형태다.
 *
 * `RunEvent` 자체에 `seq` 를 넣지 않은 이유: `seq` 는 전송 계층의 관심사(재전송 순번)이고
 * 이벤트 내용이 아니다. 봉투로 감싸면 버퍼(List)와 채널(pub/sub)에 **완전히 같은 바이트**를
 * 넣을 수 있어 재연결 시 중복 판정이 `seq` 비교 하나로 끝난다.
 *
 * ## 발행 절차 (Gen-Phase 6 `reporter.ts` 가 그대로 따라야 한다)
 * ```
 * seq = INCR  run:<id>:seq
 *       EXPIRE run:<id>:seq  <TTL>
 * body = JSON({seq, payload})
 *       RPUSH  run:<id>:events  body
 *       LTRIM  run:<id>:events  -<MAX> -1
 *       EXPIRE run:<id>:events  <TTL>
 *       PUBLISH run:<id>  body
 * ```
 * 순서가 중요하다 — **버퍼에 넣은 다음 publish** 해야 한다. 반대로 하면 구독자가
 * 이벤트를 받은 직후 버퍼를 읽었을 때 그 이벤트가 아직 없어 재연결 재전송에 구멍이 생긴다.
 */
export const RunEventEnvelopeSchema = z.object({
  seq: z.number().int().positive(),
  payload: RunEventSchema,
});
export type RunEventEnvelope = z.infer<typeof RunEventEnvelopeSchema>;

/* ════════════════════════════════════════════════════════════
 * B. WebSocket — 녹화 (양방향 + 바이너리)
 *
 *   경로: `WS /rec/:sessionId?token=…` (Runner 직결)
 *   판별 필드는 `t` 다.
 * ════════════════════════════════════════════════════════════ */

/* ── C→S : 테스터 입력을 원격 브라우저로 역주입 ─────────────── */

export const MouseInputMessageSchema = z.object({
  t: z.literal("mouse"),
  /** 원격 뷰포트 좌표계로 이미 변환된 값이다(클라이언트가 캔버스 스케일을 나눠서 보낸다). */
  x: z.number(),
  y: z.number(),
  kind: z.enum(["move", "down", "up"]),
  button: z.enum(["left", "middle", "right"]).default("left"),
  clickCount: z.number().int().nonnegative().default(1),
  modifiers: z.number().int().nonnegative().default(0),
});

export const WheelInputMessageSchema = z.object({
  t: z.literal("wheel"),
  x: z.number(),
  y: z.number(),
  deltaX: z.number(),
  deltaY: z.number(),
});

/** 조합이 없는 입력(영문·숫자·특수키)은 이 경로로 보낸다 — keydown 이 정상 발생한다. */
export const KeyInputMessageSchema = z.object({
  t: z.literal("key"),
  kind: z.enum(["down", "up", "press"]),
  key: z.string().min(1),
  code: z.string().optional(),
  text: z.string().optional(),
  modifiers: z.number().int().nonnegative().default(0),
});

/**
 * 한글 등 IME 조합 입력.
 * - A안(MVP): `commit` 만 쓴다 → Runner 가 `Input.insertText` 1회 호출.
 * - B안(승급 시): `set` 으로 조합 중간 상태를 중계 → `Input.imeSetComposition`.
 *
 * 두 안 모두 `input-bridge.ts` 한 파일 안에서만 갈린다.
 */
export const ImeInputMessageSchema = z.object({
  t: z.literal("ime"),
  kind: z.enum(["set", "commit"]),
  text: z.string(),
  selectionStart: z.number().int().nonnegative().optional(),
  selectionEnd: z.number().int().nonnegative().optional(),
});

export const ResizeInputMessageSchema = z.object({
  t: z.literal("resize"),
  w: z.number().int().min(320).max(3840),
  h: z.number().int().min(240).max(2160),
});

export const RecorderClientMessageSchema = z.discriminatedUnion("t", [
  MouseInputMessageSchema,
  WheelInputMessageSchema,
  KeyInputMessageSchema,
  ImeInputMessageSchema,
  ResizeInputMessageSchema,
]);
export type RecorderClientMessage = z.infer<typeof RecorderClientMessageSchema>;

/* ── S→C : 프레임 · 스텝 초안 · 네비게이션 ────────────────── */

/**
 * ★ `jpeg` 는 **바이너리(Uint8Array)** 다. base64 금지 — 33% 대역폭 오버헤드가 붙고
 *   프레임 왕복 지연이 이 기능의 유일한 성패 요인이다 (02-context "전송").
 *
 *   실제 전송은 WS 바이너리 프레임으로 나가고, 이 스키마는 그 구조를 타입으로 고정한다.
 *   클라이언트는 `createImageBitmap(blob)` → `canvas.drawImage` 로 렌더한다.
 */
export const FrameMessageSchema = z.object({
  t: z.literal("frame"),
  jpeg: z.instanceof(Uint8Array),
  /** screencast 프레임 타임스탬프. 왕복 지연 측정의 기준값이다. */
  timestamp: z.number(),
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
});
export type FrameMessage = z.infer<typeof FrameMessageSchema>;

export const StepDraftMessageSchema = z.object({
  t: z.literal("step"),
  step: DraftStepSchema,
  index: z.number().int().nonnegative(),
});

export const NavMessageSchema = z.object({
  t: z.literal("nav"),
  url: z.string(),
});

export const RecorderErrorMessageSchema = z.object({
  t: z.literal("error"),
  code: z.string(),
  message: z.string(),
});

export const RecorderServerMessageSchema = z.discriminatedUnion("t", [
  FrameMessageSchema,
  StepDraftMessageSchema,
  NavMessageSchema,
  RecorderErrorMessageSchema,
]);
export type RecorderServerMessage = z.infer<typeof RecorderServerMessageSchema>;

/** 토큰 검증 실패 시의 WS close code. */
export const WS_CLOSE_UNAUTHORIZED = 4401;
/** 세션이 이미 만료/종료됐을 때의 close code. */
export const WS_CLOSE_SESSION_GONE = 4404;

/* ════════════════════════════════════════════════════════════
 * C. 실행 라이브 스트림 WS  (`/live/:runId`) — 라운드 2, 03-phases 쟁점 3
 *
 *   녹화 WS(`/rec/:sessionId`)와 **같은 서버·같은 포트(`RUNNER_WS_PORT`)** 의 다른 경로다.
 *   포트 1개 · nginx 규칙 1개 · **프레임 봉투 25바이트 · 백프레셔 드롭 정책 ·
 *   `bufferedAmount` 상한이 전부 동일**하기 때문이다. 분리하면 그 네 가지가 두 벌이 되고
 *   둘이 어긋나는 순간 한쪽 화면만 조용히 깨진다.
 *
 *   분리되는 것은 **세션 레지스트리**와 **Redis 토큰 키 공간**뿐이다
 *   (`LIVE_STREAM_TOKEN_KEY_PREFIX` — `recording.ts` 참조).
 *
 *   ★★ **C→S 메시지는 없다. 이 스트림은 단방향이다.** ★★
 *   코드 실행 화면은 **보기만** 한다. 원격 조작(`RecorderClientMessageSchema` 의 mouse/key/ime)을
 *   붙이면 사용자 입력이 테스트를 깨뜨린다 (01-clarify "폐기하지 않는 것" 절).
 *   그래서 이 union 에는 **서버→클라이언트 방향만** 있고, `Live*` 이름의 클라이언트 메시지 타입은
 *   **일부러 존재하지 않는다.** 필요해 보이거든 먼저 이 주석을 지우는 PR 을 내라.
 *
 *   프레임은 **기존 25바이트 봉투 바이너리 그대로**다. 새 포맷을 만들지 않는다
 *   (웹 `frame.ts` 디코더를 무수정 재사용한다).
 * ════════════════════════════════════════════════════════════ */

/**
 * 스트림의 상태.
 *
 * | 값 | 화면 처리 |
 * |---|---|
 * | `live` | 프레임이 흐른다 |
 * | `between-tests` | **테스트 전환 구간의 공백**(page 닫힘 ~ 새 page 첫 프레임). "다음 테스트 준비 중" 오버레이. 안 띄우면 "멈췄다"로 오인된다 — PoC 가 명시적으로 넘긴 항목 |
 * | `ended` | 실행 종료. **마지막 프레임을 유지하고 그 위에 상태 배지를 덮는다.** 캔버스를 비우지 않는다 — 마지막 프레임은 실패 직전 화면이라 정보가 가장 많다 |
 */
export const LIVE_STREAM_STATES = ["live", "between-tests", "ended"] as const;
export const LiveStreamStateSchema = z.enum(LIVE_STREAM_STATES);
export type LiveStreamState = z.infer<typeof LiveStreamStateSchema>;

export const LiveStreamStateMessageSchema = z.object({
  t: z.literal("state"),
  state: LiveStreamStateSchema,
  /** `ended` 일 때만 의미가 있다. 배지 문구가 이 값으로 갈린다. */
  runStatus: RunStatusSchema.optional(),
});
export type LiveStreamStateMessage = z.infer<typeof LiveStreamStateMessageSchema>;

export const LiveStreamErrorMessageSchema = z.object({
  t: z.literal("error"),
  code: z.string(),
  message: z.string(),
});
export type LiveStreamErrorMessage = z.infer<typeof LiveStreamErrorMessageSchema>;

/**
 * S→C **텍스트** 메시지. 바이너리 프레임은 이 union 밖(25바이트 봉투)이다.
 *
 * 판별 필드는 녹화 WS 와 같은 `t` 를 쓴다 — 웹의 메시지 디스패처 모양이 하나로 유지된다.
 */
export const LiveStreamServerMessageSchema = z.discriminatedUnion("t", [
  LiveStreamStateMessageSchema,
  LiveStreamErrorMessageSchema,
]);
export type LiveStreamServerMessage = z.infer<typeof LiveStreamServerMessageSchema>;

/* ────────────────────────────────────────────────────────────
 * Runner heartbeat (health 판정용)
 * ──────────────────────────────────────────────────────────── */

/**
 * Runner 가 살아 있음을 알리는 Redis 키의 접두사.
 *
 * - **쓰는 쪽**: `apps/runner` (Gen-Phase 6 Task 6.7) 이 `RUNNER_HEARTBEAT_TTL_SEC` 보다
 *   짧은 주기로 `SET <key> <timestamp> EX <ttl>` 한다.
 * - **읽는 쪽**: `apps/api` health 모듈이 이 접두사로 SCAN 해서 하나라도 있으면 `"ok"`,
 *   없으면 `"down"` 으로 판정한다.
 *
 * 양쪽이 같은 문자열을 써야 하므로 계약(contracts)에 둔다.
 */
export const RUNNER_HEARTBEAT_KEY_PREFIX = "testflow:runner:heartbeat:";

/** heartbeat 키의 TTL(초). 갱신 주기는 이 값의 1/3 이하를 권장한다. */
export const RUNNER_HEARTBEAT_TTL_SEC = 30;

export function runnerHeartbeatKey(runnerId: string): string {
  return `${RUNNER_HEARTBEAT_KEY_PREFIX}${runnerId}`;
}

/**
 * Runner 의 **동시 실행 한도**를 알리는 Redis 키의 접두사. (라운드 7)
 *
 * heartbeat 와 **같은 주기·같은 TTL** 로 갱신한다. 값은 `RUNNER_CONCURRENCY` 십진수 문자열이다.
 *
 * ★ 왜 별도 키인가 — heartbeat 값(ISO 문자열)에 JSON 을 끼워 넣으면 그 값을 읽는
 *   기존 판정(`health` 의 "키가 있으면 ok")과 형식이 얽힌다. 접두사가 다르면
 *   health 의 SCAN(`…heartbeat:*`)에 잡히지 않으므로 **기존 판정이 한 줄도 바뀌지 않는다.**
 *
 * ★ 왜 필요한가 — 화면이 "병렬로 N건 실행"이라고 말하려면 **실제로 몇 개가 동시에
 *   도는지**를 알아야 한다. 그 값은 Runner 프로세스만 안다(API 의 env 를 읽으면
 *   설정이 두 벌이 되어 조용히 거짓말을 한다). 키가 없으면 화면은 "알 수 없음"으로
 *   떨어지고 한도를 지어내지 않는다.
 */
export const RUNNER_CAPACITY_KEY_PREFIX = "testflow:runner:capacity:";

export function runnerCapacityKey(runnerId: string): string {
  return `${RUNNER_CAPACITY_KEY_PREFIX}${runnerId}`;
}
