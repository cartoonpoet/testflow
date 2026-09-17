---
# Evaluate Artifact
pipeline_id: 20260917-114450
phase: 05-eval
---

# TestFlow 비회원제 MVP — 최종 검증 보고서 (Gen-Phase 12)

작성 2026-09-17 · WSL2 / Node 22.22.2 / yarn 4.18.0
MySQL 8.4(3307) · Redis 7 · API(4000) · Runner(WS 4100, `local` 모드) · 웹(`vite preview` 4173)
**전 구간을 실제로 기동해 측정했다.** 추정치는 "추정"이라고 명시했다.

---

## 검증 결과 요약

| 항목 | 결과 | 비고 |
|------|------|------|
| 타입 체크 | ✅ **PASS** | `yarn typecheck` — 7 workspaces, 7 successful |
| Lint | ✅ **PASS** | `yarn lint` — 7 workspaces, 0 problems |
| Build | ✅ **PASS** | `yarn build` — 5 successful. **500KB 경고 사라짐** (code splitting) |
| 테스트 | ✅ **PASS** | **242건** — contracts 22 / web 52 / runner 75 / api **93**(기존 85 + 신규 8) |
| **PoC-2 한글 IME** | ✅ **PASS (조건부)** | 왕복 정확도 **12/12 (100%)**. A안 한계가 **실제로 재현됨** → **keydown(229) 선행 주입으로 수정·재검증**. **B안 승급은 불필요**(측정으로 기각) |
| **PoC-3 녹화→재생 왕복** | ✅ **PASS** | **17/17 (100%)** — 로컬 SPA fixture 14/14 · 공개 사이트 `playwright.dev` 3/3. iframe · SPA 라우팅 · 전체 이동 · 동적 리스트 전부 포함 |
| **성능 목표 (API p95 500ms)** | ✅ **PASS** | runs **13,241**행에서 최악 p95 **11.3ms**. 큐 등록 p95 **45ms**(목표 1s) · 이벤트 지연 **29ms**(목표 2s) |
| **마스킹 3경로** | ✅ **PASS (수정 후)** | 전수 grep 으로 **누락 3곳 발견 → 전부 수정**. 의도적 실패 실행 후 API·로그·DB·SSE·증적 **전 경로 평문 0건**(대조군으로 검사 유효성 확인) |
| 사내 스테이징 검증 (Task 12.3) | ⛔ **미실행** | 주소 미확보. 재현 절차를 03-phases 에 명시하고 `--target custom` 배선을 깔아 둠 |

---

## ★ PoC-2 한글 IME 측정 결과

전문: [`poc2-result.md`](./poc2-result.md) · 스크립트 `apps/runner/poc/poc2-ime.ts` · fixture `apps/runner/poc/fixtures/ime-test.html`

### 왕복 정확도 — **12/12 (100%), 4개 주입 방식 전부**

받침 없음(`가나다`) / 받침(`한글 받침`) / 쌍자음·겹받침(`깎다 빨갛다 있다`) /
복합모음(`왼쪽 의외로 웬만큼`) / `안녕하세요` / `계약서를 검토합니다` /
한영 혼용(`TestFlow 계약서 Review`) / 한글+숫자(`계약서 3건 검토 2026년`) /
연속 공백 / **이모지(`계약 완료 ✅ 검토 🔍`)** / 전각 문장부호(`제1조(목적) — “계약”의 정의`) / 장문 28자
— **한 케이스도 어긋나지 않았다.**

### ★ A안의 한계가 실제로 재현됐다

fixture 에 `keydown` 에만 의존하는 위젯 3종(실시간 자동완성 · 숫자 마스킹 input · Enter 단축키)을 만들었다.

| 주입 방식 | 자동완성<br>keydown / 목록 | 마스킹 input<br>keydown / blocked / 최종값 | 단축키 | composition<br>start/update/end |
|---|---|---|---|---|
| **A안 원형** `Input.insertText` 단독 | **0 / 0** ❌ | **0 / 0** / `한글123` ❌ | 1 ✅ | 0/0/0 |
| **A안+ (현재 제품)** keydown(229)+insertText | **1 / 2** ✅ | **1 / 1** / `한글123` ⚠️ | 1 ✅ | 0/0/0 |
| 대조군 `page.keyboard.type` | **0 / 0** ❌ | 3 / **0** / `한글123` ❌ | 1 ✅ | 0/0/0 |
| **B안** `imeSetComposition`+commit | **0 / 0** ❌ | **0 / 0** / `한글123` ❌ | 1 ✅ | **1/5/1** |

재현된 사실:

1. `Input.insertText` 는 `keydown`/`keypress`/`keyup` 을 **전혀** 만들지 않는다(`beforeinput`/`input` 만).
2. 그래서 **입력 중 실시간 자동완성이 통째로 죽는다** — 추천 목록 0건.
3. `keydown` 에서 `preventDefault` 하는 **마스킹 input 의 핸들러가 아예 돌지 않는다**.
4. **단축키는 깨지지 않는다.** Enter 는 `{t:"ime"}` 가 아니라 `{t:"key"}` 메시지로 가고 그 경로는 정상이다.
   → "keydown 의존 위젯이면 무조건 깨진다" 가 아니라 **문자 입력 경로만** 깨진다.
5. **예상 밖**: `page.keyboard.type("한글123")` 도 한글 부분은 keydown 을 만들지 않는다(ASCII 3자 몫만 3회).
   Playwright 고수준 API 로 바꾸는 선택지는 **없다.**

### ★ B안 승급 필요 여부 — **불필요. 승급해도 이 문제는 안 풀린다**

