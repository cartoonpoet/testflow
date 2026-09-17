import { ACTION_CHIP_LABEL, DEFAULT_STEP_OPTIONS, DraftStepSchema } from "@testflow/contracts";
import type { ActionType, DraftStep, LocatorTarget } from "@testflow/contracts";

/**
 * 원시 행동 → 업무 문장 스텝 초안 (03-phases Task 7.5)
 *
 * ## 자동 생성 문장은 **초안일 뿐이다**
 * `"'로그인' 버튼 클릭"` 같은 문장은 테스터가 스텝 카드에서 그대로 **덮어쓴다**.
 * 여기서 만드는 것은 "빈 칸보다 나은 시작점"이지 최종 이름이 아니다
 * (02-context "업무 문장 변환" / 01-clarify 화면 3).
 *
 * ## 칩 라벨은 여기서 만들지 않는다
 * 시안의 `<code>` 칩(이동/입력/클릭/확인)은 `@testflow/contracts` 의 `ACTION_CHIP_LABEL`
 * 한 곳에서만 계산한다. web 이 재구현하지 않도록 이 파일도 그 표를 **import 해서 쓴다**
 * (아래 `chipLabel()`). 매핑을 두 벌 만들면 화면과 Runner 가 갈라진다.
 *
 * ## 이 파일은 순수 함수만 둔다
 * DOM 도 Playwright 도 모른다 → 단위 테스트가 가능하다. DOM 접근이 필요한 부분
 * (Locator 후보 생성·고유성 검증)은 전부 `injected.ts` 안에서 끝난 뒤 넘어온다.
 */

/* ────────────────────────────────────────────────────────────
 * 1. injected.ts 가 보내는 원시 행동
 *
 *   ★ 이 타입은 `injected.ts` 의 `RecordedAction` 과 **1:1** 이다. 그쪽은 import 를 쓸 수
 *     없어(글로벌 스크립트로 emit 돼야 한다) 타입을 공유하지 못하고 양쪽에 적는다.
 *     형태를 바꾸면 두 파일을 같이 고쳐야 한다.
 * ──────────────────────────────────────────────────────────── */

export const RECORDED_ACTION_KINDS = [
  "click",
  "fill",
  "select",
  "check",
  "uncheck",
  "press",
] as const;
export type RecordedActionKind = (typeof RECORDED_ACTION_KINDS)[number];

export interface RecordedAction {
  kind: RecordedActionKind;
  target: LocatorTarget;
  /** `fill`/`select` 의 입력값, `press` 의 키 이름. 비밀번호면 `{{password}}` 가 들어온다. */
  value?: string;
  isSecret?: boolean;
  role: string | null;
  accessibleName: string | null;
  label: string | null;
  tag: string;
  inputType: string | null;
  url: string;
  at: number;
}

/** 네비게이션(→ `goto`)은 DOM 이벤트가 아니라 Node 쪽 `framenavigated` 에서 온다. */
export interface RecordedNavigation {
  kind: "goto";
  /** 이미 `{{baseUrl}}` 치환이 끝난 형태일 수 있다. */
  url: string;
  at: number;
}

export type RecordedEvent = RecordedAction | RecordedNavigation;

/* ────────────────────────────────────────────────────────────
 * 2. 업무 문장 만들기
 * ──────────────────────────────────────────────────────────── */

/** role → 한국어 명사. 문장에서 `'로그인' <여기> 클릭` 자리에 들어간다. */
const ROLE_NOUN: Readonly<Record<string, string>> = {
  button: "버튼",
  link: "링크",
  textbox: "입력란",
  searchbox: "검색란",
  checkbox: "체크박스",
  radio: "선택 항목",
  combobox: "선택란",
  listbox: "목록",
  option: "항목",
  tab: "탭",
  menuitem: "메뉴",
  heading: "제목",
  img: "이미지",
  slider: "슬라이더",
  spinbutton: "숫자 입력란",
  switch: "스위치",
  cell: "셀",
  row: "행",
};

/** role 이 없을 때 태그로 대신 부른다. */
const TAG_NOUN: Readonly<Record<string, string>> = {
  input: "입력란",
  textarea: "입력란",
  select: "선택란",
  button: "버튼",
  a: "링크",
};

function noun(action: RecordedAction): string {
  if (action.role !== null) {
    const byRole = ROLE_NOUN[action.role];
    if (byRole !== undefined) return byRole;
  }
  if (action.inputType === "password") return "입력란";
  return TAG_NOUN[action.tag] ?? "요소";
}

/**
 * 문장에 쓸 대상 이름. `label` 이 있으면 라벨이 가장 업무 언어에 가깝고
 * (테스터는 화면에 보이는 "아이디"라고 부른다), 없으면 accessible name 으로 떨어진다.
 */
function subject(action: RecordedAction): string | null {
  const label = clean(action.label);
  if (label !== null) return label;
  return clean(action.accessibleName);
}

