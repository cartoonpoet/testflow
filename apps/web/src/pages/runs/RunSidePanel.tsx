import type * as React from "react";
import { cn } from "cn";
import type { Artifact, RunDetail } from "@testflow/contracts";
import { Skeleton, StateView } from "@/components/ui";
import { RunScreenStill } from "./RunScreen";
import {
  ARTIFACT_TYPE_LABEL,
  EMPTY_MARK,
  MASK,
  artifactTypeRank,
  browserLabel,
  formatBytes,
} from "@/lib";

/**
 * 시안 화면 4 우측 (`grid: 1fr 360px` 의 360px 쪽).
 *
 *   .browser      background #17201e (--color-browser) / radius 16px / overflow hidden / shadow
 *   .browser-bar  height 42px / background #232d2a / gap 6px / padding 0 13px
 *   .browser-bar i 8×8 원 #53605c
 *   .browser-url  height 24px / flex 1 / margin-left 8px / radius 6px / #34403d / 9px #9ca9a5
 *   .browser-screen aspect-ratio 16/10 / background #f7f8f7 / grid place-items center / padding 35px
 *                   @760px padding 20px
 *   .run-meta     padding 18px / white / border / radius 16px / margin-top 15px
 *   .kv           flex space-between / padding 8px 0 / border-bottom 1px #edf0ee / 11px
 *
 * ★ 라운드 2 — 브라우저 화면 자리의 **정적 가짜 로그인 목업(라운드 1 `.fake-login`)을 폐기**했다.
 *   표시 우선순위는 이렇다:
 *
 *   | # | 조건 | 표시 |
 *   |---|---|---|
 *   | 1 | 코드 실행 + 스트림 연결됨 | **라이브 캔버스** |
 *   | 2 | 코드 실행 종료 + 프레임 있음 | **마지막 프레임 + 상태 배지** (캔버스를 비우지 않는다) |
 *   | 3 | 실패 스크린샷 증적 있음 | 스크린샷 |
 *   | 4 | 아무것도 없음 | **중립 안내** (가짜 로그인 화면을 다시 만들지 않는다) |
 *
 *   **녹화 기반 실행(`sourceType === "steps"`)에는 라이브가 없다** — Runner 가 그 경로에
 *   스트림을 배선하지 않았다(04-gen-4 전달 6번). 그때는 3·4 만 쓰고, 그 사실을
 *   화면에 한 줄로 적는다. 있는 척하지 않는다.
 *
 * ★ 라운드 3 — **코드 실행의 라이브 화면은 이 패널에서 나갔다.**
 *   360px 은 1280px 프레임의 28% 라 화면 안의 글자가 읽히지 않았다. 라이브는
 *   본문 전폭 무대(`RunScreen` → `features/live/LiveStage`)로 올라갔고, 여기에는
 *   **라이브가 없는 녹화 실행의 브라우저 목업만** 남는다(위 표의 3·4).
 *   그래서 코드 실행에서는 이 패널이 "실행 정보" 로 시작한다.
 */
export type RunSidePanelProps = {
  run: RunDetail;
  artifacts: readonly Artifact[];
  artifactsPending: boolean;
  artifactsError: Error | null;
  onRetryArtifacts: () => void;
  /**
   * 실행 요청 때 넣은 변수 — **이미 마스킹된 사본**이다(`lib/mask.ts`).
   * 서버에는 저장되지 않고 라우터 state(= `history.state`)로만 전달된다.
   * 실측상 새로고침해도 살아남으므로(세션 히스토리) **마스킹된 사본만** 넘긴다.
   */
  maskedVariables?: Readonly<Record<string, string>> | undefined;
};

