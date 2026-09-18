# Gen-Phase 15 · 브랜드 아이덴티티 — 로고와 파비콘

TestFlow 의 로고 마크와 파비콘을 만들어 제품에 넣었다.
증적 스크린샷은 모두 `assets/15-brand/` 아래에 있다.

---

## 1. 디자인 판단과 근거

### 제품에서 끌어낸 것

TestFlow 는 **녹화 → 편집 → 실행 → 지켜보기**다.
정체성은 두 단어에 있다 — **흐름(flow)** 과 **지켜봄(watch)**.
쓰는 사람은 법무 담당자 같은 비개발자라, 개발자 도구처럼 날카롭기보다 **차분하고 신뢰감 있는** 쪽이 맞다.

경쟁 인접 제품(Playwright·Cypress)이 이미 초록을 쓴다. 팔레트는 시안에서 확정된 것이라 바꾸지 않았고,
**초록 안에서의 차별점은 색이 아니라 형태**에서 찾기로 했다.

### 글자(TF) 인가 도형인가 — 렌더로 결정했다

말로 고르지 않고 **후보를 전부 그려 16px 로 래스터해서 눈으로 봤다.**
`assets/15-brand/explore-round4-realpixel.png` 의 `TF_old` 열이 결론이다.

> **"TF" 두 글자는 16px 에서 검은 얼룩이 된다.** T 의 가로획과 F 의 두 팔이 1px 씩으로 뭉개져
> 글자 사이 흰 틈이 사라진다. 이름을 인지시키려던 목적 자체가 그 크기에서 소멸한다.

→ **도형 마크로 간다.** 이름 인지는 옆의 워드마크("TestFlow")가 사이드바에서 이미 해 주고 있고,
파비콘에는 애초에 워드마크가 들어갈 자리가 없다.

### 고른 형태 — 「지켜보는 흐름」

세 요소가 하나의 획으로 이어진다.

| 요소 | 형태 | 의미 |
|---|---|---|
| 둥근 타일 | 반경 9.6/32 (= `radius-chip 9px @30px`) | 실행을 **지켜보는 화면**(뷰포트) |
| 오른쪽으로 오르는 계단 | 2단 스텝 경로, 굵기 5/32, 둥근 캡 | 테스트 **스텝이 흘러가는 경로** |
| 경로 끝의 뚫린 원 | 채운 원 + 가운데 구멍 | 지금 실행 중인 스텝 = **라이브 인디케이터** |

**두 개념이 한 형태에서 겹친다.** 경로와 링은 끊기지 않고 이어져 하나의 획으로 읽힌다 —
흐름이 흘러가서 "지금 보고 있는 지점"에 도착한다. 재생 삼각형이나 체크마크를 쓰지 않았다.

방향을 **올라가는 쪽**으로 잡은 것도 판단이다. 내려가는 계단(`H_desc`)도 그려 봤는데
**하락·실패로 읽힌다.** 테스트가 통과하는 제품에서 쓸 수 없는 정서다.

### 버린 안들 (`explore-round1-concepts.png`, `round2`, `round3`)

| 안 | 버린 이유 |
|---|---|
| **TF 글자 유지** | 16px 에서 판독 불가 (위 참조) |
| **눈(lens/eye)** | 16px 판독성은 최고였다. 그러나 **감시(surveillance) 정서**가 붙고, 눈 파비콘은 이미 흔하다 |
| **얇은 선 + 위성 점** (`round1 step`·`bars`) | 16px 에서 전부 뭉갠다. 라운드1의 핵심 학습 |
| **링 + 재생 삼각형** (`round1 ring`) | 16px 판독은 됐지만 **유튜브 재생 버튼**이라 변별력 0 |
| **이중 셰브런 `»`** (`round2 tilechev`) | 읽히긴 하나 "빨리감기"라 뻔하고, 형태가 하나 더 많다 |
| **브라우저 바를 그린 타일** (`round3 D_bar`) | 16px 에서 바가 **취소선 얼룩**이 된다 |
| **3단 계단** (`round3 E_three`) | 16px 에서 지그재그 덩어리로 뭉갠다 |
| **경로 끝 눈** (`round5 F_eyehead`) | 동공이 사라져 잎사귀처럼 보인다 |
| **경로 + 작은 점** (`round5 G_dotstep`) | 점이 **렌더 먼지**처럼 보인다 |

