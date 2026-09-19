import type * as React from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BROWSERS,
  CreateRunRequestSchema,
  effectiveVariableDefault,
  isOptionalVariable,
  isSecretVariableKey,
  variablePrefillValue,
  type CreateRunResponse,
  type RunVariable,
} from "@testflow/contracts";
import { NoticeBox, NoticeLine } from "@/components";
import { Button, Input, Modal, Select } from "@/components/ui";
import { browserLabel, maskRecord } from "@/lib";
import { useCreateRun, useRunQueue } from "@/hooks/useRuns";
import { useHealth } from "@/hooks/useHealth";
import { useCurrentProject } from "@/hooks/useProject";
import { useScenarioVariables } from "@/hooks/useScenarioVariables";
import { toast } from "@/hooks/useToast";
import { useRunVariableForm } from "./useRunVariableForm";

/**
 * 실행 요청 다이얼로그 — ★ 이 MVP 의 **핵심 경로**.
 *
 * ## 왜 여기서 값을 직접 받나 (02-context "★ 사용자 최종 결정" (a)(c))
 * 실행 환경 관리 화면과 테스트 데이터 관리 화면이 MVP 에서 빠졌다. 그래서
 *  - **`baseUrl` 은 이 폼이 주 경로다.** `projects.base_url` 은 **기본값**으로 채워 두되
 *    그대로 고칠 수 있다(스테이징·개발 주소를 매번 바꿔 가며 돌리는 것이 실제 사용 방식이다).
 *  - **계정·비밀번호도 이 폼에서 직접 받는다.** DB 에는 저장할 컬럼 자체가 없고
 *    (`project_variables` 테이블을 만들지 않았다), 값은 `POST /api/runs` 의 `variables` 로만
 *    전달돼 BullMQ 큐 페이로드에 머물다 job 과 함께 만료된다.
 *
 * ## ★ 라운드 10 — 필수와 선택을 **갈라 보여 준다**
 * 라운드 9 가 변수 16개를 찾아내자 다이얼로그가 **빈 칸 16개**가 됐다. 그중 14개는
 * 코드에 기본값이 있어 **안 채워도 되는 칸**인데 화면에는 그 사실이 보이지 않았다.
 *  - 서버가 기본값까지 실어 준다(`RunVariable.defaultValue`).
 *  - **기본값이 없는 것만** 기본으로 보인다(= 넣지 않으면 실패하는 칸).
 *  - 기본값이 있는 것은 **접어 둔다.** 접힌 줄이 개수와 의미를 말하고,
 *    이미 값을 넣어 둔 것이 있으면 그 개수도 접힌 채로 보인다
 *    (안 그러면 "왜 이 값이 들어갔지"가 된다).
 *  - 펼치면 각 칸의 placeholder 가 **그 기본값**을 말한다.
 *  - 직접 추가한 변수는 **접지 않는다** — 자기가 넣은 것을 잃어버리면 안 된다.
 *
 * ## ★ 라운드 11 — ① 가드를 읽어 필수를 되찾고 ② 기본값을 **칸에 채운다**
 *
 * 라운드 10 을 배포하자 `project-save` 시나리오의 **계정·비밀번호가 접힌 섹션으로 숨었다.**
 * 원인은 가이드가 권하는 `.fill(process.env['TESTFLOW_VAR_username'] ?? '')` 의 `?? ''` 를
 * 기본값 스캐너가 "빈 문자열 기본값" 으로 읽은 것이다(타입 안전용인데). 이제 같은 코드에
 * 있는 **가드**(`for (const key of [...]) { if (!…) throw }`)를 읽어 그 키를 **필수**로
 * 올린다 — `contracts/run-variables.ts` 의 `extractCodeRequiredKeys()`.
 *
 * 그리고 placeholder 로만 알리던 기본값을 **칸에 실제 값으로 채운다.** 다만
 *  - 실행 시점에 정해지는 기본값(`` `test-${Date.now()}` ``)은 **채울 값이 없다** — 비워 둔다.
 *  - ★ **잘리거나 변형된 기본값은 절대 채우지 않는다.** placeholder 에 `…` 를 붙여
 *    보여 주는 것과 달리, 채우면 **원문과 다른 값이 그대로 전송된다.** 판정은
 *    `variablePrefillValue()` 한 곳에 있다.
 *  - 필수 칸은 채우지 않는다 — 가드는 `process.env[key]` 를 **직접** 보므로 그 뒤의
 *    `?? '기본값'` 은 닿지 않는 코드다.
 *
 * 채운 값은 **그대로 실려 나간다**(보이는 것이 곧 보내는 것이다). 결과는 비우고 실행한
 * 것과 같다 — 보내면 그 값이 `process.env` 에 들어가고, 안 보내면 코드의 `??` 가 같은
 * 값을 만든다. **기억(localStorage)에는 기본값과 다른 값만 남는다** —
 * `useRunVariableForm.ts` 머리 주석(코드의 기본값이 나중에 바뀌었을 때의 규칙).
 *
 * ## ★ 라운드 9 — 변수를 **여러 개** 받는다
 * 계정 1쌍만 받던 폼으로는 권한별 조회를 검증하는 시나리오(계정 3쌍 = 6키)를 UI 에서
 * 아예 돌릴 수 없었다. 이제 **시나리오 원본에서 필요한 변수를 찾아**
 * (`GET /api/scenarios/:id/variables`) 변수 하나당 칸 하나를 그린다.
 *  - 감지가 **0개**면(또는 스위트·다중 선택이라 대상이 하나가 아니면) 지금까지와 똑같이
 *    「계정」·「비밀번호」 두 칸만 보인다. 회귀가 없다.
 *  - `username`/`password` 가 감지되면 **그 칸이 곧 그 변수**다(중복 칸을 만들지 않는다).
 *  - 감지는 정규식 스캐너다(`contracts/run-variables.ts`). 못 잡는 형태가 있어서
 *    **「변수 추가」로 직접 넣을 수 있어야 한다.**
 *
 * ## 비밀번호를 어떻게 다루나
 *  - `type="password"` · `autoComplete="new-password"` — 브라우저 자동완성 저장을 유도하지 않는다.
 *  - **전송 후 폼에서 즉시 지운다**(성공·실패 모두). 실패했다고 평문을 남겨 두면
 *    다이얼로그를 닫을 때까지 DOM 에 살아 있다.
 *  - react-query 캐시 어디에도 넣지 않는다.
 *    실행 화면으로 넘길 때도 **`maskRecord()` 를 통과한 사본**만 라우터 state 로 넘긴다.
 *  - ★ localStorage 에는 **비밀이 아닌 값만** 남는다(`run-variable-memory.ts` 가
 *    `isSecretVariableKey()` 로 걸러 낸다). 비밀 키는 **이름만** 남고 값은 언제나 빈 문자열이다.
 *
 * ## 폼 검증
 * react-hook-form 을 새로 넣지 않았다(Gen-Phase 10 과 같은 판단). 전송 직전에
 * **계약 스키마(`CreateRunRequestSchema`)로 `safeParse`** 한다 — 서버가 실제로 검증하는 그 규칙이다.
 */
