import { Panel } from "@/components/ui";

/**
 * Gen-Phase 8 은 **레이아웃과 프리미티브까지**가 범위다.
 * 화면 내용은 Gen-Phase 9(대시보드·시나리오 목록) / 10(빌더) / 11(실행 현황·스위트)
 * 에서 각각 제 컴포넌트로 교체된다. 여기 있는 것은 라우터 골격을 세우기 위한 빈 껍데기다.
 */
export function PagePlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <>
      <div className="mb-[24px] flex items-end justify-between max-mobile:flex-col max-mobile:items-start max-mobile:gap-[12px]">
        <div>
          <h1 className="mb-[5px]">{title}</h1>
          <p className="m-0 text-muted">{description}</p>
        </div>
      </div>
      <Panel title="준비 중" bodyClassName="px-[20px] py-[18px]">
        <p className="m-0 text-[12px] text-muted">
          이 화면은 {phase} 에서 구현됩니다.
        </p>
      </Panel>
    </>
  );
}