### 색: 왜 `logo-mark` 스킨인가

`mint/ink`(`#49c493` 타일 + `#10201b` 글리프)와 `brand/mint`(`#087f5b` 타일 + 민트 글리프)를
나란히 렌더해 비교했다(`explore-round3-tile-variants.png` 아래 절반).
**`brand/mint` 는 작은 크기에서 눈에 띄게 탁하다** — 진한 초록 위의 민트는 명도차가 부족하다.
→ 기존 토큰 `logo-mark` / `logo-mark-ink` 를 그대로 쓴다. **새 색 토큰을 만들지 않았다.**

### ★ 타일을 유지한 결정 — 파비콘 대비의 핵심

민트(`#49c493`)를 흰 배경에 그냥 올리면 대비가 **약 2:1** 이라 밝은 탭에서 씻겨 나간다.
**타일이 자기 배경을 들고 다니기 때문에**, 글리프 대비(민트↔잉크)가 탭 배경과 무관하게 고정된다.
밝은 탭·어두운 탭 양쪽에서 똑같이 읽히는 이유가 이것이다(`favicon-in-tab.png` 상단 두 줄).
기존 사이드바 칩과 형태가 이어져 **리브랜딩이 단절이 아니라 연속**으로 보이는 이득도 있다.

---

## 2. ★ 16px 에서의 판독성

**5 라운드에 걸쳐 단순화했다.** 라운드 4·5 는 16/24/32/48 로 **실제 래스터**한 뒤
9배 nearest-neighbour 로 확대해 픽셀 단위로 봤다(브라우저 스케일러가 개입하지 않게 각 크기를 직접 렌더).

| 라운드 | 스크린샷 | 배운 것 |
|---|---|---|
| 1 | `explore-round1-concepts.png` | 6개 개념 · **얇은 획과 위성 점은 16px 에서 전멸.** 살아남은 건 큰 여백(counter)을 가진 꽉 찬 실루엣뿐 |
| 2 | `explore-round2-solid-forms.png` | 「꽉 찬 형태 + 큰 구멍」만 6개 · **타일에 글리프를 뚫는 방식**이 배경 무관하게 대비를 지킨다는 걸 확인 |
| 3 | `explore-round3-tile-variants.png` | 계단 변형 8개 · 바·3단·하강안 탈락. 스킨 비교로 `mint/ink` 확정 |
| 4 | `explore-round4-realpixel.png` | **실제 픽셀 검증** · `TF` 탈락 확정, 링의 구멍이 16px 에서 살아남는 것 확인 |
| 5 | `explore-round5-final.png` | 최종 6안 미세조정 · `D_halo` 채택 |

**최종 판독성** (`favicon-in-tab.png` 3번째 줄, 16px 실제 픽셀 9배 확대):

- 16px 에서 **계단 2단과 링의 구멍이 모두 분리되어 보인다.** 뭉개지지 않는다
- 밝은 탭(`#dee1e6`) · 어두운 탭(`#202124`) · 흰 배경 셋 다 확인 — 타일 덕에 글리프 대비가 동일하다
- 획 굵기는 5/32 로 확정했다. 6/32(`F_bold`)는 16px 에서 **모서리 안쪽이 메워진다**

**16px 이 뭉개지지 않게 한 결정적 조치**: 16·32·48 PNG 를 **각각 그 크기로 직접 렌더**했다.
32px 을 16px 로 축소하면 링의 2px 구멍이 회색으로 흐려진다.

---

## 3. 산출 형식 결정과 근거

| 파일 | 크기 | 왜 |
|---|---|---|
| `favicon.svg` | 1,652 B | 모던 브라우저의 주 경로. 벡터라 어떤 크기에서도 선명하다 |
| `favicon.ico` | 2,899 B | **16·32·48 PNG 를 담은 멀티사이즈 ico.** 구형 폴백 |
| `apple-touch-icon.png` | 2,321 B | 180×180. iOS 홈 화면 |
| **합계** | **6.7 KB** | |

