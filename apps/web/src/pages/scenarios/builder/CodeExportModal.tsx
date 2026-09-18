import { useMemo, useState } from "react";
import {
  codegenFilename,
  stepsToPlaywrightCode,
  validateScenarioCode,
  type TestStep,
} from "@testflow/contracts";
import { NoticeBox, NoticeLine } from "@/components";
import { Button, Modal, Skeleton, StateView } from "@/components/ui";
import { useAdvancedScenarioDetail } from "@/hooks/useScenarioBuilder";
import { toast } from "@/hooks/useToast";

/**
 * 녹화 스텝 → Playwright 코드 내보내기 모달 (Task 6.2 · 쟁점 7).
 *
 * ★ **`?advanced=1` 로 읽는다.** 기본 상세 응답은 `toPublicLocatorTarget()` 으로
 *   **css 후보가 제거**돼 있고 `primary` 가 `null` 이 될 수 있다(css 가 1순위였던 스텝).
 *   그 응답으로 코드를 만들면 locator 가 비어 실행이 깨진다. 코드 내보내기는
 *   "사용자가 직접 쓸 코드"라 CSS 노출 금지 규율의 예외다(03-phases 공통 규율에 명시).
 *   그래서 이 쿼리는 **모달이 열려 있을 때만** 돈다 — 닫혀 있으면 요청 자체를 하지 않는다.
 *
 * ★ 생성은 전부 `@testflow/contracts` 의 `stepsToPlaywrightCode()` 다. 화면에서 규칙을
 *   재구현하지 않는다(코드 검증이 `validateScenarioCode()` 하나인 것과 같은 이유).
 */
export type CodeExportModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarioId: string;
  scenarioName: string;
  scenarioCode: string;
};

export function CodeExportModal({
  open,
  onOpenChange,
  scenarioId,
  scenarioName,
  scenarioCode,
}: CodeExportModalProps) {
  const detail = useAdvancedScenarioDetail(scenarioId, open);
  const [copied, setCopied] = useState(false);
  /*
   * 생성 시각은 **마운트 시 한 번**만 찍는다(lazy initializer). 렌더마다 `new Date()` 를 읽으면
   * 코드가 매 렌더 달라져 화면에 보인 것 · 복사한 것 · 내려받은 것이 서로 어긋난다.
   *
   * ★ 부모가 열려 있을 때만 이 컴포넌트를 마운트한다 → 닫았다 다시 열면 자연히 새 시각이고
   *   `copied` 도 초기화된다. **정리용 `useEffect` 가 필요 없다**(라운드 1 규율: useEffect 자제).
   */
  const [generatedAt] = useState(() => new Date().toISOString());

  const steps = detail.data?.steps as TestStep[] | undefined;
  const filename = codegenFilename(scenarioCode);

  const code = useMemo(() => {
    if (steps === undefined) return "";
    return stepsToPlaywrightCode(steps, {
      testName: scenarioName,
      scenarioCode,
      generatedAt,
    });
  }, [steps, scenarioName, scenarioCode, generatedAt]);

  // 생성 직후 우리 손으로 한 번 더 검증한다 — 내보낸 코드가 코드 시나리오로 들어갈 수 있는지를
  // 사용자가 붙여넣기 전에 알 수 있어야 한다(왕복이 이 기능의 존재 이유다).
  const issues = useMemo(() => (code === "" ? [] : validateScenarioCode(code)), [code]);
  const blocking = issues.filter((issue) => issue.severity === "error");

  const download = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`${filename} 을 내려받았습니다.`, { label: "내보내기" });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      title="Playwright 코드로 내보내기"
      description={`녹화한 단계를 .spec.ts 로 바꿉니다. 그대로 코드 시나리오에 넣어 실행할 수 있습니다.`}
      footer={
        <div className="flex justify-end gap-[8px]">
          <Button
            data-testid="export-copy"
            disabled={code === ""}
            onClick={() => {
              void navigator.clipboard
                .writeText(code)
                .then(() => {
                  setCopied(true);
                  toast("코드를 복사했습니다.", { label: "복사" });
                })
                .catch(() => {
                  toast("클립보드를 쓸 수 없습니다. 코드를 직접 선택해 복사하세요.", {
                    label: "복사 실패",
                    tone: "danger",
                  });
                });
            }}
          >
            {copied ? "복사됨" : "복사"}
          </Button>
          <Button variant="primary" data-testid="export-download" disabled={code === ""} onClick={download}>
            {filename} 내려받기
          </Button>
        </div>
      }
    >
      {detail.isError ? (
        <StateView
          tone="error"
          title="단계를 불러오지 못했습니다"
          description={detail.error.message}
          onRetry={() => void detail.refetch()}
        />
      ) : detail.isPending || code === "" ? (
        <Skeleton className="h-[240px] w-full" />
      ) : (
        <>
          <div className="mb-[10px] flex items-center justify-between gap-[10px]">
            <span data-testid="export-filename" className="font-mono text-[11px] text-ink">
              {filename}
            </span>
            <span className="text-[11px] text-muted">
              {String(code.split("\n").length)}줄 ·{" "}
              {blocking.length === 0 ? "코드 시나리오로 그대로 넣을 수 있습니다" : "검증 오류가 있습니다"}
            </span>
          </div>

          <pre
            data-testid="export-code-body"
            className="max-h-[42vh] overflow-auto rounded-btn border border-line bg-table-head px-[12px] py-[10px] font-mono text-[11px] leading-[1.7] text-ink"
          >
            {code}
          </pre>

          {blocking.length === 0 ? null : (
            <ul data-testid="export-issues" className="mt-[10px] list-none p-0 text-[11px] text-danger">
              {blocking.map((issue) => (
                <li key={`${String(issue.line)}:${String(issue.column)}:${issue.code}`}>
                  {String(issue.line)}:{String(issue.column)} {issue.message}
                </li>
              ))}
            </ul>
          )}

          <NoticeBox title="값은 코드에 들어 있지 않습니다">
            <NoticeLine>
              `{"{{변수}}"}` 는 `process.env["TESTFLOW_VAR_…"]` 참조로 나갑니다. 비밀번호는 코드에
              평문으로 적히지 않으며, 실행 요청에서 입력한 값이 실행 시점에 주입됩니다.
            </NoticeLine>
            <NoticeLine>
              대체 후보(fallback)와 iframe 정보는 Playwright 에 대응 문법이 없어 **주석**으로만
              남습니다. 필요하면 내려받은 파일에서 직접 고쳐 주세요.
            </NoticeLine>
          </NoticeBox>
        </>
      )}
    </Modal>
  );
}
