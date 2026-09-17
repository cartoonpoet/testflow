import { z } from "zod";
import { DraftStepSchema, TestStepSchema } from "./step.js";

/**
 * 녹화 세션 계약.
 *
 * 세션은 Runner 가 소유하고, 웹은 **Runner WS 로 직결**한다
 * (API 를 중계로 끼우면 프레임마다 홉이 늘어 지연이 배가된다 — 02-context "구조상 쟁점").
 * API 는 세션 레코드 생성/종료와 단명 토큰 발급만 담당한다.
 */

export const RECORDING_STATUSES = ["live", "stopped", "expired", "error"] as const;
export const RecordingStatusSchema = z.enum(RECORDING_STATUSES);
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;

/** ★ screencast 의 `size` 와 동일해야 한다. 미지정 시 800×800 으로 축소돼 좌표 변환이 깨진다. */
export const DEFAULT_VIEWPORT = { w: 1280, h: 800 } as const;

export const ViewportSchema = z.object({
  w: z.number().int().min(320).max(3840).default(DEFAULT_VIEWPORT.w),
  h: z.number().int().min(240).max(2160).default(DEFAULT_VIEWPORT.h),
});
export type Viewport = z.infer<typeof ViewportSchema>;

/** `POST /api/scenarios/:id/recordings` */
export const CreateRecordingDtoSchema = z.object({
  startUrl: z.url().max(500).optional(),
  viewport: ViewportSchema.optional(),
});
export type CreateRecordingDto = z.infer<typeof CreateRecordingDtoSchema>;

/**
 * 세션 생성 응답.
 * `wsUrl` 은 API 포트가 아니라 **`RUNNER_WS_PORT`** 를 가리킨다 (`/rec/:sessionId?token=…`).
 */
export const CreateRecordingResponseSchema = z.object({
  sessionId: z.uuid(),
  wsUrl: z.string().min(1),
  expiresAt: z.iso.datetime(),
  viewport: ViewportSchema,
});
export type CreateRecordingResponse = z.infer<typeof CreateRecordingResponseSchema>;

export const RecordingSessionSchema = z.object({
  id: z.uuid(),
  scenarioId: z.uuid(),
  status: RecordingStatusSchema,
  startUrl: z.string().max(500),
  viewport: ViewportSchema,
  runnerId: z.string().max(60).nullable(),
  draftStepCount: z.number().int().nonnegative(),
  startedAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  stoppedAt: z.iso.datetime().nullable(),
});
export type RecordingSession = z.infer<typeof RecordingSessionSchema>;

/**
 * `recording_sessions.draft_steps` JSON 컬럼의 형태.
 * 세션이 끊겨도 테스터 작업이 날아가지 않도록 주기적으로 여기에 저장한다.
 */
export const DraftStepsSchema = z.array(DraftStepSchema);
export type DraftSteps = z.infer<typeof DraftStepsSchema>;

/* ────────────────────────────────────────────────────────────
 * 단명 세션 토큰  (API 발급 → Runner 검증)
 * ──────────────────────────────────────────────────────────── */

/**
 * ★ 토큰 검증 규약. API(Task 5.4)와 Runner(Task 7.2)가 **같은 Redis** 를 본다.
 *
 * - API 는 `randomBytes(32)` 를 base64url 로 인코딩해 **평문 토큰**을 발급하고,
 *   Redis 에는 **SHA-256 해시(hex)** 만 `recordingTokenKey(sessionId)` 로 TTL 과 함께 둔다.
 * - Runner 는 `/rec/:sessionId?token=…` 접속 시 그 키를 `GET` 해서
 *   `sha256(token)` 과 **타이밍 안전 비교**한다. 불일치·부재면 close 4401.
 *
 * ## 왜 HMAC(무상태) 이 아니라 Redis(유상태) 인가
 * ① 새 공유 비밀(`.env` 키)을 늘리지 않는다 — Redis 는 이미 양쪽이 공유한다.
 * ② **즉시 폐기**가 된다. `stop`/`DELETE` 에서 키를 지우면 그 순간 접속이 막힌다.
 *    HMAC 은 만료 시각까지 유효해서 세션 종료 후에도 살아 있다.
 * ③ 해시만 저장하므로 Redis 덤프가 유출돼도 접속 가능한 토큰이 나오지 않는다.
 *
 * 비회원제라 **사용자 인증과는 무관**하다. 이 토큰이 증명하는 것은
 * "이 세션에 붙어도 되는 클라이언트인가" 하나뿐이다.
 */
export const RECORDING_TOKEN_KEY_PREFIX = "testflow:rec:token:";

/** 토큰 TTL(초). `expiresAt` 이 이 값으로 계산된다. */
export const RECORDING_TOKEN_TTL_SEC = 600;

export function recordingTokenKey(sessionId: string): string {
  return `${RECORDING_TOKEN_KEY_PREFIX}${sessionId}`;
}

/**
 * 세션 제어 채널. API 가 publish 하고 Runner 가 subscribe 한다.
 * `stop`/`DELETE` 요청이 왔을 때 Runner 에게 브라우저를 접으라고 알리는 유일한 경로다
 * (API 는 WS 를 중계하지 않으므로 다른 통로가 없다).
 */
export function recordingControlChannel(sessionId: string): string {
  return `rec:${sessionId}:control`;
}

export const RecordingControlMessageSchema = z.object({
  t: z.enum(["stop", "dispose"]),
  sessionId: z.uuid(),
  at: z.iso.datetime(),
});
export type RecordingControlMessage = z.infer<typeof RecordingControlMessageSchema>;

/** `POST /api/recordings/:sessionId/stop` — 초안을 확정해 시나리오에 반영한 결과. */
export const StopRecordingResponseSchema = z.object({
  steps: z.array(TestStepSchema),
});
export type StopRecordingResponse = z.infer<typeof StopRecordingResponseSchema>;
