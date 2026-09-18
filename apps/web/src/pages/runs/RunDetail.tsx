import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { isTerminalRunStatus, type Artifact, type RunDetail } from "@testflow/contracts";
import { NoticeBox, NoticeLine } from "@/components";
import { Button, PageHead, StateView } from "@/components/ui";
import { useStepSync } from "@/features/live";
import { RUN_STATUS_LABEL } from "@/lib";
import { toast } from "@/hooks/useToast";
import { useCancelRun, useDeleteRun, useRunArtifacts, useRunDetail } from "@/hooks/useRuns";
import { useRunEvents } from "@/hooks/useRunEvents";
import { RunDeleteDialog } from "./RunDeleteDialog";
import { RunDialog } from "./RunDialog";
import { RunLiveScreen } from "./RunScreen";
import { RunSidePanel } from "./RunSidePanel";
import { RunStepList, RunStepListSkeleton } from "./RunStepList";
import { RunSummaryBar } from "./RunSummaryBar";

/**
 * 화면 4 · 실행 현황 상세 (`/runs/:runId`).
 *
 *   .run-summary (다크 요약바)  +  .run-layout = grid minmax(0,1fr) 360px
 *   좌측 `.execution` 스텝 리스트 / 우측 브라우저 목업 + 실행 정보 + 증적
 *
 * ## ★ 라운드 3 — 라이브 화면이 2단 그리드 밖으로 나왔다
 * 코드 실행이면 요약바 **바로 아래에 전폭 라이브 무대**(`RunLiveScreen`)가 온다.
 * 시안의 `1fr 360px` 자체는 그대로 두되(스텝 리스트 + 실행 정보·증적), 실제 스트림만
 * 그 밖으로 뺀 것이다. 근거는 `RunScreen.tsx` / `globals.css > tf-live-stage` 주석 참조 —
 * 360px 은 1280px 프레임의 **28%** 라 프레임 안의 글자가 읽히지 않는다.
 *
 * ## 실시간 반영
 * 실행이 끝나지 않은 동안에만 SSE 를 연다(`useRunEvents`). 종료 이벤트가 오면
 * 캐시의 `status` 가 종료 상태로 바뀌고 → `enabled` 가 false 가 되어 → 이펙트 정리로
 * **연결이 스스로 닫힌다.** 별도의 "닫아라" 신호를 만들지 않았다.
 *
 * ## 취소
 * ★ 낙관적 표시를 하지 않는다. `POST /runs/:id/cancel` 은 큐에 있을 때만 상태를 확정하고
 *   이미 실행 중이면 신호만 보낸다. 최종 상태는 Runner 가 확정한다(04-gen-6: 신호 후 515ms).
 *   그래서 화면은 "취소 중" 으로 두고 SSE 의 `run.finished` 를 기다린다.
 */
