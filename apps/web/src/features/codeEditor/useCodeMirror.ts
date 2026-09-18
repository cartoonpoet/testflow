import { useEffect, useRef, type RefObject } from "react";
import {
  Compartment,
  EditorState,
  type StateEffect,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { bracketMatching, indentOnInput, indentUnit } from "@codemirror/language";
import { typescriptLanguage } from "@codemirror/lang-javascript";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { setDiagnostics } from "@codemirror/lint";
import type { CodeValidationIssue } from "@testflow/contracts";
import { INDENT, PLACEHOLDER, setIssueLines, themeExtensions } from "./theme";
import { issueLinesOf, offsetOf, signatureOf, toDiagnostics } from "./diagnostics";

/**
 * CodeMirror 6 생명주기 **훅 하나**.
 *
 * ## 왜 훅인가
 * 라운드 1·2 규율은 `useEffect` 를 자제한다. 그런데 CodeMirror 는 명령형 DOM
 * 라이브러리라 mount/unmount 와 "prop → dispatch" 반영이 반드시 필요하다.
 * 그래서 **이 파일에만** 이펙트를 모으고, 컴포넌트에는 한 줄(`useCodeMirror(...)`)만 남긴다.
 *
 * ## React 19 strict mode 이중 마운트
 * - 마운트 이펙트는 정리에서 `view.destroy()` 하고 `holder` 를 비운다.
 * - 재마운트 시 새 `EditorView` 를 만든 뒤, **같은 커밋의 뒤따르는 이펙트들이**
 *   본문·진단·편집가능 여부를 다시 밀어 넣는다(`lastDiagnostics` 를 `null` 로 되돌려
 *   진단 재적용이 건너뛰어지지 않게 한다).
 *
 * ## prop 반영이 루프를 만들지 않게
 * `onChange` 로 올라간 값이 다시 `value` 로 내려오면 문서를 또 쓰게 된다.
 * 그래서 본문 동기화는 **현재 문서와 다를 때만** dispatch 한다. 그 조건이 없으면
 * 매 타이핑마다 전체 문서 교체가 일어나 커서가 튄다.
 */

export type UseCodeMirrorOptions = {
  host: RefObject<HTMLDivElement | null>;
  value: string;
  onChange: (next: string) => void;
  issues: readonly CodeValidationIssue[];
  disabled: boolean;
};

type Holder = {
  view: EditorView;
  editable: Compartment;
  /** 마지막으로 반영한 진단의 지문. */
  lastDiagnostics: string | null;
  /**
   * 그때의 문서. **지문만 보면 안 된다** — 문서가 바뀌면 CodeMirror 가 기존 진단 범위를
   * 자동으로 **매핑**해 끌고 가는데, 줄이 쪼개지면 그 범위가 엉뚱한 줄까지 덮는다.
   * (실측: 1번 줄 앞에 import 를 끼워 넣고 Enter 치면 밑줄이 2번 줄까지 번졌다.)
   * `Text` 는 불변이라 **참조 비교 하나로** 문서 변경을 정확히 잡는다.
   */
  lastDoc: Text | null;
};

/**
 * ★ `javascript()` 를 부르지 않는다.
 *
 * `javascript()` 는 스니펫·지역 변수 자동완성을 끼워 넣느라 `@codemirror/autocomplete`
 * 를 끌어온다(lang-javascript 의 의존성이다). 이번 범위는 **구문 강조와 lint 표시까지**라
 * 자동완성은 값이 없고 번들만 늘린다. `typescriptLanguage` 를 직접 쓰면 파서만 들어오고
 * autocomplete 모듈은 참조가 끊겨 tree-shaking 으로 빠진다(번들 델타는 08-code-editor 에 기록).
 */
const baseExtensions = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  history(),
  indentUnit.of(INDENT),
  indentOnInput(),
  bracketMatching(),
  typescriptLanguage.extension,
  placeholder(PLACEHOLDER),
  ...themeExtensions,
  EditorView.contentAttributes.of({
    "aria-label": "테스트 코드",
    spellcheck: "false",
    autocorrect: "off",
    autocapitalize: "off",
    "data-testid": "code-editor",
  }),
];

/**
 * `Escape` → blur.
 *
 * `Tab` 을 들여쓰기로 가로채면 키보드만으로 에디터를 빠져나갈 수 없다. 기존 `textarea`
 * 구현이 남겨 둔 **`Escape` 후 `Tab`** 탈출 경로를 그대로 유지한다.
 * `defaultKeymap` 의 `Escape`(선택 단순화)보다 **앞에** 둬서 우리 바인딩이 이긴다.
 */