- **`.ico` 를 PNG 폴백으로 대체하지 않고 진짜로 만들었다.** ICO 는 Vista 부터 엔트리에 PNG 스트림을
  그대로 담을 수 있어서, BMP 재인코딩 없이 **Node `Buffer` 조립만으로** 멀티사이즈 ico 가 만들어진다
  (`generate-icons.mjs` 의 `buildIco`). 도구를 안 깔고도 되므로 굳이 폴백으로 낮출 이유가 없었다.
  `file(1)` 검증: `MS Windows icon resource - 3 icons, 16x16 ... 32x32 ...`
- **웹 앱 매니페스트는 만들지 않았다.** 지금 PWA 가 아니다 — 설치·오프라인·standalone 요구가 없는데
  `manifest.webmanifest` 를 넣으면 브라우저가 설치 가능 앱으로 오인할 여지만 생긴다. 불필요.
- **`theme-color` 도 넣지 않았다.** 모바일 주소창 색을 브랜드로 강제하는 이득보다 부작용이 크다.
- **낱장 `favicon-16.png`/`favicon-32.png` 를 `public/` 에 두지 않았다.** 같은 바이트가 `.ico` 안에
  이미 있고, `index.html` 이 참조하지 않는 파일은 빌드에 실리는 죽은 무게다.
  눈으로 볼 사본만 증적 폴더에 남겼다.

### `index.html` link 순서

```html
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

`rel="icon"` 이 여러 개면 **뒤에 오는 것이 이긴다.** 그래서 svg 를 ico 뒤에 뒀다.
`sizes="any"` 는 svg 가 벡터임을 알려 래스터보다 우선하게 한다.

---

## 4. PNG 를 어떻게 뽑았는가 (도구 추가 없이)

**새 의존성을 하나도 설치하지 않았다.** `sharp`·`svgexport`·`to-ico` 전부 안 썼다.

- **PNG**: 레포에 이미 있는 **Playwright(Chromium)** 로 SVG 를 렌더해 스크린샷으로 뽑았다.
  `deviceScaleFactor: 1` + 뷰포트를 최종 크기로 맞춰 **축소 없이 네이티브 렌더**한다.
  `omitBackground: true` 로 투명 배경을 유지한다.
- **`.ico`**: Node `Buffer` 로 ICONDIR(6B) + ICONDIRENTRY(16B×3) + PNG 3장을 직접 조립했다.
- playwright 해석 경로: pnpm 이 패키지별로 `node_modules` 를 격리하므로, 실제로 playwright 를
  의존하는 `apps/runner` 기준으로 `createRequire` 해석한다. **읽기만 하고 `apps/runner` 는 건드리지 않았다.**

생성기: `assets/15-brand/generate-icons.mjs` (앱이 아니라 증적 폴더에 둬서 런타임/빌드에 섞이지 않는다)

```
node .pipeline/20260917-231945/assets/15-brand/generate-icons.mjs
```

---

## 5. `public/` 정적 파일의 HEX ↔ 토큰 대조표

`public/` 은 CSS 변수를 쓸 수 없어 HEX 를 직접 적는다. **전부 시안 팔레트와 1:1 이다.**

| 파일 | HEX | 대응 토큰 (`globals.css @theme static`) | 일치 |
|---|---|---|---|
| `favicon.svg` | `#49c493` | `--color-logo-mark` | ✅ |
| `favicon.svg` | `#10201b` | `--color-logo-mark-ink` | ✅ |
| `apple-touch-icon.png` (생성기) | `#49c493` | `--color-logo-mark` | ✅ |
| `apple-touch-icon.png` (생성기) | `#10201b` | `--color-logo-mark-ink` | ✅ |

**새 색 토큰을 만들지 않았다.** 기존 두 토큰만 쓴다.
두 파일 모두 주석에 "토큰을 바꾸면 여기도 바꿔야 한다"를 적어 두었다.

### ⚠️ 렌더 검증에서 실제로 잡은 버그

