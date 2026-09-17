import { z } from "zod";

/**
 * ★ 이 파일은 TestFlow 에서 가장 중요한 계약이다.
 *
 * web(스텝 편집 폼) · api(요청 검증) · runner(스텝 해석) 세 런타임이 동시에 의존한다.
 * 나중에 모양을 바꾸면 세 곳이 함께 깨지므로, 변경 시에는 반드시 세 곳을 같이 고친다.
 *
 * 저장 위치: `test_steps.action_type` / `test_steps.target_json`
 *          / `test_steps.input_json` / `test_steps.options_json`
 */

/* ────────────────────────────────────────────────────────────
 * 1. ActionType — 스텝의 동작 종류
 * ──────────────────────────────────────────────────────────── */

export const ACTION_TYPES = [
  "goto",
  "click",
  "fill",
  "select",
  "check",
  "uncheck",
  "press",
  "hover",
  "assert_visible",
  "assert_text",
  "assert_url",
  "wait",
] as const;

export const ActionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof ActionTypeSchema>;

/**
 * 시안 스텝 카드의 `<code>` 칩 4종(이동/입력/클릭/확인)과의 대응표.
 * 화면에서 칩 라벨을 계산할 때 이 표만 쓴다 — web 에서 재정의 금지.
 */
export const ACTION_CHIP_LABEL = {
  goto: "이동",
  click: "클릭",
  fill: "입력",
  select: "입력",
  check: "입력",
  uncheck: "입력",
  press: "입력",
  hover: "클릭",
  assert_visible: "확인",
  assert_text: "확인",
  assert_url: "확인",
  wait: "대기",
} as const satisfies Record<ActionType, string>;

/**
 * 인스펙터의 "동작" select 에 노출되는 검증 동작 3종.
 * 문구는 01-clarify 디자인 시안 그대로다.
 */
export const ASSERTION_ACTION_LABEL = {
  assert_visible: "화면에 표시되는지 확인",
  assert_text: "텍스트 값 확인",
  assert_url: "URL 확인",
} as const;

export type AssertionActionType = keyof typeof ASSERTION_ACTION_LABEL;

/* ────────────────────────────────────────────────────────────
 * 2. Locator — 단일 값이 아니라 "순위 배열"이다 (FR-004)
 * ──────────────────────────────────────────────────────────── */

/**
 * Locator 후보 판별자. 우선순위는 role → label → text → testid → (fallback) css.
 *
 * ★ 판별 필드 이름은 `by` 다 (02-context `target_json` 주석 블록 및
 *   03-phases Task 2.1 / Task 4.7 의 `by:'css'` 표기 기준).
 */
export const LOCATOR_BY = ["role", "label", "text", "testid", "css"] as const;
export const LocatorBySchema = z.enum(LOCATOR_BY);
export type LocatorBy = z.infer<typeof LocatorBySchema>;

/** 후보가 여러 개 매칭될 때만 쓰는 0-based 순번. 없으면 "유일해야 한다"는 뜻이다. */
const nthField = {
  nth: z.number().int().nonnegative().optional(),
};

/** 1순위: 접근성 역할 + accessible name → `getByRole('button', { name: '로그인' })` */
export const RoleLocatorSchema = z.object({
  by: z.literal("role"),
  role: z.string().min(1),
  name: z.string().optional(),
  exact: z.boolean().optional(),
  ...nthField,
});

/** 2순위: label / aria-label / aria-labelledby → `getByLabel('아이디')` */
export const LabelLocatorSchema = z.object({
  by: z.literal("label"),
  value: z.string().min(1),
  exact: z.boolean().optional(),
  ...nthField,
});

/** 3순위: 가시 텍스트 → `getByText('로그인')` */
export const TextLocatorSchema = z.object({
  by: z.literal("text"),
  value: z.string().min(1),
  exact: z.boolean().optional(),
  ...nthField,
});

/** 4순위: data-testid → `getByTestId('login-submit')` */
export const TestIdLocatorSchema = z.object({
  by: z.literal("testid"),
  value: z.string().min(1),
  ...nthField,
});