export function RunSidePanel({
  run,
  artifacts,
  artifactsPending,
  artifactsError,
  onRetryArtifacts,
  maskedVariables,
}: RunSidePanelProps) {
  const isCode = run.sourceType === "code";

  return (
    <aside data-slot="run-side">
      {/*
        ★ 코드 실행이면 이 상자를 그리지 않는다 — 라이브 무대가 본문 전폭으로 올라가서
          같은 화면을 두 번 그리게 된다. 우측 360px 짜리 축소판이 옆에 같이 있으면
          "둘 중 어느 쪽이 진짜인가" 를 매번 판단하게 만든다.
      */}
      {isCode ? null : (
        <div className="mb-[15px] overflow-hidden rounded-panel bg-browser shadow-panel">
          <div className="flex h-[42px] items-center gap-[6px] bg-browser-bar px-[13px]">
            <i className="h-[8px] w-[8px] rounded-full bg-browser-dot" />
            <i className="h-[8px] w-[8px] rounded-full bg-browser-dot" />
            <i className="h-[8px] w-[8px] rounded-full bg-browser-dot" />
            <div className="ml-[8px] flex h-[24px] flex-1 items-center overflow-hidden rounded-[6px] bg-browser-url px-[10px] text-[9px] text-browser-url-ink">
              <span className="truncate">{stripScheme(run.summary.baseUrl)}</span>
            </div>
          </div>

          <div
            data-slot="run-still"
            className="grid aspect-[16/10] place-items-center bg-browser-screen p-[35px] max-mobile:p-[20px]"
          >
            <RunScreenStill artifacts={artifacts} code={false} />
          </div>
        </div>
      )}

      <div className="rounded-panel border border-line bg-panel p-[18px]">
        <h3 className="mb-[13px] text-[13px]">실행 정보</h3>
        <Kv label="환경">{run.summary.envLabel}</Kv>
        <Kv label="대상 주소">
          <span className="block max-w-[210px] truncate" title={run.summary.baseUrl}>
            {run.summary.baseUrl}
          </span>
        </Kv>
        <Kv label="브라우저">{browserLabel(run.summary.browser)}</Kv>
        <Kv label="테스트 데이터">
          {maskedVariables === undefined
            ? "실행 요청 시 직접 입력"
            : `${String(Object.keys(maskedVariables).length)}개 변수 · 직접 입력`}
        </Kv>
        <Kv label="영상 녹화">사용 (실패 시 보관)</Kv>
        <Kv label="실패 시 Trace">사용</Kv>
        <Kv label="원본">{isCode ? "코드 (.spec.ts)" : "녹화 스텝"}</Kv>
        {/*
          ★ 있는 척하지 않는다 — 코드 실행 경로는 page 를 우리가 소유하지 않아
            콘솔·네트워크 리스너를 걸 자리가 없다(04-gen-3 전달 6번 · 04-gen-4 전달 11번).
        */}
        {isCode ? <Kv label="콘솔·네트워크 로그">수집하지 않습니다</Kv> : null}
      </div>

      {maskedVariables === undefined ? null : (
        <div className="mt-[15px] rounded-panel border border-line bg-panel p-[18px]">
          <h3 className="mb-[8px] text-[13px]">이번 실행에 넣은 값</h3>
          <p className="m-0 mb-[10px] text-[10px] leading-[1.6] text-muted">
            서버에 저장되지 않습니다. 비밀번호는 마스킹된 값만 이 브라우저 탭의 이동 기록에
            남고, 링크로 다시 열면 표시되지 않습니다.
          </p>
          {Object.entries(maskedVariables).map(([key, value]) => (
            <div
              key={key}
              data-slot="kv"
              className="flex justify-between gap-[10px] border-b border-hairline py-[8px] text-[11px] last:border-b-0"
            >
              <span className="text-muted">{`{{${key}}}`}</span>
              <strong className="truncate">{value === "" ? MASK : value}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="mt-[15px] rounded-panel border border-line bg-panel p-[18px]">
        <h3 className="mb-[13px] text-[13px]">증적</h3>
        {artifactsPending ? (
          <div className="flex flex-col gap-[8px]">
            <Skeleton className="h-[30px] w-full" />
            <Skeleton className="h-[30px] w-full" />
          </div>
        ) : artifactsError !== null ? (
          <StateView
            tone="error"
            title="증적 목록을 불러오지 못했습니다"
            description={artifactsError.message}
            onRetry={onRetryArtifacts}
            className="py-[20px]"
          />
        ) : artifacts.length === 0 ? (
          <p className="m-0 text-[11px] leading-[1.6] text-muted">
            아직 증적이 없습니다. 실행이 끝나면 스크린샷 · 영상 · Trace · 로그가 여기에 모입니다.
            성공한 실행의 영상 · Trace 는 디스크 절약을 위해 보관하지 않습니다.
          </p>
        ) : (
          <ul data-slot="artifact-list" className="m-0 list-none p-0">
            {[...artifacts]
              .sort((a, b) => artifactTypeRank(a.type) - artifactTypeRank(b.type))
              .map((artifact) => (
                <li
                  key={artifact.id}
                  className="flex items-center justify-between gap-[10px] border-b border-hairline py-[9px] text-[11px] last:border-b-0"
                >
                  <span className="min-w-0">
                    <strong className="block truncate">
                      {ARTIFACT_TYPE_LABEL[artifact.type]}
                      {artifact.stepSequence === null
                        ? ""
                        : ` · ${String(artifact.stepSequence)}단계`}
                    </strong>
                    <span className="block text-[10px] text-muted">
                      {formatBytes(artifact.sizeBytes)}
                    </span>
                  </span>
                  <a
                    data-slot="artifact-download"
                    data-type={artifact.type}
                    href={`${artifact.url}?download=1`}
                    download
                    className={cn(
                      "shrink-0 rounded-btn border border-line px-[10px] py-[6px] text-[10px] font-bold text-ink",
                      "transition-colors duration-150 hover:border-btn-hover-line hover:bg-btn-hover-bg",
                      "focus-visible:border-brand focus-visible:shadow-focus-ring focus-visible:outline-none",
                    )}
                  >
                    받기
                  </a>
                </li>
              ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      data-slot="kv"
      className="flex justify-between gap-[10px] border-b border-hairline py-[8px] text-[11px] last:border-b-0"
    >
      <span className="shrink-0 text-muted">{label}</span>
      <strong className="min-w-0 text-right">{children ?? EMPTY_MARK}</strong>
    </div>
  );
}

/** 시안 URL 바는 `staging.example.com/login` 처럼 스킴을 뺀다. */
function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
