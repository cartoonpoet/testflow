# 08 · 코드 시나리오 입력란 → CodeMirror 6 에디터

라운드 3 · 브랜치 `feat/code-editor` (`main` `720bd15` 에서 분기)

라운드 2 `03-phases.md` **쟁점 6** 은 CodeMirror/Monaco 를 세 가지 이유로 기각하고
"승급 조건"을 남겨 뒀다 — *"사용자가 편집이 불편하다를 실제로 말하면, 이미 lazy 인 빌더
청크 안에서만 CodeMirror 를 도입하고 초기 로드 델타를 측정해 보고한다."*
그 조건이 발동했다. 이 문서는 **기각 사유 3개를 각각 어떻게 해소했는지**와 실측치다.

---

## 0. 요약

| 항목 | 기준선(main) | 결과 | 판정 |
|---|---|---|---|
| **초기 로드 JS** | 549,584 B | **549,111 B** | **−473 B** |
| 초기 로드 gzip (vite 보고) | 175.19 kB | **174.32 kB** | −0.87 kB |
| `vite build` 500KB 경고 | 없음 | **없음** | 유지 |
| 코드 화면 청크 `code-*.js` | 17,790 B | **16,528 B** | −1,262 B |
| **신규** `CodeMirrorEditor-*.js` | — | 420,540 B (gzip 142.32 kB) | 코드 화면에서만 · 별도 요청 |
| `apps/web/src` 스타일 값 HEX | 0건 | **0건** | 유지 |
| `style={{` | 3건 | **3건** | 유지 |
| typecheck / lint / build / test | 7/7 · 0 · 5/5 · 616 | **7/7 · 0 · 5/5 · 632** | 통과 |
| Playwright 렌더 검증 | — | **preview 56건 + dev 6건 = 62건 측정 / 62 통과 / 0 실패** | — |

---

## 1. 채택한 패키지 구성과 버전

`apps/web/package.json` **dependencies** 에 명시적으로 올렸다(pnpm isolated 구조라
phantom dependency 가 그대로 드러난다. `shamefully-hoist` 를 쓰지 않았다).

| 패키지 | 버전 | 배포일 | 쓰는 이유 |
|---|---|---|---|
| `@codemirror/state` | 6.7.5 | 2026-09-15 | 문서 모델 · 트랜잭션 |
| `@codemirror/view` | 6.43.12 | 2026-09-15 | 렌더 · 줄번호 거터 · placeholder · 현재 줄 강조 |
| `@codemirror/language` | 6.12.4 | 2026-06-25 | `syntaxHighlighting` · `bracketMatching` · `indentUnit` |
| `@codemirror/lang-javascript` | 6.2.5 | 2026-03-02 | TS 파서(`typescriptLanguage`) |
| `@codemirror/lint` | 6.9.7 | 2026-06-09 | **검증 오류 표시(이번 작업의 핵심 실익)** |
| `@codemirror/commands` | 6.11.1 | 2026-09-15 | `indentWithTab` · undo/redo · 기본 편집 키맵 |
| `@lezer/highlight` | 1.2.3 | 2025-10-26 | `tags` — 구문 강조 스타일 정의 |

- **`codemirror` 메타 패키지를 쓰지 않았다.** `basicSetup` 은 autocomplete · search ·
  fold · 다중 커서를 전부 끌어온다.
- **검역(`minimum-release-age=1440`)에 걸린 패키지는 없다.** 오늘(2026-09-18) 기준
  가장 최근 배포가 2026-09-15 라 전부 24시간을 넘겼다. `.npmrc` 는 손대지 않았다.
- 전이 의존으로 들어온 것: `@lezer/common` 1.5.2 · `@lezer/lr` 1.4.10 ·
  `@lezer/javascript` 1.5.4 · `@marijn/find-cluster-break` 1.0.4 ·
  **`@codemirror/autocomplete` 6.20.3**(lang-javascript 의 의존성이라 설치는 되지만
  **번들에는 들어가지 않는다** — 아래 2.3).

---

## 2. ★ 번들 — 청크별 before/after

측정: `pnpm --filter @testflow/web build` 산출물. raw 는 `find -printf %s`,
gzip 은 **vite 가 보고한 값**(before/after 같은 방법).

