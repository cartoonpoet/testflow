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

/* ────────────────────────────────────────────────────────────
 * 시나리오의 원본 종류 (라운드 2 — 03-phases 쟁점 1)
 * ──────────────────────────────────────────────────────────── */

/**
 * 시나리오가 무엇으로 만들어졌는가.
 *
 * | 값 | 원본 | 실행 엔진 |
 * |---|---|---|
 * | `steps` | 녹화로 만든 `test_steps` JSON 스텝 | `execute/interpreter.ts` (라운드 1) |
 * | `code`  | 사용자가 넣은 `.spec.ts` 본문 1개 (`scenario_codes`) | `playwright test` 외부 프로세스 |
 *
 * ★ 생성 후 바뀌지 않는다. 스텝과 코드가 동시에 존재하는 상태를 만들면
 *   "어느 쪽으로 실행하는가" 규칙이 두 벌이 된다 (03-phases Task 2.1).
 *   그래서 `PatchScenarioDtoSchema` 에는 이 필드가 **없다**.
 */
export const SCENARIO_SOURCE_TYPES = ["steps", "code"] as const;
export const ScenarioSourceTypeSchema = z.enum(SCENARIO_SOURCE_TYPES);
export type ScenarioSourceType = z.infer<typeof ScenarioSourceTypeSchema>;

/** 화면 표기. web 에서 재정의 금지 (라운드 1 `SCENARIO_STATUS_LABEL` 규율과 동일). */
export const SCENARIO_SOURCE_TYPE_LABEL = {
  steps: "녹화",
  code: "코드",
} as const satisfies Record<ScenarioSourceType, string>;

export const ScenarioSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** 자동 채번. 시안 표기 예: `TC-AUTH-001` */
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  feature: z.string().max(80).nullable(),
  status: ScenarioStatusSchema,
  /** 라운드 2 추가. 기존 행은 마이그레이션 011 이 `steps` 로 백필한다. */
  sourceType: ScenarioSourceTypeSchema,
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
  /**
   * 라운드 2 추가. 6열에는 없지만 목록에서 **어느 편집 화면으로 보낼지**(빌더 ↔ 코드 에디터)와
   * "스텝 0개" notice 판정의 예외 처리에 쓴다(`code` 시나리오는 `stepCount` 가 항상 0이다).
   */
  sourceType: ScenarioSourceTypeSchema,
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
  /**
   * 기본값이 `steps` 다 — **기존 호출부(라운드 1 웹 화면)가 이 필드를 몰라도 그대로 통과해야 한다.**
   * 이것이 "추가"와 "변경"을 가르는 지점이다.
   */
  sourceType: ScenarioSourceTypeSchema.default("steps"),
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

/* ────────────────────────────────────────────────────────────
 * 코드 시나리오 본문 (`scenario_codes`) — 03-phases 쟁점 1
 * ──────────────────────────────────────────────────────────── */

/**
 * 코드 본문의 상한. **256KiB.**
 *
 * ## 왜 256KB 인가 (근거 — 03-phases 쟁점 1)
 * 이 값이 받는 것은 **Playwright codegen 산출물**이다. codegen 이 내는 spec 은 수 KB 다
 * (PoC 의 `codegen-login.spec.ts` 는 2KB 미만). 256KB 는 그 **수백 배**라
 * 정상 사용자를 막지 않으면서도 "붙여넣기 사고"(바이너리·로그 덤프)를 잘라낸다.
 *
 * 본문이 `scenarios` 가 아니라 **`scenario_codes` 1:1 테이블**에 있는 이유도 같은 절에 있다 —
 * `scenarios` 는 목록 화면이 페이지당 20행 읽는 뜨거운 테이블이고(라운드 1 실측 p95 6.3ms),
 * TypeORM `find()` 는 전 컬럼을 선택하므로 `MEDIUMTEXT` 를 붙이면 목록 조회가 코드 본문을 통째로 끌고 온다.
 *
 * ## 확장 지점 — 나중에 1:N 이 될 수 있게 남긴 것
 * ① `scenario_codes` 의 PK 는 `scenario_id` 가 아니라 **자체 `id`** 다. 1:1 은
 *    `uq_scenario_codes_scenario` **UNIQUE 제약 하나로만** 강제한다 →
 *    다중 파일로 가려면 그 제약 하나를 `(scenario_id, filename)` UNIQUE 로 바꾸면 된다(PK·FK 불변).
 * ② 본문의 정체성을 `scenarioId` 가 아니라 **`filename`** 이 갖는다 →
 *    `ScenarioCodeSchema` 배열이 그대로 파일 목록이 된다.
 * ③ 그래도 **이번 범위는 단일 파일**이다. 다중 파일은 가상 파일트리 + 상대 import 해석 +
 *    경로 쓰기 검증을 요구하고, 그 쓰기 검증이 곧 임의 경로 쓰기 취약점의 입구다.
 */