/**
 * 5순위(최후 fallback): CSS 선택자.
 *
 * ★ 고급 설정 전용 — 테스터 화면에 절대 노출하지 않는다.
 *   API 응답에서는 `toPublicLocatorTarget()` 으로 기본 제외하고,
 *   `?advanced=1` 일 때만 원본을 그대로 내보낸다.
 */
export const CssLocatorSchema = z.object({
  by: z.literal("css"),
  value: z.string().min(1),
  ...nthField,
});

export const LocatorCandidateSchema = z.discriminatedUnion("by", [
  RoleLocatorSchema,
  LabelLocatorSchema,
  TextLocatorSchema,
  TestIdLocatorSchema,
  CssLocatorSchema,
]);
export type LocatorCandidate = z.infer<typeof LocatorCandidateSchema>;

/** css 를 제외한 후보 — 테스터에게 보여도 되는 것들. */
export const PublicLocatorCandidateSchema = z.discriminatedUnion("by", [
  RoleLocatorSchema,
  LabelLocatorSchema,
  TextLocatorSchema,
  TestIdLocatorSchema,
]);
export type PublicLocatorCandidate = z.infer<typeof PublicLocatorCandidateSchema>;

/** 실패 진단용 스냅샷. 재생에는 쓰지 않는다(참고 정보). */
export const LocatorSnapshotSchema = z.object({
  tag: z.string().min(1),
  attrs: z.record(z.string(), z.string()).optional(),
  text: z.string().optional(),
});
export type LocatorSnapshot = z.infer<typeof LocatorSnapshotSchema>;

/**
 * `test_steps.target_json` 의 형태.
 *
 * runner 의 `locator.ts` 는 primary 실패(또는 매칭 0개·2개 이상) 시
 * fallbacks 를 **순서대로** 시도하고, 성공한 단계를 `resolvedBy` 로 기록한다.
 */
export const LocatorTargetSchema = z.object({
  primary: LocatorCandidateSchema,
  fallbacks: z.array(LocatorCandidateSchema).default([]),
  /** iframe 안의 요소면 그 frame 의 URL. 최상위 문서면 null. */
  frameUrl: z.string().nullable().optional(),
  snapshot: LocatorSnapshotSchema.nullable().optional(),
});
export type LocatorTarget = z.infer<typeof LocatorTargetSchema>;

/**
 * API 응답용 Locator. css 후보가 전부 제거된 형태다.
 * primary 가 css 였던 경우 primary 는 `null` 이 된다(문자열 "css" 자체가 응답에 남지 않도록).
 */
export const PublicLocatorTargetSchema = z.object({
  primary: PublicLocatorCandidateSchema.nullable(),
  fallbacks: z.array(PublicLocatorCandidateSchema),
  frameUrl: z.string().nullable().optional(),
  snapshot: LocatorSnapshotSchema.nullable().optional(),
});
export type PublicLocatorTarget = z.infer<typeof PublicLocatorTargetSchema>;

const isPublicCandidate = (c: LocatorCandidate): c is PublicLocatorCandidate => c.by !== "css";

/**
 * CSS 후보를 제거한다. API 응답 직렬화 직전에 반드시 통과시킨다.
 * (03-phases Task 4.7 — 기본 응답 JSON 에 문자열 "css" 가 나타나면 안 된다)
 */
export function toPublicLocatorTarget(target: LocatorTarget): PublicLocatorTarget {
  const primary = isPublicCandidate(target.primary) ? target.primary : null;
  return {
    primary,
    fallbacks: target.fallbacks.filter(isPublicCandidate),
    frameUrl: target.frameUrl ?? null,
    snapshot: target.snapshot ?? null,
  };
}

/** primary + fallbacks 를 시도 순서대로 편 배열. runner 의 해석 진입점. */
export function locatorChain(target: LocatorTarget): LocatorCandidate[] {
  return [target.primary, ...target.fallbacks];
}

/* ────────────────────────────────────────────────────────────
 * 3. 입력값 / 옵션
 * ──────────────────────────────────────────────────────────── */