첫 `favicon.svg` 는 **브라우저에서 아예 렌더되지 않았다.** 탭 스크린샷의 svg 열이
전부 깨진 이미지 아이콘으로 나와서 발견했다.

> 원인: 주석 안에 `--color-logo-mark` 라고 적었는데, **XML 주석에는 연속 하이픈(`--`)을 넣을 수 없다.**
> SVG 는 엄격한 XML 로 파싱되므로 파일 전체가 무효가 된다. 파비콘이 조용히 기본 아이콘으로 떨어진다.

`xml.dom.minidom` 파싱으로 재현 확인 → 주석에서 `--` 를 제거(`color-logo-mark` 로 표기)하고
재생성·재빌드 후 정상 렌더 확인. **말로만 검토했으면 그대로 배포됐을 버그다.**

---

## 6. 사이드바 로고 교체

`apps/web/src/components/layout/Sidebar/TestFlowMark.tsx` (신규) — **인라인 SVG 컴포넌트**.

```
- <span className="... rounded-chip bg-logo-mark ...">TF</span>
+ <TestFlowMark className="h-[30px] w-[30px]" />
```

- **이미지 파일 참조가 아니라 인라인 SVG** 인 이유: 색을 토큰 유틸(`fill-logo-mark` /
  `stroke-logo-mark-ink` / `fill-logo-mark-ink`)로 제어할 수 있고, HTTP 요청이 하나 줄어든다
- `apps/web/src` 에 **HEX 리터럴을 한 글자도 넣지 않았다.** 전부 Tailwind 토큰 유틸이다
- **인라인 CSS(`style={{}}`) 없음**
- `aria-hidden="true"` + `focusable="false"` — 옆의 워드마크 "TestFlow" 가 이미 이름을 읽어 주므로
  스크린리더가 같은 이름을 두 번 말하지 않게 했다
- 30×30 자리·`gap-[11px]`·워드마크 18px/850 은 그대로 뒀다 (`sidebar-logo.png` 에서 균형 확인)

### 밝음/어두움 대비

| 배경 | 결과 |
|---|---|
| `--nav #15211e` (사이드바) | 민트 타일이 사이드바에서 가장 밝은 요소 — 로고로 적절하다. `sidebar-full.png` |
| 밝은 탭 `#dee1e6` | 타일이 자기 배경을 들고 있어 글리프 대비 유지 |
| 어두운 탭 `#202124` | 민트 타일이 강하게 튄다 |
| 흰 배경 | 민트가 흰 위에서 다소 부드럽지만, **읽는 대상은 잉크 글리프**라 판독에 문제 없다 |

---

## 7. 렌더 검증

모두 **실제 빌드 산출물을 `vite preview` 로 띄워** 확인했다.

> ⚠️ 포트 4173 은 **다른 에이전트의 preview 서버**가 쓰고 있었다.
> 처음 4173 에 요청했을 때 `favicon.ico` 가 404 로 나와 잠깐 오진했는데, 남의 앱이었다.
> 내 서버를 4180(`--strictPort`)으로 띄워 다시 측정했다. 그쪽 서버는 건드리지 않았고 살아 있다.

### `link[rel=icon]` HTTP 상태 — 404 면 탭에 기본 아이콘이 뜬다

| href | status | content-type | bytes |
|---|---|---|---|
| `/favicon.ico` | **200** | `image/x-icon` | 2,899 |
| `/favicon.svg` | **200** | `image/svg+xml` | 1,652 |
| `/apple-touch-icon.png` | **200** | `image/png` | 2,321 |

원본 JSON: `assets/15-brand/verify.json`

### 스크린샷

| 항목 | 경로 |
|---|---|
| 탭 스트립(밝음/어두움) + 16px 실제 픽셀 + svg 벡터 + apple-touch | `favicon-in-tab.png` |
| 사이드바 로고 클로즈업 (`--nav` 위) | `sidebar-logo.png` |
| 사이드바 전체 | `sidebar-full.png` |
| 앱 1280px | `app-1280.png` |
| 760px 오프캔버스 닫힘 / 열림 | `mobile-760-closed.png` / `mobile-760-open.png` |
| 16/32/48 파비콘 원본 | `favicon-16.png` / `favicon-32.png` / `favicon-48.png` |
| 탐색 라운드 1~5 | `explore-round1..5-*.png` |