### 2.1 before (main `720bd15`)

| 청크 | raw | gzip | 초기 로드 |
|---|---:|---:|:--:|
| `index-4MyW0M3U.js` | 218,647 | 69.11 kB | ● |
| `useProject-BYc8rloA.js` | 330,221 | 105.66 kB | ● |
| `rolldown-runtime-hePW80VL.js` | 716 | 0.42 kB | ● |
| `index-CDeA_HOh.css` | 40,675 | 9.01 kB | ● |
| `code-C2qu1wGh.js` | 17,790 | 6.44 kB | 코드 화면 |
| **초기 로드 JS 합** | **549,584** | **175.19 kB** | |

### 2.2 after (`feat/code-editor`)

| 청크 | raw | gzip | 초기 로드 | 증감 |
|---|---:|---:|:--:|---:|
| `index-BZstJp3E.js` | 304,426 | 95.35 kB | ● | — |
| `vendor-react-p8dv98dL.js` | 218,828 | 68.24 kB | ● | — |
| `dist-Bf4qbvgc.js` | 25,857 | 10.73 kB | ● | — |
| `index-*.css` | 40,700 | 9.11 kB | ● | **+25 B** |
| `code-3OqEQBMv.js` | 16,528 | 5.93 kB | 코드 화면 | **−1,262 B** |
| `CodeMirrorEditor-C3nsDb2H.js` | 420,540 | 142.32 kB | **에디터 렌더 시점** | 신규 |
| **초기 로드 JS 합** | **549,111** | **174.32 kB** | | **−473 B** |

**초기 로드는 늘지 않았다(오히려 473바이트 줄었다).** 청크 이름이 바뀐 것은 아래 2.4 참고 —
같은 바이트가 다르게 나뉜 것이고, 내용물이 바뀐 게 아니다.

### 2.3 에디터를 어디에 가뒀나 — 실측으로 확인

코드 화면은 원래도 라우트 lazy 청크(`routes.tsx`)였다. 하지만 **거기에 얹으면 화면을
여는 순간 437KB 를 전부 받아야 한다.** 그래서 `CodeEditorPanel` 안에서 한 겹 더 쪼갰다:

```tsx
const CodeMirrorEditor = lazy(() => import("@/features/codeEditor/CodeMirrorEditor"));
```

Playwright 네트워크 실측:

| 측정 | 결과 |
|---|---|
| 대시보드(`/`)에서 `CodeMirrorEditor-*.js` 요청 | **0건** |
| 코드 화면 진입 시 요청 | **1건** (`CodeMirrorEditor-C3nsDb2H.js`) |
| 초기 로드 3개 청크에 `codemirror`/`lezer` 문자열 | **0건** (grep) |
| 에디터 청크에 `CompletionContext`/`startCompletion` | **0건** (autocomplete tree-shaken) |

즉 화면 껍데기(파일명 · 첨부 · 안내 박스 · 검증 목록)는 16.5KB 청크로 **즉시** 뜨고,
에디터만 뒤따라 붙는다(그 사이는 `Skeleton` 이 380px 자리를 잡아 레이아웃이 안 튄다).

### 2.4 ★ `vite.config.ts` 에 vendor 청크를 못박은 이유 (숨기지 않고 기록)

**처음 lazy 로 쪼갰을 때 500KB 경고가 떴다.** 원인은 CodeMirror 가 아니었다.

rolldown 의 자동 분할은 "이 모듈에 도달하는 엔트리·동적청크의 집합"으로 묶는데,
**동적 import 를 하나 더 만들면 그 집합이 통째로 재편된다.** 실제로:

| | index | 공용 | 초기 합 | 경고 |
|---|---:|---:|---:|:--:|
| before | 218,647 | 330,221 (`useProject-*`) | 549,584 | 없음 |
| lazy 추가 (설정 없음) | **515,397** | 34,051 (`dist-*`) | 549,448 | **500KB 경고** |
| lazy + `vendor-react` 그룹 | 304,426 | 218,828 + 25,857 | 549,111 | 없음 |