이번 측정의 가장 중요한 결론이다. `Input.imeSetComposition` 을 PoC 에서 직접 호출해 재 보니
**composition 이벤트만 생기고 `keydown` 은 여전히 0** 이었다.
02-context 가 B안을 "A안 한계 1의 해법" 으로 적어 둔 것은 **틀린 전제**였다.

→ `input-bridge.ts` 의 `setComposition` / `commitComposition` 은 **호출 시 에러를 던지는
미구현 상태로 그대로 둔다.** 구현할 이유가 측정으로 사라졌다.

### 실제 해법 — keydown(229) 선행 주입 ("A안+"), **이번에 구현·검증**

실제 한글 IME 는 조합 중 매 키마다 `keyCode 229 / key="Process"` keydown 을 보낸다.
`insertText` 앞뒤에 그것을 붙였더니 위젯이 살아났다.

| | 수정 전 | 수정 후 |
|---|---|---|
| 자동완성 추천 목록 | 0건 | **2건** |
| 마스킹 `preventDefault` 호출 | 0 | **1** |
| 왕복 정확도 | 12/12 | **12/12** (손상 없음) |

`apps/runner/src/record/input-bridge.ts` 의 `insertText()` 안 **8줄**. 파일 1개만 바뀌었다.

**남는 한계(사실대로)**: `preventDefault()` 로 `insertText` 를 **취소할 수는 없다.**
마스킹 input 의 핸들러는 돌지만 값은 들어간다(`한글123`).
실제 IME 도 같은 부류의 제약이 있는 것이 일반적이지만 **실제 IME 로 대조 측정을 하지 않았으므로
"동일하다" 고 단정하지 않는다.** 완전 해소는 B안 조합 중계 + keydown(229) 를 **함께** 구현해야 한다.

---

## ★ PoC-3 녹화→재생 왕복 측정 결과

전문: [`poc3-result.md`](./poc3-result.md) · 스크립트 `apps/runner/poc/poc3-roundtrip.ts`

캔버스 클라이언트를 실제 headless Chromium 으로 띄워 Runner WS 에 붙이고 **진짜 마우스·키보드 이벤트**로
원격 페이지를 조작했다. 재생은 `POST /api/runs` → BullMQ → Runner 정규 경로다.

### ★ 왕복 성공률

| 대상 | 녹화 스텝 | 재생 | **성공률** |
|---|---|---|---|
| **A. 로컬 SPA fixture** (iframe · pushState · **전체 이동** · 동적 리스트 · 비밀번호) | 14 | `passed` | **14/14 (100%)** |
| **B. 공개 사이트 `https://playwright.dev`** (Docusaurus SPA) | 3 | `passed` | **3/3 (100%)** |
| 합계 | 17 | — | **17/17 (100%)** |

**실패 케이스 0건.** 네트워크는 열려 있었다(200 / 0.24s) — 대체 fixture 는 쓰지 않았다.

### 04-gen-7 이 못 덮은 3가지 — 전부 덮었다

| 항목 | 결과 | 근거 |
|---|---|---|
| **iframe 안의 요소** | ✅ | 스텝 #8·#9 의 `frameUrl` 이 iframe URL 로 정확히 채워졌고 재생도 통과. `injected.ts` 의 `window.top === window` 판정이 동작 |
| **SPA 라우팅 (pushState, 같은 문서)** | ✅ | `계약` 탭 전환 후 #5→#6→#7 계속 기록 |
| **전체 이동 (새 문서)** ★ | ✅ | `다음 페이지` 링크 이후에도 **#12·#13·#14 가 계속 기록됐다** = `context.addInitScript()` 가 새 문서에 재주입된다는 직접 증거. page 단위로 걸었다면 #12 부터 사라졌을 것 |
| **실제 공개 SPA 라우팅** | ✅ | `Docs` 클릭 → Docusaurus 라우팅 → 새 화면의 `Writing tests` 를 이어서 기록 |
| **동적 리스트 + 고유성** | ✅ | 같은 이름 버튼 4개 상태에서 2번째 `삭제` → `primary: {by:"role", name:"삭제", nth:1}` + `fallbacks:[text nth:1, css "#rows > li:nth-of-type(2) > button"]` |

### 검증 포인트 4가지

| 포인트 | 판정 | 근거 |
|---|---|---|
| ① role/label 우선순위 | ✅ | 우리가 만들지 않은 마크업에서도 `role=link name="Docs"` 추출. 입력란은 `role=textbox name` → `label` fallback. CSS 는 언제나 마지막이고 `?advanced=1` 없이는 응답에 없다 |
| ② 고유성 검증 | ✅ | `nth` 부여 확인. 없었다면 재생이 strict mode violation 으로 죽는다 |
| ③ `input` 디바운스 1스텝 병합 | ✅ | **총 23자(4개 칸)를 55ms 간격으로 한 글자씩 → `fill` 스텝 4개.** 디바운스가 없으면 23스텝 |
| ④ 비밀번호 승격 + 평문 미잔류 | ✅ | `{{password}}` + `isSecret:true`. 13,054바이트 전수 검색 평문 **0건** |

### 이번 측정 중에 고친 것 — PoC 캔버스 클라이언트의 IME 경로 누락

**첫 실행에서 한글이 통째로 유실됐다.** `검색어` 스텝 자체가 안 생겼고 `2026 유지보수 계약` 이
`"2026  "` 로 들어갔다(ASCII·공백만 남음). 원인은 `poc/client/index.html` 이 PoC-1 시절 산출물이라
`window` 레벨 `keydown` 만 듣고 **IME 경로가 없었던** 것이다.
제품 웹 클라이언트(`useImeBridge.ts`)에는 그 경로가 있다.

