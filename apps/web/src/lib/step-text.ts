import {
  ACTION_CHIP_LABEL,
  displayStepValue,
  type ActionType,
  type LocatorTarget,
  type PublicLocatorTarget,
  type TestStepInput,
  type TestStepOptions,
} from "@testflow/contracts";

/**
 * 스텝 카드의 **업무 문장** 만들기.
 *
 * ★ 원칙 두 가지 —
 *  ① 칩 라벨(이동/입력/클릭/확인)은 contracts 의 `ACTION_CHIP_LABEL` 만 쓴다. web 재정의 금지.
 *  ② **테스터 화면에 CSS 선택자·testid 를 쓰지 않는다.** 대상 문구는 role/label/text 후보에서만
 *     뽑고, 그런 후보가 없으면 스냅샷 텍스트 → 그마저 없으면 "대상 요소"로 떨어진다.
 *     (API 기본 응답이 이미 css 를 제거하지만, 화면 쪽에서도 같은 방어를 한다.)
 *  ③ `isSecret` 값은 **contracts 의 `displayStepValue`** 를 통과시킨다 —
 *     `••••••••` 문자열을 web 이 직접 만들지 않는다.
 */

type AnyLocatorTarget = LocatorTarget | PublicLocatorTarget;

export type DescribableStep = {
  actionType: ActionType;
  target?: AnyLocatorTarget | null | undefined;
  input?: TestStepInput | null | undefined;
  options?: TestStepOptions | undefined;
};

/** ARIA role → 업무 용어. 없는 role 은 원문을 그대로 쓴다(거짓말하지 않는다). */
const ROLE_LABEL: Readonly<Record<string, string>> = {
  button: "버튼",
  link: "링크",
  textbox: "입력란",
  searchbox: "검색란",
  checkbox: "체크박스",
  radio: "선택 항목",
  combobox: "선택 상자",
  listbox: "목록 상자",
  option: "항목",
  heading: "제목",
  tab: "탭",
  menuitem: "메뉴 항목",
  img: "이미지",
  cell: "표 항목",
};

/**
 * 대상 요소를 가리키는 사람 말.
 *
 * 후보 체인(primary → fallbacks)에서 **role/label/text 인 첫 후보**를 쓴다.
 * testid·css 는 건너뛴다 — 코드·선택자를 테스터에게 노출하지 않는다는 원칙 때문이다.
 */
export function describeTarget(target: AnyLocatorTarget | null | undefined): string {
  if (target === null || target === undefined) return "";

  const chain = [target.primary, ...target.fallbacks];
  for (const candidate of chain) {
    if (candidate === null || candidate === undefined) continue;
    if (candidate.by === "role") {
      const role = ROLE_LABEL[candidate.role] ?? candidate.role;
      return candidate.name === undefined || candidate.name === ""
        ? role
        : `${role} “${candidate.name}”`;
    }
    if (candidate.by === "label") return `“${candidate.value}” 입력란`;
    if (candidate.by === "text") return `“${candidate.value}”`;
  }

  const snapshotText = target.snapshot?.text ?? "";
  if (snapshotText !== "") return `“${snapshotText.slice(0, 40)}”`;
  return "대상 요소";
}

/** 시안 스텝 카드 `<code>` 칩. */
export function stepChipLabel(actionType: ActionType): string {
  return ACTION_CHIP_LABEL[actionType];
}

/** 시안 `.step-no` 표기 — `01`, `02`, … */
export function stepNumberLabel(sequence: number): string {
  return String(sequence).padStart(2, "0");
}

/**
 * 칩 뒤에 붙는 설명 문장.
 * 시안 예: `{{baseUrl}}/login` · `아이디 필드 · {{testUser.email}}` · `버튼 “로그인”`
 */
export function describeStepDetail(step: DescribableStep): string {
  const target = describeTarget(step.target);
  const value = displayStepValue({ input: step.input ?? null });

  switch (step.actionType) {
    case "goto":
      return value;
    case "click":
      return target;
    case "hover":
      return target === "" ? "" : `${target} 위로 이동`;
    case "fill":
      return joinDot(target, value);
    case "select":
      return joinDot(target, value === "" ? "" : `“${value}” 선택`);
    case "press":
      return joinDot(target, value === "" ? "" : `${value} 키 입력`);
    case "check":
      return target === "" ? "선택" : `${target} 선택`;
    case "uncheck":
      return target === "" ? "선택 해제" : `${target} 선택 해제`;
    case "assert_visible":
      return target === "" ? "화면에 표시됨" : `${target} 이(가) 화면에 표시됨`;
    case "assert_text":
      return joinDot(target, value === "" ? "" : `텍스트 “${value}”`);
    case "assert_url":
      return value === "" ? "URL 확인" : `URL 이 “${value}”`;
    case "wait": {
      const waitMs = step.options?.waitMs;
      return waitMs === undefined ? "대기" : `${formatSeconds(waitMs)} 대기`;
    }
  }
}

function joinDot(left: string, right: string): string {
  if (left === "") return right;
  if (right === "") return left;
  return `${left} · ${right}`;
}

/** 5000 → "5초", 1500 → "1.5초" */
export function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  const text = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return `${text}초`;
}