**초기 로드 총량은 세 경우 모두 사실상 같다**(549.6 / 549.4 / 549.1 KB).
바뀐 것은 나뉘는 방식뿐인데, 그중 하나가 경고 임계를 넘었다. 그래서 React 런타임을
`build.rollupOptions.output.advancedChunks` 로 고정 청크에 못박았다.

- 범위는 **`react|react-dom|scheduler` 로 좁혔다.** `node_modules` 전체를 한 그룹으로
  묶으면 CodeMirror 420KB 가 초기 로드로 끌려 들어와 이번 작업의 전제가 깨진다.
- 부수 효과로 React 청크가 화면 변경과 무관해져 캐시 수명이 길어진다.

### 2.5 확장별 번들 델타 (각각 측정)

에디터 청크 raw / gzip 기준. "채택"만 최종 구성에 들어 있다.

| 구성 | raw | gzip | Δ raw | 판단 |
|---|---:|---:|---:|---|
| **채택 구성** | 420,540 | 142.32 kB | — | |
| `javascript({typescript:true})` 로 바꾸면 | 433,590 | 146.85 kB | **+13,050** | ✗ autocomplete 가 딸려 온다. 이번 범위에 자동완성은 없다 |
| `@codemirror/lint` 를 빼면 | 392,210 | 133.53 kB | −28,330 | ✓ **넣는다.** 에디터로 바꾼 가장 큰 실익이 이것이다 |
| `defaultKeymap`+`history` 를 빼면 | 402,210 | 136.49 kB | −18,330 | ✓ **넣는다.** undo/redo · Home/End 없는 에디터는 textarea 보다 못하다 |
| `@codemirror/search` | — | — | — | ✗ **설치조차 안 했다.** spec 1개는 100줄 남짓이라 값이 낮고, 검색 패널은 자체 input/button 을 그려 토큰 매핑을 또 만들어야 한다 |
| `drawSelection` (CM 자체 커서) | — | — | — | ✗ 네이티브 캐럿으로 충분하다. `caret-color` 를 `--brand` 로 칠했고, 안 넣은 덕에 reduced-motion 우회 위험도 없다(6절) |

---

## 3. ★ 테마를 `@theme` 토큰으로 묶은 방법

### 3.1 방법

CodeMirror 테마는 JS 객체다. 쟁점 6 이 "JS 객체 안의 HEX"를 기각 사유로 든 그 지점이다.
**값으로 `var(--color-…)` 문자열만 쓴다.** style-mod 가 만드는 것은 결국 평범한 CSS
선언이라 `var()` 가 그대로 살아 런타임에 `:root` 토큰으로 해석된다.

```ts
// apps/web/src/features/codeEditor/theme.ts
const editorTheme = EditorView.theme({
  ".cm-gutters": { backgroundColor: "var(--color-table-head)", … },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-brand)" },
  …
});
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, …], color: "var(--color-code-keyword)", fontWeight: "600" },
  …
]);
```

**안 되는 속성은 없었다.** 색을 넣는 자리 전부에서 `var()` 가 동작했다(computed style 로
11건 실측, 6절 표). 단 하나 예외적으로 손을 봐야 했던 것이 아래 3.3 이다.

### 3.2 신규 색 토큰 — 구문 강조 8색

`globals.css` 의 `@theme static` L1 뒤에 추가했다. **시안에 코드 에디터가 없어
구문 강조 팔레트가 없었다.** 고른 기준:

1. 배경은 `--panel #ffffff`. 전부 흰 배경 대비 **4.5:1 이상**으로 맞췄다.
2. 브랜드 초록(`--brand #087f5b`)에서 색상환을 한 칸씩 돌려 시안과 충돌하지 않게 했다.

| 토큰 | 값 | 근거 |
|---|---|---|
| `--color-code-keyword` | `#0a6b4d` | `--brand #087f5b` ~ `--brand-dark #086044` 사이 |
| `--color-code-string` | `#8a5412` | `--notice-ink #80520d` ~ `--warn #c57814` 사이 호박색 |
| `--color-code-number` | `#1c6c86` | 초록과 구분되는 청록 |
| `--color-code-comment` | `#6e7a75` | `--muted #68736f` 를 살짝 밝게 — 뒤로 물러나되 4.5:1 유지 |
| `--color-code-function` | `#2f5f8a` | 슬레이트 블루 — 호출/정의 식별자 |
| `--color-code-type` | `#6a4ea0` | 보라 — 타입·클래스명 |
| `--color-code-tag` | `#a33b3b` | `--danger #c34343` 을 어둡게 — JSX 태그 |
| `--color-code-punct` | `#59645f` | `--tag-ink` 와 같은 값 — 구두점은 약하게 |