→ PoC 클라이언트에 제품과 같은 구조의 **숨은 IME 버퍼**를 넣었다. 수정 후 한글이 전부 정확히 들어갔다.
**제품 버그가 아니라 하네스 버그였다.** 다만 고치지 않았으면 "한글 녹화가 안 된다" 는
**잘못된 결론을 보고할 뻔했다.**

---

## 성능 목표 측정

전문: [`perf-result.md`](./perf-result.md). 각 엔드포인트 워밍업 5회 후 **100회 호출**.

### 데이터 규모 (직접 INSERT 로 대량 생성)

| 테이블 | 측정 전 | 규모 ① | **규모 ②** |
|---|---|---|---|
| `scenarios` | 29 | 89 | **249** |
| `runs` | 41 | 1,241 | **13,241** |
| `step_results` | 228 | 7,428 | **79,428** |
| `artifacts` | 54 | 1,764 | **18,904** |

시각 컬럼은 전부 `UTC_TIMESTAMP(3)` 기준(앱 규약 `timezone:"Z"` + `default-time-zone=+00:00` 과 동일).

### ① 일반 API p95 500ms — **PASS**

| 엔드포인트 | 데이터 규모 | p50 | **p95** | 목표 | 판정 |
|---|---|---|---|---|---|
| `GET /api/health` | 13.2k runs | 1.5ms | **2.1ms** | 500ms | ✅ |
| `GET /api/dashboard/summary?range=today` | 13.2k runs | 4.2ms | **5.3ms** | 500ms | ✅ |
| `GET /api/dashboard/summary?range=30d` | 13.2k runs | 9.8ms | **11.3ms** | 500ms | ✅ |
| `GET /api/dashboard/readiness` | 249 scenarios | 3.5ms | **5.8ms** | 500ms | ✅ |
| `GET /api/projects/:id/scenarios` (page1 size20) | 249 scenarios | 4.1ms | **6.3ms** | 500ms | ✅ |
| `GET /api/projects/:id/scenarios?q&status` | 249 scenarios | 3.3ms | **5.3ms** | 500ms | ✅ |
| `GET /api/runs?projectId&limit=20` | 13.2k runs | 2.3ms | **3.4ms** | 500ms | ✅ |
| `GET /api/runs?status=failed&limit=20` | 13.2k runs | 2.1ms | **3.2ms** | 500ms | ✅ |
| `GET /api/runs?limit=20` (필터 없음) | 13.2k runs | 2.3ms | **4.2ms** | 500ms | ✅ |
| `GET /api/runs/:id` (상세 + 스텝) | 79.4k step_results | 2.5ms | **3.4ms** | 500ms | ✅ |
| `GET /api/runs/:id/artifacts` | 18.9k artifacts | 2.2ms | **3.5ms** | 500ms | ✅ |
| `GET /api/scenarios/:id` (스텝 포함) | 1.75k test_steps | 2.5ms | **3.4ms** | 500ms | ✅ |

**최악 p95 가 11.3ms — 목표의 2.3%.**
04-gen-5 가 축소 후보로 지목한 **대시보드 집계는 무겁지 않았다**(readiness 3.6ms).
`scenarios LEFT JOIN runs ON r.id = s.last_run_id` 비정규화 컬럼 덕분에 실행 이력 전체를 훑지 않는다.
**축소할 이유가 없다.**

### ② 큐 등록 1초 / ③ 이벤트 지연 2초 — **PASS**

| 목표 | 실측 | 판정 |
|---|---|---|
| `POST /api/runs` 후 1초 이내 큐 등록 | p50 **27.0ms** / p95 **45.0ms** / max 82.8ms (202) | ✅ |
| 상태 이벤트 지연 2초 이내 (서버 확정 → SSE 수신) | **29ms** | ✅ |
| 〃 (서버 확정 → **브라우저 화면 반영**, 04-gen-11) | **246ms** | ✅ |

### ★ 인덱스 추가 — before / after

`EXPLAIN` 으로 **full scan + filesort 2건**을 찾았다. 기존 `ix_runs_project_queued (project_id, queued_at)` 는
선행 컬럼이 `project_id` 라 `projectId` 를 안 넘기는 `/runs` 화면 경로에서 쓸 수 없었다.

신규 마이그레이션 **`010-add-run-list-indexes.ts`**:
`ix_runs_status_queued (status, queued_at)` + `ix_runs_queued (queued_at)`

| 엔드포인트 | **before p95** | **after p95** | 검사 행수 | EXPLAIN |
|---|---|---|---|---|
| `GET /api/runs?status=failed&limit=20` | 9.9ms | **3.2ms** | 12,987 → **1,894** | `key=NULL, filesort` → `ix_runs_status_queued, Backward index scan` |
| `GET /api/runs?limit=20` (필터 없음) | 12.6ms | **4.2ms** | 12,987 → **20** | `key=NULL, filesort` → `ix_runs_queued, Backward index scan` |

> 솔직히: **지금 느려서 넣은 게 아니다.** 13k 행에서 9.9ms 는 목표를 한참 밑돈다.
> 다만 두 쿼리가 **행 수에 선형**이라 10만~100만 행에서 목표를 넘는다. 지금 넣는 비용이 더 싸다.
> **인덱스가 2개인 이유**: `(status, queued_at)` 하나로는 필터 없는 `ORDER BY queued_at` 을 탈 수 없다.

---

## 마스킹 3경로 전수 점검 결과

