import { useImperativeHandle, useRef, type Ref } from "react";
import { cn } from "cn";
import type { CodeValidationIssue } from "@testflow/contracts";
import { useCodeMirror } from "./useCodeMirror";

/**
 * CodeMirror 6 에디터 — **이 모듈이 번들 경계다.**
 *
 * `CodeEditorPanel` 이 `lazy(() => import("@/features/codeEditor/CodeMirrorEditor"))`
 * 로만 부른다. 그래서 CodeMirror 전량이 **이 모듈의 청크**에 갇히고,
 * 코드 화면 청크(`code-*.js`)에도, 초기 로드 청크에도 들어가지 않는다.
 * → 화면 껍데기(파일명 · 첨부 · 안내)는 즉시 뜨고 에디터만 뒤따라 붙는다.
 *
 * **default export 다** — `React.lazy` 가 요구한다. 이 파일을 이름 있는 import 로
 * 끌어 쓰면 경계가 무너지므로 barrel(`index.ts`)에 올리지 않았다.
 */

export type CodeMirrorHandle = {
  /** 검증 목록의 `줄:열` 버튼이 부른다. */
  jumpTo: (line: number, column: number) => void;
};

export type CodeMirrorEditorProps = {
  value: string;
  onChange: (next: string) => void;
  issues: readonly CodeValidationIssue[];
  disabled: boolean;
  handle?: Ref<CodeMirrorHandle>;
};

export default function CodeMirrorEditor({
  value,
  onChange,
  issues,
  disabled,
  handle,
}: CodeMirrorEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const { jumpTo } = useCodeMirror({ host, value, onChange, issues, disabled });

  useImperativeHandle(handle, () => ({ jumpTo }));

  return (
    <div
      ref={host}
      data-slot="code-mirror"
      data-disabled={disabled ? "true" : undefined}
      className={cn("tf-code-host w-full", disabled && "opacity-60")}
    />
  );
}
