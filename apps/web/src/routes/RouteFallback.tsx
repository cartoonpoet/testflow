import { Panel, Skeleton } from "@/components/ui";

/**
 * 라우트 청크를 받는 동안 보여 주는 자리표시자 (Gen-Phase 12 Task 12.7).
 *
 * ## ★ 왜 화면별 스켈레톤을 쓰지 않는가
 * `RunListSkeleton` · `SuiteTableSkeleton` 같은 화면별 스켈레톤은 **그 화면 파일 안에** 있다.
 * 여기서 import 하면 **그 청크를 미리 받아 오게 되어 code splitting 이 무효가 된다.**
 * 그래서 fallback 은 공용 프리미티브(`Panel`·`Skeleton`)로만 만든다 — 기존 토큰 그대로,
 * 새 색·새 반경 0개.
 *
 * ## 모양
 * 모든 화면이 `PageHead`(제목 + 설명) + 본문 패널 구조라서, 그 두 덩어리의 자리만 잡는다.
 * 자리를 잡아 두면 청크가 도착했을 때 레이아웃이 튀지 않는다(Gen-Phase 9 스켈레톤 규율).
 * 애니메이션은 `Skeleton` 이 쓰는 `animate-pulse` 이고 `prefers-reduced-motion` 에서 자동 정지한다.
 *
 * 사내망 단일 서버 배포라 이 화면이 보이는 시간은 보통 한 프레임 미만이다.
 * 그래도 두는 이유는 **느린 회선에서 흰 화면이 보이지 않게** 하기 위해서다.
 */
export function RouteFallback() {
  return (
    <div data-slot="route-fallback" aria-busy="true">
      {/* PageHead 자리 */}
      <div className="mb-[24px] flex items-end justify-between max-mobile:flex-col max-mobile:items-start max-mobile:gap-[12px]">
        <div>
          <Skeleton className="h-[28px] w-[188px]" />
          <Skeleton className="mt-[9px] h-[13px] w-[260px]" />
        </div>
        <Skeleton className="h-[34px] w-[120px] max-mobile:hidden" />
      </div>

      {/* 본문 패널 자리 */}
      <Panel>
        <Skeleton className="h-[13px] w-[40%]" />
        <Skeleton className="mt-[14px] h-[11px] w-full" />
        <Skeleton className="mt-[10px] h-[11px] w-[86%]" />
        <Skeleton className="mt-[10px] h-[11px] w-[92%]" />
        <Skeleton className="mt-[10px] h-[11px] w-[74%]" />
        <Skeleton className="mt-[10px] h-[11px] w-[90%]" />
      </Panel>
    </div>
  );
}