### 코드 grep 전수 조사 — **누락 3곳을 찾았다**

| 경로 | 점검 전 상태 | 조치 |
|---|---|---|
| **① API 응답** | ❌ **누락.** `run.mapper.ts` 의 `toRun`/`toStepResult` 가 `errorMessage` 를 **DB 값 그대로 통과**시켰다. `mask.ts` 호출이 `runs.sse.ts` **한 곳뿐**이었다 | ✅ `runs.service.findOne()` 에서 SSE 와 **같은 값 목록**(BullMQ job 페이로드)으로 `maskSecrets()` 적용. 그러려고 `RunEventsService.secretValuesOf()` 를 `public` 으로 열었다 |
| **② 서버 로그 (Runner)** | ❌ **누락 2곳.** `executor.ts:243` 이 실행 환경 오류 **원문**을 stdout 에 찍었고, `main.ts` 의 `worker.on("failed")` 도 원문을 찍었다 | ✅ 각각 `reporter.mask(...)` / `maskSecretText(..., collectSecretValues(job.data...))` 적용 |
| **② 서버 로그 (API)** | ✅ 문제 없음 | 사용자 입력이 실리는 로그 지점이 없다(`recordings.service` 의 세션 ID 로그뿐) |
| **③ `step_results` / `runs.error_message`** | ✅ `reporter.ts` 가 쓰기 전 마스킹 | 변경 없음 |
| **④ SSE 이벤트** | ✅ `runs.sse.ts:176` | 변경 없음 |
| (추가) 증적 파일 | ✅ 콘솔 로그 · 네트워크 URL 모두 `reporter.mask()` 통과 | 변경 없음 |

> ★ 왜 위험했나: 점검 전에는 **Runner 가 DB 에 쓰기 전 마스킹하는 것이 유일한 방어선**이었다.
> 그 한 곳이 미래에 깨지면 API 응답이 평문을 그대로 내보냈을 것이다. 이제 2겹이다.

### Playwright 에러 메시지 형태 전수 테스트 (`mask.spec.ts` 신규 8건)

입력값이 에러에 실려 나오는 형태가 하나가 아니다. 6가지를 실제 문자열로 고정했다:
`locator.fill` 타임아웃의 call log / `expect().toHaveValue()` 의 기대·실제 /
`strict mode violation: waiting for getByRole(...)` / 우리 인터프리터의 `assert_text` 문장 /
`page.goto` URL 의 `user:pass@` / JSON 직렬화된 요청 body.
**전부 마스킹된다.** 객체로 감싼 SSE payload 형태도 포함.

또한 **"값 목록이 비면(job 만료) 문자열은 못 잡는다"는 사실을 테스트로 고정**했다 —
그래서 Runner 가 **쓰기 전에** 마스킹해야 한다는 설계 근거가 코드에 박혔다.

### 실측 — 의도적 실패 실행 후 전 경로 grep

`assert_text` 의 기대값을 `{{password}}` 로 두어 Playwright 에러에 값이 실리게 만들었다.
결과 메시지: `텍스트가 기대값과 다릅니다. 기대(포함): "••••••••" / 실제: "completed=0 memo="""`

| 검사 위치 | 평문 건수 |
|---|---|
| `GET /api/runs/:id` 응답 | **0** |
| 서버 로그 `api.log` + `runner.log` | **0** |
| DB `step_results.error_message` / `runs.error_message` (`LIKE '%Tf!SecretPw%'`) | **0** |
| SSE 스트림 실수신 5,455 바이트 | **0** (`••••••••` 검출) |
| 증적 파일 `artifacts/` 전체 재귀 | **0** |
| DB 전체 덤프 179KB (PoC-3 실행분 포함) | **0** |
| Redis SSE 버퍼 `run:*:events` | **0** |
| **대조군** — 같은 검사를 평문이 든 파일에 | **1건 검출** ← 검사가 실제로 동작함 |

---

## 번들 code splitting 결과

`apps/web/src/routes/routes.tsx` 를 `React.lazy` + 라우트별 `Suspense fallback` 으로 바꿨다.
fallback 은 **공용 `RouteFallback`** 이다 — 화면별 스켈레톤을 쓰면 그 청크를 미리 받아 분할이 무효가 된다.

| | **before** | **after** |
|---|---|---|
| **초기 로드 JS** | **623.79 KB** | **523.83 KB** (**−99.96 KB, −16.0%**) |
| **초기 로드 JS (gzip)** | **192.31 KB** | **164.59 KB** (**−27.72 KB, −14.4%**) |
| CSS | 38.14 KB / gzip 8.59 KB | 37.46 KB / gzip 8.38 KB |
| 청크 수 | 1 | **16** |
| `vite build` 500KB 경고 | ⚠️ 발생 | ✅ **없음** |
| 전체 JS 합계(모든 청크) | 623.79 KB | 616.52 KB / gzip 199.99 KB |

지연 로드되는 주요 청크:

| 청크 | 크기 | gzip |
|---|---|---|
| **`builder`** (빌더 + 인스펙터 + **녹화 클라이언트** `features/recorder`) | **25.26 KB** | 9.12 KB |
| `RunDetail` (실행 상세 + SSE + 증적) | 15.34 KB | 5.15 KB |
| `SuiteDetail` · `RunDialog` · `scenarios` · `dashboard` · `suites` · `runs` · `NewScenarioPage` | 2.3~7.8 KB | |

녹화 클라이언트가 `builder` 청크에 들어갔음을 산출물 grep 으로 확인했다(초기 청크에는 0건).

### 라우팅 회귀 검증 — Playwright 로 전 라우트

