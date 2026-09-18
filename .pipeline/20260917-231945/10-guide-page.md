# 10 · 가이드 화면 (`/guide`) — `docs/AI로-테스트코드-만들기.md` 를 앱 안으로

브랜치 `feat/guide-page` (from `main` `02c5180`) · 커밋 `c07a709` · **push 안 함**

> ⚠️ **작업 격리** — 다른 에이전트가 `apps/web/src/pages/runs/**` 를 **같은 작업 트리에서**
> 고치고 있었다(`git worktree list` 기준 워크트리가 하나뿐이었고, `globals.css` 를 포함해
> 7개 파일이 uncommitted 상태였다). 같은 디렉터리에서 `git checkout -b` 하면 HEAD 가 공유돼
> 서로의 작업을 덮어쓴다. 그래서 **별도 워크트리**를 떠서 작업했다.
>
> ```
> git worktree add -b feat/guide-page ../testflow-guide 02c5180
> ```
>
> 리베이스·PR 후 `git worktree remove ../testflow-guide` 로 정리하면 된다.
> 이 디렉터리에는 `pnpm install` 이 따로 돼 있다(root store 재사용, 1분 10초).

---

## 1. 라우트·사이드바 배치 결정과 근거

| 항목 | 결정 |
|---|---|
| 경로 | `/guide` |
| 코드 분할 | **`React.lazy` 유지** — `routes.tsx` 의 다른 8개와 같은 방식 |
| 사이드바 | **`HELP` 그룹 신설**, 항목 1개 (`? 가이드`) |
| 브레드크럼 | `프로젝트명 / 가이드` (자동) |

### 왜 `MANAGE` 가 아니라 새 그룹인가

`MANAGE` 의 4개는 전부 **프로젝트의 무엇인가를 바꾸는 화면**이다(스위트·실행 환경·테스트
데이터·프로젝트 설정). 읽기 전용 문서가 그 사이에 끼면 두 가지가 깨진다.

1. **의미** — "가이드도 설정하는 것"으로 읽힌다.
2. **더 나쁜 것** — 그 그룹의 4개 중 **3개가 MVP 제외라 `opacity-40` 으로 흐려져 있다.**
   그 옆에 새 항목을 붙이면 흐린 항목들과 한 덩어리로 보여 **같이 미구현처럼** 읽힌다.

시안의 그룹 **구조**(대문자 라벨 + 항목 목록)는 그대로 따르고, 시안이 정의한 두 그룹
(`WORKSPACE` 4개 / `MANAGE` 4개)은 **한 글자도 건드리지 않았다.** 도움말은 성격이 달라
하단 별도 그룹이 자연스럽다. 사이드바 `nav` 가 `overflow-y-auto` 라 그룹이 하나 늘어도
아래 사용자 정보 블록(`mt-auto`)이 밀리지 않는다 — 1440·1050·760 스크린샷으로 확인했다.

### 브레드크럼은 손대지 않았다

`PAGE_TITLES` 가 `NAV_GROUPS` 에서 파생된다(`navigation.ts`). 메뉴 항목을 넣는 것만으로
`usePageTitle()` → `Breadcrumb` 가 `법무 통합 포털 / 가이드` 를 그린다. **별도 코드 0줄.**
렌더 검증에서 문자열 완전 일치로 확인했다.

### 탑바 `? 사용 안내` 버튼은 **넣지 않았다**

`AppShellRoute.tsx` 주석에 "시안 `.top-actions` 는 `? 사용 안내` / `＋ 새 시나리오` 2개"
라고 적혀 있어 후보였지만, 두 가지 이유로 뺐다.

- `AppShellRoute.tsx` 는 이번 작업에 **필수가 아닌** 공용 파일이다. 병행 작업 중이라
  리베이스 충돌 면적을 늘릴 이유가 없다.
- 진입 경로가 사이드바에 이미 상시 노출된다. 탑바 버튼은 **중복 진입점**이다.

필요하면 `AppShellRoute` 의 `topActions` 에 `<Button asChild><Link to="/guide">` 한 줄을
더하면 된다 — 지금 구조에서 그게 전부다.

---

## 2. 원본 마크다운과의 관계 — 단일 출처 전략

### 결론: **md 가 단일 출처로 남고, 화면은 "테스트로 묶인 사본"이다.**

