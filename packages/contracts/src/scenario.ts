import { z } from "zod";
import { TestStepSchema, TestStepBaseSchema, TestStepArraySchema } from "./step.js";

/* ────────────────────────────────────────────────────────────
 * 프로젝트 (화면 없음 — 값 공급용)
 * ──────────────────────────────────────────────────────────── */

/**
 * `projects.base_url` 은 **실행 다이얼로그의 기본값(placeholder)** 일 뿐이다.
 * 실행 시 baseUrl 을 직접 입력받는 것이 주 경로다
 * (02-context "★ 사용자 최종 결정" (a)).
 *
 * 변수·Secret 은 DB 에 없다. `variables` 필드는 응답에 존재하지 않는다.
 */
export const ProjectSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  baseUrl: z.string().max(500),
  defaultEnvLabel: z.string().min(1).max(50),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const PatchProjectDtoSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.url().max(500).optional(),
  defaultEnvLabel: z.string().min(1).max(50).optional(),
});
export type PatchProjectDto = z.infer<typeof PatchProjectDtoSchema>;

/* ────────────────────────────────────────────────────────────
 * 시나리오
 * ──────────────────────────────────────────────────────────── */

export const SCENARIO_STATUSES = ["draft", "published", "archived"] as const;
export const ScenarioStatusSchema = z.enum(SCENARIO_STATUSES);
export type ScenarioStatus = z.infer<typeof ScenarioStatusSchema>;

export const SCENARIO_STATUS_LABEL = {
  draft: "초안",
  published: "발행됨",
  archived: "보관됨",
} as const satisfies Record<ScenarioStatus, string>;

export const ScenarioSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** 자동 채번. 시안 표기 예: `TC-AUTH-001` */
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  feature: z.string().max(80).nullable(),
  status: ScenarioStatusSchema,
  version: z.number().int().positive(),
  /** 비회원제 — `created_by` 대신 자유 입력 텍스트다. */
  authorName: z.string().max(50).nullable(),
  lastRunId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

/**
 * 목록 응답 1행. 시안(화면 2) 테이블 **6열**과 1:1 대응한다.
 *
 * | 시안 열 | 필드 |
 * |---|---|
 * | 시나리오   | `code` + `name` |
 * | 기능       | `feature` |
 * | 상태       | `status` |
 * | 최근 결과  | `lastResult` |
 * | 수정일     | `updatedAt` |
 * | 작성자     | `authorName` |
 *
 * `stepCount` 는 6열에는 없지만 목록에서 "스텝 0개" notice 판정에 쓰인다.
 */
export const ScenarioListItemSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  feature: z.string().nullable(),
  status: ScenarioStatusSchema,
  lastResult: z
    .object({
      runId: z.uuid(),
      runCode: z.string(),
      status: z.string(),
      finishedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  updatedAt: z.iso.datetime(),
  authorName: z.string().nullable(),
  stepCount: z.number().int().nonnegative(),
});
export type ScenarioListItem = z.infer<typeof ScenarioListItemSchema>;

export const ScenarioListResponseSchema = z.object({
  items: z.array(ScenarioListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.number().int().positive(),
});
export type ScenarioListResponse = z.infer<typeof ScenarioListResponseSchema>;

export const ScenarioListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: ScenarioStatusSchema.optional(),
  feature: z.string().max(80).optional(),
  page: z.coerce.number().int().positive().default(1),
  size: z.coerce.number().int().positive().max(100).default(20),
});
export type ScenarioListQuery = z.infer<typeof ScenarioListQuerySchema>;

/** `GET /api/scenarios/:id` — 빌더 화면이 읽는 형태. */
export const ScenarioDetailSchema = ScenarioSchema.extend({
  steps: z.array(TestStepSchema),
});
export type ScenarioDetail = z.infer<typeof ScenarioDetailSchema>;

export const CreateScenarioDtoSchema = z.object({
  name: z.string().min(1).max(200),
  feature: z.string().max(80).optional(),
  authorName: z.string().max(50).optional(),
});
export type CreateScenarioDto = z.infer<typeof CreateScenarioDtoSchema>;

export const PatchScenarioDtoSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  feature: z.string().max(80).nullable().optional(),
  authorName: z.string().max(50).nullable().optional(),
});
export type PatchScenarioDto = z.infer<typeof PatchScenarioDtoSchema>;

/**
 * `PUT /api/scenarios/:id/steps` — **전량 치환**.
 * 순서 변경과 삭제를 한 번에 처리하기 위한 형태다.
 */
export const PutStepsDtoSchema = z.object({
  steps: TestStepArraySchema,
});
export type PutStepsDto = z.infer<typeof PutStepsDtoSchema>;

/** `POST /api/scenarios/:id/steps` — `afterSequence` 뒤에 한 건 삽입. */
export const CreateStepDtoSchema = z.object({
  afterSequence: z.number().int().nonnegative().optional(),
  step: TestStepBaseSchema.omit({ id: true, scenarioId: true, sequence: true }),
});
export type CreateStepDto = z.infer<typeof CreateStepDtoSchema>;

/** `PATCH /api/steps/:stepId` — 인스펙터 "적용". */
export const PatchStepDtoSchema = TestStepBaseSchema.omit({
  id: true,
  scenarioId: true,
  sequence: true,
})
  .partial()
  .extend({
    sequence: z.number().int().positive().optional(),
  });
export type PatchStepDto = z.infer<typeof PatchStepDtoSchema>;

export const PublishScenarioResponseSchema = z.object({
  status: z.literal("published"),
  version: z.number().int().positive(),
});
export type PublishScenarioResponse = z.infer<typeof PublishScenarioResponseSchema>;
