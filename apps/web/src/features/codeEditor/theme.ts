import { StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * CodeMirror 테마 — **색을 여기에 적지 않는다.**
 *
 * ## ★ 규율: HEX 리터럴 0건
 * CodeMirror 테마는 JS 객체 안에 색 문자열을 넣는 구조라, 순진하게 쓰면 컴포넌트에
 * HEX 가 박힌다(03-phases 쟁점 6 이 기각 사유로 든 바로 그 지점이다).
 * 여기서는 값으로 **`var(--color-…)` 문자열만** 쓴다. style-mod 가 만드는 것은 결국
 * 일반 CSS 선언이라 `var()` 가 그대로 살아 런타임에 `:root` 토큰으로 해석된다.
 * 색의 출처는 여전히 `globals.css` 의 `@theme static` **한 곳**이다.
 *
 * ## 신규 토큰
 * 구문 강조 8색(`--color-code-*`)만 새로 만들었다. 에디터 크롬(거터·선택·커서·
 * 오류 줄 배경·툴팁)은 기존 L1/L2 토큰을 그대로 참조한다. 근거는 `globals.css` 주석 참고.
 */

/** `Tab` 한 번이 넣는 공백. codegen 산출물이 2칸이라 2칸을 유지한다. */
export const INDENT = "  ";

export const PLACEHOLDER =
  'import { test, expect } from "@playwright/test";\n\ntest("로그인", async ({ page }) => {\n  await page.goto("/login");\n});';

/**
 * 구문 강조 — `@theme static` 의 `--color-code-*` 8색만 쓴다.
 *
 * 태그를 잘게 쪼개지 않았다. 색이 8개뿐이라 그 이상 나누면 서로 구분이 안 되고,
 * 스타일 규칙 수만큼 CSS 가 늘어난다.
 */
const highlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.moduleKeyword,
      tags.definitionKeyword,
      tags.operatorKeyword,
      tags.modifier,
      tags.self,
    ],
    color: "var(--color-code-keyword)",
    fontWeight: "600",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.escape],
    color: "var(--color-code-string)",
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal],
    color: "var(--color-code-number)",
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--color-code-comment)",
    fontStyle: "italic",
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.function(tags.definition(tags.variableName)),
      tags.definition(tags.variableName),
      tags.labelName,
    ],
    color: "var(--color-code-function)",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.variableName)],
    color: "var(--color-code-type)",
  },
  {
    tag: [tags.tagName, tags.attributeName, tags.angleBracket],
    color: "var(--color-code-tag)",
  },
  {
    tag: [tags.punctuation, tags.separator, tags.bracket, tags.operator, tags.derefOperator],
    color: "var(--color-code-punct)",
  },
  { tag: tags.invalid, color: "var(--color-danger)" },
]);

/**
 * 에디터 크롬.
 *
 * 높이는 여기서 정하지 않는다 — 껍데기(`tf-code-host`)가 `380/520px` 을 갖고
 * 에디터는 `100%` 만 따른다. 높이 규칙이 두 군데로 갈리지 않게 한 것이다.
 */
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    backgroundColor: "var(--color-panel)",
    color: "var(--color-ink)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.7",
    overflow: "auto",
  },
  ".cm-content": { padding: "12px 0", caretColor: "var(--color-brand)" },
  ".cm-line": { padding: "0 12px" },
  ".cm-placeholder": { color: "var(--color-muted)" },

  /* 거터 — 시안의 테이블 헤더 색을 그대로 쓴다(기존 textarea 거터와 동일). */
  ".cm-gutters": {
    backgroundColor: "var(--color-table-head)",
    color: "var(--color-table-head-ink)",
    borderRight: "1px solid var(--color-line)",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    lineHeight: "1.7",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px", minWidth: "28px" },
  ".cm-activeLineGutter": { backgroundColor: "var(--color-hint)", color: "var(--color-ink)" },

  ".cm-activeLine": { backgroundColor: "var(--color-step-selected-bg)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-brand)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--color-soft)",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--color-soft)",
    outline: "1px solid var(--color-brand)",
  },
  ".cm-nonmatchingBracket": { color: "var(--color-danger)" },

  /*
   * ★ lint 표시 — `@codemirror/lint` 의 baseTheme 은 물결 밑줄을 **색이 박힌 SVG
   *   data URI** 로 그린다(`underline("#f11")`). data URI 안에는 `var()` 를 넣을 수
   *   없으므로, 그 배경 이미지를 끄고 CSS `text-decoration: underline wavy` 로
   *   바꿨다. 이러면 색이 토큰 하나로 표현된다.
   */
  ".cm-lintRange": { backgroundImage: "none", paddingBottom: "0" },
  ".cm-lintRange-error": {
    textDecoration: "underline wavy var(--color-danger)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    textDecoration: "underline wavy var(--color-warn)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-active": { backgroundColor: "var(--color-notice)" },

  ".cm-tooltip": {
    backgroundColor: "var(--color-panel)",
    border: "1px solid var(--color-line)",
    borderRadius: "var(--radius-input)",
    boxShadow: "var(--shadow-panel)",
    color: "var(--color-ink)",
    fontFamily: "var(--font-sans)",
    fontSize: "11px",
    lineHeight: "1.6",
    maxWidth: "320px",
  },
  ".cm-tooltip.cm-tooltip-lint": { overflow: "hidden" },
  ".cm-diagnostic": { padding: "6px 10px" },
  ".cm-diagnostic-error": { borderLeft: "4px solid var(--color-danger)" },
  ".cm-diagnostic-warning": { borderLeft: "4px solid var(--color-warn)" },

  /*
   * 오류·경고가 있는 줄의 배경. 기존 textarea 는 **거터 숫자를 붉게** 칠해 알려 줬다 —
   * 그 신호를 잃지 않으려고 줄 데코레이션으로 대신한다(`issueLineField`).
   * `.cm-activeLine` 보다 **뒤에** 선언해 같은 특정성에서 이쪽이 이긴다.
   */
  ".cm-tf-warningLine": { backgroundColor: "var(--color-notice)" },
  ".cm-tf-errorLine": { backgroundColor: "var(--color-danger-soft)" },
});

/** 줄 단위 오류/경고 표시. `line` 은 1-based. */
export type IssueLine = { line: number; severity: "error" | "warning" };

/** `issueLineField` 를 갱신하는 effect. 진단 dispatch 와 같은 트랜잭션에 실어 보낸다. */
export const setIssueLines = StateEffect.define<readonly IssueLine[]>();

const errorLine = Decoration.line({ class: "cm-tf-errorLine" });
const warningLine = Decoration.line({ class: "cm-tf-warningLine" });

const issueLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setIssueLines)) continue;
      // 같은 줄에 오류·경고가 겹치면 오류가 이긴다.
      const worst = new Map<number, "error" | "warning">();
      for (const item of effect.value) {
        if (worst.get(item.line) === "error") continue;
        worst.set(item.line, item.severity);
      }
      const ranges: Range<Decoration>[] = [];
      const total = transaction.state.doc.lines;
      for (const [line, severity] of worst) {
        if (line < 1 || line > total) continue;
        const info = transaction.state.doc.line(line);
        ranges.push((severity === "error" ? errorLine : warningLine).range(info.from));
      }
      next = Decoration.set(ranges, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 테마 + 구문 강조 + 줄 표시. 에디터 확장 목록에 그대로 펼쳐 넣는다. */
export const themeExtensions: Extension[] = [
  editorTheme,
  syntaxHighlighting(highlightStyle),
  issueLineField,
];