md 를 지우고 화면을 유일 출처로 삼는 선택지도 있었지만 버렸다. 문서는 **앱을 못 여는
상황에서도 읽혀야** 한다(레포 클론·PR 리뷰·사내 위키 붙여넣기). 반대로 사본을 두면
언젠가 반드시 갈라진다 — "사람이 기억하기"에 맡기는 대신 **깨지는 테스트**로 바꿨다.

### 어떻게 대조가 가능한가

`content.ts` 는 문장을 **원본 md 문법 그대로** 담는다.

```ts
{ kind: "p", text: "TestFlow는 **표준 Playwright 코드**를 실행합니다. ..." }
```

`**` 를 `<strong>` 으로 바꿔 쓰는 순간 대조가 불가능해지므로 **일부러** 마크다운을 남긴다.
인라인 서식은 `InlineMd` 가 런타임에 해석한다 — 규칙 3개(`**굵게**` `*기울임*` `` `코드` ``),
정규식 1개. 블록 구조(제목·표·리스트·코드 블록)는 TSX 가 그린다.

### `content.spec.ts` — 원본 md 를 `?raw` 로 읽어 대조

| 검사 | 결과 |
|---|---|
| H1 일치 | ✅ |
| `##` 절 제목 6개 — 문자열·**순서**까지 | ✅ |
| `###` 소절 제목 6개 — 문자열·순서까지 | ✅ |
| **★ AI 프롬프트 전문 (876자) 완전 일치** | ✅ |
| ` ```ts ` 코드 블록 6개 — 순서까지 배열 비교 | ✅ |
| 화면이 그리는 코드 블록 집합 = md 코드 블록 집합 | ✅ |
| 표 3개의 **모든 줄**(머리 + 본문 15행) | ✅ |
| **본문 산문 전 줄**이 화면 데이터에 그대로 존재 | ✅ |
| 앵커 id 중복 없음 · `^[a-z][a-z0-9-]*$` | ✅ |
| md 에 `InlineMd` 가 모르는 문법(링크·이미지)이 없음 | ✅ |

마지막 항목이 **회귀 방지의 핵심**이다. 원본에 마크다운 링크가 새로 들어오면 화면에는
`[텍스트](url)` 이 날것으로 노출되는데, 그 전에 테스트가 먼저 깨진다.

프롬프트 블록은 TS 템플릿 리터럴이라 백틱 6개와 `${key}` 를 이스케이프해야 했다 —
사람이 반드시 틀리는 자리다. **글자 단위 비교**가 그걸 잡는다.

### 화면에도 출처를 적었다

본문 맨 아래:

> 이 화면의 원본 문서는 레포지토리의 `docs/AI로-테스트코드-만들기.md` 입니다.
> 내용을 고칠 때는 그 파일을 먼저 고치세요 — 두 곳이 어긋나면 테스트가 실패합니다.

---

## 3. ★ 복사 버튼 — HTTP(비 secure context) 폴백 **실측**

### 문제

`navigator.clipboard` 는 **secure context(HTTPS 또는 `localhost`)에서만 존재**한다.
배포는 `http://61.98.69.147` — **평문 HTTP + IP** 라 크롬에서 `navigator.clipboard` 가
아예 `undefined` 다. 그런데 개발 PC 의 `http://localhost:4173` 은 **예외적으로 secure
context 로 취급**되므로 **로컬에서만 확인하면 이 버그를 절대 만나지 못한다.**

### 구현 (`pages/guide/clipboard.ts`) — 3단

```
1) navigator.clipboard.writeText        → "clipboard-api"   (HTTPS · localhost)
2) 화면 밖 <textarea> + execCommand('copy') → "exec-command" (평문 HTTP)
3) 둘 다 실패                             → "manual"        (danger 토스트로 안내)
```

- 2)는 **사용자 제스처 안에서 동기로** 실행돼야 한다. `hasClipboardApi()` 가 `false` 면
  `copyText()` 는 `await` 을 한 번도 타지 않고 동기로 2)로 내려간다.
- `textarea` 는 `display:none`/`visibility:hidden` 이면 **선택이 안 돼 빈 문자열이 복사된다.**
  그래서 `position:fixed; left:-9999px` 로 화면 밖에 둔다.
