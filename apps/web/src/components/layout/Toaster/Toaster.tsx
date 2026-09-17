import { cn } from "cn";
import { useToasts, dismissToast } from "@/hooks/useToast";

/**
 * 시안 `.toast` 1:1.
 *   position fixed / right 26px / bottom 26px
 *   background #16241f (--color-toast) / radius 12px / padding 13px 16px
 *   box-shadow var(--shadow) / z-index 50 / font-size 12px
 *   진입 translateY(90px)→0 + opacity, 2.2초 후 자동 소멸
 *   760px 이하: left/right 14px, bottom 14px
 *
 * 진입 연출을 클래스 토글이 아니라 CSS `@keyframes` 로 한 이유:
 * `prefers-reduced-motion: reduce` 에서 globals.css 가 `animation:none` 을 걸면
 * 토스트가 **최종 상태로 즉시** 나타난다. 클래스 토글이면 초기 상태(투명)에
 * 멈춰 버려 화면에서 사라진다.
 */
export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div
      data-slot="toaster"
      role="status"
      aria-live="polite"
      className={cn(
        "fixed right-[26px] bottom-[26px] z-50 flex flex-col gap-[8px] items-end",
        "max-mobile:right-[14px] max-mobile:left-[14px] max-mobile:bottom-[14px] max-mobile:items-stretch",
      )}
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismissToast(t.id)}
          className={cn(
            "animate-toast-in text-left",
            "rounded-toast bg-toast px-[16px] py-[13px] text-[12px] text-white shadow-panel",
          )}
        >
          {t.label === undefined ? null : (
            <b
              className={cn(
                "mr-[7px]",
                t.tone === "danger" ? "text-danger" : "text-toast-accent",
              )}
            >
              {t.label}
            </b>
          )}
          {t.message}
        </button>
      ))}
    </div>
  );
}
