/**
 * Playwright reporter 의 **step 제목** 처리 — 마스킹과 `ActionType` 매핑.
 *
 * 라운드 2 PoC 가 실측으로 밝힌 두 가지를 **계약으로 못박은 파일**이다
 * (`r2-poc-live-stream.md` — "★ 반드시 넘겨야 할 발견 두 가지").
 *
 * ## 왜 Runner 가 아니라 contracts 에 있는가
 * 두 함수 모두 **입력이 문자열, 출력이 계약 타입**인 순수 함수다. `ActionType` 의 정의가
 * 여기(contracts)에 있으므로 그 매핑도 여기 있어야 한 곳에서 같이 움직인다.
 * Runner 의 `execute/pw-event-mapper.ts`(Gen-Phase 3)는 이 함수들을 **import 해서**
 * 필터링·시퀀스 부여·SSE 봉투 조립만 한다. 매핑 규칙을 복사하지 않는다.
 *
 * ★ 단, **사용자 테스트 프로세스에 주입되는 `pw-reporter.ts` 는 이 파일을 import 하면 안 된다.**
 *   reporter 는 사용자 프로세스 안에서 돌기 때문에 `@testflow/contracts` 를 끌어들이면
 *   사용자 테스트의 의존성 그래프를 오염시킨다 (PoC 전달사항 4번).
 *   변환은 **Runner 쪽에서** 한다.
 */
import type { ActionType } from "./step.js";

/* ────────────────────────────────────────────────────────────
 * ① 마스킹 — step 제목에 입력값이 평문으로 실려 나온다
 * ──────────────────────────────────────────────────────────── */

/**
 * 값을 벗겨야 하는 **입력 계열** step 제목.
 *
 * Playwright 1.63 실측: `Fill "hong.gildong"` · `Fill "s3cr3t-pw"` · `Type "…"` ·
 * `Set input files "…"`. **비밀번호가 제목에 그대로 박혀서 온다.**
 */
const INPUT_STEP_TITLE_PATTERN = /^(fill|type|set input)/i;

/** 벗긴 값을 대신하는 표기. `SECRET_MASK`(`••••••••`)는 화면용이라 제목에는 쓰지 않는다. */
export const PW_STEP_VALUE_MASK = '"***"';

/**
 * step 제목에서 **입력값만** 벗긴다. 마스킹은 **DB/SSE 로 나가기 전에** 적용해야 한다
 * (라운드 1 규약: 마스킹은 DB 쓰기 전에).
 *
 * ★ 왜 인용부호를 전부 지우지 않는가 —
 *   `Expect "toHaveText"` 의 인용부호 안은 **matcher 이름**이다. 같이 지우면
 *   "무엇을 확인했는지"가 화면에서 사라진다. 입력 계열만 벗기는 이유가 이것이다.
 *
 * ★ 이 패턴 기반 제거가 **유일한 방어선**인 경우가 있다 —
 *   코드 실행은 사용자가 `variables` 를 안 넘길 수 있어 값 기반 마스킹
 *   (`collectSecretValues()`)이 빈 배열로 떨어진다 (01-clarify 제약 1번).
 *
 * @example
 * stripStepValue('Fill "s3cr3t-pw"')   // → 'Fill "***"'
 * stripStepValue('Expect "toHaveText"') // → 'Expect "toHaveText"' (변형 없음)
 */
export function stripStepValue(title: string): string {
  if (!INPUT_STEP_TITLE_PATTERN.test(title)) return title;
  return title.replace(/"[^"]*"/g, PW_STEP_VALUE_MASK);
}

/* ────────────────────────────────────────────────────────────
 * ② `ActionType` 매핑 — 제목은 API 이름이 아니라 사람이 읽는 라벨이다
 * ──────────────────────────────────────────────────────────── */

/**
 * Playwright step 제목 → TestFlow `ActionType`.
 *
 * ★★ **제목은 API 이름이 아니다.** `locator.click` 이 아니라 `Click`,
 *    `page.goto` 가 아니라 `Navigate` 다. 문서를 보고 추측해 매핑을 짜면 **전부 `wait` 로 떨어진다.**
 *    아래 규칙은 PoC 의 `--mode c` 실행 로그에서 **실측한 문자열**로 맞췄다
 *    (`apps/runner/poc/r2/map-events.ts` 승격).
 *
 * ★★ **이 라벨은 Playwright 버전업에 조용히 바뀐다.** 그래서
 *    `pw-step-title.spec.ts` 의 회귀 테스트가 이 함수의 짝이다 — 실측 제목 전량이
 *    기대 `ActionType` 으로 떨어지는지, 그리고 **미분류(`wait`) 비율이 기준을 넘지 않는지**를
 *    고정한다. 그 테스트가 없으면 버전업 때 전 스텝이 `wait` 가 되어도 아무도 모른다
 *    (03-phases 리스크 4번).
 *
 * 미분류는 `wait` 로 떨어뜨린다 — 없는 동작을 지어내는 것보다 낫다.
 */
export function toActionType(title: string): ActionType {
  const t = title.toLowerCase();
  if (t.startsWith("navigate") || t.includes("goto")) return "goto";
  if (t.startsWith("fill") || t.startsWith("type") || t.startsWith("set input")) return "fill";
  if (t.startsWith("select option")) return "select";
  if (t.startsWith("uncheck")) return "uncheck";
  if (t.startsWith("check")) return "check";
  if (t.startsWith("click") || t.startsWith("double click")) return "click";
  if (t.startsWith("press")) return "press";
  if (t.startsWith("hover")) return "hover";
  if (t.includes("tohaveurl")) return "assert_url";
  if (t.includes("tobevisible") || t.includes("tobeattached") || t.includes("tobeenabled"))
    return "assert_visible";
  if (t.includes("tohavetext") || t.includes("tocontaintext") || t.includes("tohavevalue"))
    return "assert_text";
  return "wait";
}

/* ────────────────────────────────────────────────────────────
 * ③ 사용자에게 보여줄 step 인가 — 카테고리·깊이 필터
 * ──────────────────────────────────────────────────────────── */

/**
 * 화면에 흘려보낼 step 의 카테고리.
 *
 * Playwright 는 `hook`("Before Hooks"/"After Hooks"/"Worker Cleanup")과
 * `fixture`("Fixture \"browser\"") 카테고리 step 도 보낸다. 그대로 흘리면
 * **사용자 화면이 내부 구현으로 도배된다** — PoC 실측 `step.begin` 51건 → 사용자 스텝 22건.
 */
export const PW_VISIBLE_STEP_CATEGORIES = ["pw:api", "expect", "test.step"] as const;

/**
 * `depth === 0` **AND** 카테고리가 위 3종일 때만 사용자 스텝이다.
 * (`depth > 0` 은 `expect` 안쪽의 locator 질의 같은 중첩 내부 호출이다.)
 */
export function isUserVisiblePwStep(category: string, depth: number): boolean {
  if (depth !== 0) return false;
  return (PW_VISIBLE_STEP_CATEGORIES as readonly string[]).includes(category);
}
