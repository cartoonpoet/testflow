import { Suspense, lazy, useRef } from "react";
import { cn } from "cn";
import { scenarioCodeByteLength, type CodeValidationIssue } from "@testflow/contracts";
import { Skeleton } from "@/components/ui";
import type { CodeMirrorHandle } from "@/features/codeEditor/CodeMirrorEditor";

/**
 * 코드 에디터 (Task 5.2 · 라운드 3에서 CodeMirror 6 으로 교체).
 *
 * ## ★ `textarea` → CodeMirror 6 (03-phases 쟁점 6 의 "승급 조건" 발동)
 * 쟁점 6 은 세 가지 이유로 에디터를 기각했다. 그 셋을 전부 해결하고 들어왔다.
 *
 * 1. **번들** — CodeMirror 를 이 파일에 **정적으로 import 하지 않는다.**
 *    `lazy(() => import(...))` 로 별도 청크에 가둔다. 코드 화면은 원래도 라우트 lazy
 *    청크였는데(routes.tsx), 거기에 얹으면 화면을 여는 순간 전부 받아야 한다.
 *    한 겹 더 쪼개서 **에디터를 그리는 시점**에 받게 했다. 초기 로드 청크는 그대로다.
 *    (청크별 before/after 수치는 `.pipeline/20260917-231945/08-code-editor.md`)
 * 2. **테마 토큰** — 색을 컴포넌트에 적지 않는다. CodeMirror 테마 객체는 값으로
 *    `var(--color-…)` **문자열만** 쓰고, 색의 정의는 `globals.css` 의 `@theme static`
 *    한 곳에 남는다(`features/codeEditor/theme.ts`). HEX 리터럴 0건 규율 유지.
 * 3. **의존성** — `.npmrc` 의 `minimum-release-age=1440` 을 끄지 않았다. 채택 버전은
 *    전부 24시간을 넘긴 안정판이고 `apps/web/package.json` 에 **명시적으로** 올렸다.
 *
 * ## 이 파일이 갖는 것 / 넘긴 것
 * 패널 껍데기(제목 · 줄 수 · 바이트 수)와 **검증 목록**은 여기 남는다 — CodeMirror 와
 * 무관하고, 에디터 청크를 받기 전에도 보여야 한다. 에디터 본체와 그 생명주기는
 * `features/codeEditor` 로 넘겼다.
 *
 * ## 검증은 재구현하지 않는다
 * `validateScenarioCode()`(contracts) 를 **그대로** 부른다(부르는 곳은 `index.tsx`).
 * 이 컴포넌트는 그 결과(`issues`)를 받아 **표시만** 한다.
 */

const CodeMirrorEditor = lazy(() => import("@/features/codeEditor/CodeMirrorEditor"));

export type CodeEditorPanelProps = {
  value: string;
  onChange: (next: string) => void;
  /** contracts 검증 결과 + 서버 400 의 `details` 를 합친 목록. */
  issues: readonly CodeValidationIssue[];
  disabled?: boolean;
};

export function CodeEditorPanel({
  value,
  onChange,
  issues,
  disabled = false,
}: CodeEditorPanelProps) {
  const editor = useRef<CodeMirrorHandle | null>(null);

  const lines = value === "" ? 1 : value.split("\n").length;

  return (
    <div data-slot="code-editor" className="rounded-panel border border-line bg-panel">
      <div className="flex items-center justify-between gap-[10px] border-b border-line px-[15px] py-[10px]">
        <span className="text-label text-muted">테스트 코드 (.spec.ts)</span>
        <span data-testid="code-line-count" className="font-mono text-[10px] text-muted">
          {String(lines)}줄 · {String(scenarioCodeByteLength(value))}바이트
        </span>
      </div>

      {/*
        에디터 청크를 받는 동안의 자리. 높이를 `tf-code-host` 의 초기값(380px)과 맞춰
        청크가 붙는 순간 레이아웃이 튀지 않게 한다.
      */}
      <Suspense fallback={<Skeleton className="m-[12px] h-[356px] w-[calc(100%-24px)]" />}>
        <CodeMirrorEditor
          value={value}
          onChange={onChange}
          issues={issues}
          disabled={disabled}
          handle={editor}
        />
      </Suspense>

      <IssueList
        issues={issues}
        onJump={(line, column) => {
          editor.current?.jumpTo(line, column);
        }}
      />
    </div>
  );
}

/**
 * 검증 결과 목록. **오류만 저장을 막는다** — 경고(`no_test` 등)는 막지 않는다
 * (`hasBlockingIssues()` 가 error 만 본다. 스텝이 없는 spec 도 사용자의 자유다).
 *
 * 에디터 안에도 같은 내용이 물결 밑줄 + 호버 툴팁으로 뜬다. 목록을 지우지 않은 이유는
 * **스크롤 밖의 오류**다 — 380px 안에 안 보이는 줄의 오류를 여기서 한눈에 보고 눌러서 간다.
 */
function IssueList({
  issues,
  onJump,
}: {
  issues: readonly CodeValidationIssue[];
  onJump: (line: number, column: number) => void;
}) {
  if (issues.length === 0) {
    return (
      <p
        data-slot="code-issues"
        data-count="0"
        className="m-0 border-t border-line px-[15px] py-[12px] text-[11px] text-muted"
      >
        문제 없음 — 허용 import 는 <code className="font-mono">@playwright/test</code> 뿐입니다.
      </p>
    );
  }

  return (
    <ul
      data-slot="code-issues"
      data-count={issues.length}
      className="m-0 list-none border-t border-line p-0"
    >
      {issues.map((issue, index) => (
        <li
          key={`${String(issue.line)}-${issue.code}-${String(index)}`}
          data-severity={issue.severity}
          data-line={issue.line}
          className={cn(
            "flex items-start gap-[10px] border-b border-hairline px-[15px] py-[10px] text-[11px] leading-[1.6] last:border-b-0",
            issue.severity === "error" ? "bg-danger-soft text-danger" : "bg-notice text-notice-ink",
          )}
        >
          <button
            type="button"
            data-testid="code-issue-line"
            className="shrink-0 font-mono text-[11px] font-bold underline"
            onClick={() => {
              onJump(issue.line, issue.column);
            }}
          >
            {String(issue.line)}:{String(issue.column)}
          </button>
          <span className="min-w-0">
            {issue.severity === "error" ? "오류" : "경고"} · {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
