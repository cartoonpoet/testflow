import { z } from "zod";
import { ActionTypeSchema } from "./step.js";
import { ArtifactTypeSchema, StorageKeySchema } from "./storage.js";

/* ────────────────────────────────────────────────────────────
 * 상태
 * ──────────────────────────────────────────────────────────── */

export const RUN_STATUSES = [
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
  "timeout",
  "error",
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const STEP_RESULT_STATUSES = ["pending", "running", "passed", "failed", "skipped"] as const;
export const StepResultStatusSchema = z.enum(STEP_RESULT_STATUSES);
export type StepResultStatus = z.infer<typeof StepResultStatusSchema>;

/** 종료 상태 — SSE 스트림을 닫아도 되는 시점 판정에 쓴다. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "passed",
  "failed",
  "cancelled",
  "timeout",
  "error",
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export const BROWSERS = ["chromium"] as const;
export const BrowserSchema = z.enum(BROWSERS);
export type Browser = z.infer<typeof BrowserSchema>;

/* ────────────────────────────────────────────────────────────
 * 변수 · Secret 판별  (02-context "★ 사용자 최종 결정" (c))
 * ──────────────────────────────────────────────────────────── */

/**
 * 키 이름만 보고 Secret 으로 간주하는 규칙.
 * `secretKeys` 로 명시 지정할 수도 있으며, 둘 중 하나라도 맞으면 Secret 이다.
 */
export const SECRET_KEY_PATTERN = /(password|passwd|pwd|secret|token|apikey|api_key)/i;

export function isSecretVariableKey(key: string, secretKeys: readonly string[] = []): boolean {
  return secretKeys.includes(key) || SECRET_KEY_PATTERN.test(key);
}

/** 저장용 마스크. 화면 표시용 `••••••••` 와 구분한다. */
export const STORED_SECRET_PLACEHOLDER = "***";

/**
 * `runs` 테이블에 변수를 남겨야 할 때 쓰는 변환.
 * Secret 키의 **값은 절대 평문으로 저장하지 않는다.**
 * 실제 값은 Redis 큐 페이로드에만 존재하고 실행 완료 후 만료된다.
 */
export function maskVariablesForStorage(
  variables: Record<string, string>,
  secretKeys: readonly string[] = [],
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    masked[key] = isSecretVariableKey(key, secretKeys) ? STORED_SECRET_PLACEHOLDER : value;
  }
  return masked;
}

/** 마스킹 대상 "값" 목록 — `mask.ts` 에 넘겨 로그/에러 메시지에서 지운다. */
export function collectSecretValues(
  variables: Record<string, string>,
  secretKeys: readonly string[] = [],
): string[] {
  return Object.entries(variables)
    .filter(([key, value]) => value.length > 0 && isSecretVariableKey(key, secretKeys))
    .map(([, value]) => value);
}

/* ────────────────────────────────────────────────────────────
 * 실행 요청
 * ──────────────────────────────────────────────────────────── */

/**
 * `POST /api/runs` 요청 body.
 *
 * ★ `baseUrl` 과 `variables`(계정·비밀번호) 는 **실행 요청 body 가 주 경로**다.
 *   `projects.base_url` 은 실행 다이얼로그의 기본값(placeholder) 일 뿐이고,
 *   변수는 DB 에 저장되지 않는다 (02-context "★ 사용자 최종 결정" (a)(c)).
 */
export const CreateRunDtoSchema = z
  .object({
    scenarioId: z.uuid().optional(),
    suiteId: z.uuid().optional(),
    /** 실행 다이얼로그에서 직접 입력. 스텝의 `{{baseUrl}}` 가 이 값으로 치환된다. */
    baseUrl: z.url().max(500),
    envLabel: z.string().min(1).max(50),
    browser: BrowserSchema.default("chromium"),
    /** 예: `{ "testUser.email": "qa@x.com", "testUser.password": "hunter2" }` */
    variables: z.record(z.string().min(1).max(100), z.string().max(2000)).default({}),
    /** 키 이름 규칙으로 잡히지 않는 Secret 을 명시할 때 쓴다. */
    secretKeys: z.array(z.string().min(1).max(100)).default([]),
  })
  .superRefine((dto, ctx) => {
    if (!dto.scenarioId && !dto.suiteId) {
      ctx.addIssue({
        code: "custom",
        path: ["scenarioId"],
        message: "scenarioId 또는 suiteId 중 하나는 반드시 필요합니다.",
      });
    }
    if (dto.scenarioId && dto.suiteId) {
      ctx.addIssue({
        code: "custom",
        path: ["suiteId"],
        message: "scenarioId 와 suiteId 를 동시에 지정할 수 없습니다.",
      });
    }
  });