- 스타일 값을 `element.style.*` 로 쓰지 않기 위해 `globals.css` 에
  `@utility tf-offscreen` 을 **한 개** 추가했다(레포 규율: 스타일은 CSS 에만).

### 실측 — `http://172.22.87.132:4175` (LAN IP, 평문 HTTP)

`http://localhost` 는 secure context 라 의미가 없다. **LAN IP 로 실제 비-secure 환경을
만들어** 확인했다.

| 측정 | 값 |
|---|---|
| `window.isSecureContext` | **`false`** ← 진짜 비-secure 임을 먼저 증명 |
| `typeof navigator.clipboard` | **`undefined`** ← 1번 경로가 없다는 실증 |
| 버튼 상태 | `✓ 복사됨` (폴백 성공) |
| 토스트 | `복사됨 클립보드에 복사했습니다 — AI 대화 맨 앞에 붙여넣을 프롬프트` |
| **실제 클립보드 내용** | **프롬프트 전문 876자 — 원본 md 와 완전 일치** |
| 콘솔 에러 | 0건 |

"실제 클립보드 내용"은 버튼 상태로 추정한 것이 **아니다.** 복사 후 페이지에 `textarea` 를
심고 `Ctrl+V` 로 **되붙여** 문자열을 읽었고, 그 문자열을 `docs/*.md` 에서 다시 파싱한
프롬프트 전문과 `===` 비교했다.

secure context(localhost) 쪽도 같은 방식으로 `navigator.clipboard.readText()` 결과가
876자 완전 일치함을 확인했다.

### 복사 버튼을 **2개만** 붙인 이유

문서의 코드 블록은 7개(프롬프트 1 + `ts` 6)다. 그중 **4개는 `// ❌` 가 섞인 대조 예시**다.
거기에 복사 버튼을 붙이면 "하지 말라고 적어 둔 코드"를 한 번의 클릭으로 가져가게 된다.

| 블록 | 복사 버튼 |
|---|---|
| AI 프롬프트 | ✅ (이 문서의 핵심 산출물) |
| 환경변수 전체 예시 (`4. 값을 코드에 박지 마세요`) | ✅ (붙여넣어 바로 도는 완결된 테스트) |
| import ✅/❌ · URL ✅/❌ · locator 우선순위 · `.nth(1)` · 업로드 ✅/❌ | ❌ |

버튼 없는 블록도 드래그 선택은 항상 된다.

---

## 4. 마크다운 렌더러를 넣지 않았다

`react-markdown`(+`remark-gfm`)은 gzip 60KB 대다. 이 화면 하나 때문에 그걸 받는 것은
라운드 3 이 세운 전제를 깨는 일이다. 대신:

- 블록 구조는 **TSX**. 복사 버튼·앵커 id·표 스타일·코드 강조를 전부 제어할 수 있다.
- 인라인 서식만 `InlineMd`(정규식 1개, 62줄).
- 구문 강조는 `highlight.ts` — 규칙 4개(문자열·주석·숫자·키워드) **순수 함수**, 93줄.
  색은 08-code-editor 가 만든 `--color-code-*` 토큰 재사용, **신규 색 0개**.
  가장 중요한 성질은 **무손실**이다(토큰을 이으면 언제나 입력과 동일) — `highlight.spec.ts`
  가 문서의 코드 블록 6개 전부로 고정한다. 복사는 토큰이 아니라 **원본 문자열**을 복사하므로
  강조가 틀려도 복사 내용은 영향받지 않는다.

CodeMirror(420KB 청크)는 쓰지 않았다 — 가이드는 제일 가벼워야 하는 화면이다.

---

## 5. 원본 md 대조 결과

### 자동 비교

- `content.spec.ts` **10건** — 위 2절 표 (빌드 파이프라인에 들어간다, 회귀 시 CI 실패)
- 렌더 검증 하네스에서 **DOM 기준으로 한 번 더** — 실제 렌더된 `h2` 6개 / `h3` 6개 텍스트를
  md 에서 다시 파싱한 제목 배열과 `JSON.stringify` 비교

### 문장 수정: **0건**

원본의 수치·식별자를 코드와 대조했고 **전부 일치**했다. 고칠 오탈자·불일치가 없었다.

