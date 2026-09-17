import { cn } from "cn";

/**
 * 시안 `.add-step` 1:1 (Task 10.2).
 *
 * ```
 * width:100% · border:1px dashed #aebbb6 · background:#f9fbfa
 * color:var(--brand) · border-radius:12px · padding:12px · font-weight:750
 * ```
 * `ui/Button` 을 쓰지 않았다 — `.btn` 은 실선 테두리·min-height 38px·중앙 정렬 폭이
 * 자기 계약이라, 점선 전폭 버튼을 만들려면 그 계약을 대부분 덮어써야 한다.
 * 덮어쓴 버튼은 이름만 Button 이고 실제로는 다른 것이다.
 */
export type AddStepButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
};

export function AddStepButton({
  onClick,
  disabled = false,
  label = "＋ 다음 스텝 추가",
}: AddStepButtonProps) {
  return (
    <button
      type="button"
      data-slot="add-step"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full rounded-step border border-dashed border-add-step-line bg-add-step-bg",
        "p-[12px] font-750 text-brand outline-none transition-colors duration-150",
        "hover:border-brand focus-visible:shadow-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {label}
    </button>
  );
}