/**
 * `test_steps.input_json`.
 *
 * - `fill` / `select` / `press`: 입력할 값
 * - `goto`: 이동할 URL (`{{baseUrl}}/login` 처럼 변수 포함 가능)
 * - `assert_text` / `assert_url`: **기대값**
 *
 * `isSecret: true` 인 값은 화면에 `••••••••` 로 표시하고, 실제 값은
 * 실행 요청 body 의 `variables` 로만 들어온다. DB 에는 `{{password}}` 같은
 * 변수 참조만 남는다 (02-context "★ 사용자 최종 결정" (c)).
 */
export const TestStepInputSchema = z.object({
  value: z.string().max(2000),
  isSecret: z.boolean().default(false),
});
export type TestStepInput = z.infer<typeof TestStepInputSchema>;

/** 인스펙터 "최대 대기 시간" select 의 선택지 (시안: 5초 · 10초 · 30초). */
export const STEP_TIMEOUT_CHOICES_MS = [5000, 10000, 30000] as const;
export const DEFAULT_STEP_TIMEOUT_MS = 10000;

/** `test_steps.options_json`. */
export const TestStepOptionsSchema = z.object({
  /** 최대 대기 시간(ms). 시안 select 는 5000/10000/30000 만 노출한다. */
  timeoutMs: z.number().int().min(100).max(300_000).default(DEFAULT_STEP_TIMEOUT_MS),
  /** true 면 실패해도 시나리오를 계속 진행한다(스텝은 `skipped` 로 기록). */
  optional: z.boolean().default(false),
  /** `action_type: 'wait'` 전용 — 고정 대기 시간(ms). */
  waitMs: z.number().int().positive().max(300_000).optional(),
});
export type TestStepOptions = z.infer<typeof TestStepOptionsSchema>;

export const DEFAULT_STEP_OPTIONS: TestStepOptions = {
  timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
  optional: false,
};

/* ────────────────────────────────────────────────────────────
 * 4. TestStep
 * ──────────────────────────────────────────────────────────── */

/** target 이 반드시 있어야 하는 동작. */
const ACTIONS_REQUIRING_TARGET = new Set<ActionType>([
  "click",
  "fill",
  "select",
  "check",
  "uncheck",
  "press",
  "hover",
  "assert_visible",
  "assert_text",
]);

/** input.value 가 반드시 있어야 하는 동작. */
const ACTIONS_REQUIRING_INPUT = new Set<ActionType>([
  "goto",
  "fill",
  "select",
  "press",
  "assert_text",
  "assert_url",
]);

/**
 * 확장 가능한 원형(ZodObject). `.extend()` / `.omit()` 이 필요하면 이쪽을 쓴다.
 * 교차 필드 검증까지 포함한 최종 스키마는 아래 `TestStepSchema` 다.
 */
export const TestStepBaseSchema = z.object({
  /** 서버가 부여한다. 신규 작성/녹화 초안 단계에서는 없다. */
  id: z.uuid().optional(),
  scenarioId: z.uuid().optional(),
  /** 1부터. 재정렬 시 전량 재기입된다 (`uq_test_steps_seq`). */
  sequence: z.number().int().positive(),
  /** 업무 단계 이름. 예: "아이디 입력" */
  name: z.string().min(1).max(200),
  actionType: ActionTypeSchema,
  target: LocatorTargetSchema.nullable().optional(),
  input: TestStepInputSchema.nullable().optional(),
  options: TestStepOptionsSchema.default(DEFAULT_STEP_OPTIONS),
});