export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const maskedVariables = readMaskedVariables(location.state);
  const rerunOf = readRerunOf(location.state);

  /*
   * ★ 라운드 7 — 스텝 레일(무대 옆/위의 스텝 목록)을 켤 것인가.
   *
   * 상태가 여기 있는 이유는 `RunLiveScreen` 이 run 이 바뀔 때 통째로 다시 만들어지기
   * 때문이 아니라, **사용자의 선택이 실행 하나보다 오래 살아야** 하기 때문이다.
   * 기본값은 `true` — 사용자가 요구한 것이 "영상과 스텝을 같이 보기" 자체다.
   */
  const [railOpen, setRailOpen] = useState(true);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const detail = useRunDetail(runId);
  const run = detail.data;
  const isActive = run !== undefined && !isTerminalRunStatus(run.status);

  const events = useRunEvents(runId, { enabled: isActive });
  const artifacts = useRunArtifacts(runId);
  const cancel = useCancelRun(runId);
  const cancelPending = isActive && (cancel.isPending || cancel.isSuccess);
  const removeRun = useDeleteRun();

  /*
   * ★ 라운드 5 — 무대와 스텝 목록을 잇는 단 하나의 손잡이.
   *
   * 무대(`RunLiveScreen`)와 목록(`RunStepList`)은 **형제**다. 한쪽이 다른 쪽 안에
   * 있지 않으므로 상태는 공통 부모인 여기에 있어야 한다. 훅은 조건 없이 부른다 —
   * 무대가 없는 실행(진행 중인 녹화)에서도 목록의 자동 추적은 그대로 필요하다.
   */
  const sync = useStepSync(run);

  return (
    <div
      data-slot="run-detail"
      data-step-sync-mode={sync.mode}
      data-sse-connection={events.connection}
      data-sse-received={events.received}
      data-sse-duplicates={events.duplicates}
      data-sse-last-id={events.lastEventId ?? ""}
      data-sse-resyncs={events.resyncs}
    >
      <PageHead
        title="실행 현황"
        description={
          run === undefined ? "실행 상세를 불러오는 중입니다." : `${run.runCode} · ${run.scenarioName}`
        }
        action={
          run === undefined ? undefined : (
            <div className="flex gap-[9px]">
              {/*
                ★ 라운드 8 — **진행 중이면 끄고 이유를 `title` 로 말한다**(#14 의 재실행 방식).
                  버튼을 숨기지 않는 이유도 같다 — 사라지면 사용자는 "왜 어떤 실행에는
                  삭제가 있고 어떤 실행에는 없나"를 추측한다.
                  라벨은 **"이력 삭제"** 다: 이 화면의 다른 파괴적 버튼("■ 실행 중단")과
                  혼동되지 않아야 하고, 지워지는 것이 **실행 이력과 그 증적**이지
                  시나리오가 아니라는 점이 이름에 드러나야 한다.
              */}
              <Button
                variant="danger"
                data-slot="run-delete-open"
                data-testid="run-delete-open"
                disabled={isActive || removeRun.isPending}
                title={
                  isActive
                    ? "진행 중인 실행은 삭제할 수 없습니다. 먼저 실행을 중단하세요."
                    : undefined
                }
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                이력 삭제
              </Button>

              {isActive ? (
                <Button
                  variant="danger"
                  data-slot="run-cancel"
                  disabled={cancelPending}
                  onClick={() => {
                    cancel.mutate();
                  }}
                >
                  {cancelPending ? "취소 중…" : "■ 실행 중단"}
                </Button>
              ) : (
                /*
                 * ★ 라운드 7 — **끝난 실행은 이 화면에서 바로 다시 돌린다.**
                 *   종료 상태 전부(`passed`·`failed`·`timeout`·`cancelled`·`error`)에서 보인다.
                 *   진행 중에는 위 "실행 중단" 이 그 자리를 쓰므로 자연히 안 보인다.
                 *
                 *   시나리오가 삭제되면 `runs.scenario_id` 가 SET NULL 이라 다시 돌릴 대상이
                 *   없다. 그때 버튼을 지우지 않고 **끄고 이유를 붙인다** — 버튼이 사라지면
                 *   사용자는 "왜 어떤 실행에는 재실행이 있고 어떤 실행에는 없나"를 추측한다.
                 */
                <Button
                  variant="primary"
                  data-slot="run-rerun"
                  disabled={run.scenarioId === null}
                  title={
                    run.scenarioId === null
                      ? "원본 시나리오가 삭제되어 다시 실행할 수 없습니다."
                      : undefined
                  }
                  onClick={() => {
                    setRerunOpen(true);
                  }}
                >
                  ↻ 재실행
                </Button>
              )}
            </div>
          )
        }
      />

      {/*
        ★ 이 화면은 증적 목록을 **이미 읽어 놓았다**(`useRunArtifacts`). 그래서 확인
          대화상자가 "증적 N개 · 합계 M" 을 실제 값으로 적는다.
      */}
      {run === undefined ? null : (
        <RunDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          pending={removeRun.isPending}
          targets={[
            {
              id: run.id,
              runCode: run.runCode,
              scenarioName: run.scenarioName,
              artifacts: artifacts.data,
            },
          ]}
          onConfirm={() => {
            removeRun.mutate(run.id, {
              onSuccess: () => {
                toast(`${run.runCode} 실행 이력을 삭제했습니다.`, { label: "삭제" });
                setDeleteOpen(false);
                // 지운 run 의 상세에 머무르면 404 가 난다 — 목록으로 되돌린다.
                void navigate("/runs");
              },
              onError: (error: Error) => {
                toast(error.message, { label: "삭제 실패", tone: "danger" });
              },
            });
          }}
        />
      )}

      {/*
        ★ 재실행으로 만들어진 run 이면 **원본과 이어 보인다.**
          스키마를 늘리지 않았다 — 근거는 `readRerunOf` JSDoc.
      */}
      {rerunOf === undefined ? null : (
        <NoticeBox title={`${rerunOf.runCode} 을(를) 다시 실행한 결과입니다`} className="mt-0 mb-[15px]">
          <NoticeLine>
            원본 실행:{" "}
            <Link to={`/runs/${rerunOf.runId}`} className="font-750 text-brand underline">
              {rerunOf.runCode}
            </Link>{" "}
            · 대상 주소·환경·브라우저는 그 실행의 값으로 채워 요청했습니다. 계정·비밀번호는
            저장되지 않으므로 이번 요청에 직접 입력한 값이 쓰였습니다.
          </NoticeLine>
        </NoticeBox>
      )}

      {run === undefined || run.scenarioId === null ? null : (
        <RunDialog
          open={rerunOpen}
          onOpenChange={setRerunOpen}
          target={{ scenarioId: run.scenarioId }}
          targetName={run.scenarioName}
          defaults={{
            baseUrl: run.baseUrl,
            envLabel: run.envLabel,
            browser: run.browser,
          }}
          rerunOf={{ runId: run.id, runCode: run.runCode }}
        />
      )}

      {detail.isPending ? (
        <>
          <div className="mb-[15px] h-[86px] rounded-run-summary bg-dark-panel opacity-40" />
          <div className="tf-run-layout">
            <RunStepListSkeleton />
            <div />
          </div>
        </>
      ) : null}

      {detail.isError ? (
        <div className="rounded-table border border-line bg-panel">
          <StateView
            tone="error"
            title="실행 정보를 불러오지 못했습니다"
            description={detail.error.message}
            onRetry={() => void detail.refetch()}
          />
        </div>
      ) : null}

      {run === undefined ? null : (
        <>
          <RunSummaryBar run={run} cancelPending={cancelPending} />

          {run.status === "queued" ? (
            <NoticeBox title="실행을 기다리는 중입니다" className="mt-0 mb-[15px]">
              <NoticeLine>
                Runner 가 큐에서 이 실행을 가져가면 자동으로 시작됩니다. Runner 가 떠 있지
                않으면 큐에 쌓인 채 진행되지 않습니다.
              </NoticeLine>
            </NoticeBox>
          ) : null}

          {events.connection === "reconnecting" ? (
            <NoticeBox
              title={`실시간 연결을 다시 맺는 중입니다 (${String(events.attempt)}회)`}
              className="mt-0 mb-[15px]"
              data-slot="sse-reconnecting"
            >
              <NoticeLine>
                끊긴 지점 이후의 이벤트만 다시 받습니다. 놓친 진행 상황은 연결이 돌아오면
                한 번에 반영됩니다.
              </NoticeLine>
            </NoticeBox>
          ) : null}

          {events.connection === "failed" ? (
            <NoticeBox title="실시간 연결이 끊겼습니다" className="mt-0 mb-[15px]">
              <NoticeLine>
                {events.error ?? "재연결에 실패했습니다."} 아래 버튼으로 현재 상태를 다시
                읽을 수 있습니다.
              </NoticeLine>
              <div className="mt-[10px]">
                <Button
                  onClick={() => {
                    void detail.refetch();
                    void artifacts.refetch();
                  }}
                >
                  상태 새로 읽기
                </Button>
              </div>
            </NoticeBox>
          ) : null}

          {run.errorMessage === null || isActive ? null : (
            <div
              role="alert"
              data-slot="run-error"
              className="mb-[15px] rounded-metric border border-danger bg-danger-soft px-[18px] py-[16px] text-danger"
            >
              <strong className="text-[12px]">
                실행 {RUN_STATUS_LABEL[run.status]} · {String(run.passedSteps)}/
                {String(run.totalSteps)} 단계 통과
              </strong>
              <p className="m-0 mt-[5px] text-[11px] leading-[1.5]">{run.errorMessage}</p>
            </div>
          )}

          {/*
            ★ 라운드 4 — 전폭 무대는 코드 실행만의 것이 아니다.
              **끝난 녹화 실행도 영상이 있으면** 같은 자리에서 다시 본다. 360px 패널의
              축소판으로는 1280×800 영상을 볼 수 없고(28%), "다시 보기"가 실행 종류에 따라
              되기도 안 되기도 하면 그건 기능이 아니라 우연이다.
          */}
          {showStage(run, artifacts.data ?? []) ? (
            <RunLiveScreen
              run={run}
              artifacts={artifacts.data ?? []}
              sync={sync}
              railOpen={railOpen}
              onRailOpenChange={setRailOpen}
            />
          ) : null}

          <div className="tf-run-layout">
            <div className="min-w-0">
              {run.steps.length === 0 && !(run.sourceType === "code" && isActive) ? (
                <div className="rounded-panel border border-line bg-panel">
                  <StateView
                    title="표시할 단계가 없습니다"
                    description={
                      run.sourceType === "code"
                        ? "코드 실행은 단계를 미리 알 수 없습니다. 이 실행에서는 보고된 단계가 없습니다."
                        : "스텝이 없는 시나리오이거나 실행 준비 중입니다."
                    }
                  />
                </div>
              ) : (
                <RunStepList
                  steps={run.steps}
                  sourceType={run.sourceType}
                  active={isActive}
                  sync={sync}
                />
              )}
            </div>

            <RunSidePanel
              run={run}
              stageShown={showStage(run, artifacts.data ?? [])}
              artifacts={artifacts.data ?? []}
              artifactsPending={artifacts.isPending}
              artifactsError={artifacts.error}
              onRetryArtifacts={() => void artifacts.refetch()}
              maskedVariables={maskedVariables}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 전폭 무대(`RunLiveScreen`)를 그릴 것인가.
 *
 * - **코드 실행**: 언제나 그린다(라이브가 있다).
 * - **녹화 실행**: 라이브는 없지만 **끝난 뒤 영상이 있으면** 다시 보기 무대로 쓴다.
 *   진행 중인 녹화 실행에 빈 전폭 상자를 세우지 않는다 — 그건 "고장났다"로 읽힌다.
 */
function showStage(run: RunDetail, artifacts: readonly Artifact[]): boolean {
  if (run.sourceType === "code") return true;
  return (
    isTerminalRunStatus(run.status) && artifacts.some((artifact) => artifact.type === "video")
  );
}

/**
 * 라우터 state 로 넘어온 **마스킹된** 변수 사본을 읽는다.
 *
 * 평문은 애초에 여기까지 오지 않는다(`RunDialog` 가 `maskRecord()` 를 거친 사본만 넘긴다).
 *
 * ★ 실측으로 확인한 사실: react-router 의 `state` 는 `history.state` 에 들어가므로
 *   **새로고침해도 살아남는다**(세션 히스토리에 남는다). 그래서 여기 넘기는 것이
 *   반드시 마스킹된 사본이어야 한다 — 실측 `history.state` 값:
 *   `{"usr":{"maskedVariables":{"username":"qa-tester","password":"••••••••"}}}`.
 *   링크로 직접 들어오거나 다른 탭에서 열면 state 가 없고, 그때는
 *   "실행 요청 시 직접 입력" 으로 떨어진다 — 서버에는 이 값이 없기 때문이다.
 */
/**
 * ★ 라운드 7 — "이 실행은 어떤 실행을 다시 돌린 것인가".
 *
 * ## 스키마를 늘리지 않았다 — 근거
 * `runs` 에 `rerun_of_run_id` 컬럼을 두면 마이그레이션 + 계약(`RunSchema`) + 매퍼 +
 * 서비스가 같이 움직인다. 그 값으로 **할 수 있는 일은 지금 화면에 한 줄 적는 것뿐**이고,
 * 실행 이력의 정합성(무엇이 언제 무엇을 돌렸나)은 이미 `runs` 가 시나리오·시각·설정
 * 스냅샷으로 다 갖고 있다. 즉 **새 컬럼이 없어도 잃는 사실이 없다.**
 *
 * 그래서 `maskedVariables` 와 **똑같은 경로**(react-router `state` = `history.state`)로
 * 넘긴다. 이 경로의 성질은 이미 실측돼 있다 — 새로고침에는 살아남고, 링크로 직접
 * 들어오거나 다른 탭에서 열면 없다. 후자에서는 배너가 사라질 뿐 화면이 깨지지 않는다.
 *
 * 나중에 "재실행 계보"를 목록에서 필터링해야 할 일이 생기면 그때가 컬럼을 만들 때다.
 * 그 전에 만들면 조회하는 곳이 없는 컬럼 하나를 영원히 들고 다니게 된다.
 */
function readRerunOf(state: unknown): { runId: string; runCode: string } | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const candidate = (state as { rerunOf?: unknown }).rerunOf;
  if (typeof candidate !== "object" || candidate === null) return undefined;

  const { runId, runCode } = candidate as { runId?: unknown; runCode?: unknown };
  if (typeof runId !== "string" || typeof runCode !== "string") return undefined;
  return { runId, runCode };
}

function readMaskedVariables(
  state: unknown,
): Readonly<Record<string, string>> | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const candidate = (state as { maskedVariables?: unknown }).maskedVariables;
  if (typeof candidate !== "object" || candidate === null) return undefined;

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (typeof value === "string") out[key] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
