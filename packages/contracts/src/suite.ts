import { z } from "zod";

/**
 * 스위트 = 시나리오 묶음. 실행은 별도 엔드포인트 없이
 * `POST /api/runs { suiteId }` 로 하고, 생성된 run N 건이 동일 `batch_id` 를 갖는다
 * (02-context "규약 메모").
 */
export const SuiteSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Suite = z.infer<typeof SuiteSchema>;

export const SuiteListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  scenarioCount: z.number().int().nonnegative(),
  lastRun: z
    .object({
      batchId: z.uuid().nullable(),
      status: z.string(),
      finishedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
});
export type SuiteListItem = z.infer<typeof SuiteListItemSchema>;

export const SuiteScenarioRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sequence: z.number().int().positive(),
});
export type SuiteScenarioRef = z.infer<typeof SuiteScenarioRefSchema>;

export const SuiteDetailSchema = SuiteSchema.extend({
  scenarios: z.array(SuiteScenarioRefSchema),
});
export type SuiteDetail = z.infer<typeof SuiteDetailSchema>;

export const CreateSuiteDtoSchema = z.object({
  name: z.string().min(1).max(200),
  /** 배열 순서가 곧 `suite_scenarios.sequence` 다. */
  scenarioIds: z.array(z.uuid()).min(1),
});
export type CreateSuiteDto = z.infer<typeof CreateSuiteDtoSchema>;

export const PatchSuiteDtoSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  scenarioIds: z.array(z.uuid()).min(1).optional(),
});
export type PatchSuiteDto = z.infer<typeof PatchSuiteDtoSchema>;
