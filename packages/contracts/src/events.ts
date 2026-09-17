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