export type CreateRunDto = z.infer<typeof CreateRunDtoSchema>;
export type CreateRunPayload = z.input<typeof CreateRunDtoSchema>;

/** 202 Accepted 응답. 실행 진행은 SSE 로만 관찰한다. */
export const CreateRunResponseSchema = z.object({
  runId: z.uuid(),
  /** 스위트 실행이면 생성된 run 이 여러 건이다. */
  runIds: z.array(z.uuid()),
  batchId: z.uuid().nullable(),
  status: z.literal("queued"),
  position: z.number().int().nonnegative(),
});
export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;

/* ────────────────────────────────────────────────────────────
 * 실행 결과
 * ──────────────────────────────────────────────────────────── */

export const RunSchema = z.object({
  id: z.uuid(),
  /** 시안 표시용. 예: `RUN-2431` */
  runCode: z.string().min(1).max(30),
  projectId: z.uuid(),
  scenarioId: z.uuid().nullable(),
  suiteId: z.uuid().nullable(),
  batchId: z.uuid().nullable(),
  /** 실행 시점 이름 스냅샷 — 시나리오가 삭제돼도 이력이 남는다. */
  scenarioName: z.string().max(200),
  envLabel: z.string().max(50),
  /** 실행 시점 값 고정(재현성). */
  baseUrl: z.string().max(500),
  browser: BrowserSchema,
  status: RunStatusSchema,
  runnerId: z.string().max(60).nullable(),
  totalSteps: z.number().int().nonnegative(),
  passedSteps: z.number().int().nonnegative(),
  failedSeq: z.number().int().positive().nullable(),
  /** 반드시 마스킹 후 저장된 값이다. */
  errorMessage: z.string().nullable(),
  queuedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

/** 대시보드 "최근 실행" 목록 1행. */
export const RunListItemSchema = z.object({
  id: z.uuid(),
  runCode: z.string(),
  scenarioName: z.string(),
  browser: BrowserSchema,
  status: RunStatusSchema,
  durationMs: z.number().int().nonnegative().nullable(),
  startedAt: z.iso.datetime().nullable(),
});
export type RunListItem = z.infer<typeof RunListItemSchema>;

export const StepResultSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  stepId: z.uuid().nullable(),
  sequence: z.number().int().positive(),
  /** 실행 시점 스텝 이름. */
  nameSnapshot: z.string().max(200),
  actionType: ActionTypeSchema,
  status: StepResultStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** 마스킹 후 저장된 값이다. */
  errorMessage: z.string().nullable(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const ArtifactSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  stepResultId: z.uuid().nullable(),
  type: ArtifactTypeSchema,
  storageKey: StorageKeySchema,
  contentType: z.string().max(100),
  sizeBytes: z.number().int().nonnegative().nullable(),
  /** 스크린샷은 스텝 단위라 표시용 sequence 를 함께 준다. */
  stepSequence: z.number().int().positive().nullable(),
  /** `GET /api/artifacts/:id` 로 향하는 상대 URL. */
  url: z.string(),
  createdAt: z.iso.datetime(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

/** 실행 현황 화면 상단 다크 요약바(`#18302a`)가 읽는 값. */
export const RunSummarySchema = z.object({
  envLabel: z.string(),
  baseUrl: z.string(),
  browser: BrowserSchema,
  runnerId: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  totalSteps: z.number().int().nonnegative(),
  /** 시안 `4 / 5 단계` 의 좌변. */
  currentStep: z.number().int().nonnegative(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunDetailSchema = RunSchema.extend({
  summary: RunSummarySchema,
  steps: z.array(StepResultSchema),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const RunListQuerySchema = z.object({
  projectId: z.uuid().optional(),
  scenarioId: z.uuid().optional(),
  status: RunStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type RunListQuery = z.infer<typeof RunListQuerySchema>;

/* ────────────────────────────────────────────────────────────
 * 대시보드
 * ──────────────────────────────────────────────────────────── */

/** 시안 화면 1 의 지표 4종. */
export const DashboardSummarySchema = z.object({
  todayRuns: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  automatedScenarios: z.number().int().nonnegative(),
  avgDurationMs: z.number().int().nonnegative(),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

export const DashboardNoticeSchema = z.object({
  level: z.enum(["info", "warn", "danger"]),
  message: z.string(),
});
export type DashboardNotice = z.infer<typeof DashboardNoticeSchema>;

/** 회귀 테스트 준비도(진행바) + amber notice. */
export const DashboardReadinessSchema = z.object({
  percent: z.number().min(0).max(100),
  totalScenarios: z.number().int().nonnegative(),
  passing: z.number().int().nonnegative(),
  notices: z.array(DashboardNoticeSchema),
});
export type DashboardReadiness = z.infer<typeof DashboardReadinessSchema>;