export type RunTarget =
  | { scenarioId: string }
  /** ★ 라운드 7 — 시나리오 목록의 다중 선택. `batch_id` 로 묶인 run N건이 생긴다. */
  | { scenarioIds: readonly string[] }
  | { suiteId: string };

/**
 * ★ 라운드 7 — 폼의 **기본값을 바깥에서 밀어 넣는 통로**.
 *
 * 재실행(`RunDetail`)이 쓴다. 프로젝트 기본값 대신 **그 run 이 실제로 쓴 값**을 채운다.
 * 넘기지 않은 필드는 지금까지처럼 프로젝트 기본값으로 떨어진다.
 */
export type RunDialogDefaults = {
  baseUrl?: string;
  envLabel?: string;
  browser?: (typeof BROWSERS)[number];
};

export type RunDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: RunTarget;
  /** 다이얼로그 제목 아래에 보여 줄 대상 이름. */
  targetName: string;
  /** 스위트·다중 선택 실행이면 몇 건이 생기는지 미리 알려 준다. */
  scenarioCount?: number;
  defaults?: RunDialogDefaults;
  /** 재실행이면 원본 run. 안내 문구와 결과 화면의 계보 배너에 쓴다. */
  rerunOf?: { runId: string; runCode: string };
};

export function RunDialog(props: RunDialogProps) {
  const { open, onOpenChange, target, targetName, scenarioCount, defaults, rerunOf } = props;
  const { project } = useCurrentProject();

  const baseUrl = defaults?.baseUrl ?? project?.baseUrl ?? "";
  const envLabel = defaults?.envLabel ?? project?.defaultEnvLabel ?? "스테이징";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={rerunOf === undefined ? "실행 요청" : `재실행 · ${rerunOf.runCode}`}
      description={
        scenarioCount === undefined
          ? targetName
          : `${targetName} · 시나리오 ${String(scenarioCount)}건이 한 묶음으로 실행됩니다`
      }
    >
      {/*
       * ★ `key` 로 초기화한다 — `useEffect` 로 "열릴 때 기본값 채우기" 를 하지 않는다.
       *   프로젝트 조회가 늦게 끝나도 값이 도착하는 순간 폼이 새 기본값으로 다시 마운트된다.
       *   ★ 라운드 7 — `key` 에 **실제로 쓰는 기본값**을 넣는다. 재실행은 프로젝트가 아니라
       *     원본 run 의 값으로 채우므로, 키가 프로젝트에만 걸려 있으면 다른 run 의
       *     재실행 다이얼로그를 연속으로 열었을 때 앞 run 의 값이 남는다.
       */}
      {open ? (
        <RunDialogForm
          key={`${project?.id ?? "no-project"}:${baseUrl}:${envLabel}:${rerunOf?.runId ?? ""}`}
          target={target}
          defaultBaseUrl={baseUrl}
          defaultEnvLabel={envLabel}
          defaultBrowser={defaults?.browser ?? "chromium"}
          rerunOf={rerunOf}
          onClose={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Modal>
  );
}

/** 계정·비밀번호가 들어가는 변수 이름. 녹화가 만드는 `{{password}}` 와 같아야 한다. */
export const ACCOUNT_VARIABLE = "username";
export const PASSWORD_VARIABLE = "password";

/**
 * 감지된 변수가 **0개일 때** 그리는 칸. 라운드 9 이전의 폼과 **정확히 같다**.
 *
 * ★ 감지가 0개라고 칸을 없애지 않는 이유: 스캐너가 못 잡는 형태(동적 조립)가 있고,
 *   스위트·다중 선택 실행은 대상이 하나가 아니라 아예 묻지 않는다. 그 모든 경우에
 *   **지금까지 쓰던 폼이 그대로 나와야** 기존 사용자가 하던 일이 계속 된다.
 */
const FALLBACK_VARIABLE_KEYS = [ACCOUNT_VARIABLE, PASSWORD_VARIABLE] as const;

/** 조회 전·실패 시의 빈 결과. 렌더마다 새 배열을 만들지 않으려고 모듈 상수로 둔다. */
const NO_VARIABLES: readonly RunVariable[] = [];

/** 익숙한 두 키는 사람이 읽는 이름으로 부른다. 나머지는 **키 이름 그대로**가 라벨이다. */
function variableLabel(key: string): string {
  if (key === ACCOUNT_VARIABLE) return "계정";
  if (key === PASSWORD_VARIABLE) return "비밀번호";
  return key;
}

/**
 * ★ 라운드 10 — placeholder 가 **기본값을 말한다.**
 * ★ 라운드 11 — 채울 수 있는 기본값은 **칸에 들어가 있다.** 그래서 placeholder 는
 *   이제 **채우지 못한 경우**와 **사용자가 칸을 비웠을 때**를 맡는다.
 *
 * 갈래를 **다르게** 적는다. 하나로 뭉치면 거짓말이 된다:
 *  - `literal` 값이 있음 → 칸에 그 값이 들어간다. 지우면 `비우면 "변호사"` 가 보인다.
 *  - `literal` 빈 문자열 → 따옴표(`""`)만 보여 주면 **빈 칸과 구분이 안 된다.**
 *    그래서 **문장으로** 적는다. 이것이 `|| ""` 의 실제 의미다
 *    (예: `relatedDoc*Row` — 이름을 안 주면 코드가 첫 행을 고른다).
 *  - `literal` 이지만 **잘렸다/변형됐다** → ★ **채우지 않는다.** 칸이 비어 있는 이유를
 *    말해야 한다. 앞부분만 보여 주고 "그래서 채우지 않았다"까지 적는다 —
 *    잘린 값을 채우면 사용자가 모르는 채 **원문과 다른 값**이 전송된다.
 *  - `dynamic` → **리터럴 원문을 보여 주지 않는다.** `` `test-${Date.now()}` `` 를
 *    그대로 적으면 그 글자가 들어간다고 읽는다.
 *  - 필수(가드) → 기본값이 있어도 **없는 것으로 다룬다**(`effectiveVariableDefault`).
 *
 * ★ 칸 하나의 폭(2열 그리드)에 **잘리지 않고 들어가는 길이**로 맞춘다. 잘린 문구는
 *   기본값을 잘못 읽게 만든다. 더 긴 설명은 `variableTitle()`(툴팁)이 맡는다.
 */
function variablePlaceholder(variable: RunVariable, secret: boolean): string {
  const fallback = effectiveVariableDefault(variable);
  if (fallback === null) {
    if (variable.key === ACCOUNT_VARIABLE) return "qa-tester";
    return secret ? "••••••••" : "값을 입력하세요";
  }
  if (fallback.kind === "dynamic") return "비우면 자동 생성됩니다";
  if (variablePrefillValue(variable) === null) {
    return fallback.truncatedText ? "비우면 코드의 긴 기본값을 씁니다" : "비우면 코드의 기본값을 씁니다";
  }
  if (fallback.text === "") return "비우면 빈 값으로 실행됩니다";
  return `비우면 "${fallback.text}"`;
}

/** placeholder 가 짧게 말한 것을 **끝까지** 말해 주는 툴팁. 없으면 `undefined`. */
function variableTitle(variable: RunVariable): string | undefined {
  const fallback = effectiveVariableDefault(variable);
  if (fallback === null) return undefined;
  if (fallback.kind === "dynamic") {
    return "코드가 실행할 때 값을 만들어 냅니다(예: 타임스탬프). 무엇이 될지는 미리 알 수 없습니다.";
  }
  if (variablePrefillValue(variable) === null) {
    return (
      (fallback.truncatedText
        ? `코드의 기본값이 너무 길어 칸에 채우지 않았습니다. 앞부분: "${fallback.text}…"`
        : `코드의 기본값에 줄바꿈 같은 보이지 않는 글자가 있어 칸에 채우지 않았습니다. 보이는 모양: "${fallback.text}"`) +
      " — 비워 두면 코드의 값이 그대로 쓰입니다. 원문과 다른 값을 채워 두면 그 값이 그대로 전송됩니다."
    );
  }
  if (fallback.text === "") {
    return "코드의 기본값이 빈 문자열입니다. 비워 두면 코드가 정한 기본 동작(예: 목록의 첫 항목)이 쓰입니다.";
  }
  return `코드의 기본값을 채워 두었습니다: "${fallback.text}" — 그대로 고쳐 쓸 수 있고, 비우면 같은 값이 쓰입니다.`;
}

/**
 * ★ 라운드 10 — 이 칸에 「비밀 아님」 토글을 **내놓아도 되는가.**
 *
 * `SECRET_KEY_PATTERN` 은 `securitySecretKeyword`(검색어 `[보안]`)·
 * `securityTopSecretProjectName`(`[극비]`) 을 비밀로 **오탐**한다. 가려지는 것은 그렇다 쳐도
 * localStorage 에 안 남아 **매 실행마다 다시 타이핑**해야 했다.
 *
 * ## 패턴을 느슨하게 만들지 않는다
 * 비밀값을 놓치는 쪽이 훨씬 나쁘다(마스킹·저장 제외가 전부 그 판정에 달려 있다).
 * 그래서 **판정은 그대로 두고, 사람이 칸 단위로 푸는 길**을 낸다.
 *
 * ## "기본값이 있으면 비밀이 아니다"로 **자동 판정하지 않는 이유**
 * `|| "changeme"` 처럼 **기본값이 있어도 진짜 비밀**일 수 있다. 기본값의 존재는
 * "코드에 평문이 적혀 있다"는 뜻이지 "이 값이 비밀이 아니다"는 뜻이 아니다.
 * 그래서 기본값은 **토글을 내놓는 조건**으로만 쓴다 — 실제로 푸는 것은 언제나 사람이다.
 * 코드 앞단 가드로 막힌 진짜 계정(`username`·`password`)은 **필수**이므로
 * 이 토글이 **아예 나타나지 않는다**(라운드 11 — `?? ''` 때문에 기본값이 "있는" 것으로
 * 읽히던 그 칸들이다. `isOptionalVariable()` 이 가드를 먼저 보므로 토글은 계속 안 나온다).
 *
 * ## 무엇이 바뀌고 무엇이 안 바뀌나
 * 바뀌는 것: 이 브라우저에서의 **표시**(`type=text`)와 **기억**(localStorage).
 * 안 바뀌는 것: 서버의 `maskVariablesForStorage()`(`runs` 에 `***`)·
 * `collectSecretValues()`(로그·에러·스텝 이름 마스킹)는 이 토글을 **알지도 못한다.**
 * 실행 요청의 `secretKeys` 도 그대로 `[]` 다 — 즉 마스킹 기준은 한 글자도 약해지지 않는다.
 */
function canMarkPlain(variable: RunVariable): boolean {
  return variable.isSecret && isOptionalVariable(variable);
}

/** 기존 칸의 `data-slot`·`name` 을 그대로 유지한다(선택자에 기대는 검증·스타일 회귀 방지). */
function variableSlot(key: string): string {
  if (key === ACCOUNT_VARIABLE) return "field-account";
  if (key === PASSWORD_VARIABLE) return "field-password";
  return "field-variable";
}

function RunDialogForm({
  target,
  defaultBaseUrl,
  defaultEnvLabel,
  defaultBrowser,
  rerunOf,
  onClose,
}: {
  target: RunTarget;
  defaultBaseUrl: string;
  defaultEnvLabel: string;
  defaultBrowser: (typeof BROWSERS)[number];
  rerunOf?: { runId: string; runCode: string };
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const health = useHealth();
  const createRun = useCreateRun();

  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [envLabel, setEnvLabel] = useState(defaultEnvLabel);
  const [browser, setBrowser] = useState<(typeof BROWSERS)[number]>(defaultBrowser);
  const [formError, setFormError] = useState<readonly string[]>([]);
  /**
   * ★ 선택 변수는 **접힌 채로 시작한다.** 이것이 이 라운드의 요점이다 —
   *   열어 두면 라운드 9 와 똑같이 빈 칸 16개가 된다. 값을 기억해 둔 것이 있어도
   *   열지 않는다(그 사실은 접힌 줄의 배지가 말한다).
   */
  const [optionalOpen, setOptionalOpen] = useState(false);

  /*
   * ★ 감지는 **단건 실행일 때만** 한다.
   *   - 스위트: 이 폼은 담긴 시나리오가 무엇인지 모른다(서버가 편다). 물어볼 id 가 없다.
   *   - 다중 선택: id 는 있지만 최대 50건이라, 다이얼로그를 여는 것만으로 요청 50건 +
   *     코드 본문 50벌 읽기가 된다. 묶음 실행은 보통 같은 기본값으로 돌리는 용도이고,
   *     변수가 필요하면 「변수 추가」로 넣을 수 있다.
   *   두 경우 모두 **라운드 9 이전과 똑같은 폼**이 나온다(회귀 없음).
   */
  const scenarioId = "scenarioId" in target ? target.scenarioId : undefined;
  const detection = useScenarioVariables(scenarioId, true);
  const detected = detection.data?.variables ?? NO_VARIABLES;

  const form = useRunVariableForm({
    scenarioId,
    detected,
    fallbackKeys: FALLBACK_VARIABLE_KEYS,
  });

  const runnerDown = health.data?.runner === "down";

  /*
   * ★ 가르는 기준은 **`isOptionalVariable()` 하나**다. 라운드 11 부터 그 함수가
   *   ① 코드의 가드(`required`) ② 기본값 유무 순으로 본다 — 화면은 순서를 모른다.
   *   "빈 문자열 기본값은 없는 셈 치자" 같은 판단을 화면에서 새로 만들지 않는다 —
   *   `|| ""` 는 "비워 두는 것이 정상" 이라는 **의미 있는 기본값**이다.
   */
  const requiredFields = form.fields.filter((field) => !isOptionalVariable(field));
  const optionalFields = form.fields.filter((field) => isOptionalVariable(field));
  /**
   * 접힌 상태에서도 보여 줄 숫자 — **사용자가 코드의 기본값과 다르게 고른 칸**의 수다.
   * ★ 라운드 11 — 자동 바인딩 뒤에는 "값이 들어 있다"가 "사용자가 넣었다"를 뜻하지 않는다.
   *   채워진 기본값까지 세면 접힌 줄이 언제나 "입력해 둔 값 14개" 가 되어 의미를 잃는다.
   */
  const filledOptional = optionalFields.filter(
    (field) => form.valueOf(field.key) !== "" && !form.isCodeDefault(field.key),
  ).length;
  /** 코드에서 값을 그대로 가져와 채운 칸의 수. 접힌 줄이 "왜 값이 들어 있는지" 를 말한다. */
  const prefilledOptional = optionalFields.filter(
    (field) => (variablePrefillValue(field) ?? "") !== "" && form.isCodeDefault(field.key),
  ).length;

  const renderField = (variable: RunVariable) => {
    const secret = form.isSecretField(variable.key);
    return (
      <VariableField
        key={variable.key}
        variable={variable}
        secret={secret}
        plain={form.isPlain(variable.key)}
        value={form.valueOf(variable.key)}
        onChange={(value) => {
          form.setValue(variable.key, value);
        }}
        onTogglePlain={
          canMarkPlain(variable)
            ? () => {
                form.togglePlain(variable.key);
              }
            : undefined
        }
      />
    );
  };

  /*
   * 묶음 크기는 **여기서 셀 수 있는 것만** 센다. 스위트는 담긴 시나리오 수를 이 폼이
   * 모르므로(서버가 편다) 0 으로 두고 안내를 띄우지 않는다 — 모르는 숫자를 쓰지 않는다.
   */
  const batchSize = "scenarioIds" in target ? target.scenarioIds.length : 1;
  const queue = useRunQueue({ enabled: batchSize > 1 });
  const concurrency = queue.data?.concurrency ?? null;

  const submit = () => {
    const variables = form.collect();

    const candidate = {
      ...target,
      baseUrl: baseUrl.trim(),
      envLabel: envLabel.trim(),
      browser,
      variables,
      /*
       * ★ 비워 둔다. `isSecretVariableKey()` 가 **키 이름으로 자동 판정**하고
       *   (`*password*`·`*token*` 등), 서버·Runner·이 화면이 전부 그 **같은 함수**를 쓴다.
       *   여기서 목록을 또 만들면 규칙이 두 벌이 되어 어긋나는 순간 한쪽이 평문을 흘린다.
       *   이름 규칙에 안 걸리는 비밀 키를 명시하고 싶으면 그때 이 필드를 쓴다(계약은 열려 있다).
       */
      secretKeys: [],
    };

    const parsed = CreateRunRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      setFormError(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
      return;
    }
    setFormError([]);

    // 화면으로 넘어가는 것은 **마스킹된 사본**뿐이다. 평문은 이 함수 밖으로 나가지 않는다.
    const maskedVariables = maskRecord(variables);

    createRun.mutate(parsed.data, {
      onSuccess: (response) => {
        // ★ 기억은 **성공했을 때만** 남긴다. 그리고 비밀값은 저장되지 않는다
        //   (`rememberVariables()` 가 언제나 버린다 — `run-variable-memory.ts`).
        form.remember();
        toast("실행을 요청했습니다", { label: "실행" });
        onClose();
        goToResult(response, maskedVariables);
      },
      onSettled: () => {
        // ★ 성공·실패 무관하게 비밀 칸을 폼에서 지운다.
        form.clearSecrets();
      },
    });
  };

  const goToResult = (
    response: CreateRunResponse,
    maskedVariables: Record<string, string>,
  ) => {
    if (response.runIds.length > 1 && response.batchId !== null) {
      /*
       * 스위트·다중 선택 실행은 run 이 N 건 생긴다(같은 `batch_id`). 목록 응답
       * (`RunListItem`)에는 `batchId` 가 없어 서버에 "이 묶음만" 을 물어볼 수 없으므로,
       * 방금 받은 id 들을 쿼리로 들고 간다. 묶음 화면이 그 id 로 각각 상세를 읽는다.
       */
      void navigate(
        `/runs?batch=${response.batchId}&ids=${response.runIds.join(",")}`,
        { state: { maskedVariables } },
      );
      return;
    }
    // ★ 재실행이면 원본을 같이 넘긴다 — 결과 화면이 "무엇을 다시 돌린 것인지" 말한다.
    void navigate(`/runs/${response.runId}`, { state: { maskedVariables, rerunOf } });
  };

  const errors = formError.length > 0 ? formError : apiErrorLines(createRun.error);

  return (
    <form
      data-slot="run-dialog-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field
        label="대상 주소 (baseUrl)"
        hint="스텝의 {{baseUrl}} 자리에 들어갑니다. 프로젝트 기본값을 그대로 고칠 수 있습니다."
      >
        <Input
          name="baseUrl"
          data-slot="field-base-url"
          value={baseUrl}
          placeholder={defaultBaseUrl === "" ? "https://staging.example.com" : defaultBaseUrl}
          inputMode="url"
          onChange={(event) => {
            setBaseUrl(event.target.value);
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-[12px] max-mobile:grid-cols-1">
        <Field label="환경 라벨">
          <Input
            name="envLabel"
            data-slot="field-env-label"
            value={envLabel}
            placeholder="스테이징"
            onChange={(event) => {
              setEnvLabel(event.target.value);
            }}
          />
        </Field>

        <Field label="브라우저">
          <Select
            name="browser"
            data-slot="field-browser"
            value={browser}
            onChange={(event) => {
              setBrowser(event.target.value as (typeof BROWSERS)[number]);
            }}
          >
            {BROWSERS.map((value) => (
              <option key={value} value={value}>
                {browserLabel(value)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-[6px] mb-[10px] border-t border-line pt-[14px]">
        <strong className="text-[12px]">테스트 데이터</strong>
        {detected.length === 0 ? (
          /* ★ 감지 0개 — 라운드 9 이전 문구 그대로다(회귀 금지). */
          <p className="m-0 mt-[4px] text-[10px] leading-[1.6] text-muted">
            입력한 값은 이번 실행에만 쓰이고 <strong>서버에 저장되지 않습니다.</strong>
            {" 스텝의 "}
            {`{{${ACCOUNT_VARIABLE}}}`} · {`{{${PASSWORD_VARIABLE}}}`} 자리에 들어갑니다.
          </p>
        ) : (
          <p
            data-slot="detected-variables-notice"
            className="m-0 mt-[4px] text-[10px] leading-[1.6] text-muted"
          >
            이 시나리오가 쓰는 변수 <strong>{String(detected.length)}개</strong>를 찾았습니다 —{" "}
            <strong>꼭 입력할 것 {String(requiredFields.length)}개</strong> ·{" "}
            <strong>선택 {String(optionalFields.length)}개</strong>. 입력한 값은 이번 실행에만
            쓰이고 <strong>서버에 저장되지 않습니다.</strong>{" "}
            {optionalFields.length === 0 ? (
              /* 선택이 0개면 채울 것도 없다 — 없는 이야기를 하지 않는다(회귀: 녹화 시나리오). */
              <>
                <strong>빈 칸은 전달하지 않습니다</strong> — 기본값이 없으면 그 자리에서 실패합니다.
              </>
            ) : (
              <>
                <strong>코드에 적힌 기본값은 칸에 미리 채워 두었습니다</strong> — 그대로 고쳐 쓸 수
                있습니다. 실행할 때 값이 정해지는 기본값과 너무 긴 기본값은 채우지 않았고, 그 칸을
                비워 두면 코드의 값이 그대로 쓰입니다.
              </>
            )}
            {detection.data?.truncated === true
              ? ` 변수가 너무 많아 앞 ${String(detected.length)}개만 보여 줍니다.`
              : ""}
          </p>
        )}
        {/* ★ 기억은 **비밀이 아닌 값만** 남는다. 그 사실을 화면에서 말한다. */}
        {scenarioId === undefined ? null : (
          <p
            data-slot="variable-memory-notice"
            className="m-0 mt-[4px] text-[10px] leading-[1.6] text-muted"
          >
            다음 실행을 위해 이 브라우저에 값이 기억됩니다. <strong>비밀값은 저장하지 않습니다.</strong>
          </p>
        )}
        {/*
          ★ 라운드 7 — 재실행에서 **왜 계정 칸만 비어 있는지**를 그 자리에서 말한다.
            주소·환경·브라우저는 채워 주면서 계정만 비워 두면, 설명이 없을 때
            사용자는 "채우는 걸 깜빡한 버그"로 읽는다. 실제로는 DB 에 컬럼 자체가
            없어서(설계) 채울 값이 존재하지 않는다.
        */}
        {rerunOf === undefined ? null : (
          <p
            data-slot="rerun-secret-notice"
            className="m-0 mt-[6px] text-[10px] leading-[1.6] text-muted"
          >
            <strong>보안상 계정·비밀번호는 저장하지 않습니다.</strong> {rerunOf.runCode} 의 대상
            주소·환경·브라우저는 그대로 채웠고, 계정 칸만 직접 입력해 주세요(값이 필요 없는
            시나리오면 비워 둔 채로 실행하면 됩니다).
          </p>
        )}
      </div>

      {/*
        ★ 감지분(없으면 「계정」·「비밀번호」)을 **한 벌의 `renderField`** 로 그린다.
          갈래를 두면 감지 0개일 때의 마크업이 두 벌이 되어 회귀가 생긴다.
          감지 0개면 `requiredFields` 가 곧 「계정」·「비밀번호」이고
          `optionalFields` 는 비어 있다 — 라운드 9 이전과 **같은 화면**이다.
      */}
      {requiredFields.length > 0 ? (
        <div
          data-slot="required-variables"
          className="grid grid-cols-2 gap-[12px] max-mobile:grid-cols-1"
        >
          {requiredFields.map(renderField)}
        </div>
      ) : (
        /*
          ★ 필수가 0개일 때 — 칸을 하나도 안 그리면 "테스트 데이터" 제목만 떠 있어
            로딩 실패처럼 보인다. **왜 빈지**를 한 줄로 말한다.
        */
        <p
          data-slot="no-required-variables"
          className="m-0 mb-[12px] rounded-metric border border-line bg-soft px-[12px] py-[9px] text-[11px] leading-[1.6]"
        >
          반드시 입력해야 하는 변수가 <strong>없습니다.</strong> 그대로 실행하면 코드에 적힌
          기본값으로 돌아갑니다.
        </p>
      )}

      {/*
        ★ 선택 변수 — **접는다.** 접힌 줄이 개수와 의미를 말하고, 이미 넣어 둔 값이
          있으면 그 개수도 같이 말한다(기억된 값이 조용히 실려 나가면 안 된다).
      */}
      {optionalFields.length === 0 ? null : (
        <div className="mb-[12px] flex flex-wrap items-center gap-[7px]">
          <button
            type="button"
            data-slot="optional-variables-toggle"
            aria-expanded={optionalOpen}
            aria-controls="optional-variables-panel"
            className="inline-flex items-center gap-[5px] rounded-btn border border-line bg-panel px-[11px] py-[7px] text-[11px] font-bold text-ink transition-colors duration-150 outline-none hover:border-btn-hover-line hover:bg-btn-hover-bg focus-visible:border-brand focus-visible:shadow-focus-ring"
            onClick={() => {
              setOptionalOpen((prev) => !prev);
            }}
          >
            <span aria-hidden="true">{optionalOpen ? "▾" : "▸"}</span>
            <span>선택 변수 {String(optionalFields.length)}개</span>
            <span className="font-normal text-muted">
              {prefilledOptional === 0
                ? "· 비우면 코드의 기본값을 씁니다"
                : `· 코드의 기본값 ${String(prefilledOptional)}개를 채워 두었습니다`}
            </span>
          </button>
          {filledOptional === 0 ? null : (
            <span
              data-slot="optional-variables-filled"
              className="rounded-badge border border-brand bg-soft px-[7px] py-[4px] text-[10px] font-bold text-brand-dark"
            >
              직접 입력한 값 {String(filledOptional)}개
            </span>
          )}
        </div>
      )}
      {optionalFields.length > 0 && optionalOpen ? (
        <div
          id="optional-variables-panel"
          data-slot="optional-variables"
          className="grid grid-cols-2 gap-[12px] max-mobile:grid-cols-1"
        >
          {optionalFields.map(renderField)}
        </div>
      ) : null}

      {/*
        ★ 직접 추가 — 스캐너가 못 잡는 형태(동적 조립)와 스위트·다중 선택을 위한 통로다.
          `run-variables.ts` 머리 주석의 한계를 **사용자가 메울 수 있게** 하는 장치이고,
          이것이 없으면 그 한계가 곧 "못 돌리는 시나리오"가 된다.
      */}
      {form.customs.map((row) => (
        <div
          key={row.id}
          data-slot="custom-variable-row"
          className="mb-[12px] flex items-end gap-[9px] max-mobile:flex-wrap"
        >
          <div className="min-w-0 flex-1">
            <Field label="변수 이름">
              <Input
                data-slot="custom-variable-key"
                value={row.key}
                autoComplete="off"
                spellCheck={false}
                placeholder="예: lawyer_email"
                onChange={(event) => {
                  form.patchCustom(row.id, { key: event.target.value });
                }}
              />
            </Field>
          </div>
          <div className="min-w-0 flex-1">
            <Field label="값">
              <Input
                data-slot="custom-variable-value"
                type={isSecretVariableKey(row.key) ? "password" : "text"}
                value={row.value}
                autoComplete={isSecretVariableKey(row.key) ? "new-password" : "off"}
                spellCheck={false}
                placeholder="값을 입력하세요"
                onChange={(event) => {
                  form.patchCustom(row.id, { value: event.target.value });
                }}
              />
            </Field>
          </div>
          <Button
            variant="danger"
            data-slot="custom-variable-remove"
            aria-label={`변수 ${row.key === "" ? "행" : row.key} 삭제`}
            className="mb-[12px]"
            onClick={() => {
              form.removeCustom(row.id);
            }}
          >
            삭제
          </Button>
        </div>
      ))}

      <div className="mb-[12px]">
        <Button
          variant="ghost"
          data-slot="custom-variable-add"
          onClick={() => {
            form.addCustom();
          }}
        >
          + 변수 추가
        </Button>
      </div>

      {/*
        ★ 라운드 7 — **"병렬"이 실제로 몇 개인지 숨기지 않는다.**
          여러 건을 걸면 run 은 N 건 생기지만 동시에 도는 것은 Runner 의 한도까지다.
          한도를 모르면(Runner 미기동·구버전) 숫자를 지어내지 않고 그렇게 적는다.
      */}
      {batchSize <= 1 ? null : (
        <NoticeBox title={`${String(batchSize)}건이 한 묶음으로 큐에 올라갑니다`}>
          <NoticeLine data-slot="batch-concurrency-notice">
            {concurrency === null
              ? "동시에 몇 건이 실행되는지는 Runner 가 알려 주지 않았습니다(Runner 미기동일 수 있습니다). 나머지는 큐에서 차례를 기다립니다."
              : `Runner 는 한 번에 최대 ${String(concurrency)}건을 동시에 실행합니다. ` +
                (batchSize > concurrency
                  ? `나머지 ${String(batchSize - concurrency)}건은 큐에서 차례를 기다리며, 앞 실행이 끝나는 대로 순서대로 시작합니다.`
                  : "선택한 건수가 한도 안이라 모두 곧바로 시작됩니다.")}
          </NoticeLine>
        </NoticeBox>
      )}

      {runnerDown ? (
        <NoticeBox title="Runner 가 실행 중이 아닙니다">
          <NoticeLine>
            실행 요청은 접수되지만 <strong>큐에 쌓인 채 진행되지 않습니다.</strong> 서버에서
            Runner 를 기동한 뒤 요청하면 대기 중인 실행부터 순서대로 처리됩니다.
          </NoticeLine>
        </NoticeBox>
      ) : null}

      {errors.length === 0 ? null : (
        <div
          role="alert"
          data-slot="run-dialog-error"
          className="mt-[14px] rounded-metric border border-danger bg-danger-soft px-[14px] py-[12px] text-[11px] leading-[1.6] text-danger"
        >
          {errors.map((line) => (
            <p key={line} className="m-0">
              {line}
            </p>
          ))}
        </div>
      )}

      <div className="mt-[18px] flex items-center justify-end gap-[9px]">
        <Button onClick={onClose}>취소</Button>
        <Button
          type="submit"
          variant="primary"
          data-slot="run-dialog-submit"
          disabled={createRun.isPending}
        >
          {createRun.isPending ? "요청 중…" : "▶ 실행 시작"}
        </Button>
      </div>
    </form>
  );
}

/**
 * 변수 칸 하나.
 *
 * ★ `Field` 를 쓰지 않고 따로 그리는 이유는 **「비밀 아님」 토글** 때문이다.
 *   `Field` 는 `<label>` 이 칸 전체를 감싸는데, `<button>` 은 labelable 요소라
 *   `<label>` 안에 넣으면 HTML 이 깨진다(`RunRow.tsx` 가 체크박스로 같은 판단을 했다).
 *   그래서 `htmlFor`/`id` 로 묶고 라벨 줄 오른쪽에 버튼을 둔다 — 보이는 결과는 같다.
 */
function VariableField({
  variable,
  secret,
  plain,
  value,
  onChange,
  onTogglePlain,
}: {
  variable: RunVariable;
  /** **지금** 비밀로 다루는가(사용자가 푼 칸이면 false). */
  secret: boolean;
  plain: boolean;
  value: string;
  onChange: (value: string) => void;
  /** `undefined` 면 토글을 내놓지 않는다(`canMarkPlain`). */
  onTogglePlain?: () => void;
}) {
  const id = `run-var-${variable.key}`;
  return (
    <div className="mb-[12px]">
      <div className="mb-[6px] flex items-center justify-between gap-[7px]">
        <label htmlFor={id} className="block text-label text-muted">
          {variableLabel(variable.key)}
        </label>
        {onTogglePlain === undefined ? null : (
          <button
            type="button"
            data-slot="variable-plain-toggle"
            data-variable-key={variable.key}
            aria-pressed={plain}
            title={
              plain
                ? "다시 비밀로 다룹니다 — 값이 가려지고 이 브라우저에 기억되지 않습니다."
                : "검색어처럼 비밀이 아닌 값이면 풀어 두세요 — 값이 보이고 이 브라우저에 기억됩니다. 서버 기록·로그 마스킹은 그대로입니다."
            }
            className="shrink-0 rounded-tag border border-line bg-panel px-[6px] py-[2px] text-[10px] text-muted transition-colors duration-150 outline-none hover:border-btn-hover-line hover:bg-btn-hover-bg focus-visible:border-brand focus-visible:shadow-focus-ring"
            onClick={onTogglePlain}
          >
            {plain ? "비밀로 되돌리기" : "비밀 아님"}
          </button>
        )}
      </div>
      <Input
        id={id}
        name={variable.key}
        data-slot={variableSlot(variable.key)}
        data-variable-key={variable.key}
        data-secret={secret ? "true" : "false"}
        /*
         * ★ 라운드 11 — 이 칸의 값이 **코드에서 자동으로 채워질 수 있는 값인가.**
         *   검증(스크린샷·덤프)이 "채워진 것" 과 "사용자가 친 것" 을 구분할 수 있어야 한다.
         *   보이는 것은 바뀌지 않는다(선택자용 표시다).
         */
        data-prefill={variablePrefillValue(variable) === null ? "none" : "code-default"}
        type={secret ? "password" : "text"}
        value={value}
        autoComplete={secret ? "new-password" : "off"}
        spellCheck={false}
        placeholder={variablePlaceholder(variable, secret)}
        title={variableTitle(variable)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-[12px] block">
      <span className="mb-[6px] block text-label text-muted">{label}</span>
      {children}
      {hint === undefined ? null : (
        <span className="mt-[5px] block text-[10px] leading-[1.5] text-muted">{hint}</span>
      )}
    </label>
  );
}

function apiErrorLines(error: unknown): readonly string[] {
  if (error === null || error === undefined) return [];
  if (error instanceof Error) {
    const details = (error as { details?: readonly string[] }).details;
    return details !== undefined && details.length > 0 ? details : [error.message];
  }
  return ["실행 요청에 실패했습니다"];
}