- **760px 오프캔버스**: 햄버거로 열었을 때 로고가 정상 렌더된다 (`mobile-760-open.png`)
- 탭 스트립 스크린샷의 아이콘은 **preview 서버가 실제로 서빙한 바이트**를 `<img>` 로 불러 그렸다

---

## 8. 기준선

| 게이트 | 기준 | 결과 |
|---|---|---|
| `pnpm typecheck` | 7/7 | ✅ **7/7** |
| `pnpm lint` | 0 problems | ✅ **0 problems** (7/7) |
| `pnpm build` | 5/5 · 500KB 경고 없음 | ✅ **5/5**, 경고 없음 |
| `pnpm test` | 717건 이상 | ✅ **717건** 통과 |
| `apps/web/src` 스타일 HEX 리터럴 | 0건 | ✅ **0건** (HEX 31건 매치는 전부 시안 참조 **주석**, 신규 0건) |

### 번들 before / after

`git stash` 로 베이스라인을 직접 빌드해 같은 방법으로 쟀다(엔트리 + `modulepreload` JS 합).

| | 초기 로드 JS | 아이콘 |
|---|---|---|
| before | 550,059 B (537.2 KB) | 0 |
| after | 550,598 B (537.7 KB) | 6,872 B |
| **차이** | **+539 B** | +6.7 KB (정적, JS 아님) |

메인 청크 `index-*.js` 305.91 KB (gzip 95.92 KB) · CSS 45.27 KB (gzip 10.10 KB).
인라인 SVG 컴포넌트라 JS 증가가 539 B 에 그친다.

---

## 9. 생성·수정 파일

**신규**
- `apps/web/public/favicon.svg`
- `apps/web/public/favicon.ico`
- `apps/web/public/apple-touch-icon.png`
- `apps/web/src/components/layout/Sidebar/TestFlowMark.tsx`
- `.pipeline/20260917-231945/assets/15-brand/` (생성기 + 증적 스크린샷)

**수정**
- `apps/web/index.html` — 아이콘 link 3줄
- `apps/web/src/components/layout/Sidebar/Sidebar.tsx` — `TF` span → `<TestFlowMark />`
- `apps/web/src/components/layout/Sidebar/index.ts` — barrel export 2줄

**건드리지 않음**: `docker-compose.yml` · `packages/db/src/cli/guard.ts` · `.gitattributes` ·
`.npmrc` · `apps/api/**` · `apps/runner/**` · `features/recorder/**` · `globals.css`(새 토큰 불필요)

---

## 10. 미검증 / 한계

- **실제 브라우저 탭 UI 스크린샷은 못 찍었다.** 탭 스트립은 OS 크롬 영역이라 Playwright 의
  `page.screenshot()` 으로 캡처되지 않는다(헤드리스에는 탭 UI 자체가 없다).
  대신 ① `link[rel=icon]` 이 **실제로 200 으로 로드되는지**를 HTTP 로 검증하고,
  ② preview 서버가 서빙한 **진짜 아이콘 바이트**로 탭 스트립을 모사해 그렸다.
  탭에 아이콘이 뜨는지를 좌우하는 건 ①이고 그건 검증됐다.
- **Safari/Firefox 실측 없음.** Chromium 만 썼다. svg 파비콘과 PNG 담은 ico 는 둘 다
  두 브라우저의 지원 범위 안이지만 실물 확인은 안 했다.
- **iOS 홈 화면 실측 없음.** `apple-touch-icon` 의 마스크는 CSS `border-radius` 로 모사만 했다.
- **다크모드용 파비콘 변형 없음.** `prefers-color-scheme` 으로 svg 안에서 색을 바꿀 수 있지만,
  타일이 자기 배경을 갖고 있어 양쪽에서 이미 읽힌다. 변형을 만들면 ico 폴백과 모양이 갈린다.
- **로고 사용 규정(최소 크기·여백·오용 예) 문서는 만들지 않았다.** 요청 범위 밖이다.