**에디터 크롬은 신규 색을 만들지 않았다.** 전부 기존 토큰 참조다:

| 부위 | 참조 토큰 |
|---|---|
| 거터 배경 / 글자 | `--color-table-head` / `--color-table-head-ink` |
| 현재 줄 / 현재 줄 거터 | `--color-step-selected-bg` / `--color-hint` |
| 커서 · 괄호 매칭 테두리 | `--color-brand` |
| 선택 영역 · 괄호 매칭 배경 | `--color-soft` |
| 오류 밑줄 · 오류 줄 배경 | `--color-danger` · `--color-danger-soft` |
| 경고 밑줄 · 경고 줄 배경 | `--color-warn` · `--color-notice` |
| 툴팁 | `--color-panel` · `--color-line` · `--radius-input` · `--shadow-panel` |
| 폰트 | `--font-mono` (시안에 이미 있던 토큰) |

### 3.3 `@codemirror/lint` 의 하드코딩 색을 끈 방법

lint 의 `baseTheme` 은 물결 밑줄을 **색이 박힌 SVG data URI** 로 그린다
(`underline("#f11")`, 경고는 `orange`). data URI 안에는 `var()` 를 넣을 수 없다.
→ 그 배경 이미지를 끄고 **CSS `text-decoration`** 으로 바꿨다:

```ts
".cm-lintRange": { backgroundImage: "none", paddingBottom: "0" },
".cm-lintRange-error": {
  textDecoration: "underline wavy var(--color-danger)",
  textDecorationSkipInk: "none",
  textUnderlineOffset: "3px",
},
```

실측: `background-image: none` · `text-decoration-style: wavy` ·
`text-decoration-color: rgb(195, 67, 67)` == `--color-danger #c34343`. **통과.**
같은 방식으로 `.cm-diagnostic-error/-warning` 의 `border-left` 색도 토큰으로 바꿨다.

`lintGutter()` 는 **안 넣었다** — 마커가 `content: url(data:image/svg…)` 라 색을
토큰화할 방법이 없다. 대신 오류/경고 **줄 배경**을 직접 칠하는 `issueLineField`
(StateField + `Decoration.line`)를 만들어, 기존 textarea 가 하던
"오류 줄을 붉게 표시"를 더 눈에 띄게 대체했다.

### 3.4 HEX 0건 확인

```
$ grep -rnE '#[0-9a-fA-F]{3,8}\b' apps/web/src --include=*.ts --include=*.tsx | wc -l
31          # before: 30
$ grep -rn 'style={{' apps/web/src | wc -l
3           # before: 3
```

**늘어난 1건은 JSDoc 주석이다** — `theme.ts` 의
`… underline("#f11") … data URI 안에는 var() 를 넣을 수 없으므로 …`.
CodeMirror 기본값이 무엇이었고 왜 껐는지를 남긴 것으로, 기존 30건(시안 출처 표기)과
같은 성격이다. **스타일 값으로 쓰인 HEX 는 여전히 0건**이고, 색의 정의는 전부
`globals.css` 한 곳에 있다.

---

## 4. 검증 오류(diagnostics) 표시 — 실측

`validateScenarioCode()` 는 **재구현하지 않았다.** contracts 의 순수 함수 결과를
`{line, column}` → 문서 오프셋으로 옮겨 `setDiagnostics()` 에 넘기기만 한다.

`import fs from "fs"` 를 1번 줄에 넣고 실측(스크린샷 `r3-02-error.png`):