export const MAX_SCENARIO_CODE_BYTES = 256 * 1024;

/**
 * 파일명 규칙. **이 이름은 나중에 Runner 의 작업 디렉토리에 실제 파일로 쓰인다** —
 * 경로 구분자(`/`·`\`)와 상위 참조(`..`)를 여기서 막는다(라운드 1 storage traversal 방어와 같은 규율).
 * 확장자를 `.spec.ts` 로 고정하는 이유는 Playwright 의 기본 `testMatch` 가 그것이기 때문이다.
 */
export const SCENARIO_CODE_FILENAME_PATTERN = /^[A-Za-z0-9._-]+\.spec\.ts$/;

export const ScenarioCodeFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(SCENARIO_CODE_FILENAME_PATTERN, "파일명은 [A-Za-z0-9._-] 와 .spec.ts 확장자만 허용합니다.")
  .refine((name) => !name.includes(".."), { message: "파일명에 '..' 를 쓸 수 없습니다." });

/** 업로드·붙여넣기 경로가 파일명을 주지 않았을 때 쓰는 기본 파일명. */
export const DEFAULT_SCENARIO_CODE_FILENAME = "scenario.spec.ts";

/** `GET /api/scenarios/:id/code` 응답. 본문이 없으면 404 다(빈 문자열로 내려주지 않는다). */
export const ScenarioCodeSchema = z.object({
  scenarioId: z.uuid(),
  filename: ScenarioCodeFilenameSchema,
  content: z.string(),
  /** UTF-8 바이트 수. `content.length`(UTF-16 코드유닛)와 다르다 — `scenarioCodeByteLength()` 로 센다. */
  sizeBytes: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});
export type ScenarioCode = z.infer<typeof ScenarioCodeSchema>;

/**
 * `PUT /api/scenarios/:id/code` — upsert.
 *
 * ★ 업로드 전용 엔드포인트를 따로 만들지 않는다. 웹이 `File` 을 텍스트로 읽어 이리로 보낸다
 *   (multipart 를 받으려면 `main.ts` 의 `bodyParser:false` 부트스트랩에 미들웨어를 얹어야 하고,
 *   코드는 어차피 텍스트라 얻는 것이 없다 — 03-phases Task 2.2).
 *
 * 크기 상한은 여기서 검사하지 않는다. `validateScenarioCode()` 가 `too_large` **issue** 로 잡아
 * 400 응답의 `details` 에 줄 번호와 함께 실린다(zod 에러로 잘라 버리면 사용자가 이유를 못 본다).
 */
export const PutScenarioCodeDtoSchema = ScenarioCodeSchema.pick({
  filename: true,
  content: true,
});
export type PutScenarioCodeDto = z.infer<typeof PutScenarioCodeDtoSchema>;

/**
 * 코드 본문의 UTF-8 바이트 수.
 *
 * ★ `Buffer` 도 `TextEncoder` 도 쓰지 않는다 — `@testflow/contracts` 는 **브라우저(web)에서도
 *   import 되는 패키지**라 `types: []` / `lib: ["ES2023"]` 로 **어떤 런타임 전역에도 의존하지 않는다.**
 *   (`Buffer` 는 Node 전용이고, `TextEncoder` 는 DOM/Node 타입 중 하나를 끌어와야 한다.
 *   그 한 줄을 위해 lib 을 넓히면 `document` 같은 것도 같이 열린다.)
 *   그래서 코드 포인트를 직접 세는 순수 계산으로 둔다 — 결과는 `TextEncoder().encode().length` 와 같다.
 */
export function scenarioCodeByteLength(content: string): number {
  let bytes = 0;
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < content.length) {
      const next = content.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        // 서러게이트 쌍 = 1 코드포인트 = 4바이트.
        bytes += 4;
        i += 1;
      } else {
        // 짝 없는 서러게이트는 U+FFFD 로 인코딩된다(3바이트) — TextEncoder 와 같은 동작.
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export const PublishScenarioResponseSchema = z.object({
  status: z.literal("published"),
  version: z.number().int().positive(),
});
export type PublishScenarioResponse = z.infer<typeof PublishScenarioResponseSchema>;
