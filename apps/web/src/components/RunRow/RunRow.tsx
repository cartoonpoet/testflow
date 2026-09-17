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

export function RunRow({ run, now }: RunRowProps) {
  const navigate = useNavigate();
  const tone = RUN_STATUS_TONE[run.status];

  return (
    <button
      type="button"
      data-slot="run-row"
      onClick={() => {
        void navigate(`/runs/${run.id}`);
      }}
      className={cn(
        "tf-run-row w-full border-b border-hairline px-[12px] py-[13px] text-left last:border-b-0",
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
  );
}
