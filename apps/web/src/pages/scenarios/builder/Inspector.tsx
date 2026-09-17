import { useState } from "react";
import type * as React from "react";
import {
  ASSERTION_ACTION_LABEL,
  ACTION_CHIP_LABEL,
  SECRET_MASK,
  STEP_TIMEOUT_CHOICES_MS,
  TestStepSchema,
  type ActionType,
  type AssertionActionType,
  type PatchStepDto,
  type PublicTestStep,
  type TestStep,
} from "@testflow/contracts";
import { Button, Input, Select } from "@/components/ui";
import { describeTarget, formatSeconds, stepNumberLabel } from "@/lib/step-text";

/**
 * 시안 `.inspector` 1:1 (Task 10.3).
 *
 * ```
 * grid 의 우측 330px 열 · sticky top:88px (1050px 미만 static — tf-inspector-sticky)
 * inspector-head : padding 18px · 하단 라인 · h2 15px · p 11px muted
 * field          : padding 0 18px · margin-top 16px · label 10px/750
 * hint           : margin 16px 18px · bg --color-hint · 10px / line-height 1.5
 * actions        : padding 18px · flex gap 8px · 버튼 flex:1
 * ```
 *
 * ★★ **CSS 선택자를 테스터 화면에 그리지 않는다.**
 *   기본 응답은 API 가 이미 css 후보를 제거해서 보낸다. 게다가 이 화면은
 *   "고급 설정"이 꺼져 있으면 `?advanced=1` **요청 자체를 하지 않는다** —
 *   화면에 안 그리는 게 아니라 **브라우저 메모리에 들어오지도 않는다**.
 *
 * ★ 동작 select 에 노출되는 검증 3종은 contracts 의 `ASSERTION_ACTION_LABEL` 이다.
 *   최대 대기 시간 선택지는 `STEP_TIMEOUT_CHOICES_MS`(5·10·30초)다. web 재정의 금지.
 */

/** 시안 힌트 문구 — 한 글자도 바꾸지 않는다. */
const HINT_TEXT =
  "요소를 찾을 때 접근성 역할과 표시 텍스트를 우선 사용합니다. CSS 선택자는 고급 설정에서만 노출됩니다.";

/**
 * "값" 입력칸의 라벨. **키 집합이 contracts 의 `ACTIONS_REQUIRING_INPUT` 과 같다.**
 * 그 집합은 contracts 가 export 하지 않으므로 여기 표가 사실상의 사본인데,
 * 어긋나면 전송 직전 `TestStepSchema.safeParse` 가 먼저 잡는다(아래 `buildPatch`).
 */
const VALUE_FIELD_LABEL = {
  goto: "이동할 주소",
  fill: "입력할 값",
  select: "선택할 값",
  press: "입력할 키",
  assert_text: "기대 텍스트",
  assert_url: "확인할 대상",
} as const;

type ValueAction = keyof typeof VALUE_FIELD_LABEL;

function hasValueField(action: ActionType): action is ValueAction {
  return action in VALUE_FIELD_LABEL;
}

/** 대상(요소)이 있어야 하는 검증. `assert_url` 은 요소가 필요 없다. */
const ELEMENT_ASSERTIONS: readonly AssertionActionType[] = ["assert_visible", "assert_text"];

function isAssertion(action: ActionType): action is AssertionActionType {
  return action in ASSERTION_ACTION_LABEL;
}

export type InspectorProps = {
  step: PublicTestStep | undefined;
  /** 고급 설정 토글 상태. 켜져 있을 때만 `advancedStep` 이 들어온다. */
  advanced: boolean;
  onAdvancedChange: (next: boolean) => void;
  advancedStep: TestStep | undefined;
  onApply: (stepId: string, dto: PatchStepDto) => void;
  onDelete: (stepId: string) => void;
  busy: boolean;
};

export function Inspector(props: InspectorProps) {
  const { step } = props;

  return (
    <aside
      data-slot="inspector"
      className="tf-inspector-sticky rounded-panel border border-line bg-panel"
    >
      <div className="border-b border-line p-[18px]">
        <h2 className="mb-[4px] text-inspector-title">
          {step === undefined ? "스텝 설정" : `스텝 ${stepNumberLabel(step.sequence)} 설정`}
        </h2>
        <p className="m-0 text-[11px] text-muted">사용자에게 보이는 이름과 확인 조건</p>
      </div>

      {step === undefined ? (
        <p className="m-0 px-[18px] py-[28px] text-center text-[11px] leading-[1.6] text-muted">
          왼쪽에서 단계를 선택하면
          <br />
          이름과 확인 조건을 바꿀 수 있습니다.
        </p>
      ) : (
        // ★ `key` 로 폼을 다시 만든다 — 선택한 스텝이 바뀔 때 로컬 편집값을
        //   `useEffect` 로 동기화하지 않기 위해서다(규율: useEffect 자제).
        <InspectorForm key={step.id ?? String(step.sequence)} {...props} step={step} />
      )}
    </aside>
  );
}