| 측정 | 결과 |
|---|---|
| 검증 목록에 `1:16` 오류 | ✅ `Node 내장 모듈은 사용할 수 없습니다. 'fs'` |
| 에디터 1번 줄에 밑줄 | ✅ **1번 줄에만** 1건 |
| 밑줄 색 | ✅ `rgb(195, 67, 67)` == `--color-danger` |
| 밑줄 모양 | ✅ `wavy` |
| lint 기본 SVG 배경 | ✅ `none` (껐다) |
| 오류 줄 배경 | ✅ `rgb(255, 240, 239)` == `--color-danger-soft` |
| 호버 툴팁 | ✅ `Node 내장 모듈은 사용할 수 없습니다. 'fs' (fs) / node_builtin`, 왼쪽 테두리 `--color-danger` |
| 저장 버튼 | ✅ 잠김 |
| 경고(`no_test`)만 있을 때 밑줄 색 | ✅ `rgb(197, 120, 20)` == `--color-warn` |
| 경고만 있을 때 저장 | ✅ **저장된다** (`hasBlockingIssues()` 가 error 만 본다) |

### ★ 구현 중 실제로 잡은 버그 (렌더 검증이 아니었으면 놓쳤다)

처음엔 "진단 지문이 같으면 dispatch 를 건너뛴다"로만 가드했다. 그런데 **문서가 바뀌면
CodeMirror 가 기존 진단 범위를 자동으로 매핑해 끌고 간다.** 1번 줄 앞에 import 를 끼워
넣고 Enter 를 치면, 매핑된 범위가 줄을 넘어가 **밑줄이 2번 줄까지 번졌다**(1차 실측에서
`.cm-lintRange-error` 2개 검출). `Text` 가 불변인 점을 이용해 **문서 참조 비교**를
가드에 더해 고쳤고, 회귀 검사를 하네스에 넣었다
("오류 밑줄이 1번 줄에만 그려진다"). 단위 테스트로도 고정했다(`diagnostics.spec.ts`).

---

## 5. textarea 가 하던 기능 체크리스트

| 기능 | 유지 | 실측 |
|---|:--:|---|
| 줄 번호 표시 | ✅ | 거터가 `1`…`11` 을 그린다 |
| `Tab` 들여쓰기(2칸) | ✅ | `const 대기…` → `  const 대기…` |
| `Shift+Tab` 내어쓰기 | ✅ | 되돌아온다 |
| `Escape` 로 포커스 탈출 | ✅ | `Tab` 포커스 트랩 회피 경로 유지 |
| 검증 오류를 줄 번호와 함께 표시 | ✅ | **밑줄 + 툴팁으로 승격** (4절) |
| 검증 목록의 `줄:열` 클릭 → 점프 | ✅ | 에디터로 포커스 이동 |
| 줄 수 · 바이트 수 헤더 | ✅ | `11줄 · 373바이트` |
| `spellCheck` 끔 | ✅ | `spellcheck="false"` |
| `aria-label="테스트 코드"` | ✅ | contentDOM 에 그대로 |
| `data-testid="code-editor"` | ✅ | contentDOM 에 그대로 (기존 셀렉터 유지) |
| 저장 중 비활성 | ✅ | Compartment 로 `editable` 재설정 + `opacity-60` |
| placeholder | ✅ | 같은 문구 · `--color-muted` |
| 높이 380–520px · 세로 리사이즈 | ✅ | `tf-code-host` 유틸로 이전 `min-h/max-h/resize-y` 재현 |
| 가로 줄바꿈 없음(`wrap="off"`) | ✅ | CodeMirror 기본(비래핑) |
| 저장 / 발행 / 실행 동작 | ✅ | 6절 |
| 첨부 UI 와 레이아웃 공존 | ✅ | 6절 |
| **추가** 구문 강조 | 🆕 | TS/JS |
| **추가** 괄호 매칭 · 현재 줄 강조 | 🆕 | |
| **추가** undo/redo · 기본 편집 키맵 | 🆕 | `@codemirror/commands` |

`index.tsx`(코드 화면)는 **한 줄도 고치지 않았다.** `CodeEditorPanel` 의 props 계약
(`value`/`onChange`/`issues`/`disabled`)이 그대로다.

---

## 6. 렌더 검증

`pnpm --filter @testflow/web build` → `vite preview`(4173) + API(4000) + Runner 실제 구동,
Playwright(로컬 설치본)로 **56건 측정 / 56 통과 / 0 실패**.
전체 측정값: `r3-editor-measurements.json`.

