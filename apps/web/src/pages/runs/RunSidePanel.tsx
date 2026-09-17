import type * as React from "react";
import { cn } from "cn";
import type { Artifact, RunDetail } from "@testflow/contracts";
import { Skeleton, StateView } from "@/components/ui";
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
 * ★ 브라우저 목업 자리에 **실행 중에는 최신 스크린샷 증적**을 넣는다(Task 11.5).
 *   증적이 없을 때만 시안의 정적 가짜 로그인 화면을 그리고, 그 아래에
 *   "미리보기" 라고 적어 실제 화면으로 오해하지 않게 한다.
 *   MVP 의 실행은 headless 라 실시간 화면 스트리밍이 없다 — 있는 척하지 않는다.
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
  const screenshot = latestScreenshot(artifacts);

  return (
    <aside data-slot="run-side">
      <div className="overflow-hidden rounded-panel bg-browser shadow-panel">
        <div className="flex h-[42px] items-center gap-[6px] bg-browser-bar px-[13px]">
          <i className="h-[8px] w-[8px] rounded-full bg-browser-dot" />
          <i className="h-[8px] w-[8px] rounded-full bg-browser-dot" />
          <i className="h-[8px] w-[8px] rounded-full bg-browser-dot" />
          <div className="ml-[8px] flex h-[24px] flex-1 items-center overflow-hidden rounded-[6px] bg-browser-url px-[10px] text-[9px] text-browser-url-ink">
            <span className="truncate">{stripScheme(run.summary.baseUrl)}</span>
          </div>
        </div>

        <div className="grid aspect-[16/10] place-items-center bg-browser-screen p-[35px] max-mobile:p-[20px]">
          {screenshot === undefined ? <FakeLoginMock /> : (
            <img
              data-slot="run-screenshot"
              src={screenshot.url}
              alt={`실패 스텝 ${String(screenshot.stepSequence ?? 0)} 스크린샷`}
              className="max-h-full max-w-full rounded-[6px] border border-fake-line object-contain"
            />
          )}
        </div>
      </div>

      <div className="mt-[15px] rounded-panel border border-line bg-panel p-[18px]">
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

/**
 * 시안 `.fake-login` — 정적 목업이다.
 *
 * ★ 실제 대상 화면이 아니다. 실행은 headless 라 화면이 웹으로 오지 않는다.
 *   실패 스크린샷 증적이 생기면 이 자리를 그 이미지가 대신한다.
 */
function FakeLoginMock() {
  return (
    <div className="w-full text-center">
      <div className="mx-auto w-[80%] max-w-[260px] rounded-[13px] border border-fake-line bg-panel p-[22px] text-left">
        <h3 className="mb-[18px] text-[16px]">로그인</h3>
        <div className="mt-[8px] flex h-[31px] items-center rounded-[7px] border border-fake-input-line px-[9px] text-[9px] text-fake-ink">
          아이디
        </div>
        <div className="mt-[8px] flex h-[31px] items-center rounded-[7px] border border-fake-input-line px-[9px] text-[9px] text-fake-ink">
          {MASK}
        </div>
        <div className="mt-[12px] grid h-[32px] place-items-center rounded-[7px] bg-brand text-[9px] text-white">
          로그인
        </div>
      </div>
      <p className="m-0 mt-[12px] text-[10px] text-fake-ink">
        화면 미리보기 — 실제 실행 화면이 아닙니다
      </p>
    </div>
  );
}

function latestScreenshot(artifacts: readonly Artifact[]): Artifact | undefined {
  return [...artifacts]
    .filter((artifact) => artifact.type === "screenshot")
    .sort((a, b) => (a.stepSequence ?? 0) - (b.stepSequence ?? 0))
    .at(-1);
}

/** 시안 URL 바는 `staging.example.com/login` 처럼 스킴을 뺀다. */
function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