```
PASS  /                        → h1="대시보드"          청크=5   셸=true  콘솔에러=0
PASS  /scenarios               → h1="테스트 시나리오"    청크=6   셸=true  콘솔에러=0
PASS  /scenarios/new           → h1="시나리오 만들기"    청크=6   셸=true  콘솔에러=0
PASS  /scenarios/:id (빌더)    → h1="시나리오 만들기"    청크=8   셸=true  콘솔에러=0
PASS  /runs                    → h1="실행 현황"          청크=8   셸=true  콘솔에러=0
PASS  /runs/:id                → h1="실행 현황"          청크=7   셸=true  콘솔에러=0
PASS  /suites                  → h1="테스트 스위트"      청크=10  셸=true  콘솔에러=0
PASS  /suites/:id              → h1="로그인 회귀 묶음"   청크=9   셸=true  콘솔에러=0
PASS  /does-not-exist          → / 로 리다이렉트                          콘솔에러=0

클라이언트 라우팅: 초기 청크 5개 → 4화면 순회 후 14개 (지연 로드 9개) 콘솔에러=0
결과: 9/9 라우트 PASS
```

**셸(사이드바·탑바)은 청크를 받는 동안에도 유지된다** — 본문만 `RouteFallback` 으로 바뀐다.
어느 라우트에서도 fallback 이 잔류하지 않았다(측정 시점 `route-fallback` 노드 0개).

---

## 전체 해피패스 실행 결과

**웹 UI 로만** 끝까지 돌렸다(`vite preview` 4173 + Playwright 실브라우저).
스크린샷 10장 — `/tmp/tf12/happy-*.png`

### 성공 경로

| 단계 | 결과 |
|---|---|
| ① 시나리오 생성 (`/scenarios/new` → `만들고 녹화하기`) | ✅ 빌더로 자동 이동 |
| ② **녹화** — 캔버스에 원격 화면 1280×800 수신(표시 816×510), **13.6 fps · 렌더 107 · 드롭 0** | ✅ |
|   캔버스에 직접 클릭·타이핑 → 초안 스텝이 **실시간으로 쌓임** | ✅ `goto → fill → fill → click` **4건** |
|   `type="password"` 값 수집 여부 | ✅ **`{{password}}` + `isSecret:true`** — 시나리오 JSON 전체에 평문 **0건** |
|   디바운스 | ✅ 아이디 9자·비밀번호 16자 → 각 `fill` **1스텝** |
| ③ 스텝 편집 (인스펙터에서 이름 변경) + 임시 저장 | ✅ |
| ④ **발행** | ✅ `status=published`, `version=2` |
| ⑤ **실행 요청** (`▶ 실행` → 대상 주소 · 환경 라벨 · **계정/비밀번호 직접 입력**) | ✅ 실행 현황으로 자동 이동 |
|   전송 후 브라우저 잔류 검사 | ✅ **HTML / localStorage / sessionStorage / cookie / history.state 전부 평문 0건** |
| ⑥ **실시간 관전** (SSE) | ✅ 이벤트 **10건 수신, 중복 0** |
| ⑦ 최종 | ✅ **`passed` — 1:passed, 2:passed, 3:passed, 4:passed** |
| 콘솔 에러 | ✅ **0건** |

### 실패 증적 경로 (별도 실행 — 성공 실행은 기본적으로 증적을 남기지 않는다)

같은 발행 시나리오를 **일부러 다른 대상 주소**로 실행해 스텝 2를 실패시켰다.

```
상태: failed   스텝: 1:passed, 2:failed, 3:skipped, 4:skipped
에러: 대상 요소를 찾지 못했습니다(10000ms). 시도한 후보:
      role=textbox name="아이디" → 0개 매칭 / label="아이디" → 0개 매칭 / css="#username" → 0개 매칭
SSE: received=11  duplicates=0  connection=idle
관측된 상태 전이: (초기) → open → idle    ← 되돌아간 프레임 0건
```

**증적 5종이 화면에 표시되고 화면의 링크를 그대로 받아 전부 200 을 받았다:**

| 종류 | HTTP | Content-Type | 크기 | Content-Disposition |
|---|---|---|---|---|
| screenshot | 200 | `image/png` | 14,137 B | `attachment; filename="step-02.png"` |
| video | 200 | `video/webm` | 125,010 B | `video.webm` |
| trace | 200 | `application/zip` | 54,193 B | `trace.zip` |
| console_log | 200 | `text/plain` | 118 B | `console.log` |
| network_log | 200 | `application/json` | 228 B | `network.json` |

화면에 그려진 에러 메시지: **평문 0건 / `••••••••` 검출 / 계정명은 표시됨**(의도대로).

---

## 수정한 오류

