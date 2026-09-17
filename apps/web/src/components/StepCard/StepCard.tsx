import type * as React from "react";
import { cn } from "cn";
import {
  describeStepDetail,
  stepChipLabel,
  stepNumberLabel,
  type DescribableStep,
} from "@/lib/step-text";

/**
 * 시안 `.step-card` 1:1 (Task 10.1).
 *
 * ```
 * grid-template-columns: 34px 1fr auto   ← 번호칩 / 이름+동작설명 / 핸들
 * radius 12px · padding 13px 14px · transition .15s
 * hover     border #9db1aa + shadow 0 5px 18px rgba(21,48,41,.06)
 * selected  border #74ad99 + background #f6fbf8, 번호칩은 --soft/--brand
 * ```
 * 색은 전부 `globals.css` 토큰(`--color-step-*`)이다. HEX 를 여기 쓰지 않는다.
 *
 * ★ 순서 변경은 **버튼과 키보드**로 한다(드래그 라이브러리를 넣지 않았다).
 *   주 사용자가 비개발자 테스터이고, 드래그는 키보드·스크린리더에서 아예 쓸 수 없다.
 *   시안의 `••` 핸들은 **장식으로 남기고**(aria-hidden) 그 자리에 ▲▼ 버튼을 둔다.
 *   카드에 포커스를 둔 채 `Alt+↑` / `Alt+↓` 로도 움직인다.
 *
 * ★ `isSecret` 값은 `describeStepDetail` → contracts `displayStepValue` 를 거쳐
 *   `••••••••` 로만 그려진다. 원본 값은 이 컴포넌트에 들어오지도 않는다.
 */

export type StepCardStep = DescribableStep & { name: string };

export type StepCardProps = {
  step: StepCardStep;
  /** 화면 표시용 번호(1부터). `sequence` 가 없는 녹화 초안에는 목록 인덱스를 넣는다. */
  sequence: number;
  selected?: boolean;
  onSelect?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** 순서 변경 요청이 날아가는 중이면 버튼을 잠근다. */
  busy?: boolean;
};

export function StepCard({
  step,
  sequence,
  selected = false,
  onSelect,
  onMoveUp,
  onMoveDown,
  busy = false,
}: StepCardProps) {
  const detail = describeStepDetail(step);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey) return;
    if (event.key === "ArrowUp" && onMoveUp !== undefined) {
      event.preventDefault();
      onMoveUp();
    } else if (event.key === "ArrowDown" && onMoveDown !== undefined) {
      event.preventDefault();
      onMoveDown();
    }
  };

  return (
    <li
      data-slot="step-card"
      data-selected={selected ? "true" : "false"}
      data-sequence={sequence}
      className={cn(
        "mb-[10px] grid grid-cols-[34px_1fr_auto] items-center gap-[12px]",
        "rounded-step border px-[14px] py-[13px] transition-[border-color,box-shadow,background-color] duration-150",
        selected
          ? "border-step-selected-line bg-step-selected-bg"
          : "border-line bg-panel hover:border-step-hover-line hover:shadow-step-hover",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onKeyDown={onKeyDown}
        aria-pressed={selected}
        className="col-span-2 grid grid-cols-subgrid items-center gap-[12px] text-left outline-none focus-visible:rounded-step focus-visible:shadow-focus-ring"
      >
        <span
          data-slot="step-no"
          className={cn(
            "grid h-[28px] w-[28px] place-items-center rounded-chip font-mono text-[11px] font-bold",
            selected ? "bg-soft text-brand" : "bg-step-no text-step-no-ink",
          )}
        >
          {stepNumberLabel(sequence)}
        </span>
        <span data-slot="step-copy" className="block min-w-0">
          <strong className="block text-[13px]">{step.name}</strong>
          <span className="mt-[3px] block text-[11px] text-muted">
            <code className="rounded-[5px] bg-soft px-[5px] py-[2px] text-[10px] text-brand-dark">
              {stepChipLabel(step.actionType)}
            </code>{" "}
            {detail}
          </span>
        </span>
      </button>

      <span className="flex items-center gap-[2px]">
        <ReorderButton
          label={`${String(sequence)}번 단계를 위로`}
          glyph="▲"
          onClick={onMoveUp}
          disabled={busy || onMoveUp === undefined}
        />
        <ReorderButton
          label={`${String(sequence)}번 단계를 아래로`}
          glyph="▼"
          onClick={onMoveDown}
          disabled={busy || onMoveDown === undefined}
        />
        {/* 시안 `.drag` — 장식. 실제 조작은 위 두 버튼과 Alt+↑/↓ 다. */}
        <span
          aria-hidden="true"
          className="ml-[4px] text-drag tracking-drag"
          title="Alt+↑ / Alt+↓ 로 순서를 바꿉니다"
        >
          ••
        </span>
      </span>
    </li>
  );
}

function ReorderButton({
  label,
  glyph,
  onClick,
  disabled,
}: {
  label: string;
  glyph: string;
  onClick?: (() => void) | undefined;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid h-[22px] w-[18px] place-items-center rounded-[6px] text-[9px] text-drag outline-none",
        "hover:bg-step-no hover:text-muted focus-visible:shadow-focus-ring",
        "disabled:pointer-events-none disabled:opacity-30",
      )}
    >
      {glyph}
    </button>
  );
}