### computed style 실측 (토큰 대조)

| 대상 | 실측 | `@theme` 값 |
|---|---|---|
| keyword | `rgb(10, 107, 77)` | `--color-code-keyword #0a6b4d` |
| string | `rgb(138, 84, 18)` | `--color-code-string #8a5412` |
| number | `rgb(28, 108, 134)` | `--color-code-number #1c6c86` |
| comment | `rgb(110, 122, 117)` + `italic` | `--color-code-comment #6e7a75` |
| 거터 배경 | `rgb(245, 247, 246)` | `--color-table-head #f5f7f6` |
| 현재 줄 | `rgb(246, 251, 248)` | `--color-step-selected-bg #f6fbf8` |
| 오류 밑줄 | `rgb(195, 67, 67)` | `--color-danger #c34343` |
| 경고 밑줄 | `rgb(197, 120, 20)` | `--color-warn #c57814` |
| 오류 줄 배경 | `rgb(255, 240, 239)` | `--color-danger-soft #fff0ef` |
| 캐럿 | `rgb(8, 127, 91)` | `--color-brand #087f5b` |
| 폰트 | `ui-monospace, SFMono-Regular, Menlo, monospace` | `--font-mono` |

### 저장 → 실행 왕복

에디터에서 `// 왕복 "확인" · 개행 보존` 을 타이핑 → 저장 → `GET /api/scenarios/:id/code`:

- **299자 == 299자, 문자열 완전 일치.** 개행(`\n`) · 한글 · 따옴표 전부 보존.
- `\r` 없음(CRLF 로 변질되지 않는다).
- `▶ 실행` → 실행 생성 → `/runs/033df090-…` 로 이동 → **`status: passed`**.
  즉 에디터에 친 코드가 Runner 까지 그대로 가서 실행됐다.
- (참고) 처음엔 `page.goto("http://127.0.0.1:4173/")` 로 시험했는데
  `ERR_CONNECTION_REFUSED` 로 실패했다. **Runner 의 네트워크 네임스페이스에서 호스트의
  preview 포트가 안 보이는 환경 문제**이고, 에러 메시지가 에디터에 친 URL 을 그대로
  인용한 것 자체가 왕복의 증거였다. 최종 검증은 네트워크를 타지 않는
  `page.setContent(...)` 스펙으로 바꿔 **passed** 를 받았다.

### 레이아웃 · 반응형 · 접근성

| 측정 | 결과 |
|---|---|
| 데스크톱 `tf-builder` | `800px 330px` 2단 유지 · 에디터 오른쪽 끝 1061px < 첨부 패널 왼쪽 1080px (겹침 없음) |
| 1050px | 1단(`758px`) · 가로 오버플로 0 · 에디터 756×380 |
| 760px | 1단(`734px`) · 가로 오버플로 0 · 에디터 732×380 |
| `prefers-reduced-motion: reduce` | 에디터 하위 **89개 엘리먼트 전수 스캔 — 도는 애니메이션/트랜지션 0건** |
| 커서 | `.cm-cursor` 없음 = 브라우저 네이티브 캐럿. **CodeMirror 의 `cm-blink` 애니메이션 자체가 존재하지 않는다**(`drawSelection` 미채택) → 전역 reduced-motion 규율을 우회할 여지가 없다 |
| 콘솔 에러 | **7개 컨텍스트 전부 0건** (HTTP 4xx/5xx 응답도 에러로 계수) |

### 스크린샷

| 파일 | 내용 |
|---|---|
| `r3-01-highlight.png` | 데스크톱 · 구문 강조 · 첨부 패널과 2단 |
| `r3-02-error.png` | `import fs` 오류 — 물결 밑줄 · 붉은 줄 배경 · 툴팁 · 저장 잠김 |
| `r3-04-run.png` | 실행 화면 |
| `r3-05-1050.png` / `r3-05-760.png` | 반응형 |
| `r3-06-reduced-motion.png` | reduced-motion |
| `r3-07-dev-strict.png` | dev(StrictMode 이중 마운트) |

원본은 `/tmp/cm-verify/` 에도 있다(`cm-03-rundialog.png` 포함).

---

