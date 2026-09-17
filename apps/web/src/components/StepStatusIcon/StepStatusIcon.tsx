import { cn } from "cn";
import type { StepResultStatus } from "@testflow/contracts";

/**
 * 시안 `.exec-row .check` 1:1 (화면 4 · 실행 스텝 상태 표시).
 *
 *   .check          25×25 / border-radius 50% / grid place-items-center
 *                   font-size 10px / font-weight 900 / bg #e5f4ee / color var(--success)
 *   .check.running  border 2px solid var(--brand) + border-top-color:transparent
 *                   background white + animation spin .9s linear infinite
 *   .check.wait     background #eef1ef / color #8c9692
 *
 * ★ 시안은 **3-상태**(완료 `✓` / 실행 중 스피너 / 대기 숫자)만 그린다.
 *   그런데 Runner 가 실제로 만드는 스텝 상태는 **5종**이다(04-gen-6 실측):
 *   `pending` · `running` · `passed` · `failed` · `skipped`.
 *   빠진 두 가지를 **새 색 없이** 채웠다.
 *     - `failed`  → `--danger-soft` + `--danger` + `!`  (시안 `.run-symbol.fail` 과 같은 조합)
 *     - `skipped` → 대기와 같은 중립색 + `–`
 *       ★ **빨간색으로 그리지 않는다.** 취소·실패 이후 스텝이 `skipped` 인데(04-gen-6),
 *         그걸 실패로 칠하면 "5개 중 4개 실패" 처럼 보인다. 실행되지 않은 것은 사고가 아니다.
 *
 * ★ `prefers-reduced-motion` 에서는 globals.css 가 애니메이션을 끈다. 그러면 스피너가
 *   "윗변만 뚫린 정지한 원" 으로 남아 오해를 부르므로, `motion-reduce:` 로 윗변을 되살려
 *   **꽉 찬 브랜드색 링**(정적 표시)이 되게 한다.
 */
export type StepStatusIconProps = {
  status: StepResultStatus;
  /** 대기 상태에 표시할 스텝 번호. */
  sequence: number;
};

const toneClass: Record<StepResultStatus, string> = {
  passed: "bg-ok-soft text-success",
  running: "border-2 border-brand border-t-transparent bg-panel animate-spin-check motion-reduce:border-t-brand",
  failed: "bg-danger-soft text-danger",
  skipped: "bg-wait text-wait-ink",
  pending: "bg-wait text-wait-ink",
};

const glyph: Record<StepResultStatus, string | null> = {
  passed: "✓",
  running: null,
  failed: "!",
  skipped: "–",
  pending: null,
};

export const STEP_STATUS_LABEL: Record<StepResultStatus, string> = {
  pending: "대기",
  running: "실행 중",
  passed: "완료",
  failed: "실패",
  skipped: "건너뜀",
};

export function StepStatusIcon({ status, sequence }: StepStatusIconProps) {
  return (
    <span
      data-slot="step-status"
      data-status={status}
      role="img"
      aria-label={`${String(sequence)}단계 ${STEP_STATUS_LABEL[status]}`}
      className={cn(
        "grid h-[25px] w-[25px] place-items-center rounded-full text-[10px] font-black",
        toneClass[status],
      )}
    >
      {glyph[status] ?? (status === "pending" ? String(sequence) : "")}
    </span>
  );
}