function InspectorForm({
  step,
  advanced,
  onAdvancedChange,
  advancedStep,
  onApply,
  onDelete,
  busy,
}: InspectorProps & { step: PublicTestStep }) {
  const [name, setName] = useState(step.name);
  const [actionType, setActionType] = useState<ActionType>(step.actionType);
  const [value, setValue] = useState(step.input?.value ?? "");
  const [targetText, setTargetText] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(step.options.timeoutMs);
  const [error, setError] = useState<string | null>(null);

  const isSecret = step.input?.isSecret === true;
  const recordedTarget = step.target ?? null;
  const targetLabel = describeTarget(recordedTarget);
  const needsElement = (ELEMENT_ASSERTIONS as readonly ActionType[]).includes(actionType);
  /** 요소 대상을 새로 적어야 하는 경우 = 녹화된 대상이 없는데 요소 검증을 고른 때. */
  const needsNewTarget = needsElement && recordedTarget === null;

  const actionOptions = buildActionOptions(step.actionType);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (step.id === undefined) return;

    const built = buildPatch({
      step,
      name: name.trim(),
      actionType,
      value,
      targetText: targetText.trim(),
      timeoutMs,
    });
    if (typeof built === "string") {
      setError(built);
      return;
    }
    setError(null);
    onApply(step.id, built);
  };

  return (
    <form onSubmit={apply}>
      <Field label="업무 단계 이름">
        <Input
          value={name}
          data-testid="inspector-name"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </Field>

      <Field label="동작">
        <Select
          value={actionType}
          data-testid="inspector-action"
          onChange={(event) => {
            setActionType(event.target.value as ActionType);
          }}
        >
          {actionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      {/* 요소 대상 — 녹화된 것이 있으면 읽기 전용 문장이다(선택자를 노출하지 않는다). */}
      {needsElement || actionType === "click" || actionType === "hover" ? (
        <Field label="확인할 대상">
          {needsNewTarget ? (
            <Input
              value={targetText}
              placeholder="화면에 보이는 문구 (예: 오늘 실행)"
              data-testid="inspector-target"
              onChange={(event) => {
                setTargetText(event.target.value);
              }}
            />
          ) : (
            <p
              data-testid="inspector-target-readonly"
              className="m-0 rounded-input border border-line bg-hint px-[10px] py-[11px] text-[11px] leading-[1.5] text-hint-ink"
            >
              {targetLabel === "" ? "기록된 대상이 없습니다" : targetLabel}
            </p>
          )}
        </Field>
      ) : null}

      {hasValueField(actionType) ? (
        <Field label={VALUE_FIELD_LABEL[actionType]}>
          {isSecret ? (
            <Input
              value={SECRET_MASK}
              disabled
              aria-label="보안 값 (표시되지 않습니다)"
              data-testid="inspector-secret"
            />
          ) : (
            <Input
              value={value}
              data-testid="inspector-value"
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
          )}
        </Field>
      ) : null}

      <Field label="최대 대기 시간">
        <Select
          value={String(timeoutMs)}
          data-testid="inspector-timeout"
          onChange={(event) => {
            setTimeoutMs(Number(event.target.value));
          }}
        >
          {STEP_TIMEOUT_CHOICES_MS.map((ms) => (
            <option key={ms} value={ms}>
              {formatSeconds(ms)}
            </option>
          ))}
          {/* 녹화·API 가 목록 밖의 값을 갖고 있을 수 있다. 그 값을 조용히 바꾸지 않는다. */}
          {(STEP_TIMEOUT_CHOICES_MS as readonly number[]).includes(timeoutMs) ? null : (
            <option value={timeoutMs}>{formatSeconds(timeoutMs)}</option>
          )}
        </Select>
      </Field>

      <p className="mx-[18px] my-[16px] rounded-btn bg-hint p-[11px] text-[10px] leading-[1.5] text-hint-ink">
        {HINT_TEXT}
      </p>

      <AdvancedPanel
        advanced={advanced}
        onAdvancedChange={onAdvancedChange}
        advancedStep={advancedStep}
      />

      {error === null ? null : (
        <p role="alert" className="mx-[18px] mb-[4px] text-[10px] leading-[1.5] text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-[8px] p-[18px]">
        <Button
          variant="danger"
          className="flex-1"
          disabled={busy || step.id === undefined}
          onClick={() => {
            if (step.id !== undefined) onDelete(step.id);
          }}
        >
          삭제
        </Button>
        <Button variant="primary" type="submit" className="flex-1" disabled={busy}>
          적용
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-[16px] block px-[18px]">
      <span className="mb-[7px] block text-label text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * 동작 select 의 선택지.
 *
 * - 현재 동작이 검증이 아니면(녹화된 클릭·입력 등) **그 동작을 첫 줄에 남긴다.**
 *   남기지 않으면 select 를 여는 순간 값이 검증으로 바뀐 것처럼 보인다.
 * - 검증 3종은 시안 문구 그대로 항상 노출한다. 대상 요소가 없는 스텝에서
 *   `화면에 표시되는지 확인`·`텍스트 값 확인` 을 고르면 아래 `확인할 대상` 칸이 열려
 *   화면에 보이는 문구로 대상을 만들 수 있다.
 */
function buildActionOptions(current: ActionType): { value: ActionType; label: string }[] {
  const options: { value: ActionType; label: string }[] = [];
  if (!isAssertion(current)) {
    options.push({ value: current, label: `${ACTION_CHIP_LABEL[current]} — 녹화된 동작` });
  }
  for (const [action, label] of Object.entries(ASSERTION_ACTION_LABEL)) {
    options.push({ value: action as ActionType, label });
  }
  return options;
}

type BuildPatchInput = {
  step: PublicTestStep;
  name: string;
  actionType: ActionType;
  value: string;
  targetText: string;
  timeoutMs: number;
};

/**
 * 폼 값 → `PATCH /api/steps/:id` body.
 *
 * ★ 보내기 전에 **contracts 의 `TestStepSchema` 로 합쳐진 결과를 검증**한다.
 *   화면이 자체 규칙을 다시 쓰지 않고 계약 그대로를 쓰기 위해서다
 *   (어떤 동작에 target/input 이 필요한지는 계약이 이미 알고 있다).
 *   실패하면 첫 메시지를 그대로 보여 준다 — 서버 400 을 왕복하지 않는다.
 *
 * 반환이 문자열이면 오류 메시지다.
 */
export function buildPatch(input: BuildPatchInput): PatchStepDto | string {
  const { step, name, actionType, value, targetText, timeoutMs } = input;
  if (name === "") return "업무 단계 이름을 입력해 주세요.";

  const dto: PatchStepDto = {
    name,
    actionType,
    options: { ...step.options, timeoutMs },
  };

  if (hasValueField(actionType)) {
    // Secret 스텝은 값 대신 **변수 참조**(`{{password}}`)를 갖고 있다. 그대로 돌려보낸다 —
    // 화면이 `••••••••` 를 보내면 그 문자열이 진짜 값으로 저장돼 버린다.
    dto.input =
      step.input?.isSecret === true
        ? { value: step.input.value, isSecret: true }
        : { value, isSecret: false };
  } else {
    dto.input = null;
  }

  const needsElement = (ELEMENT_ASSERTIONS as readonly ActionType[]).includes(actionType);
  if (actionType === "goto") {
    dto.target = null;
  } else if (needsElement && step.target === null) {
    if (targetText === "") return "확인할 대상을 입력해 주세요.";
    dto.target = { primary: { by: "text", value: targetText }, fallbacks: [] };
  }

  const merged = {
    sequence: step.sequence,
    name: dto.name ?? step.name,
    actionType: dto.actionType ?? step.actionType,
    target: dto.target === undefined ? (step.target ?? null) : dto.target,
    input: dto.input === undefined ? (step.input ?? null) : dto.input,
    options: dto.options ?? step.options,
  };
  const parsed = TestStepSchema.safeParse(merged);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "값을 확인해 주세요.";

  return dto;
}

/**
 * 고급 설정.
 *
 * ★ 토글이 꺼져 있으면 부모가 `?advanced=1` 쿼리를 **비활성**으로 두므로
 *   css 문자열이 네트워크를 타지 않는다. 여기서는 받은 것만 그린다.
 */
function AdvancedPanel({
  advanced,
  onAdvancedChange,
  advancedStep,
}: {
  advanced: boolean;
  onAdvancedChange: (next: boolean) => void;
  advancedStep: TestStep | undefined;
}) {
  const chain =
    advancedStep?.target === null || advancedStep?.target === undefined
      ? []
      : [advancedStep.target.primary, ...advancedStep.target.fallbacks];

  return (
    <div className="mx-[18px] mb-[4px]">
      <label className="flex cursor-pointer items-center gap-[7px] text-[10px] font-750 text-muted">
        <input
          type="checkbox"
          data-testid="advanced-toggle"
          checked={advanced}
          onChange={(event) => {
            onAdvancedChange(event.target.checked);
          }}
          className="h-[13px] w-[13px] accent-brand"
        />
        고급 설정 (개발자용 선택자 표시)
      </label>

      {!advanced ? null : (
        <div data-testid="advanced-locators" className="mt-[8px]">
          {advancedStep === undefined ? (
            <p className="m-0 text-[10px] text-muted">불러오는 중…</p>
          ) : chain.length === 0 ? (
            <p className="m-0 text-[10px] text-muted">이 단계에는 요소 대상이 없습니다.</p>
          ) : (
            <ol className="m-0 list-none p-0">
              {chain.map((candidate, index) => (
                <li
                  key={`${candidate.by}-${String(index)}`}
                  className="mb-[4px] break-all rounded-[6px] bg-hint px-[8px] py-[6px] font-mono text-[10px] leading-[1.5] text-hint-ink"
                >
                  <b>{index === 0 ? "primary" : `fallback ${String(index)}`}</b> · {candidate.by} ·{" "}
                  {candidate.by === "role"
                    ? `${candidate.role}${candidate.name === undefined ? "" : ` "${candidate.name}"`}`
                    : candidate.value}
                  {candidate.nth === undefined ? "" : ` · nth=${String(candidate.nth)}`}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
