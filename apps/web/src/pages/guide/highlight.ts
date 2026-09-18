/**
 * 가이드 화면 코드 블록의 **최소 구문 강조** — 순수 함수.
 *
 * ## 왜 직접 쓰는가
 * 이 화면에는 `.spec.ts` 예시가 6개 있고 그 안에 `// ✅` / `// ❌` 주석이 의미를 나른다.
 * 전부 한 색이면 "되는 줄"과 "안 되는 줄"이 눈으로 구분되지 않는다.
 * 그렇다고 CodeMirror(420KB 청크)나 highlight.js 를 끌어오면 이 화면을 여는 것만으로
 * 큰 청크를 받게 된다 — **가이드는 제일 가벼워야 하는 화면**이다.
 *
 * 그래서 규칙 4개(주석·문자열·숫자·키워드)짜리 토크나이저를 둔다. 색은 08-code-editor 가
 * 이미 만들어 둔 `--color-code-*` 토큰을 그대로 쓴다(신규 색 0개).
 *
 * ## 한계 (의도한 것)
 * 여러 줄 주석(`/* *\/`), 정규식 리터럴, JSX 는 다루지 않는다. 이 화면의 예시 코드에
 * 하나도 없고, 넣는 순간 "작은 함수"가 아니게 된다. 예시가 늘어 필요해지면 그때 넓힌다.
 *
 * ★ 표시 전용이다. **복사 버튼은 토큰이 아니라 원본 문자열을 복사한다** —
 *   여기서 무슨 일이 나도 복사되는 내용은 영향받지 않는다.
 */

export type CodeTokenKind = "plain" | "comment" | "string" | "number" | "keyword";

export type CodeToken = {
  readonly kind: CodeTokenKind;
  readonly text: string;
};

/**
 * 교체 순서가 곧 우선순위다.
 *   1) `//` 줄 주석 — 문자열 안의 `https://` 를 먹지 않도록 문자열보다 **뒤**가 아니라,
 *      문자열이 먼저 매칭되게 아래 순서를 유지해야 한다(정규식 교대는 왼쪽부터 시도한다).
 *      그래서 문자열을 1번에 둔다.
 *   2) 주석
 *   3) 숫자
 *   4) 키워드
 */
const TOKEN_PATTERN = new RegExp(
  [
    // 1) 문자열 — 홑따옴표 · 쌍따옴표 · 백틱. `'input[type="file"]'` 처럼 안에 다른 따옴표가 있어도
    //    바깥 따옴표가 먼저 잡혀 통째로 소비된다. `https://` 가 주석으로 오인되지 않는 이유다.
    /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/.source,
    // 2) 줄 주석
    /(\/\/[^\n]*)/.source,
    // 3) 숫자
    /(\b\d+(?:\.\d+)?\b)/.source,
    // 4) 키워드
    /(\b(?:import|export|from|const|let|var|function|return|await|async|if|else|for|of|in|new|throw|try|catch|typeof|class|default)\b)/
      .source,
  ].join("|"),
  "g",
);

/** 캡처 그룹 번호 → 토큰 종류. `TOKEN_PATTERN` 의 교대 순서와 짝이다. */
const GROUP_KIND: readonly CodeTokenKind[] = ["string", "comment", "number", "keyword"];

/**
 * 코드 문자열을 토큰 배열로 나눈다.
 *
 * 반환 토큰의 `text` 를 순서대로 이으면 **항상 입력과 완전히 같다**(무손실).
 * `highlight.spec.ts` 가 그 성질을 고정한다 — 렌더가 코드를 조용히 바꿔 먹는 사고를 막는다.
 */
export function tokenizeCode(code: string): readonly CodeToken[] {
  const tokens: CodeToken[] = [];
  let last = 0;

  // `matchAll` 은 lastIndex 를 건드리지 않아 정규식 상태 공유 사고가 없다.
  for (const match of code.matchAll(TOKEN_PATTERN)) {
    const start = match.index;
    if (start > last) tokens.push({ kind: "plain", text: code.slice(last, start) });

    const groupIndex = GROUP_KIND.findIndex((_, i) => match[i + 1] !== undefined);
    tokens.push({
      kind: GROUP_KIND[groupIndex] ?? "plain",
      text: match[0],
    });
    last = start + match[0].length;
  }

  if (last < code.length) tokens.push({ kind: "plain", text: code.slice(last) });
  return tokens;
}

/**
 * 토큰 종류 → Tailwind 클래스.
 * 색은 전부 `globals.css` 의 `--color-code-*` 토큰이다(HEX 리터럴 0건 규율).
 */
export const CODE_TOKEN_CLASS: Readonly<Record<CodeTokenKind, string>> = {
  plain: "",
  comment: "text-code-comment italic",
  string: "text-code-string",
  number: "text-code-number",
  keyword: "text-code-keyword font-semibold",
};