| 문서의 주장 | 코드 근거 | 일치 |
|---|---|---|
| 코드 본문 **256KB** | `MAX_SCENARIO_CODE_BYTES = 256 * 1024` (`contracts/scenario.ts:225`) | ✅ |
| 첨부 **개당 10MB** | `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024` | ✅ |
| **시나리오당 20개** | `MAX_ATTACHMENTS_PER_SCENARIO = 20` | ✅ |
| **합계 50MB** | `MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024` (`attachment.ts:91`) | ✅ |
| 파일명 `[A-Za-z0-9._-]` + `.spec.ts` | `ScenarioCodeFilenameSchema` / `codegen.ts:314` | ✅ |
| 변수 접두사 `TESTFLOW_VAR_` | `CODEGEN_VAR_ENV_PREFIX` (`codegen.ts:66`) | ✅ |
| 「계정」=`username`, 「비밀번호」=`password` | `RunDialog.tsx:86-87` | ✅ |
| 「테스트 데이터 (첨부파일)」 | `AttachmentsField.tsx:69` — 문자열 완전 일치 | ✅ |

### 화면에서 **추가**한 문자열 (원본에 없는 UI 크롬)

내용을 새로 쓰지 않는다는 원칙에 따라 아래 4개가 전부다.

1. 코드 블록 머리 캡션 2개 — `AI 대화 맨 앞에 붙여넣을 프롬프트`, `환경변수로 받는 전체 예시`
2. 복사 버튼 라벨·토스트 문구
3. 목차 제목 `목차`
4. 본문 하단의 원본 문서 경로 안내 1문장

`PageHead` 의 `description` 은 **일부러 비웠다** — 거기에 요약을 쓰면 바로 아래 원본 첫
문장과 같은 말이 두 번 나오고, 그 요약이 **원본에 없는 새 문장**이 된다.

---

## 6. 번들 before / after

같은 워크트리에서 `pnpm build` 를 두 번 돌려 `dist` 를 바이트로 쟀다.

### 초기 로드 (index.html + CSS + vendor-react + entry)

| 청크 | before | after | 증감 |
|---|---|---|---|
| `index.html` | 551 | 551 | 0 |
| `assets/index-*.css` | 40,700 | 43,372 | **+2,672** |
| `assets/vendor-react-*.js` | 218,828 | 218,828 | 0 |
| `assets/index-*.js` (entry) | 304,426 | 304,737 | **+311** |
| **합계** | **564,505 B** | **567,488 B** | **+2,983 B (+0.53%)** |

### 지연 청크

| 청크 | before | after |
|---|---|---|
| `assets/guide-*.js` | — | **21,634 B (gzip 8.61 kB)** |
| `CodeMirrorEditor-*.js` | 420,540 | 420,540 (동일) |
| `RunDetail` · `builder` · `code` · `scenarios` · `suites` · `dashboard` · `runs` 등 | 변화 없음 | 변화 없음 |

- **가이드 본문은 초기 로드에 1바이트도 들어가지 않는다.** 기존 청크는 해시만 바뀌고
  크기는 전부 동일하다.
- entry `+311 B` 는 라우트 등록 + `lazy()` 래퍼 + 사이드바 메뉴 1줄이다.
- CSS `+2,672 B`(raw) / **+0.47 kB(gzip)** 은 **정직하게 늘어난 부분**이다. CSS 는 단일
  파일이라 화면별로 쪼갤 수 없다. 새 화면이 쓰는 유틸(간격·크기 조합)만큼 늘었고,
  **새 색 토큰은 0개**다(`--color-code-*`·notice·table 토큰 전부 재사용).
- `vite build` **"Some chunks are larger than 500 kB" 경고 없음** (before/after 모두).
  `advancedChunks option is deprecated` 경고는 `vite.config.ts` 에서 오는 **기존** 경고이고
  이번 변경과 무관하다(해당 파일 미수정).

---

## 7. 렌더 검증

하네스: `apps/runner/node_modules/.guideverify/verify.mjs` (라운드 2·3 과 같은 방식 —
`playwright` 해석을 위해 `node_modules` 옆에 두고 **커밋하지 않는다**).
`vite preview --host 0.0.0.0 --port 4175` + `page.route('**/api/**')` 스텁.

### **측정 33건 / 통과 33 / 실패 0**