| # | 오류 | 원인 | 수정 |
|---|---|---|---|
| **1** | **`GET /api/runs/:id` 응답이 `error_message` 를 마스킹하지 않았다** | `run.mapper.ts` 가 DB 값을 그대로 통과. `mask.ts` 호출이 `runs.sse.ts` 한 곳뿐이었다 — **Runner 의 쓰기-전 마스킹이 유일한 방어선** | `runs.service.findOne()` 에서 SSE 와 같은 값 목록으로 `maskSecrets()` 적용. `RunEventsService.secretValuesOf()` 를 `public` 으로 전환 (`apps/api/src/modules/runs/runs.service.ts`, `runs.sse.ts`) |
| **2** | **Runner 가 실행 환경 오류 원문을 로그에 찍었다** | `executor.ts:243` — DB 경로는 `reporter` 가 마스킹하지만 **로그는 그 경로를 안 탄다** | `reporter.mask(errorMessage)` 적용 (`apps/runner/src/execute/executor.ts`) |
| **3** | **BullMQ `worker.on("failed")` 가 에러 원문을 로그에 찍었다** | 같은 이유. `job.data` 는 안 찍었지만 **메시지 자체**에 입력값이 실린다 | `collectSecretValues(job.data...)` + `maskSecretText()` 적용 (`apps/runner/src/main.ts`) |
| **4** | **`Input.insertText` 가 keydown 을 만들지 않아 keydown 의존 위젯이 죽었다** | A안의 알려진 한계. **PoC-2 에서 실제로 재현** (자동완성 목록 0건 / 마스킹 핸들러 0회) | `insertText()` 앞뒤에 `keyCode 229 / key="Process"` keydown·keyup 주입. 재측정으로 효과 확인 (`apps/runner/src/record/input-bridge.ts`) |
| **5** | **`/runs` 목록 두 경로가 full scan + filesort** | 기존 인덱스의 선행 컬럼이 `project_id` 라 `projectId` 없는 경로에서 쓸 수 없다 | 마이그레이션 `010-add-run-list-indexes.ts` 신규 + `migrations/index.ts` 배열 끝에 명시 등록 |
| **6** | **PoC 캔버스 클라이언트에 IME 경로가 없어 한글이 유실됐다** (하네스 버그) | `poc/client/index.html` 은 PoC-1 산출물이라 `window` keydown 만 듣는다 | 제품 `useImeBridge.ts` 와 같은 구조의 숨은 IME 버퍼 추가 (`apps/runner/poc/client/index.html`) |
| **7** | `vite build` 500KB 경고 (Gen-Phase 11 인계) | 단일 번들 623.79KB | 라우트 단위 `React.lazy` + `Suspense` (`apps/web/src/routes/routes.tsx`, `RouteFallback.tsx`) |

---

## 미해결 이슈 / 미검증 항목

### 1. ⛔ 사내 스테이징 대상 검증 (Task 12.3) — **주소 미확보로 미실행**

`03-phases.md` Task 12.3 에 **재현 절차 전문**을 적어 두었고, 코드 배선도 미리 깔았다.

```bash
# PoC-1 — poc1.ts 의 TARGETS 에 `custom` 을 추가해 두었다.
#   ★ 사내 주소는 소스에 박지 않는다. 환경변수로만 넘긴다.
yarn workspace @testflow/runner build:poc
POC_CUSTOM_URL="https://staging.사내도메인/login" \
  node apps/runner/dist-poc/poc/measure.js --target custom --seconds 30
```

`POC_CUSTOM_URL` 이 비면 `customTargetUrl()` 이 즉시 에러를 던진다(조용히 다른 곳을 재지 않도록).
PoC-2·PoC-3 의 절차와 **"검증 후 사내 실데이터 증적 삭제"** 절차도 03-phases 에 명시했다.

### 2. ⚠️ 배포 서버 Node 버전 — **여전히 미확인** (5단계 연속 이월)

확인할 방법이 없다. **README 의 "요구 사항" 절에 필요 최소 버전 `Node 22.0.0 이상`을 명시**하고
경고 블록을 달았다(`node --env-file-if-exists`, ESM `import.meta`, 전역 `fetch` 를 전제한다).
**배포 전에 대상 서버에서 `node -v` 를 반드시 확인해야 한다.**

### 3. 한글 IME — 마스킹 input 의 `preventDefault` 무력화 (부분 미해결)

keydown(229) 주입으로 **핸들러는 돌지만** `insertText` 를 `preventDefault` 로 취소할 수는 없다.
완전 해소는 **B안 조합 중계(`imeSetComposition`) + keydown(229) 를 함께** 구현해야 한다.
단, **B안 단독 승급은 측정으로 기각됐다**(composition 이벤트만 생기고 keydown 은 0).
`input-bridge.ts` 의 `setComposition`/`commitComposition` 은 미구현 상태로 남아 있다.
재현: `node apps/runner/dist-poc/poc/poc2-ime.js` 의 `imeComposition` 행.

### 4. 그 밖의 미검증 (전 Gen-Phase 누적)

| 항목 | 상태 | 재현/해결 경로 |
|---|---|---|
| 다중 사용자 · 다중 탭 동시 관전 | 미측정 | 전부 loopback 단일 탭. HTTP/1.1 오리진당 6 연결 제약이 실제로 걸리는지 미확인 |
| 동시 부하(k6/autocannon) | 미측정 | 이번 p95 는 **동시성 1** 에서의 p95다 |
| 접근성 자동 검사(axe) | 미실시 | `@axe-core/playwright` 를 preview 에 붙이면 된다 |
| `RUNNER_EXECUTION_MODE=docker` 이미지 빌드·전환 | 기본 `local` | `docker build -f apps/runner/Dockerfile.exec -t testflow/playwright-exec:1.63.0 .` |
| `mask.ts` 를 `packages/contracts` 로 승격 | 권고 상태 (구현 2곳) | api·runner 가 같은 파일을 import 하게 되면 `apps/runner/src/mask.ts` 가 사라진다 |
| `RunDetailSchema.queuePosition` | 계약에 없음 | `queued` 화면에 큐 위치를 못 보여 준다 |
| `RunListItemSchema.batchId` | 계약에 없음 | `/runs` 목록이 묶음을 스스로 못 그린다(지금은 URL 로 id 를 들고 다닌다) |
| 증적 보존 정책(자동 만료) | 없음 | **디스크가 무한히 찬다.** `artifacts.expires_at` + 배치 삭제가 도입 지점 |
| 공개 사이트에서 `fill` 경로 | 미재현 | `playwright.dev` 에 로그인 폼이 없다. 클릭 2회만 측정 |
| 성능 측정 데이터 정리 | DB 에 잔류 | `DELETE FROM runs WHERE run_code LIKE 'RUN-P%'; DELETE FROM scenarios WHERE code LIKE 'TC-PERF%';` (CASCADE) |

