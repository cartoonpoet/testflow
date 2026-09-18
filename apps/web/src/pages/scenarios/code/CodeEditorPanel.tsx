import { useRef } from "react";
import type * as React from "react";
import { cn } from "cn";
import { scenarioCodeByteLength, type CodeValidationIssue } from "@testflow/contracts";

/**
 * 코드 에디터 (Task 5.2).
 *
 * ## ★ `textarea` 다. CodeMirror/Monaco 를 넣지 않았다 (03-phases 쟁점 6)
 * - **번들**: CodeMirror 6 최소 구성도 수백 KB 대다. 이 화면은 lazy 청크라 초기 로드를
 *   직접 깨지는 않지만, **그 청크를 여는 순간 체감이 생긴다.**
 * - **토큰 규율**: 라운드 1은 HEX 하드코딩 **0건**이다. CodeMirror 테마는 JS 객체 안의 HEX 라
 *   CSS 변수 → 테마 객체 변환 계층을 또 만들어야 한다. 얻는 것은 색칠 하나다.
 * - **의존성 정책**: `.npmrc` 의 `minimum-release-age=1440` 을 통과해야 하고,
 *   라운드 1이 끝까지 지킨 "런타임 의존성 추가 없음" 기조를 깬다.
 * - 라운드 2의 가치는 **실행과 라이브 스트리밍**에 있다. 에디터 광택이 아니다.
 *
 * **대신 하는 것**: 모노 폰트 토큰 · `spellCheck=false` · `Tab` 들여쓰기 ·
 * 줄 수 표시 · 검증 오류의 줄 번호 표시.
 *
 * **승급 조건(기록)**: 사용자가 "편집이 불편하다"를 실제로 말하면, 이미 lazy 인 이 청크
 * 안에서만 CodeMirror 를 도입하고 초기 로드 델타를 측정해 보고한다.
 *
 * ## 검증은 재구현하지 않는다
 * `validateScenarioCode()`(contracts) 를 **그대로** 부른다. 웹과 API 가 같은 함수를 타야
 * 규칙이 어긋나는 순간 한쪽이 조용히 뚫리는 일이 없다(03-phases 쟁점 5).
 * 이 컴포넌트는 그 결과(`issues`)를 받아 **표시만** 한다.
 */

/** `Tab` 한 번이 넣는 공백. 대상이 codegen 산출물(2칸)이라 2칸으로 맞춘다. */
const INDENT = "  ";

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const lines = value === "" ? 1 : value.split("\n").length;
  /** 오류가 있는 줄 — 거터에서 붉게 표시한다. */
  const errorLines = new Set(
    issues.filter((issue) => issue.severity === "error").map((issue) => issue.line),
  );

  /**
   * ★ `Tab` 을 들여쓰기로 만든다.
   *
   * `setRangeText` 로 **DOM 값을 먼저 바꾼 뒤** 그 값을 그대로 위로 올린다.
   * 그러면 React 가 커밋할 때 DOM 값이 이미 같아 다시 쓰지 않고, **캐럿이 유지된다.**
   * (state 만 바꾸면 React 가 value 를 다시 써서 캐럿이 끝으로 튄다.)
   *
   * 접근성: `Tab` 을 가로채면 키보드로 이 필드를 벗어날 수 없다. 그래서
   * **`Escape` → `Tab`** 순서로 빠져나갈 수 있게 blur 를 남겨 뒀다(아래 `onKeyDown`).
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;

    if (event.key === "Escape") {
      target.blur();
      return;
    }
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;

    event.preventDefault();
    const { selectionStart, selectionEnd } = target;

    if (event.shiftKey) {
      // 내어쓰기 — 캐럿이 있는 줄 머리의 공백을 최대 INDENT 만큼 지운다.
      const lineStart = target.value.lastIndexOf("\n", selectionStart - 1) + 1;
      const head = target.value.slice(lineStart, lineStart + INDENT.length);
      const remove = head.startsWith(INDENT) ? INDENT.length : head.startsWith(" ") ? 1 : 0;
      if (remove === 0) return;
      target.setRangeText("", lineStart, lineStart + remove, "preserve");
      onChange(target.value);
      return;
    }

    target.setRangeText(INDENT, selectionStart, selectionEnd, "end");
    onChange(target.value);
  };

  return (
    <div data-slot="code-editor" className="rounded-panel border border-line bg-panel">
      <div className="flex items-center justify-between gap-[10px] border-b border-line px-[15px] py-[10px]">
        <span className="text-label text-muted">테스트 코드 (.spec.ts)</span>
        <span data-testid="code-line-count" className="font-mono text-[10px] text-muted">
          {String(lines)}줄 · {String(scenarioCodeByteLength(value))}바이트
        </span>
      </div>

      <div className="flex items-stretch">
        {/*
          줄 번호 거터. 세로 스크롤은 textarea 가 갖고 있으므로 `onScroll` 에서
          같은 `scrollTop` 을 여기에 밀어 넣는다(이펙트가 아니라 이벤트 핸들러다).
        */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          data-slot="code-gutter"
          className="max-h-[520px] shrink-0 overflow-hidden border-r border-line bg-table-head px-[10px] py-[12px] text-right font-mono text-[12px] leading-[1.7] text-table-head-ink"
        >
          {Array.from({ length: lines }, (_, index) => (
            <div
              key={index}
              className={cn(errorLines.has(index + 1) && "font-bold text-danger")}
            >
              {index + 1}
            </div>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          aria-label="테스트 코드"
          data-testid="code-editor"
          placeholder={'import { test, expect } from "@playwright/test";\n\ntest("로그인", async ({ page }) => {\n  await page.goto("/login");\n});'}
          className="max-h-[520px] min-h-[380px] w-full resize-y border-0 bg-panel px-[12px] py-[12px] font-mono text-[12px] leading-[1.7] text-ink outline-none"
          onKeyDown={onKeyDown}
          onScroll={(event) => {
            const gutter = gutterRef.current;
            if (gutter !== null) gutter.scrollTop = event.currentTarget.scrollTop;
          }}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </div>

      <IssueList
        issues={issues}
        onJump={(line) => {
          const textarea = textareaRef.current;
          if (textarea === null) return;
          const index = offsetOfLine(textarea.value, line);
          textarea.focus();
          textarea.setSelectionRange(index, index);
        }}
      />
    </div>
  );
}

/**
 * 검증 결과 목록. **오류만 저장을 막는다** — 경고(`no_test` 등)는 막지 않는다
 * (`hasBlockingIssues()` 가 error 만 본다. 스텝이 없는 spec 도 사용자의 자유다).
 */
function IssueList({
  issues,
  onJump,
}: {
  issues: readonly CodeValidationIssue[];
  onJump: (line: number) => void;
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
              onJump(issue.line);
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

/** 1-based 줄 번호 → 본문 안 문자 인덱스. 범위를 벗어나면 끝으로 보낸다. */
function offsetOfLine(content: string, line: number): number {
  let index = 0;
  for (let current = 1; current < line; current += 1) {
    const next = content.indexOf("\n", index);
    if (next === -1) return content.length;
    index = next + 1;
  }
  return index;
}