function clean(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/\s+/gu, " ").trim();
  if (normalized === "") return null;
  return normalized.length > 40 ? `${normalized.slice(0, 40)}…` : normalized;
}

/** URL 을 문장에 넣을 짧은 형태로. `{{baseUrl}}/login` → `/login`. */
export function shortenUrl(url: string): string {
  const withoutVar = url.replace(/^\{\{\s*baseUrl\s*\}\}/u, "");
  if (withoutVar !== url) return withoutVar === "" ? "/" : withoutVar;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

/**
 * 원시 행동 → 한국어 업무 문장.
 *
 * 예) `{kind:'click', role:'button', accessibleName:'로그인'}` → `"'로그인' 버튼 클릭"`
 *     `{kind:'fill', label:'아이디'}`                          → `"'아이디' 입력란에 값 입력"`
 */
export function describeEvent(event: RecordedEvent): string {
  if (event.kind === "goto") return `'${shortenUrl(event.url)}' 페이지로 이동`;

  const name = subject(event);
  const target = name === null ? noun(event) : `'${name}' ${noun(event)}`;

  switch (event.kind) {
    case "click":
      return `${target} 클릭`;
    case "fill":
      return `${target}에 값 입력`;
    case "select":
      return `${target}에서 값 선택`;
    case "check":
      return `${target} 선택`;
    case "uncheck":
      return `${target} 선택 해제`;
    case "press":
      return `${target}에서 ${event.value ?? "키"} 키 입력`;
    default: {
      // `RecordedActionKind` 가 늘면 여기서 컴파일 에러가 난다.
      const exhaustive: never = event;
      throw new Error(`알 수 없는 행동입니다: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/* ────────────────────────────────────────────────────────────
 * 3. ActionType 매핑 + DraftStep 생성
 * ──────────────────────────────────────────────────────────── */

const ACTION_TYPE_BY_KIND: Readonly<Record<RecordedActionKind | "goto", ActionType>> = {
  goto: "goto",
  click: "click",
  fill: "fill",
  select: "select",
  check: "check",
  uncheck: "uncheck",
  press: "press",
};

/** 시안의 `<code>` 칩(이동/입력/클릭/확인). ★ 매핑은 contracts 한 곳에만 있다. */
export function chipLabel(actionType: ActionType): string {
  return ACTION_CHIP_LABEL[actionType];
}

/**
 * 원시 행동 1건 → `DraftStep`.
 *
 * 반환 전에 **`DraftStepSchema` 로 검증**한다. 여기서 걸러 두면 녹화 종료 시점
 * (`POST /api/recordings/:id/stop`)에 계약 위반으로 무더기 실패하는 일이 없다.
 * 검증에 실패하면 `null` 을 돌려주고 그 행동은 버린다 — 초안 하나 때문에 세션 전체를
 * 깨뜨리지 않는다.
 */
export function toDraftStep(event: RecordedEvent): DraftStep | null {
  const actionType = ACTION_TYPE_BY_KIND[event.kind];
  const name = describeEvent(event);

  const draft: Record<string, unknown> = {
    name: name.slice(0, 200),
    actionType,
    options: { ...DEFAULT_STEP_OPTIONS },
  };

  if (event.kind === "goto") {
    draft["input"] = { value: event.url, isSecret: false };
  } else {
    draft["target"] = event.target;
    if (needsInput(actionType)) {
      draft["input"] = { value: event.value ?? "", isSecret: event.isSecret === true };
    }
  }

  const parsed = DraftStepSchema.safeParse(draft);
  return parsed.success ? parsed.data : null;
}

function needsInput(actionType: ActionType): boolean {
  return actionType === "fill" || actionType === "select" || actionType === "press";
}

/* ────────────────────────────────────────────────────────────
 * 4. 초안 다듬기 — 연속 중복 제거
 * ──────────────────────────────────────────────────────────── */

/**
 * 같은 대상에 대한 연속 `fill` 을 **마지막 값 하나로** 접는다.
 *
 * 1차 디바운스는 `injected.ts` 가 페이지 안에서 한다(글자마다 오는 `input` 이벤트).
 * 이 함수는 그것을 통과한 뒤에도 남는 경우 — 예를 들어 디바운스 확정 직후 `change` 가
 * 같은 값을 한 번 더 흘리는 경우 — 를 잡는 **2차 방어선**이다.
 */
export function mergeConsecutiveFills(steps: readonly DraftStep[]): DraftStep[] {
  const merged: DraftStep[] = [];
  for (const step of steps) {
    const previous = merged[merged.length - 1];
    if (
      previous !== undefined &&
      previous.actionType === "fill" &&
      step.actionType === "fill" &&
      sameTarget(previous.target ?? null, step.target ?? null)
    ) {
      merged[merged.length - 1] = step;
      continue;
    }
    merged.push(step);
  }
  return merged;
}

function sameTarget(a: LocatorTarget | null, b: LocatorTarget | null): boolean {
  if (a === null || b === null) return false;
  return JSON.stringify(a.primary) === JSON.stringify(b.primary);
}
