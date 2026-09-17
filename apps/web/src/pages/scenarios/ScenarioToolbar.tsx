import { SCENARIO_STATUSES, SCENARIO_STATUS_LABEL } from "@testflow/contracts";
import { Select } from "@/components/ui";
import {
  FILTER_ALL,
  type ScenarioFilterPatch,
  type ScenarioFilters,
} from "@/hooks/useScenarios";

/**
 * 시안 화면 2 `.toolbar` 1:1.
 *
 *   .toolbar  background white / border 1px var(--line) / radius 14px / padding 13px
 *             display flex / gap 10px / margin-bottom 14px   (@760px flex-wrap)
 *   .search   flex 1 / border 1px var(--line) / radius 10px / padding 0 12px / min-height 40px
 *   .search input  border 0 / outline 0 / background transparent
 *   .filter   border 1px var(--line) / radius 10px / padding 0 12px / color #4f5c58 / height 40px
 *
 * ★ 검색 입력은 `ui/Input` 프리미티브를 쓰지 않았다. 시안의 `.search` 는
 *   **테두리가 바깥 래퍼에 있고 input 은 투명·무테**인 형태다. Input 프리미티브는
 *   자기 테두리와 focus 링을 갖고 있어 겹친다. 래퍼가 `focus-within` 으로 같은
 *   focus 링을 그리도록 해 시각적 계약은 동일하게 맞췄다.
 *
 * ★ 상태 선택지는 `SCENARIO_STATUSES` + `SCENARIO_STATUS_LABEL`(contracts) 에서 만든다.
 *   web 에 목록을 다시 적으면 계약에 상태가 추가돼도 화면이 모른다.
 */
export type ScenarioToolbarProps = {
  filters: ScenarioFilters;
  onChange: (patch: ScenarioFilterPatch) => void;
  features: readonly string[];
};

export function ScenarioToolbar({ filters, onChange, features }: ScenarioToolbarProps) {
  return (
    <div
      data-slot="toolbar"
      className="mb-[14px] flex gap-[10px] rounded-toolbar border border-line bg-panel p-[13px] max-mobile:flex-wrap"
    >
      <div className="flex min-h-[40px] flex-1 items-center gap-[8px] rounded-btn border border-line px-[12px] transition-[border-color,box-shadow] duration-150 focus-within:border-brand focus-within:shadow-focus-ring">
        <span aria-hidden="true" className="text-muted">
          ⌕
        </span>
        <input
          data-slot="scenario-search"
          type="search"
          value={filters.q}
          aria-label="시나리오 검색"
          placeholder="이름, ID, 태그로 검색"
          onChange={(event) => {
            onChange({ q: event.target.value });
          }}
          className="w-full border-0 bg-transparent text-ink outline-none placeholder:text-muted"
        />
      </div>

      <Select
        variant="filter"
        aria-label="상태 필터"
        data-slot="status-filter"
        value={filters.status}
        onChange={(event) => {
          onChange({ status: event.target.value as ScenarioFilters["status"] });
        }}
      >
        <option value={FILTER_ALL}>전체 상태</option>
        {SCENARIO_STATUSES.map((status) => (
          <option key={status} value={status}>
            {SCENARIO_STATUS_LABEL[status]}
          </option>
        ))}
      </Select>

      <Select
        variant="filter"
        aria-label="기능 필터"
        data-slot="feature-filter"
        value={filters.feature}
        onChange={(event) => {
          onChange({ feature: event.target.value });
        }}
      >
        <option value="">모든 기능</option>
        {features.map((feature) => (
          <option key={feature} value={feature}>
            {feature}
          </option>
        ))}
        {/*
          URL 로 들어온 기능이 선택지에 없을 수 있다(100건 스캔 밖 or 삭제됨).
          그때 네이티브 select 는 **조용히 첫 항목을 고른 것처럼** 보여 URL 과 어긋난다.
          값이 살아 있도록 임시 option 을 하나 더 붙인다.
        */}
        {filters.feature !== "" && !features.includes(filters.feature) ? (
          <option value={filters.feature}>{filters.feature}</option>
        ) : null}
      </Select>
    </div>
  );
}
