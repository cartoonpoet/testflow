import { useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import {
  ScenarioCodeFilenameSchema,
  hasBlockingIssues,
  validateScenarioCode,
  type CodeValidationIssue,
} from "@testflow/contracts";
import { NoticeBox, NoticeLine, ProjectGate } from "@/components";
import { Button, Input, PageHead, Panel, Skeleton, StateView } from "@/components/ui";
import { toast } from "@/hooks/useToast";
import { useScenarioBuilderMutations, useScenarioDetail } from "@/hooks/useScenarioBuilder";
import {
  extractCodeIssues,
  useSaveScenarioCode,
  useScenarioCode,
} from "@/hooks/useScenarioCode";
import { RunDialog } from "@/pages/runs/RunDialog";
import { CodeEditorPanel } from "./CodeEditorPanel";
import { CodeUploadField } from "./CodeUploadField";

/**
 * `/scenarios/:scenarioId/code` — 코드 시나리오 편집 화면 (Task 5.2·5.3).
 *
 * 빌더(`/scenarios/:id`)와 **형제 화면**이다. 코드 시나리오에는 스텝 카드도 인스펙터도
 * 녹화 캔버스도 의미가 없어서 빌더를 재사용하지 않는다. `sourceType` 이 어긋나면
 * 서로에게 넘긴다(아래 `Navigate`).
 *
 * 라우트는 **lazy** 다(`routes.tsx`) — 초기 로드에 영향을 주지 않는다.
 */
const DEFAULT_FILENAME = "scenario.spec.ts";

export function CodeScenarioPage() {
  const { scenarioId = "" } = useParams<{ scenarioId: string }>();
  const detail = useScenarioDetail(scenarioId);
  const code = useScenarioCode(scenarioId);
  const save = useSaveScenarioCode(scenarioId);
  const mutations = useScenarioBuilderMutations(scenarioId);

  /**
   * 편집 중인 본문·파일명은 **로컬 상태**다. 서버 값은 `code.data` 가 단일 진실이고,
   * 아직 한 번도 만지지 않았으면(`draft === null`) 서버 값을 그대로 보여 준다.
   * `useEffect` 로 서버 값을 state 에 밀어 넣지 않는다(라운드 1 규율).
   */
  const [draft, setDraft] = useState<{ filename: string; content: string } | null>(null);
  const [serverIssues, setServerIssues] = useState<readonly CodeValidationIssue[]>([]);
  const [runOpen, setRunOpen] = useState(false);

  const filename = draft?.filename ?? code.data?.filename ?? DEFAULT_FILENAME;
  const content = draft?.content ?? code.data?.content ?? "";
  const dirty = draft !== null && (draft.content !== (code.data?.content ?? "") ||
    draft.filename !== (code.data?.filename ?? DEFAULT_FILENAME));

  /**
   * ★ 검증 규칙을 웹에서 다시 만들지 않는다 — contracts 의 순수 함수를 그대로 부른다.
   *   서버(`PUT`)가 400 으로 돌려주는 `details` 도 **같은 함수의 결과**라 모양이 같다.
   *   두 벌이면 규칙이 어긋나는 순간 한쪽이 조용히 뚫린다(03-phases 쟁점 5).
   */
  const localIssues = useMemo(() => validateScenarioCode(content), [content]);
  const filenameOk = ScenarioCodeFilenameSchema.safeParse(filename).success;
  // 서버 issue 는 본문을 고치면 낡는다. 편집 중에는 로컬 결과만 믿는다.
  const issues = dirty ? localIssues : [...localIssues, ...dedupe(serverIssues, localIssues)];
  const blocked = hasBlockingIssues(issues) || !filenameOk;

  if (detail.data !== undefined && detail.data.sourceType !== "code") {
    return <Navigate to={`/scenarios/${scenarioId}`} replace />;
  }

  return (
    <>
      <PageHead
        title="테스트 코드"
        description="Playwright 테스트 코드 1개를 넣고 그대로 실행합니다."
        action={
          <div className="flex gap-[8px]">
            <Button
              variant="primary"
              data-testid="code-save"
              disabled={code.isPending || save.isPending || blocked}
              title={blocked ? "오류를 고쳐야 저장할 수 있습니다" : undefined}
              onClick={() => {
                setServerIssues([]);
                save.mutate(
                  { filename, content },
                  {
                    onSuccess: () => {
                      setDraft(null);
                      toast("코드를 저장했습니다.", { label: "저장" });
                    },
                    onError: (error: Error) => {
                      const details = extractCodeIssues(error);
                      setServerIssues(details);
                      toast(
                        details.length === 0
                          ? error.message
                          : `검증에서 ${String(details.length)}건이 걸렸습니다. 아래 목록을 확인하세요.`,
                        { label: "저장 실패", tone: "danger" },
                      );
                    },
                  },
                );
              }}
            >
              {save.isPending ? "저장 중…" : "저장"}
            </Button>
            <Button
              data-testid="run-open"
              disabled={code.data === null || code.data === undefined || dirty}
              title={
                code.data === null || code.data === undefined
                  ? "코드를 먼저 저장해야 실행할 수 있습니다"
                  : dirty
                    ? "저장하지 않은 변경이 있습니다"
                    : undefined
              }
              onClick={() => {
                setRunOpen(true);
              }}
            >
              ▶ 실행
            </Button>
            <Button
              data-testid="publish"
              disabled={detail.data === undefined || mutations.publishScenario.isPending}
              onClick={() => {
                mutations.publishScenario.mutate(undefined, {
                  onSuccess: (result) => {
                    toast(`버전 ${String(result.version)} 으로 발행했습니다.`, { label: "발행" });
                  },
                  onError: (error: Error) => {
                    toast(error.message, { label: "발행 실패", tone: "danger" });
                  },
                });
              }}
            >
              발행하기
            </Button>
          </div>
        }
      />

      <RunDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        target={{ scenarioId }}
        targetName={detail.data?.name ?? ""}
      />

      <ProjectGate>
        {detail.isError ? (
          <Panel>
            <StateView
              tone="error"
              title="시나리오를 불러오지 못했습니다"
              description={detail.error.message}
              onRetry={() => void detail.refetch()}
            />
          </Panel>
        ) : code.isError ? (
          <Panel>
            <StateView
              tone="error"
              title="코드를 불러오지 못했습니다"
              description={code.error.message}
              onRetry={() => void code.refetch()}
            />
          </Panel>
        ) : (
          <div className="tf-builder">
            <div className="min-w-0">
              <div className="mb-[15px] flex items-center gap-[10px] rounded-panel border border-line bg-panel px-[15px] py-[12px]">
                <span className="shrink-0 text-label text-muted">파일명</span>
                <Input
                  value={filename}
                  data-testid="code-filename"
                  aria-invalid={filenameOk ? undefined : true}
                  className="max-w-[280px]"
                  onChange={(event) => {
                    setDraft({ filename: event.target.value, content });
                  }}
                />
                {filenameOk ? null : (
                  <span className="text-[10px] text-danger">
                    영문·숫자·`.` `_` `-` 로 이루어진 `*.spec.ts` 만 됩니다
                  </span>
                )}
              </div>

              {code.isPending ? (
                <div className="rounded-panel border border-line bg-panel p-[15px]">
                  <Skeleton className="h-[16px] w-[180px]" />
                  <Skeleton className="mt-[10px] h-[320px] w-full" />
                </div>
              ) : (
                <CodeEditorPanel
                  value={content}
                  issues={issues}
                  disabled={save.isPending}
                  onChange={(next) => {
                    setDraft({ filename, content: next });
                  }}
                />
              )}
            </div>

            <div className="min-w-0">
              <CodeUploadField
                disabled={save.isPending}
                onLoaded={(uploadedName, uploadedContent) => {
                  setServerIssues([]);
                  setDraft({
                    filename: normalizeFilename(uploadedName),
                    content: uploadedContent,
                  });
                }}
              />

              <NoticeBox title="이 화면에서 알아 둘 것">
                <NoticeLine>
                  허용하는 import 는 <code className="font-mono">@playwright/test</code> 하나뿐입니다.
                  Node 내장 모듈과 상대 경로 import 는 거부됩니다.
                </NoticeLine>
                <NoticeLine>
                  ★ 이 검사는 <strong>보안 경계가 아닙니다.</strong> 우회할 수 있습니다. 실제
                  방어는 실행 격리가 담당합니다 — 신뢰할 수 없는 코드를 넣지 마세요.
                </NoticeLine>
                <NoticeLine>
                  코드 실행은 <strong>콘솔·네트워크 로그를 수집하지 않습니다.</strong> 실패 시
                  영상 · Trace · 스크린샷만 남습니다.
                </NoticeLine>
                <NoticeLine>
                  총 단계 수는 실행해 봐야 알 수 있어, 실행 화면의 `N / M 단계` 에서 M 이
                  실행 중에 늘어납니다.
                </NoticeLine>
              </NoticeBox>
            </div>
          </div>
        )}
      </ProjectGate>
    </>
  );
}

/** 서버 issue 중 로컬에서 이미 잡힌 것과 겹치는 항목을 뺀다(같은 줄·같은 코드). */
function dedupe(
  server: readonly CodeValidationIssue[],
  local: readonly CodeValidationIssue[],
): CodeValidationIssue[] {
  const seen = new Set(local.map((issue) => `${String(issue.line)}:${issue.code}`));
  return server.filter((issue) => !seen.has(`${String(issue.line)}:${issue.code}`));
}

/**
 * 업로드 파일명을 계약(`[A-Za-z0-9._-]+\.spec\.ts`)에 맞춘다.
 * codegen 산출물은 보통 `login.ts` 라 `.spec.ts` 가 아니다 — 여기서 붙여 준다.
 * 경로 문자는 서버·Runner 가 또 막지만(3중 방어), **화면에서도 먼저 벗긴다.**
 */
function normalizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).at(-1) ?? raw;
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "-");
  if (safe.endsWith(".spec.ts")) return safe;
  return `${safe.replace(/\.ts$/, "")}.spec.ts`;
}
