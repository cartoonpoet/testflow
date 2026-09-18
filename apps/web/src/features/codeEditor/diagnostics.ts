import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import type { CodeValidationIssue } from "@testflow/contracts";
import type { IssueLine } from "./theme";

/**
 * contracts 의 `CodeValidationIssue` → CodeMirror 진단으로 옮기는 **순수 변환**.
 *
 * 훅(`useCodeMirror`)에서 떼어 낸 이유는 두 가지다.
 * 1. **테스트 가능성** — 여기는 `@codemirror/state` 만 쓴다(DOM 없음). `@codemirror/view` 는
 *    모듈 로드 시점에 `navigator` 를 읽어서 node 환경 단위 테스트에서 못 부른다.
 * 2. 좌표 변환은 **에디터로 바꾸면서 새로 생긴 유일한 계산**이다. 여기가 틀리면 오류가
 *    엉뚱한 줄에 붙는데, 그건 렌더 검증으로만 잡기엔 경우의 수가 많다.
 */

/** 1-based `{line, column}` → 문서 오프셋. 범위를 벗어나면 그 줄(또는 마지막 줄) 끝으로 접는다. */
export function offsetOf(state: EditorState, line: number, column: number): number {
  const lineNumber = Math.min(Math.max(line, 1), state.doc.lines);
  const info = state.doc.line(lineNumber);
  return Math.min(info.from + Math.max(column - 1, 0), info.to);
}

/**
 * `validateScenarioCode()` 는 **길이를 주지 않는다**(`{line, column}` 만 있다).
 * 그래서 밑줄 범위는 "그 열부터 **그 줄 끝**까지"로 잡는다.
 *
 * - 줄을 **넘어가지 않는다**. 넘기면 다음 줄까지 물결이 번져 오류 위치를 오히려 흐린다.
 * - 열이 이미 줄 끝이면 한 글자를 확보한다 — 길이 0 이면 CodeMirror 가 밑줄 대신
 *   눈에 잘 안 띄는 **점 마커**를 그린다.
 */
export function toDiagnostics(
  state: EditorState,
  issues: readonly CodeValidationIssue[],
): Diagnostic[] {
  return issues.map((issue) => {
    const from = offsetOf(state, issue.line, issue.column);
    const lineEnd = state.doc.lineAt(from).to;
    const to = from < lineEnd ? lineEnd : Math.min(from + 1, state.doc.length);
    return {
      from: Math.min(from, to),
      to,
      severity: issue.severity,
      message: `${issue.message}${issue.moduleName === undefined ? "" : ` (${issue.moduleName})`}`,
      source: issue.code,
    };
  });
}

/**
 * 같은 진단을 다시 밀어 넣지 않기 위한 지문.
 * 메시지는 넣지 않는다 — 같은 `줄:열:심각도:코드` 면 메시지도 같다(contracts 가 결정한다).
 */
export function signatureOf(issues: readonly CodeValidationIssue[]): string {
  return issues
    .map((issue) => `${String(issue.line)}:${String(issue.column)}:${issue.severity}:${issue.code}`)
    .join("|");
}

/** 줄 배경 표시용. 같은 줄에 둘이 겹치면 `issueLineField` 에서 오류가 이긴다. */
export function issueLinesOf(issues: readonly CodeValidationIssue[]): IssueLine[] {
  return issues.map((issue) => ({ line: issue.line, severity: issue.severity }));
}