| 그룹 | 항목 |
|---|---|
| 진입 | 사이드바 `HELP > 가이드` 존재 · 클릭 → `/guide` · active 표시 · 브레드크럼 `법무 통합 포털 / 가이드` 완전 일치 |
| 내용 | 렌더된 `h2` 6개 · `h3` 6개가 원본 md 와 배열 일치 |
| **목차 앵커** | 링크 12개(절 6 + 소절 6) **전부** — `location.hash` 갱신 + 해당 제목이 **탑바(68px) 아래 64~120px** 로 정확히 보정돼 정지. 마지막 두 절은 문서 끝이라 더 스크롤할 것이 없어 화면 안 가시성으로 판정 |
| **복사(secure)** | `navigator.clipboard.readText()` = **프롬프트 876자 완전 일치** · 버튼 `✓ 복사됨` · 토스트 |
| **복사(HTTP)** | `isSecureContext:false` · `navigator.clipboard:undefined` · **Ctrl+V 되붙이기 876자 완전 일치** · 폴백 토스트 |
| 가로 넘침 | 1440 / 1200 / 1050 / 900 / 760 / 480 / 360 **7개 폭 전부** `body.scrollWidth === clientWidth` (초과 0px) |
| 스크롤 봉쇄 | 코드 블록 7개 전부 `overflow-x:auto` · 표 래퍼 3개 전부 `overflow-x:auto` · 360px 에서 표 3/3 이 **상자 안에서만** 스크롤 |
| 반응형 | 1050px 이하 목차가 본문 **위로** 이동 + `position:static` / 1051px 이상 `sticky` |
| 접근성 | `prefers-reduced-motion: reduce` → `transition-duration:0s`, `scroll-behavior:auto` |
| 콘솔 | secure · reduced-motion · 비-secure **3개 컨텍스트 전부 에러 0건** |

### 산출물

```
.pipeline/20260917-231945/r3-guide-1440.png            전체 (데스크톱)
.pipeline/20260917-231945/r3-guide-1050.png            브레이크포인트 1050
.pipeline/20260917-231945/r3-guide-760.png             브레이크포인트 760
.pipeline/20260917-231945/r3-guide-notice.png          amber notice + ✅/❌ 코드 강조
.pipeline/20260917-231945/r3-guide-code.png            환경변수 전체 예시 + 복사 버튼
.pipeline/20260917-231945/r3-guide-tables.png          중첩 표 + 자주 겪는 문제
.pipeline/20260917-231945/r3-guide-http-copy.png       ★ 평문 HTTP 복사 성공 순간
.pipeline/20260917-231945/r3-guide-reduced-motion.png  reduced-motion
.pipeline/20260917-231945/r3-guide-measurements.json   33건 원본 측정값
```

---

## 8. ★ 수정한 공용 파일 (리베이스 대비)

병행 작업(`feat/live-view-large`)과 겹칠 수 있는 파일은 **3개**이고, 전부 **추가만** 했다.
삭제·이동·기존 줄 수정은 `routes.tsx` 주석 1줄 외에 없다.

| 파일 | 변경 | 충돌 위험 |
|---|---|---|
| `apps/web/src/styles/globals.css` | **+25줄, -0줄.** `@utility tf-inspector-sticky` **바로 뒤**에 `@utility tf-offscreen` 블록 1개 추가. 토큰(`@theme static`)은 **건드리지 않음** | **낮음** — 상대 작업은 `@theme static` 안(L1 토큰 2개)과 `tf-code-host` **앞**(`tf-live-*` 3개)에 넣었다. 서로 다른 위치다 |
| `apps/web/src/routes/routes.tsx` | **+10줄, -1줄.** ① 파일 머리 주석 1줄 문구 수정 ② `SuitesPage` 뒤에 `GuidePage` lazy 선언 ③ `suites/:suiteId` 뒤에 라우트 1줄 | **낮음** — 상대는 `pages/runs/**` 작업이라 `RunScreen` 이 새 라우트로 들어오면 ②③ 근처가 겹칠 수 있다. 둘 다 "줄 추가"라 자동 병합될 가능성이 높다 |
| `apps/web/src/components/layout/Sidebar/navigation.ts` | **+16줄, -0줄.** `NAV_GROUPS` 배열 **끝**에 `HELP` 그룹 추가. `WORKSPACE`·`MANAGE` 미수정. `PAGE_TITLES` 로직 미수정 | **매우 낮음** |

