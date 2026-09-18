import { useNavigate } from "react-router-dom";
import { cn } from "cn";
import type { RunListItem } from "@testflow/contracts";
import {
  RUN_STATUS_LABEL,
  RUN_STATUS_SYMBOL,
  RUN_STATUS_TONE,
  browserLabel,
  formatRelativeTime,
} from "@/lib";

/**
 * 시안 `.run-row` 1:1 (화면 1 · 최근 실행 1행).
 *
 *   grid-template-columns: 34px 1fr 90px 100px 80px   ← 시안 원본
 *   gap 10px / align-items center / padding 13px 12px / border-bottom 1px #edf0ee
 *   hover background #f7f9f8
 *   @1050px  30px 1fr 80px 70px   + .tag  숨김
 *   @760px   30px 1fr 75px        + .time 숨김
 *
 * 5열 = 상태심볼 · 이름/RUN-ID · 브라우저 태그 · 상태 텍스트 · 경과 시간.
 *
 * ★ 열 정의는 `globals.css` 의 `@utility tf-run-row` 에 있다. 브레이크포인트마다
 *   열 수가 달라지는 그리드라 클래스 문자열로 흩어 놓으면 tag/time 숨김과 어긋난다.
 *
 * ★ 행 전체가 `<button>` 이다. div+onClick 은 키보드로 도달할 수 없다.
 */
export type RunRowProps = {
  run: RunListItem;
  now?: Date;
  /**
   * ★ 라운드 8 — 다중 선택(삭제용). **시나리오 표와 같은 규율**이다:
   *   생략하면 이 행은 라운드 7까지와 **똑같이** 동작한다(체크박스 자체가 없다).
   *   대시보드의 "최근 실행" 패널은 이 props 를 주지 않으므로 한 글자도 바뀌지 않는다.
   */
  selected?: boolean;
  onToggle?: (id: string) => void;
  /**
   * 고를 수 **없는** 이유. 주면 체크박스가 **꺼진 채 자리를 지키고** `title` 로 이유가 붙는다.
   *
   * ★ 칸을 통째로 비우지 않는 이유가 둘이다 —
   *   ① 비우면 그 행만 좌우로 어긋나 표가 깨져 보인다(실측: 아이콘이 40px 밀린다).
   *   ② "왜 이 행만 고를 수 없나"를 사용자가 추측하게 된다. #14 가 재실행 버튼에서
   *      **끄고 이유를 붙이는** 쪽을 고른 것과 같은 판단이다.
   */
  selectDisabledReason?: string;
};

const symbolClass = {
  green: "bg-ok-soft text-success",
  red: "bg-danger-soft text-danger",
  gray: "bg-wait text-wait-ink",
} as const;

const statusTextClass = {
  green: "text-success",
  red: "text-danger",
  gray: "text-wait-ink",
} as const;

export function RunRow({ run, now, selected, onToggle, selectDisabledReason }: RunRowProps) {
  const navigate = useNavigate();
  const tone = RUN_STATUS_TONE[run.status];
  // `selected` 를 주지 않으면 체크 칸 자체가 없다(대시보드 "최근 실행"이 그 경로다).
  const selectable = selected !== undefined;
  const selectDisabled = onToggle === undefined || selectDisabledReason !== undefined;

  /*
   * ★ 체크박스는 `<button>` **바깥**이다. 버튼 안에 대화형 요소를 넣으면 HTML 이
   *   무효이고(클릭이 버튼으로 새어 행 이동이 된다), 브라우저마다 다르게 동작한다.
   *   행 구분선(`border-b`)을 바깥 래퍼로 옮긴 이유도 이것이다 — `last:border-b-0` 이
   *   유일한 자식이 아니라 **행들 사이**에서 판정돼야 한다.
   */
  return (
    <div
      data-slot="run-row-wrap"
      data-run-id={run.id}
      data-selected={selectable ? (selected ? "true" : "false") : undefined}
      className={cn(
        "flex items-center border-b border-hairline last:border-b-0",
        selectable && "pl-[12px]",
      )}
    >
      {selectable ? (
        <input
          type="checkbox"
          data-testid="run-select"
          data-run-id={run.id}
          data-select-disabled={selectDisabled ? "true" : "false"}
          aria-label={`${run.runCode} 선택`}
          checked={selected}
          disabled={selectDisabled}
          title={selectDisabledReason}
          onChange={() => {
            onToggle?.(run.id);
          }}
          className="mr-[10px] h-[14px] w-[14px] shrink-0 accent-brand disabled:opacity-40"
        />
      ) : null}

      <button
        type="button"
        data-slot="run-row"
        onClick={() => {
          void navigate(`/runs/${run.id}`);
        }}
        className={cn(
          "tf-run-row min-w-0 flex-1 px-[12px] py-[13px] text-left",
          "transition-colors duration-150 hover:bg-run-row-hover",
          "focus-visible:outline-none focus-visible:bg-run-row-hover",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid h-[28px] w-[28px] place-items-center rounded-chip text-[11px] font-black max-compact:h-[26px] max-compact:w-[26px]",
            symbolClass[tone],
          )}
        >
          {RUN_STATUS_SYMBOL[run.status]}
        </span>

        <span className="block min-w-0">
          <strong className="block truncate text-[13px]">{run.scenarioName}</strong>
          <span className="block truncate text-[11px] text-muted">{run.runCode}</span>
        </span>

        <span className="justify-self-start rounded-tag bg-tag px-[7px] py-[4px] text-[10px] font-750 text-tag-ink max-compact:hidden">
          {browserLabel(run.browser)}
        </span>

        <span className={cn("text-[11px] font-extrabold", statusTextClass[tone])}>
          {RUN_STATUS_LABEL[run.status]}
        </span>

        <span className="text-right text-[11px] text-muted max-mobile:hidden">
          {formatRelativeTime(run.startedAt, now)}
        </span>
      </button>
    </div>
  );
}