---

## 변경 파일 전체 목록

### 신규 생성 (12)

**Runner — PoC 산출물**
- `apps/runner/poc/poc2-ime.ts` — PoC-2 측정 스크립트(주입 4방식 × 케이스 12 + 위젯 3종)
- `apps/runner/poc/fixtures/ime-test.html` — keydown 의존 위젯 3종 + composition 관측 fixture
- `apps/runner/poc/poc3-roundtrip.ts` — PoC-3 왕복 측정(로컬 SPA + 공개 사이트)
- `apps/runner/poc/fixtures/poc3-app.html` — iframe · pushState · 전체 이동 · 동적 리스트
- `apps/runner/poc/fixtures/poc3-frame.html` — iframe 내부 문서
- `apps/runner/poc/fixtures/poc3-page2.html` — 전체 이동 대상(+ `type="password"`)

**DB**
- `packages/db/src/migrations/010-add-run-list-indexes.ts` — `/runs` 목록 인덱스 2종

**Web**
- `apps/web/src/routes/RouteFallback.tsx` — 라우트 청크 로딩 자리표시자

**파이프라인 산출물**
- `.pipeline/20260917-114450/poc2-result.md`
- `.pipeline/20260917-114450/poc3-result.md`
- `.pipeline/20260917-114450/perf-result.md`
- `.pipeline/20260917-114450/05-eval.md` — 이 파일

### 수정 (12)

**API — 마스킹 누락 수정**
- `apps/api/src/modules/runs/runs.service.ts` — `findOne()` 에 `maskSecrets()` 적용 (경로 ①)
- `apps/api/src/modules/runs/runs.sse.ts` — `secretValuesOf()` 를 `public` 으로
- `apps/api/src/common/utils/mask.spec.ts` — Playwright 에러 형태 전수 테스트 **8건 추가**(85 → 93)

**Runner — 마스킹 누락 수정 + IME**
- `apps/runner/src/execute/executor.ts` — 실행 환경 오류 로그 마스킹 (경로 ②)
- `apps/runner/src/main.ts` — `worker.on("failed")` 로그 마스킹 (경로 ②)
- `apps/runner/src/record/input-bridge.ts` — **`insertText()` 에 keydown(229) 선행 주입**
- `apps/runner/poc/client/index.html` — IME 버퍼 추가(하네스 수정)
- `apps/runner/poc/poc1.ts` — `custom` 타깃 + `customTargetUrl()` (Task 12.3 배선)

**DB**
- `packages/db/src/migrations/index.ts` — `010` 을 배열 끝에 명시 등록

**Web**
- `apps/web/src/routes/routes.tsx` — `React.lazy` + 라우트별 `Suspense`

**문서**
- `README.md` — 전면 재작성(구조 · 구동 10분 · env 오염 · 환경변수 전량 · 타임존 · 실행 격리 · 배포 전제 · **MVP 미충족** · 문제 해결)
- `.pipeline/20260917-114450/03-phases.md` — Task 12.1·12.2·12.4~12.7 `[x]`, **12.3 은 `[ ]` 유지 + 재현 절차 추가**

### 손대지 않은 것 (제약 준수)

`docker-compose.yml` · `packages/db/src/cli/guard.ts` · `packages/contracts` **전체**(추가조차 없다) ·
`apps/web` 의 Gen-Phase 8·9·10·11 화면 산출물(`routes.tsx` 1개 제외) ·
`apps/api/src/common/utils/mask.ts` 본체 · `apps/runner/src/mask.ts` 본체.
확정 버전 전량 유지. **HEX 하드코딩 0건**(검출 111건 전부 JSDoc 의 시안 출처 표기) ·
**인라인 CSS 0건**(`style={{` 2건은 CSS 커스텀 프로퍼티 주입으로 기존 패턴).

---

## MVP 완성도

