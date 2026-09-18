import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { CodeValidationIssue } from "@testflow/contracts";
import type { Diagnostic } from "@codemirror/lint";
import { issueLinesOf, offsetOf, signatureOf, toDiagnostics } from "./diagnostics";

/**
 * 좌표 변환은 **에디터로 바꾸면서 새로 생긴 유일한 계산**이다. 여기가 틀리면 검증 오류가
 * 엉뚱한 줄에 붙는다 — 화면으로만 확인하기에는 경우의 수(한글 · 빈 줄 · 범위 밖)가 많다.
 */

const DOC = [
  'import fs from "fs";', // 1  (20자)
  "", // 2
  "const 대기 = 300;", // 3  (한글 2글자)
  "test();", // 4
].join("\n");

const state = EditorState.create({ doc: DOC });

/** `noUncheckedIndexedAccess` 아래에서 인덱싱 결과를 좁힌다. */
function at(list: Diagnostic[], index: number): Diagnostic {
  const item = list[index];
  if (item === undefined) throw new Error(`진단 ${String(index)} 번이 없다`);
  return item;
}

function issue(partial: Partial<CodeValidationIssue>): CodeValidationIssue {
  return {
    line: 1,
    column: 1,
    severity: "error",
    code: "node_builtin",
    message: "메시지",
    ...partial,
  };
}

describe("offsetOf", () => {
  it("1:1 은 문서 맨 앞이다", () => {
    expect(offsetOf(state, 1, 1)).toBe(0);
  });

  it("열이 그대로 오프셋에 더해진다", () => {
    expect(offsetOf(state, 1, 16)).toBe(15);
    expect(DOC.slice(15, 20)).toBe('"fs";');
  });

  it("빈 줄은 줄 시작 오프셋을 준다", () => {
    expect(offsetOf(state, 2, 1)).toBe(21);
  });

  it("한글은 코드 유닛 1개로 센다 (contracts 와 같은 기준)", () => {
    const line3 = state.doc.line(3);
    expect(offsetOf(state, 3, 7)).toBe(line3.from + 6);
    expect(DOC.slice(line3.from + 6, line3.from + 8)).toBe("대기");
  });

  it("열이 줄 끝을 넘으면 줄 끝으로 접는다", () => {
    expect(offsetOf(state, 4, 999)).toBe(state.doc.line(4).to);
  });

  it("줄 번호가 범위를 넘으면 마지막 줄로 접는다", () => {
    expect(offsetOf(state, 99, 1)).toBe(state.doc.line(4).from);
  });

  it("0 이하 좌표도 죽지 않는다", () => {
    expect(offsetOf(state, 0, 0)).toBe(0);
  });
});

describe("toDiagnostics", () => {
  it("밑줄은 그 열부터 그 줄 끝까지다 — 다음 줄로 번지지 않는다", () => {
    const diagnostic = at(toDiagnostics(state, [issue({ line: 1, column: 16 })]), 0);
    expect(diagnostic.from).toBe(15);
    expect(diagnostic.to).toBe(20);
    expect(state.doc.lineAt(diagnostic.to).number).toBe(1);
  });

  it("빈 줄에서도 길이 0 이 되지 않는다 (점 마커 방지)", () => {
    const diagnostic = at(toDiagnostics(state, [issue({ line: 2, column: 1 })]), 0);
    expect(diagnostic.to).toBeGreaterThan(diagnostic.from);
  });

  it("severity 를 그대로 옮긴다", () => {
    const mapped = toDiagnostics(state, [
      issue({ severity: "error" }),
      issue({ line: 4, severity: "warning", code: "no_test" }),
    ]);
    expect(at(mapped, 0).severity).toBe("error");
    expect(at(mapped, 1).severity).toBe("warning");
  });

  it("moduleName 이 있으면 메시지 뒤에 붙는다", () => {
    expect(at(toDiagnostics(state, [issue({ moduleName: "fs" })]), 0).message).toBe("메시지 (fs)");
    expect(at(toDiagnostics(state, [issue({})]), 0).message).toBe("메시지");
  });

  it("code 를 source 로 남긴다", () => {
    expect(at(toDiagnostics(state, [issue({ code: "relative_import" })]), 0).source).toBe(
      "relative_import",
    );
  });
});

describe("signatureOf", () => {
  it("줄·열·심각도·코드가 같으면 같은 지문이다", () => {
    expect(signatureOf([issue({})])).toBe(signatureOf([issue({ message: "다른 메시지" })]));
  });

  it("줄이 달라지면 지문이 달라진다", () => {
    expect(signatureOf([issue({ line: 1 })])).not.toBe(signatureOf([issue({ line: 2 })]));
  });

  it("빈 목록은 빈 문자열이다", () => {
    expect(signatureOf([])).toBe("");
  });
});

describe("issueLinesOf", () => {
  it("줄 번호와 심각도만 남긴다", () => {
    expect(issueLinesOf([issue({ line: 3, severity: "warning" })])).toEqual([
      { line: 3, severity: "warning" },
    ]);
  });
});
