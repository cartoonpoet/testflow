import { z } from "zod";
import { ActionTypeSchema, SECRET_MASK } from "./step.js";
import { ScenarioSourceTypeSchema } from "./scenario.js";
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
 * ★ **자유 텍스트** 안의 `키=값` 모양 비밀값을 가린다 (프로세스 레벨 예외 로그용).
 *
 * ## 기존 마스킹으로는 왜 안 되는가
 * 값 기반 마스킹(`apps/api` 의 `maskErrorMessage` · Runner 의 `maskSecretText`)은
 * **그 run 의 평문 값 목록을 알고 있을 때만** 동작한다. 그런데
 * `unhandledRejection` / `uncaughtException` 핸들러는 **어느 run 의 예외인지 알 수 없는
 * 지점**이라 값 목록이 언제나 빈 배열이다 — 즉 그 경로에서는 아무것도 가려지지 않는다.
 * 키 기반 마스킹은 객체의 **키**를 보는 것이라 문자열 한 줄에는 걸리지 않는다.
 *
 * 그 틈을 메우는 최소한의 방어다. 문자열에서 `password=…` · `"token":"…"` ·
 * `Authorization: Bearer …` 같은 **모양**을 찾아 값만 지운다.
 *
 * ★ 이것은 **보조 방어선이지 대체재가 아니다.** 키 이름이 없는 비밀값
 * (Playwright 가 `input[value='hunter2']` 로 뱉는 것)은 여기서 잡히지 않는다 —
 * 그건 값 목록을 아는 경로(SSE·DB 저장)가 잡는다. 그래서 **프로세스 레벨 로그에는
 * 스택을 찍지 않는다**(`process-guards.ts` 주석).
 */
const SECRET_TEXT_PATTERN =
  /(password|passwd|pwd|secret|token|credential|authorization|api[-_]?key|private[-_]?key)(["']?\s*[:=]\s*)(["']?)((?:Bearer\s+)?[^"'\s,;}&]+)/gi;

export function maskSecretsInText(text: string, mask: string = SECRET_MASK): string {
  return text.replace(SECRET_TEXT_PATTERN, (_match, key: string, sep: string, quote: string) =>
    `${key}${sep}${quote}${mask}`,
  );
}

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

/**
 * `POST /api/runs` 가 **실제로 받는 요청 body**.
 *
 * `CreateRunDtoSchema` 와 필드 구성은 같지만 `baseUrl` · `envLabel` 이 **선택**이다.
 * 생략하면 서버가 `projects.base_url` / `projects.default_env_label` 로 채운다
 * (02-context "★ 사용자 최종 결정" (a) — 프로젝트 값은 기본값, 요청 값이 우선).
 *
 * ★ `CreateRunDtoSchema` 는 손대지 않았다. 기본값을 채운 뒤의 형태가 `CreateRunDto` 이고,
 *   이 스키마는 그 **입력 단계**를 표현한다. runner 로 나가는 큐 페이로드는
 *   언제나 `baseUrl` · `envLabel` 이 채워진 상태다.
 */
export const CreateRunRequestSchema = z
  .object({
    scenarioId: z.uuid().optional(),
    suiteId: z.uuid().optional(),
    /**
     * ★ 라운드 7 — **여러 시나리오를 한 번에** 실행한다(시나리오 목록의 다중 선택).
     *
     * 스위트와 **같은 규약**이다: `batch_id` 하나로 묶인 run N건이 생기고 부모 run 은 없다.
     * 다른 점은 순서의 출처뿐이다 — 스위트는 `suite_scenarios.sequence`, 여기는
     * **요청 배열의 순서**다. 서버는 그 순서를 그대로 `batch_sequence` 로 쓴다.
     *
     * 상한 50 은 `RunListQuerySchema.limit` 상한(100)의 절반이다 — 한 번의 요청이
     * 묶음 화면 한 장에 들어가지 않을 만큼 커지지 않게 막는 값이고, DB 상한이 아니다.
     */
    scenarioIds: z.array(z.uuid()).min(1).max(50).optional(),
    baseUrl: z.url().max(500).optional(),
    envLabel: z.string().min(1).max(50).optional(),
    browser: BrowserSchema.default("chromium"),
    variables: z.record(z.string().min(1).max(100), z.string().max(2000)).default({}),
    secretKeys: z.array(z.string().min(1).max(100)).default([]),
  })
  .superRefine((dto, ctx) => {
    const given = [dto.scenarioId, dto.suiteId, dto.scenarioIds].filter(
      (value) => value !== undefined,
    ).length;
    if (given === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["scenarioId"],
        message: "scenarioId · scenarioIds · suiteId 중 하나는 반드시 필요합니다.",
      });
    }
    if (given > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["suiteId"],
        message: "scenarioId · scenarioIds · suiteId 중 하나만 지정할 수 있습니다.",
      });
    }
    if (dto.scenarioIds !== undefined && new Set(dto.scenarioIds).size !== dto.scenarioIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["scenarioIds"],
        message: "같은 시나리오를 두 번 담을 수 없습니다.",
      });
    }
  });
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

/* ────────────────────────────────────────────────────────────
 * BullMQ 큐 규약  (api 가 등록하고 runner 가 소비한다)
 * ──────────────────────────────────────────────────────────── */