function checkStepShape(step: z.infer<typeof TestStepBaseSchema>, ctx: z.RefinementCtx): void {
  const { actionType, target, input, options } = step;

  if (ACTIONS_REQUIRING_TARGET.has(actionType) && !target) {
    ctx.addIssue({
      code: "custom",
      path: ["target"],
      message: `'${actionType}' 동작에는 대상(target)이 필요합니다.`,
    });
  }

  if (ACTIONS_REQUIRING_INPUT.has(actionType) && !input) {
    ctx.addIssue({
      code: "custom",
      path: ["input"],
      message: `'${actionType}' 동작에는 값(input)이 필요합니다.`,
    });
  }

  if (actionType === "goto" && target) {
    ctx.addIssue({
      code: "custom",
      path: ["target"],
      message: "'goto' 동작에는 대상(target)을 지정할 수 없습니다.",
    });
  }

  if (actionType === "wait" && options.waitMs === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["options", "waitMs"],
      message: "'wait' 동작에는 options.waitMs 가 필요합니다.",
    });
  }
}

/** ★ 단일 타입 소스. web·api·runner 는 이 스키마만 쓴다. */
export const TestStepSchema = TestStepBaseSchema.superRefine(checkStepShape);

/** 파싱 결과(기본값이 채워진 형태). 저장·해석은 이 타입을 쓴다. */
export type TestStep = z.infer<typeof TestStepSchema>;
/** 파싱 입력(기본값 생략 가능한 형태). 요청 body 타입은 이쪽이다. */
export type TestStepPayload = z.input<typeof TestStepSchema>;

/**
 * 녹화 중 생성되는 스텝 초안.
 * `sequence` 는 녹화 종료 후 시나리오에 반영할 때 부여하므로 아직 없다.
 */
export const DraftStepSchema = TestStepBaseSchema.omit({
  id: true,
  scenarioId: true,
  sequence: true,
}).superRefine((draft, ctx) => {
  checkStepShape({ ...draft, sequence: 1 }, ctx);
});
export type DraftStep = z.infer<typeof DraftStepSchema>;

/** 스텝 배열 — 시퀀스가 1..n 으로 연속인지까지 본다. */
export const TestStepArraySchema = z.array(TestStepSchema).superRefine((steps, ctx) => {
  steps.forEach((step, index) => {
    if (step.sequence !== index + 1) {
      ctx.addIssue({
        code: "custom",
        path: [index, "sequence"],
        message: `sequence 는 1부터 연속이어야 합니다 (기대: ${String(index + 1)}, 실제: ${String(step.sequence)}).`,
      });
    }
  });
});

/** 화면 표시용 마스킹 문자열 (시안 `••••••••`). */
export const SECRET_MASK = "••••••••";

/** 스텝의 표시용 값. Secret 이면 마스킹된 문자열을 돌려준다. */
export function displayStepValue(step: Pick<TestStep, "input">): string {
  if (!step.input) return "";
  return step.input.isSecret ? SECRET_MASK : step.input.value;
}

/* ── 5. API 응답용 스텝 (css 제거본) ─────────────────────── */

/**
 * ★ API 응답 전용 스텝. `target` 이 `PublicLocatorTarget`(css 제거본)이다.
 *
 * `TestStepSchema` 로는 이 형태를 표현할 수 없다 — `PublicLocatorTarget.primary` 가
 * nullable 이기 때문이다(primary 자체가 css 였던 경우). 그래서 별도 스키마를 둔다.
 * **필드 이름·구조는 `TestStepBaseSchema` 와 완전히 동일하고 `target` 만 좁혀진다.**
 *
 * 사용처: `GET /api/scenarios/:id`, `PUT/POST /api/scenarios/:id/steps`,
 *        `PATCH /api/steps/:stepId` 의 **응답**. `?advanced=1` 이면 원본 `TestStep` 을 낸다.
 */
export const PublicTestStepSchema = TestStepBaseSchema.extend({
  target: PublicLocatorTargetSchema.nullable(),
});
export type PublicTestStep = z.infer<typeof PublicTestStepSchema>;

/** API 응답 직렬화 직전에 통과시킨다. `target` 의 css 후보가 전부 제거된다. */
export function toPublicTestStep(step: TestStep): PublicTestStep {
  return {
    ...step,
    target: step.target ? toPublicLocatorTarget(step.target) : null,
  };
}

/** 응답에 실려 나갈 수 있는 스텝 형태. `?advanced=1` 여부에 따라 둘 중 하나다. */
export type ApiTestStep = TestStep | PublicTestStep;