| 요구사항 ID | 내용 | 상태 | 비고 |
|---|---|---|---|
| **FR-001** | 브라우저 녹화로 시나리오 생성 | ✅ **충족** | 해피패스에서 웹 UI 로 실측. 원격 화면 13.6fps · 드롭 0 · 초안 실시간 반영 |
| **FR-002** | 녹화 스텝을 업무 언어로 편집 | ✅ **충족** | 인스펙터에서 이름·확인 조건·타임아웃 편집. CSS Selector 비노출(`?advanced=1` 전용) |
| **FR-003** | 시나리오 발행 / 버전 관리 | ✅ **충족** | `draft → published`, `version` 증가 실측 |
| **FR-004** | Locator 우선순위 (role → label → text → testid → css) | ✅ **충족** | PoC-3 에서 role/label 추출 + **고유성 검증(`nth`)** 확인. 공개 사이트에서도 동작 |
| **FR-005** | **Secret 암호화 저장 (MUST)** | ❌ **미충족** | **사용자 결정으로 대체** — 계정·비밀번호를 **저장하지 않고** 실행 시 입력받는다. 큐 페이로드에만 존재. `SECRET_ENC_KEY`·`crypto.ts`·`project_variables` 전부 없다. **대가: 저장된 자격증명으로 스케줄 실행 불가.** README 에 명시 |
| **FR-006** | 시나리오 실행 요청 + 큐 등록 | ✅ **충족** | 202 Accepted, p95 **45ms**(목표 1s) |
| **FR-007** | 실행 현황 실시간 표시 | ✅ **충족** | SSE 5종 이벤트. 지연 **29ms**(서버) / **246ms**(화면). `Last-Event-ID` 재연결·중복 0 검증(04-gen-11) |
| **FR-008** | 실패 증적 수집 (스크린샷·영상·trace·로그) | ✅ **충족** | **5종** 생성·표시·다운로드 전부 200 실측 |
| **FR-009** | 실행 취소 | ✅ **충족** | "취소 중" → SSE 확정 `cancelled`(380ms), 되돌아간 표시 0건 (04-gen-11) |
| **FR-010** | 스위트 묶음 실행 (SHOULD) | ✅ **충족** | run N건이 동일 `batch_id`, 3/3 passed (04-gen-11) |
| **FR-011** | 대시보드 지표 · 준비도 | ✅ **충족** | 실데이터 집계. 13k runs 에서 p95 5.3~11.3ms |
| **FR-012** | 실행 이력 조회 | ✅ **충족** | `/runs` 목록 + 상태 필터 + 상세. 인덱스 추가로 스케일 확보 |
| **NFR — 성능** | API p95 500ms / 큐 1s / 이벤트 2s | ✅ **충족** | 11.3ms / 45ms / 29ms |
| **NFR — 보안(마스킹)** | Secret 노출 차단 | ✅ **충족** | 4경로 전수 + 전 저장소 평문 0건 (대조군 확인) |
| **NFR — 보안(접근제어)** | — | ❌ **없음** | 비회원제. **사내망 제한이 전제.** 전환 지점 `[AUTHZ]` 주석 4곳 |

**요약: FR 12건 중 11건 충족, 1건(FR-005) 미충족 — 사용자 결정에 의한 대체.**

---

## 다음 단계 제안

우선순위 순.

1. **배포 서버 Node 버전 확인** — `node -v`. 22 미만이면 기동 자체가 안 된다. 5단계째 미확인.
2. **사내 스테이징 검증(Task 12.3)** — 주소만 받으면 바로 돌아간다(위 재현 절차).
   사내 로그인 폼이 `keydown` 의존이면 PoC-2 결과가 그대로 적용된다.
3. **증적 보존 정책** — `artifacts.expires_at` + 배치 삭제. **지금은 디스크가 무한히 찬다.**
   영상 1건이 수 MB~수십 MB이고, 실패 실행마다 5종이 쌓인다. 운영 투입 전에 넣어야 한다.
4. **`RUNNER_EXECUTION_MODE=docker` 전환** — 운영 권장 모드다. 이미지 빌드 후 전환.
   실행 1회당 컨테이너 1개 + 커널 수준 자원 제한이 생긴다.
5. **`mask.ts` 를 `packages/contracts` 로 승격** — 지금 구현이 2곳(api / runner)이고
   **규칙이 어긋나는 순간 한쪽으로 평문이 샌다.** 승격하면 `apps/runner/src/mask.ts` 가 사라진다.
6. **계약 2건 추가** — `RunListItemSchema.batchId`, `RunDetailSchema.queuePosition`.
   각각 스위트 묶음 패널과 큐 위치 표시가 제대로 된다(지금은 URL 로 우회 / 미표시).
7. **접근성 자동 검사(axe)** + **다중 탭 동시 관전 측정**.
8. **회원제 전환 검토** — `[AUTHZ]` 주석 4곳이 정확한 마이그레이션 지점이다.
   전부 NULL 허용 컬럼 추가 + 신규 테이블이라 **데이터 파괴 없이** 전환된다.
   전환하면 FR-005 를 제대로 구현할 토대도 생긴다(사용자별 자격증명 → 스케줄 실행).

---

## 검증 로그 (원본 명령)

| 명령 / 항목 | 결과 |
|---|---|
| `yarn typecheck` | ✅ 7 successful, 7 total |
| `yarn lint` | ✅ 7 successful, 7 total (0 problems) |
| `yarn build` | ✅ 5 successful. web JS **523.83KB** / gzip **164.59KB**, CSS 37.46KB / gzip 8.38KB. **500KB 경고 없음** |
| `yarn test` | ✅ **242건** (contracts 22 / web 52 / runner 75 / api 93) |
| `node apps/runner/dist-poc/poc/poc2-ime.js` | ✅ 4방식 × 12케이스 = **48/48 왕복 일치** |
| `node apps/runner/dist-poc/poc/poc3-roundtrip.js` | ✅ 로컬 14/14 · 공개 3/3 |
| `node /tmp/tf12/perf.mjs <projectId> 100` | ✅ 12 엔드포인트 전부 p95 < 12ms |
| 전 라우트 Playwright | ✅ **9/9 PASS**, 콘솔에러 0 |
| 해피패스 (웹 UI) | ✅ 생성→녹화→편집→발행→실행→관전 **`passed` 4/4**, 콘솔에러 0 |
| 실패 증적 (웹 UI) | ✅ `failed`, 증적 **5종** 표시 + 다운로드 5/5 × 200 |
| 마스킹 전 경로 grep | ✅ API·로그·DB·SSE·증적·Redis 버퍼 **평문 0건**, 대조군 1건 검출 |
| HEX 리터럴 (스타일 값) | ✅ **0건** |
| `style={{` | ✅ **0건** (CSS 커스텀 프로퍼티 주입 2건 제외 — 기존 패턴) |
| git | ✅ **커밋만. push 하지 않았다**(원격 저장소 없음) |
