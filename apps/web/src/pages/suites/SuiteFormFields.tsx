import { cn } from "cn";
import type { ScenarioListItem } from "@testflow/contracts";
import { StateView } from "@/components/ui";
import { formatScenarioMeta } from "@/lib";

/**
 * 스위트에 담을 시나리오 선택 목록.
 *
 * 시안에 없는 화면이라 **기존 패턴만 조합**했다 — 시나리오 표의 보조 텍스트
 * (`TC-AUTH-001 · 5개 스텝`), 스텝 카드의 선택 표시(`--color-step-selected-*`),
 * 체크박스는 브라우저 기본형(`accent-color` 를 브랜드 토큰으로). 새 색은 없다.
 */
export type ScenarioPickerProps = {
  scenarios: readonly ScenarioListItem[];
  selectedIds: readonly string[];
  onToggle: (scenarioId: string) => void;
};

export function ScenarioPicker({ scenarios, selectedIds, onToggle }: ScenarioPickerProps) {
  if (scenarios.length === 0) {
    return (
      <StateView
        title="선택할 시나리오가 없습니다"
        description="먼저 시나리오를 만들어야 스위트를 구성할 수 있습니다."
      />
    );
  }

  return (
    <div
      data-slot="scenario-picker"
      className="max-h-[320px] overflow-auto rounded-step border border-line"
    >
      {scenarios.map((scenario) => {
        const checked = selectedIds.includes(scenario.id);
        return (
          <label
            key={scenario.id}
            data-slot="scenario-option"
            data-selected={checked}
            className={cn(
              "flex cursor-pointer items-center gap-[10px] border-b border-hairline px-[13px] py-[11px] last:border-b-0",
              checked ? "border-step-selected-line bg-step-selected-bg" : "hover:bg-row-hover",
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                onToggle(scenario.id);
              }}
              className="h-[15px] w-[15px] accent-brand"
            />
            <span className="min-w-0">
              <strong className="block truncate text-[12px]">{scenario.name}</strong>
              <span className="block truncate text-[10px] text-muted">
                {formatScenarioMeta(scenario.code, scenario.stepCount)}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