const escapeBlur = {
  key: "Escape",
  run: (view: EditorView) => {
    view.contentDOM.blur();
    return true;
  },
};

/**
 * `TransactionSpec["effects"]` 는 `effect | effect[] | undefined` 세 모양을 다 받는다.
 * `Array.isArray` 는 `readonly` 배열을 좁혀 주지 못해(TS 한계) 여기서 한 번만 평탄화한다.
 */
function asEffectList(given: TransactionSpec["effects"]): readonly StateEffect<unknown>[] {
  if (given === undefined) return [];
  return Array.isArray(given)
    ? (given as readonly StateEffect<unknown>[])
    : [given as StateEffect<unknown>];
}

export function useCodeMirror({ host, value, onChange, issues, disabled }: UseCodeMirrorOptions) {
  const holder = useRef<Holder | null>(null);
  /**
   * 이펙트가 항상 최신 prop 을 보게 하는 상자. 이 값들은 **이펙트를 다시 돌릴 이유가
   * 아니다** — `onChange` 가 매 렌더 새 함수라고 해서 에디터를 다시 만들 수는 없다.
   */
  const latest = useRef({ value, onChange, disabled });

  /*
   * 렌더 중에 ref 를 쓰면 `react-hooks/refs` 가 막는다(정당한 룰이다 — 렌더는 순수해야 한다).
   * 그래서 상자 갱신도 이펙트로 한다. **마운트 이펙트보다 먼저** 선언해야 재마운트 때
   * 최신 값으로 에디터가 만들어진다(이펙트는 선언 순서대로 돈다).
   */
  useEffect(() => {
    latest.current.value = value;
    latest.current.onChange = onChange;
    latest.current.disabled = disabled;
  }, [value, onChange, disabled]);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;

    const editable = new Compartment();
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          ...baseExtensions,
          keymap.of([escapeBlur, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          editable.of(EditorView.editable.of(!latest.current.disabled)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            latest.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    holder.current = { view, editable, lastDiagnostics: null, lastDoc: null };

    return () => {
      view.destroy();
      holder.current = null;
    };
  }, [host]);

  // 본문 ← prop. 바깥에서 값이 갈아끼워졌을 때만(업로드·저장 후 재조회) 문서를 바꾼다.
  useEffect(() => {
    const current = holder.current;
    if (current === null) return;
    const doc = current.view.state.doc.toString();
    if (doc === value) return;
    current.view.dispatch({ changes: { from: 0, to: doc.length, insert: value } });
  }, [value]);

  // 진단 ← prop. `issues` 는 매 렌더 새 배열이라 **지문으로 비교해** 불필요한 dispatch 를 막는다.
  useEffect(() => {
    const current = holder.current;
    if (current === null) return;
    const { view } = current;
    const signature = signatureOf(issues);
    if (signature === current.lastDiagnostics && view.state.doc === current.lastDoc) return;
    current.lastDiagnostics = signature;
    /*
     * `setDiagnostics()` 는 effect 가 담긴 **TransactionSpec** 을 돌려준다(lint 확장을
     * 아직 안 붙였으면 `appendConfig` 까지 함께 실어 준다). 그래서 통째로 덮어쓰면 안 되고,
     * 우리 줄-표시 effect 를 **뒤에 이어 붙여** 한 트랜잭션으로 보낸다.
     */
    const spec = setDiagnostics(view.state, toDiagnostics(view.state, issues));
    const merged: StateEffect<unknown>[] = [
      ...asEffectList(spec.effects),
      setIssueLines.of(issueLinesOf(issues)),
    ];
    view.dispatch({ ...spec, effects: merged });
    current.lastDoc = view.state.doc;
  }, [issues]);

  // 저장 중에는 편집을 막는다(기존 `textarea disabled` 와 같은 동작).
  useEffect(() => {
    const current = holder.current;
    if (current === null) return;
    current.view.dispatch({
      effects: current.editable.reconfigure(EditorView.editable.of(!disabled)),
    });
  }, [disabled]);

  /** 특정 줄로 커서를 옮기고 포커스한다(검증 목록의 `줄:열` 버튼). */
  const jumpTo = (line: number, column: number) => {
    const current = holder.current;
    if (current === null) return;
    const { view } = current;
    const position = offsetOf(view.state, line, column);
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    view.focus();
  };

  return { jumpTo };
}
