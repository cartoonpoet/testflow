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

/** `POST /api/recordings/:sessionId/stop` — 초안을 확정해 시나리오에 반영한 결과. */
export const StopRecordingResponseSchema = z.object({
  steps: z.array(TestStepSchema),
});
export type StopRecordingResponse = z.infer<typeof StopRecordingResponseSchema>;
