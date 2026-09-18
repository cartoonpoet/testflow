import { cn } from "cn";

/**
 * TestFlow 브랜드 마크 — 「지켜보는 흐름」
 *
 * 형태의 근거
 *   · 둥근 타일          = 실행을 **지켜보는 화면**(뷰포트). 반경 9.6/32 은 `--radius-chip 9px @30px` 과 같다.
 *   · 오른쪽으로 오르는 계단 = 테스트 **스텝이 흘러가는 경로**. 오름 방향이라 "진행/통과"로 읽힌다.
 *   · 경로 끝의 뚫린 원     = 지금 실행 중인 스텝의 **라이브 인디케이터**(녹화·재생 점).
 *   경로와 링은 끊기지 않고 이어져 하나의 획으로 읽힌다 — 흐름과 지켜봄이 한 형태에서 겹친다.
 *
 * ★ 이미지 파일이 아니라 인라인 SVG 인 이유
 *   색을 토큰(`fill-logo-mark` / `stroke-logo-mark-ink`)으로 제어할 수 있고,
 *   `<img>` 요청이 하나 줄어든다. HEX 리터럴이 `apps/web/src` 에 들어가지 않는다.
 *
 * ★ 글자(<text>)를 쓰지 않는다 — 16px 파비콘에서 "TF" 두 글자는 검은 얼룩이 된다(렌더 검증).
 *   같은 기하를 `public/favicon.svg` 가 HEX 로 복제한다. 토큰을 바꾸면 그 파일도 함께 바꿔야 한다.
 */
export type TestFlowMarkProps = {
  className?: string;
};

export function TestFlowMark({ className }: TestFlowMarkProps) {
  return (
    <svg
      data-slot="brand-mark"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <path
        className="fill-logo-mark"
        d="M0 9.6A9.6 9.6 0 0 1 9.6 0h12.8A9.6 9.6 0 0 1 32 9.6v12.8A9.6 9.6 0 0 1 22.4 32H9.6A9.6 9.6 0 0 1 0 22.4Z"
      />
      <path
        className="stroke-logo-mark-ink"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.4 24.4h7.2v-12h2.6"
      />
      <circle className="fill-logo-mark-ink" cx="23.4" cy="12.4" r="4.9" />
      <circle className="fill-logo-mark" cx="23.4" cy="12.4" r="2" />
    </svg>
  );
}