## 7. 구조 — `useEffect` 를 어디에 모았나

라운드 1·2 규율은 `useEffect` 를 자제한다. CodeMirror 는 명령형 DOM 라이브러리라
생명주기가 불가피하다. **이펙트는 `useCodeMirror.ts` 한 파일에만 있고**(4개),
컴포넌트에는 `useCodeMirror(...)` 한 줄만 남는다.

| 이펙트 | 하는 일 | 재실행 회피 |
|---|---|---|
| ① prop 상자 갱신 | 최신 `value`/`onChange`/`disabled` 를 ref 에 담는다 | 렌더 중 ref 쓰기는 `react-hooks/refs` 가 막는다 → 이펙트로 |
| ② mount | `EditorView` 생성 / cleanup 에서 `destroy()` | deps `[host]` — `onChange` 가 매 렌더 새 함수여도 에디터를 다시 만들지 않는다 |
| ③ 본문 동기화 | 바깥 값이 갈아끼워졌을 때만 문서 교체 | **현재 문서와 다를 때만** dispatch (없으면 타이핑마다 전체 교체 → 커서가 튄다) |
| ④ 진단 | `setDiagnostics` + 줄 배경 effect 를 **한 트랜잭션**으로 | 지문 + **문서 참조** 비교로 불필요한 dispatch 차단 (4절 버그) |
| ⑤ disabled | Compartment 로 `EditorView.editable` 재설정 | |

**React 19 strict mode 이중 마운트**: cleanup 이 `destroy()` 하고 holder 를 비우며,
재마운트 시 ①→②→③④⑤ 순서로 돌아 본문·진단·편집가능이 다시 밀려 들어간다
(`lastDiagnostics`/`lastDoc` 을 `null` 로 되돌려 재적용이 건너뛰어지지 않게 했다).

**dev 서버(`vite dev` 5173, StrictMode 이중 호출이 실제로 일어나는 빌드)에서 별도 실측**
— 6건 측정 / 6건 통과 (스크린샷 `/tmp/cm-verify/cm-07-dev-strict.png`):

| 측정 | 결과 |
|---|---|
| `.cm-editor` 개수 | **1** (이중 마운트로 두 벌이 남지 않는다) |
| 호스트 div 자식 수 | **1** (죽은 뷰가 DOM 에 안 남는다) |
| 본문 | 서버 값 10줄 그대로 |
| 재마운트 후 진단 | 오류 1건이 **정확히 1줄에** 다시 붙는다 (밑줄 1 · 줄 배경 1 · 목록 1) |
| 연속 타이핑 | 같은 줄에 이어진다 (커서가 끝으로 안 튄다) |
| 콘솔 에러 | **0건** |

---

## 8. 생성 · 수정 파일

**생성**

| 파일 | 내용 |
|---|---|
| `apps/web/src/features/codeEditor/theme.ts` | 테마 객체(`var()` 만) · HighlightStyle · `issueLineField` |
| `apps/web/src/features/codeEditor/useCodeMirror.ts` | 생명주기 훅 (이펙트 전부 여기) |
| `apps/web/src/features/codeEditor/CodeMirrorEditor.tsx` | **default export** — `lazy()` 번들 경계 |
| `apps/web/src/features/codeEditor/diagnostics.ts` | `{line,column}` → 오프셋 순수 변환 (DOM 비의존) |
| `apps/web/src/features/codeEditor/diagnostics.spec.ts` | 위 변환 단위 테스트 **16건** |
| `.pipeline/20260917-231945/08-code-editor.md` · `r3-*.png` · `r3-editor-measurements.json` | 이 문서와 증적 |

위치는 `features/recorder`(`useFrameRenderer` 등 명령형 DOM 훅이 이미 co-locate 돼
있다)와 같은 규약을 따랐다. **barrel(`index.ts`)을 두지 않았다** — 이름 있는 import 로
끌어 쓰는 순간 번들 경계가 무너진다.

**수정**

