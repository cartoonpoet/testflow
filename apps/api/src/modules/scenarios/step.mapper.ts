import { DEFAULT_STEP_OPTIONS, toPublicTestStep } from "@testflow/contracts";
import type { ApiTestStep, TestStep } from "@testflow/contracts";
import type { TestStepEntity } from "@testflow/db";

/**
 * DB 엔티티 ↔ `@testflow/contracts` 의 `TestStep` 변환.
 *
 * 타입을 API 에서 재정의하지 않는다 — 여기서 하는 일은 **컬럼 이름 매핑뿐**이다
 * (`targetJson` → `target` 등).
 */
export function toTestStep(entity: TestStepEntity): TestStep {
  return {
    id: entity.id,
    scenarioId: entity.scenarioId,
    sequence: entity.sequence,
    name: entity.name,
    actionType: entity.actionType,
    target: entity.targetJson,
    input: entity.inputJson,
    options: entity.optionsJson ?? DEFAULT_STEP_OPTIONS,
  };
}

/**
 * ★ **응답 직렬화 직전에 반드시 통과시킨다.**
 *
 * 기본값(`advanced=false`)은 `toPublicTestStep()` → `toPublicLocatorTarget()` 을 거쳐
 * `by:"css"` 후보가 전부 제거된 형태다. CSS Selector 는 테스터 화면에 노출하지 않는다
 * (02-context "설계상 반드시 지켜야 할 제약").
 *
 * `primary` 자체가 css 인 스텝이 존재하므로 `fallbacks` 만 필터하는 방식으로는 막을 수
 * 없다 — 그래서 단순 필터가 아니라 contracts 의 변환 함수를 쓴다.
 *
 * `?advanced=1` 일 때만 원본 `LocatorTarget` 을 그대로 낸다(고급 설정 화면 전용).
 */
export function toApiStep(step: TestStep, advanced: boolean): ApiTestStep {
  return advanced ? step : toPublicTestStep(step);
}

export function toApiSteps(steps: readonly TestStep[], advanced: boolean): ApiTestStep[] {
  return steps.map((step) => toApiStep(step, advanced));
}

/** `?advanced=1` / `?advanced=true` 만 고급 모드로 인정한다. */
export function parseAdvancedFlag(value: unknown): boolean {
  return value === "1" || value === "true";
}
