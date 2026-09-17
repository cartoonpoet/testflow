import type * as React from "react";
import { cn } from "cn";

/**
 * 로딩 자리표시자.
 *
 * 시안에는 로딩 화면이 없다(01-clarify "UX 결정사항" 마지막 줄).
 * 시안 토큰 안에서 설계한 결과는 다음과 같다.
 *  - 색은 **`--color-hairline`** 하나만 쓴다. 시안이 이미 "내용 없는 가로선"에 쓰는 색이라
 *    새 회색을 만들 필요가 없었다.
 *  - 모양은 채울 자리와 같은 크기의 막대다. 스피너 대신 스켈레톤을 고른 이유는
 *    대시보드·테이블 모두 **레이아웃이 미리 정해진 화면**이라, 자리를 잡아 두면
 *    데이터 도착 시 화면이 튀지 않기 때문이다.
 *  - 애니메이션은 Tailwind 기본 `animate-pulse` 다. `prefers-reduced-motion` 블록이
 *    globals.css 에 있어 자동으로 정지한다.
 */
export type SkeletonProps = React.ComponentProps<"div">;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-bar bg-hairline", className)}
      {...props}
    />
  );
}