**`apps/web/src/pages/runs/**` 는 읽지도 쓰지도 않았다.**
`docker-compose.yml` · `packages/db/src/cli/guard.ts` · `.gitattributes` · `.npmrc` ·
`apps/api/**` · `apps/runner/**`(소스) · `packages/contracts` 전부 무수정.
`docs/AI로-테스트코드-만들기.md` 도 무수정(고칠 것이 없었다).

### 생성한 파일 (9개, 전부 신규 폴더 `apps/web/src/pages/guide/`)

| 파일 | 줄 | 역할 |
|---|---|---|
| `content.ts` | 402 | 본문 데이터(원본 md 문법 그대로) + `AI_PROMPT` |
| `GuidePage.tsx` | 308 | 블록 렌더러 · 목차 · 표 · notice |
| `content.spec.ts` | 192 | ★ 원본 md 대조 10건 |
| `CodeBlock.tsx` | 122 | 코드 블록 + 복사 버튼 |
| `highlight.ts` | 93 | 구문 강조 토크나이저(순수 함수) |
| `clipboard.ts` | 83 | ★ 복사 3단 폴백 |
| `InlineMd.tsx` | 62 | 인라인 마크다운 3종 |
| `highlight.spec.ts` | 51 | 토크나이저 무손실 6건 |
| `index.ts` | 1 | barrel |

---

## 9. 기준선 비교

| 게이트 | 기준선 | 이번 | 판정 |
|---|---|---|---|
| `pnpm typecheck` | 7/7 | **7/7** | ✅ |
| `pnpm lint` | 0 problems | **0 problems** (7/7 successful) | ✅ |
| `pnpm build` | 5/5, 500KB 경고 없음 | **5/5, 500KB 경고 없음** | ✅ |
| `pnpm test` | 632건 | **648건** (contracts 199 · runner 232 · api 129 · web 88) | ✅ +16 |
| 초기 로드 번들 | 564,505 B | 567,488 B (**+2,983 B**, CSS 증가분) | ⚠️ 위 6절 |
| `apps/web/src` HEX 리터럴 | 0건(스타일 값) | **0건** | ✅ |
| `style={{` | 3건 | **3건** (신규 0) | ✅ |
| `useEffect` 신규 | — | **0개** (복사 상태는 `useState` 하나) | ✅ |
| 신규 런타임 의존성 | — | **0개** | ✅ |
| `prefers-reduced-motion` | 유지 | 유지 (실측) | ✅ |

web 테스트 72 → 88 (+16: `content.spec.ts` 10 + `highlight.spec.ts` 6).

---

## 10. 미검증 · 남은 것

1. **실제 배포 호스트(`http://61.98.69.147`)에서는 못 돌렸다.** 같은 조건(평문 HTTP +
   IP 주소 + 비-secure context)을 LAN IP 로 재현해 검증했다. `isSecureContext:false` 와
   `navigator.clipboard === undefined` 를 직접 확인했으므로 조건은 동일하다. 다만 사내
   프록시/CSP 가 끼면 결과가 달라질 수 있다 — **배포 후 한 번은 눌러 볼 것.**
2. **크롬(Playwright chromium) 외 브라우저 미검증.** `execCommand('copy')` 는 파이어폭스·
   사파리에서도 동작하지만 실측하지 않았다. 실패해도 3단(안내 토스트)으로 떨어진다.
3. **✅/❌ 이모지 폰트** — 헤드리스 리눅스 스크린샷에서는 이모지 폰트가 없어 `▯`/`×` 로
   찍힌다. 코드가 아니라 **스크린샷 환경**의 문제다(윈도우 크롬에서는 정상). 문자 자체는
   원본 md 에서 그대로 온 것이고 `content.spec.ts` 가 일치를 보장한다.
4. **구문 강조는 규칙 4개짜리다.** 여러 줄 주석(`/* */`)·정규식 리터럴·JSX 는 다루지
   않는다. 현재 문서의 코드 6개에 하나도 없어서 넣지 않았다. 예시가 늘면 그때 넓힌다.
5. **접근성 자동 감사(axe 등)는 돌리지 않았다.** 의미 태그(`nav`/`article`/`section`/
   `dl`/`table` + `scope="col"`)와 빈 머리칸 `sr-only` 대체 텍스트는 수동 확인만 했다.
6. **워크트리 정리** — `../testflow-guide` 는 PR 병합 후 `git worktree remove` 필요.