| 파일 | 변경 |
|---|---|
| `apps/web/src/pages/scenarios/code/CodeEditorPanel.tsx` | textarea/거터 제거 → `Suspense` + lazy 에디터. 패널 헤더·`IssueList` 는 그대로 |
| `apps/web/src/styles/globals.css` | `--color-code-*` 8개 · `@utility tf-code-host` |
| `apps/web/vite.config.ts` | `advancedChunks` vendor-react 그룹 (2.4) |
| `apps/web/package.json` · `pnpm-lock.yaml` | CodeMirror 7개 추가 |

**손대지 않은 것**: `index.tsx`(코드 화면) · `.npmrc` · `docker-compose.yml` ·
`apps/api/**` · `apps/runner/**`(소스) · `packages/contracts` · `.gitattributes`.

---

## 9. 검증 로그

| 명령 | 기준선 | 결과 |
|---|---|---|
| `pnpm install` (CodeMirror 7개) | — | ✅ 15패키지 추가 · 검역 통과 · ioredis peer 경고 1건(기존, 무관) |
| `pnpm typecheck` | 7/7 | ✅ **7 successful, 7 total** |
| `pnpm lint` | 0 problems | ✅ **7/7, 0 problems** |
| `pnpm build` | 5/5, 500KB 경고 없음 | ✅ **5/5, 경고 없음** |
| `pnpm test` | 616 | ✅ **632** (contracts 199 · runner 232 · api 129 · **web 72**(+16)) |
| Playwright 렌더 검증 (preview) | — | ✅ **56 측정 / 56 통과 / 0 실패** |
| Playwright StrictMode 검증 (dev) | — | ✅ **6 측정 / 6 통과 / 0 실패** |
| HEX grep | 30(주석) / `style={{` 3 | ✅ 31(주석) / 3 — **스타일 값 HEX 0건 유지** |

---

## 10. 미해결 · 미검증 (사실대로)

1. **에디터 청크 420KB(gzip 142KB)는 작지 않다.** 초기 로드에는 안 들어가지만
   코드 화면에서 에디터가 뜨기까지 **사내망 기준 한 번의 다운로드**가 있다.
   실제 체감(사내망 실측)은 **측정하지 않았다** — 로컬 preview 에서만 봤다.
   줄일 여지: `defaultKeymap`(−18KB)을 직접 고른 바인딩으로 줄이는 것. 지금은 안 했다.
2. **`vite.config.ts` 의 vendor 청크 고정은 웹 전체에 영향을 준다.** 초기 로드 총량과
   500KB 경고는 확인했지만, **브라우저 캐시 히트율 변화는 측정하지 않았다**(추론이다).
3. **검증 오류 밑줄의 길이는 추정이다.** `validateScenarioCode()` 가 길이를 주지 않아
   "그 열부터 **줄 끝**까지"로 잡는다. 토큰 끝이 아니라 줄 끝이라 실제보다 길 수 있다.
   contracts 가 `length` 를 주면 정확해진다 — 스키마를 건드리지 않기로 해서 안 했다.
4. **`.cm-tooltip` 등 lint 패널 UI 는 호버 툴팁만 실측했다.** lint 패널
   (`openLintPanel`)은 열 경로를 만들지 않았고 스타일도 검증하지 않았다.
5. **접근성 검사(axe 등)는 돌리지 않았다.** `aria-label` · `Escape` 탈출 · 대비
   4.5:1(계산값)까지만 확인했다. 스크린리더 실사용은 미검증.
6. **IME(한글 조합) 입력은 타이핑 시나리오에서만 확인**했다(Playwright `keyboard.type`
   은 실제 IME 조합 이벤트를 만들지 않는다). 저장된 한글이 정확한 것은 확인했지만,
   **실제 한글 IME 조합 중 CodeMirror 의 동작은 육안 검증하지 않았다.**
7. **검증 하네스는 커밋하지 않았다** — `apps/runner/node_modules/.cmverify/verify.mjs`
   와 `dev-strict.mjs` (`playwright` 를 해석하려면 그 옆에 있어야 한다). 재현이 필요하면 이 문서의 측정
   항목표가 그대로 명세다. 측정값 JSON 과 스크린샷은 `.pipeline/.../r3-*` 에 있다.
8. **검증용 시나리오를 로컬 DB 에 하나 남겼다** — `[에디터검증] CodeMirror 라운드3`
   (`c00926b0-…`). 로컬 개발 DB 라 지우지 않았다.
