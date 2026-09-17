import type * as React from "react";
import type { DashboardNotice } from "@testflow/contracts";
import { NoticeBox, NoticeLine } from "@/components";
import { Panel, Skeleton, StateView } from "@/components/ui";
import { formatPercentValue, toBarWidth } from "@/lib";
import { useDashboardReadiness } from "@/hooks/useDashboard";

/**
 * 시안 화면 1 우측 "회귀 테스트 준비도" 패널 + amber notice.
 *
 *   .suite       padding 16px 18px
 *   .suite-item  padding 14px 0 / border-bottom 1px var(--line) / 마지막 행은 테두리 없음
 *   .suite-top   flex space-between · strong 13px · span 10px var(--muted)
 *   .bar         height 6px / background #edf0ee / radius 5px / margin-top 10px / overflow hidden
 *   .bar i       height 100% / background var(--brand) / radius 5px
 *
 * ★ 시안은 기능 묶음 3줄(회원·인증 / 상품·장바구니 / 주문·결제)을 보여 주지만
 *   `GET /api/dashboard/readiness` 는 **전체 1줄**(`percent` / `passing` / `totalScenarios`)만 준다.
 *   MVP 에 "스위트별 준비도" 집계가 없어서다. 줄 수만 다르고 스타일은 시안 그대로다.
 *   (묶음별 준비도가 필요해지면 API 에 스위트 단위 집계를 추가해야 한다.)
 */
export function ReadinessPanel() {
  const readiness = useDashboardReadiness();

  return (
    <>
      <Panel title="회귀 테스트 준비도" action="최근 실행 기준" data-slot="readiness">
        {readinessBody()}
      </Panel>
      {readiness.data === undefined ? null : <ReadinessNotices notices={readiness.data.notices} />}
    </>
  );

  function readinessBody() {
    if (readiness.isPending) {
      return (
        <div className="px-[18px] py-[16px]">
          <div className="py-[14px]">
            <div className="flex items-center justify-between">
              <Skeleton className="h-[13px] w-[96px]" />
              <Skeleton className="h-[10px] w-[44px]" />
            </div>
            <Skeleton className="mt-[10px] h-[6px] w-full rounded-bar" />
          </div>
        </div>
      );
    }

    if (readiness.isError) {
      return (
        <StateView
          tone="error"
          title="준비도를 불러오지 못했습니다"
          description={readiness.error.message}
          onRetry={() => void readiness.refetch()}
        />
      );
    }

    const { percent, passing, totalScenarios } = readiness.data;

    if (totalScenarios === 0) {
      return (
        <StateView
          title="집계할 시나리오가 없습니다"
          description="첫 시나리오를 만들면 준비도가 계산됩니다."
        />
      );
    }

    return (
      <div className="px-[18px] py-[16px]" data-slot="suite">
        <ReadinessRow
          label="전체 시나리오"
          detail={`${String(passing)} / ${String(totalScenarios)}`}
          percent={percent}
        />
      </div>
    );
  }
}

/** 시안 `.suite-item` + `.bar`. */
function ReadinessRow({
  label,
  detail,
  percent,
}: {
  label: string;
  detail: string;
  percent: number;
}) {
  return (
    <div
      data-slot="suite-item"
      className="border-b border-line py-[14px] last:border-b-0 last:pb-0"
    >
      <div className="flex items-center justify-between">
        <strong className="text-[13px]">{label}</strong>
        <span className="text-[10px] text-muted">
          {detail} · {formatPercentValue(percent)}
        </span>
      </div>
      <div
        data-slot="bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="mt-[10px] h-[6px] overflow-hidden rounded-bar bg-hairline"
      >
        {/*
          폭은 데이터다. 스타일이 아니라 **값**만 CSS 변수로 넘기고
          실제 그리기는 globals.css 의 `tf-bar-fill` 이 한다.
        */}
        <i
          className="tf-bar-fill"
          style={{ "--tf-bar-width": toBarWidth(percent) } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

/** 규칙 기반 notices → 시안 amber 박스 1개. */
function ReadinessNotices({ notices }: { notices: readonly DashboardNotice[] }) {
  if (notices.length === 0) return null;

  const order = { danger: 0, warn: 1, info: 2 } as const;
  const sorted = [...notices].sort((a, b) => order[a.level] - order[b.level]);

  return (
    <NoticeBox title={`확인이 필요한 항목 ${String(sorted.length)}개`}>
      {sorted.map((notice) => (
        <NoticeLine key={`${notice.level}-${notice.message}`}>{notice.message}</NoticeLine>
      ))}
    </NoticeBox>
  );
}
