import { useNavigate } from "react-router-dom";
import { cn } from "cn";
import {
  SCENARIO_SOURCE_TYPE_LABEL,
  SCENARIO_STATUS_LABEL,
  type ScenarioListItem,
} from "@testflow/contracts";
import { Skeleton, StatusDot } from "@/components/ui";
import {
  EMPTY_MARK,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  SCENARIO_STATUS_TONE,
  formatDateLabel,
  formatScenarioMeta,
} from "@/lib";

/**
 * 시안 화면 2 테이블 1:1.
 *
 *   .table-wrap  background white / border 1px var(--line) / radius 16px / overflow auto
 *   .table       width 100% / border-collapse collapse / min-width 820px
 *   .table th    text-align left / background #f5f7f6 / padding 12px 15px
 *                color #68736f / font-size 10px / letter-spacing .04em
 *   .table td    padding 15px / border-top 1px var(--line) / font-size 12px
 *   tr:hover td  background #fbfcfb
 *   .scenario-title       font-weight 750
 *   .scenario-title small display block / color var(--muted) / font-weight 500 / margin-top 3px
 *
 * 6열 = 시나리오 · 기능 · 상태 · 최근 결과 · 수정일 · 작성자.
 * 상태 표시는 `ui/StatusDot`(시안 `.mini-status` — 6px 점 + green/red/gray).
 *
 * ★ 행 전체가 클릭 대상이다. `<tr>` 은 링크가 될 수 없으므로 `role="link"` + 키보드
 *   핸들러를 직접 붙였다. 시나리오 이름 셀에도 실제 포커스 대상이 되는 요소를 두었다.
 */
export type ScenarioTableProps = {
  items: readonly ScenarioListItem[];
  /** 검색어가 바뀌는 동안 이전 결과를 흐리게 표시한다. */
  dimmed?: boolean;
  now?: Date;
};

const COLUMNS = ["시나리오", "기능", "상태", "최근 결과", "수정일", "작성자"] as const;

export function ScenarioTable({ items, dimmed = false, now }: ScenarioTableProps) {
  const navigate = useNavigate();

  return (
    <div
      data-slot="table-wrap"
      className={cn(
        "overflow-auto rounded-table border border-line bg-panel transition-opacity duration-150",
        dimmed && "opacity-60",
      )}
    >
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column}
                scope="col"
                className="bg-table-head px-[15px] py-[12px] text-left text-th text-table-head-ink"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              role="link"
              tabIndex={0}
              data-slot="scenario-row"
              aria-label={item.name}
              data-source-type={item.sourceType}
              onClick={() => {
                void navigate(editPath(item));
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                void navigate(editPath(item));
              }}
              className="cursor-pointer outline-none [&:focus-visible>td]:bg-row-hover [&:hover>td]:bg-row-hover"
            >
              <td className="border-t border-line px-[15px] py-[15px] text-td font-750">
                <span className="flex items-center gap-[7px]">
                  <span className="min-w-0 truncate">{item.name}</span>
                  {/*
                    ★ 열을 늘리지 않는다 — 시안의 6열 구조를 유지한다.
                      원본 종류는 시나리오 이름 옆의 작은 태그로만 구분한다.
                  */}
                  <span
                    data-slot="source-tag"
                    className="shrink-0 rounded-tag bg-tag px-[6px] py-[2px] text-[9px] font-medium text-tag-ink"
                  >
                    {SCENARIO_SOURCE_TYPE_LABEL[item.sourceType]}
                  </span>
                </span>
                <small className="mt-[3px] block font-medium text-muted">
                  {/*
                    코드 시나리오는 `stepCount` 가 항상 0 이다(스텝 테이블에 행이 없다).
                    "0개 스텝" 은 사실이지만 오해를 만든다 — 그 자리에 코드임을 적는다.
                    **목록 응답에 코드 본문은 없다**(서버가 1:1 분리 테이블로 막았다).
                  */}
                  {item.sourceType === "code"
                    ? `${item.code} · 코드 실행`
                    : formatScenarioMeta(item.code, item.stepCount)}
                </small>
              </td>
              <td className="border-t border-line px-[15px] py-[15px] text-td">
                {item.feature ?? EMPTY_MARK}
              </td>
              <td className="border-t border-line px-[15px] py-[15px] text-td">
                <StatusDot tone={SCENARIO_STATUS_TONE[item.status]}>
                  {SCENARIO_STATUS_LABEL[item.status]}
                </StatusDot>
              </td>
              <td className="border-t border-line px-[15px] py-[15px] text-td">
                <LastResultCell item={item} />
              </td>
              <td className="border-t border-line px-[15px] py-[15px] text-td">
                {formatDateLabel(item.updatedAt, now)}
              </td>
              <td className="border-t border-line px-[15px] py-[15px] text-td">
                {item.authorName ?? EMPTY_MARK}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 편집 화면은 원본 종류로 갈린다 — 코드 시나리오에 빌더·인스펙터는 의미가 없다. */
function editPath(item: ScenarioListItem): string {
  return item.sourceType === "code" ? `/scenarios/${item.id}/code` : `/scenarios/${item.id}`;
}

function LastResultCell({ item }: { item: ScenarioListItem }) {
  const last = item.lastResult;
  if (last === null) return <>{EMPTY_MARK}</>;

  /**
   * `lastResult.status` 는 계약상 `z.string()` 이라 `RunStatus` 로 좁혀져 있지 않다.
   * (04-gen-4 가 `ScenarioListItemSchema` 를 그렇게 정의했다.)
   * 사전에 없는 값이 오면 원문을 그대로 회색으로 보여 준다 — 조용히 빈칸을 그리지 않는다.
   */
  const known = Object.hasOwn(RUN_STATUS_LABEL, last.status);
  const tone = known ? RUN_STATUS_TONE[last.status as keyof typeof RUN_STATUS_TONE] : "gray";
  const label = known ? RUN_STATUS_LABEL[last.status as keyof typeof RUN_STATUS_LABEL] : last.status;

  return (
    <StatusDot tone={tone} title={last.runCode}>
      {label}
    </StatusDot>
  );
}

/** 목록 로딩 중 골격. 열 수·패딩이 실제 표와 같아야 데이터 도착 시 화면이 튀지 않는다. */
export function ScenarioTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-auto rounded-table border border-line bg-panel">
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column}
                scope="col"
                className="bg-table-head px-[15px] py-[12px] text-left text-th text-table-head-ink"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              <td className="border-t border-line px-[15px] py-[15px]">
                <Skeleton className="h-[12px] w-[220px]" />
                <Skeleton className="mt-[6px] h-[10px] w-[140px]" />
              </td>
              {[0, 1, 2, 3, 4].map((cell) => (
                <td key={cell} className="border-t border-line px-[15px] py-[15px]">
                  <Skeleton className="h-[10px] w-[64px]" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