/** BullMQ 큐 이름. `BullModule.registerQueue({name: RUN_QUEUE_NAME})` / Worker 양쪽이 쓴다. */
export const RUN_QUEUE_NAME = "run";

/** 큐에 넣는 job 이름. */
export const RUN_JOB_NAME = "execute";

/**
 * 큐 페이로드.
 *
 * ★ **`variables` 의 평문은 여기에만 존재한다.** `runs` 테이블에는 컬럼 자체가 없고,
 *   job 은 완료 후 `removeOnComplete` 로 만료된다 (02-context "★ 최종 결정" (c)).
 *   Runner 는 이 값을 `{{변수}}` 치환에만 쓰고 DB 나 로그로 흘리지 않는다.
 */
export const RunJobDataSchema = z.object({
  runId: z.uuid(),
  projectId: z.uuid(),
  scenarioId: z.uuid().nullable(),
  suiteId: z.uuid().nullable(),
  batchId: z.uuid().nullable(),
  /** 같은 batch 안에서의 실행 순서(`suite_scenarios.sequence`). 단건 실행이면 1. */
  batchSequence: z.number().int().positive(),
  baseUrl: z.string().max(500),
  envLabel: z.string().max(50),
  browser: BrowserSchema,
  /**
   * 라운드 2 추가 — Runner 의 실행 엔진 분기 키 (03-phases 쟁점 2 · Task 3.7).
   *
   * `steps` → `execute/interpreter.ts` (라운드 1 경로, 무변경).
   * `code`  → `playwright test` 외부 프로세스.
   *
   * ★ **코드 본문(`scenario_codes.content`)은 이 페이로드에 싣지 않는다.**
   *   Runner 가 `scenarioId` 로 DB 에서 읽는다. 근거:
   *   ① job 은 완료 후 1시간 남는다(`removeOnComplete:{age:3600}`) — 최대 256KiB 본문을
   *      run 마다 Redis 에 복제할 이유가 없다.
   *   ② 이 페이로드에서 **민감한 것은 `variables` 하나**라는 성질을 유지해야 감사가 쉽다.
   *   ③ Runner 는 이미 DataSource 를 갖고 있다(`step_results` 를 직접 쓴다).
   *   대가: 큐 등록 ~ 실행 사이에 본문이 바뀌면 **바뀐 본문이 실행된다**(스냅샷이 아니다).
   *   큐 대기는 보통 수 초이고, 본문 스냅샷이 필요해지면 `runs` 에 컬럼이 아니라
   *   `run_codes` 스냅샷 테이블을 새로 두어야 한다(`runs` 를 뜨겁게 만들지 않기 위해).
   */
  sourceType: ScenarioSourceTypeSchema,
  variables: z.record(z.string(), z.string()),
  secretKeys: z.array(z.string()),
});
export type RunJobData = z.infer<typeof RunJobDataSchema>;

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

/**
 * `GET /api/runs/queue` — **큐가 실제로 어떻게 생겼는가.** (라운드 7)
 *
 * ★ 왜 만들었나 — 시나리오를 5건 골라 "한 번에 실행"을 누르면 run 은 5건 생기지만
 *   **실제로 동시에 도는 것은 Runner 의 `RUNNER_CONCURRENCY` 개수뿐**이다(기본 2).
 *   화면이 그것을 말하지 않으면 "병렬 실행"이라는 표시 자체가 거짓말이 된다.
 *   여기서 주는 값은 전부 **관측값**이다 — 설정을 복사해 오지 않는다.
 */
export const RunQueueStatusSchema = z.object({
  /** BullMQ `waiting` 개수(아직 아무도 집어 가지 않은 job). */
  waiting: z.number().int().nonnegative(),
  /** BullMQ `active` 개수(Runner 가 집어 가서 도는 중). */
  active: z.number().int().nonnegative(),
  /**
   * 살아 있는 Runner 들의 동시 실행 한도 **합계**. heartbeat 가 없으면 `null` 이다
   * (Runner 가 안 떠 있거나 구버전 — 한도를 **지어내지 않는다**).
   */
  concurrency: z.number().int().positive().nullable(),
  /** heartbeat 가 살아 있는 Runner 수. */
  runners: z.number().int().nonnegative(),
  /**
   * 대기 중인 job 의 **runId 를 큐 순서대로**. `jobId = runId` 규약을 그대로 쓴다.
   * 화면이 "이 실행은 대기 N번째"를 계산하는 근거다. 너무 길어지지 않게 앞에서 자른다.
   */
  waitingRunIds: z.array(z.string()).max(100),
});
export type RunQueueStatus = z.infer<typeof RunQueueStatusSchema>;

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
  /**
   * 라운드 2 추가 — **실행 시점 스냅샷**(`runs.source_type`). 조인이 아니다.
   *
   * 화면이 "이 실행은 코드 실행인가"를 알아야 라이브 뷰를 열지 / 대기 행을 그릴지 정한다.
   * `scenarios` 조인으로 읽으면 **시나리오가 삭제된 뒤 이력에서 값이 사라진다**
   * (`runs.scenario_id` 는 SET NULL 이다). `scenario_name`·`base_url` 을 스냅샷으로 둔
   * 라운드 1 원칙과 같은 이유로 컬럼에 고정한다.
   */
  sourceType: ScenarioSourceTypeSchema,
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
