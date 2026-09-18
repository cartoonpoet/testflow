---
# Round 2 PoC — 테스트 코드 실행의 라이브 스트리밍
pipeline_id: 20260917-231945
---

## ★ 판정 (게이트)

| 항목 | 합격 기준 | 실측 | 판정 |
|---|---|---|---|
| 프레임 왕복 지연 | ≤ 200ms | **p95 16.9 ms** (p50 12.6 / max 20.9) · 채택 경로 D · 샘플 264개 | ✅ 통과 (기준의 8.5%) |
| 실효 fps | ≥ 10fps | **13.20 fps** (15fps 스로틀 적용 상태) | ✅ 통과 |
| 대역폭 | (참고) | **2.28 Mbps / 세션** (라운드 1 무제한 14.6~33.1 Mbps → 1/10) | ✅ 목표 상태 달성 |
| 사용자 코드 무수정 | 필수 | **무수정** — spec 파일 0 바이트 변경. 주입은 `playwright.config.ts` + 환경변수뿐 | ✅ 통과 |
| 진행 이벤트 수신 | 필수 | reporter 이벤트 **105건** 수신 → SSE 규약 **46건** 변환, `RunEventSchema` **invalid 0건** | ✅ 통과 |

**결론 — 경로 D(`use.launchOptions` 로 CDP 포트를 열고 Runner 가 `connectOverCDP` 로 붙는다)를 채택한다.
단 다중 worker·다중 브라우저까지 감당해야 하면 경로 B(`launchServer` + `use.connectOptions`)로 올라간다.**

근거 (측정에 근거한 것만):

1. **네 경로 중 세 개가 실제로 동작했다.** A(fixture 주입)·B(launchServer+CDP)·D(launchOptions+CDP) 모두
   합격 기준을 통과했고, C(reporter)는 **원리적으로 불가능**함을 실측으로 확인했다.
2. **D 가 가장 얇다.** 우리가 주입하는 것은 `use.launchOptions.args` 한 줄이다. 브라우저 수명은 여전히
   Playwright 가 관리하므로 Runner 가 브라우저 프로세스를 돌볼 필요가 없다. B 는 Runner 가 `BrowserServer`
   수명을 직접 책임져야 하고(테스트가 죽으면 브라우저가 남는다), 그 대가로 얻는 것이 다중 worker 가시성뿐이다.
3. **A 는 `@playwright/test` 의 모듈 해석을 가로채야** 동작한다. 사용자 코드는 안 고치지만
   "사용자 spec 을 우리 디렉토리로 복사해 `node_modules` 를 겹쳐 쓴다"는 **깨지기 쉬운 장치**다
   (Playwright 버전업·pnpm 구조 변경에 노출된다). 성능은 A 가 가장 좋았지만(p95 12.1ms) 그 차이는
   기준의 2.4% 여서 구조적 취약성을 살 이유가 없다.
4. **B 는 A/D 가 막힐 때의 후퇴 경로이자, 다중 worker 요건이 생기면 올라갈 경로다.** 유일하게
   `workers: 2` 에서도 3개 page 전부를 열거했다(D 는 2개에서 멈춘다 — CDP 포트를 한 브라우저만 바인딩한다).

---

## 후보 경로별 실측 결과

측정 조건은 전 경로 동일 — `record-login.html`(무수정, rAF 막대 내장) · screencast `size` 1280×800 ·
JPEG q60 · **15fps 스로틀** · 20초 관측 구간 · 캔버스 클라이언트는 **진짜 headless Chromium**.

| 경로 | 동작 | fps | p50 | p95 | max | Mbps | 샘플 | 사용자 코드 |
|---|---|---|---|---|---|---|---|---|
| **A** fixture 주입(shim) | ✅ | 13.45 | 10.0 ms | **12.1 ms** | 22.6 ms | 2.32 | 269 | 무수정(복사만) |
| **B** launchServer + connectOptions | ✅ | 13.30 | 13.0 ms | 17.6 ms | 22.8 ms | 2.30 | 266 | 무수정 |
| **C** Reporter | ❌ | — | — | — | — | — | 0 | — |
| **D** launchOptions CDP + connectOverCDP | ✅ | 13.20 | 12.6 ms | 16.9 ms | 20.9 ms | 2.28 | 264 | 무수정 |
| **A0** ★ 음성 대조군 | ❌ (의도됨) | — | — | — | — | — | **0** | — |

원본 수치: [`r2-poc-measurements.json`](./r2-poc-measurements.json)
육안 증거: [`r2-viewer-live.png`](./r2-viewer-live.png) — 캔버스에 `hong.gildong` 입력·비밀번호 마스킹·
`스테이징` 선택·체크박스 체크·`로그인 성공`·`last: 확인|계약서 B` 가 **테스트 진행 중 상태 그대로** 찍혔다.

### A. 커스텀 fixture 주입

**결과: 동작한다. 단 "우리가 config 만 주입한다"로는 불가능하고, 모듈 해석 가로채기가 필요하다.**

- `playwright.config.ts` 에는 **`page` fixture 를 덮어쓰는 훅이 없다.** `globalSetup` 은 page 를 못 보고,
  `use` 에 넣을 수 있는 것은 `viewport`/`launchOptions`/`connectOptions` 같은 **옵션**뿐이다.
  `test.extend()` 로 만든 `test` 는 **사용자가 그것을 import 해야** 효력이 있다.
- 그래서 실제로 만든 것: **`@playwright/test` 해석 가로채기.**
  실행 시점에 `poc/r2/pw/shimroot/` 를 만들고 ① shim 패키지(`pw/shim-pkg/` 원본)를
  `shimroot/node_modules/@playwright/test/` 로 설치, ② 사용자 spec 을 `shimroot/specs/` 로 **복사**한다.
  그러면 Node 모듈 해석이 상위를 훑다가 우리 shim 을 진짜 패키지보다 먼저 잡는다.
  (shim 원본을 `shim-pkg` 라는 이름으로 커밋하는 이유는 루트 `.gitignore` 의 `node_modules/` 규칙이
  literal `node_modules` 경로를 통째로 제외하기 때문이다 — 그래서 런타임에 설치한다.)
  shim 은 `playwright/test`(진짜 구현)를 가져와 `test` 만 `extendTest()` 로 감싸 재수출한다.
  - `@playwright/test` 는 실제로 `module.exports = require('playwright/test')` 한 줄짜리 재수출 패키지라
    **모듈 인스턴스가 갈라지지 않는다**(갈라지면 "Playwright Test did not expect test() to be called here" 가 난다).
  - `import * as` + `export *` + 로컬 `export const test` 조합으로 `expect`/`defineConfig` 등은 그대로 통과한다.
- 프레임을 worker 프로세스 **밖으로** 내보내는 방법: **WS 클라이언트.**
  `worker →(ws /r2/ingest)→ Runner 호스트 →(ws /r2/view)→ 브라우저 캔버스`.
  홉이 하나 더 붙지만 loopback 이라 비용이 안 보인다(오히려 p95 12.1ms 로 **가장 빨랐다** — B/D 는
  Runner 가 CDP 로 한 번 더 경유하기 때문이다). stdout IPC 는 JPEG 바이너리 프레이밍 때문에 배제,
  파일은 지연이 붙어 배제했다.
- worker 쪽 실측(`[R2FX]`): `produced: 2705 → sent: 602` — 60fps 원본을 **worker 안에서** 15fps 로 깎아
  WS 홉에 60fps 를 흘리지 않는다.

**리스크(기록):** shim 은 Playwright 패키지 내부 구조(`@playwright/test` → `playwright/test` 재수출)에
의존한다. 버전업으로 이 구조가 바뀌면 조용히 깨진다. 채택하려면 **shim 로드 검증 테스트**가 필수다.

#### A0 — ★ 음성 대조군 (이 결과가 자기충족적이 아니라는 증거)

`TESTFLOW_R2_INGEST_WS` 를 **똑같이 켜 둔 채 shim 만 빼고** 같은 측정을 돌렸다.
→ **프레임 0장.** 테스트는 정상 통과하고 reporter 이벤트도 다 왔다. 즉 스트리밍을 붙인 것은
"fixture 를 썼다"가 아니라 **모듈 해석 가로채기**라는 것이 확인됐다. 이 대조군이 없으면
"fixture 주입이 된다"는 문장이 실제보다 훨씬 쉬운 일처럼 읽힌다.

### B. connectOverCDP / launchServer

**결과: 동작한다. `connectOptions` 만으로는 부족하고 CDP 를 겹쳐야 한다.**

- `use: { connectOptions: { wsEndpoint } }` 는 **동작한다.** Runner 가 `chromium.launchServer()` 로
  띄운 브라우저에 `playwright test` 가 붙었다.
- **★ 그런데 `launchServer` 의 wsEndpoint 로는 page 를 열거할 수 없다.** Playwright 자체 프로토콜은
  클라이언트별로 context 를 격리하므로, Runner 가 같은 엔드포인트에 또 붙어도 테스트가 만든 context 가 안 보인다.
- 해결: `launchServer({ args: ["--remote-debugging-port=<p>"] })` 로 **CDP 포트를 같이 열고**
  Runner 는 `chromium.connectOverCDP("http://127.0.0.1:<p>")` 로 붙는다. CDP 는 브라우저의 모든 target 을
  보므로 **누가 만들었든 모든 page 가 열거된다.**
  - `enumeratedPageUrls` 실측: `["about:blank", "http://127.0.0.1:37879/fixtures/record-login.html"]`
    ← 테스트가 `goto` 한 URL 이 Runner 쪽에 나타났다. **page 를 Runner 가 소유한다는 직접 증거다.**
  - 새 page 감지: `context.on("page")` **+ 100ms 폴링을 둘 다** 쓴다. 이벤트만으로는 (ⅰ) CDP 연결 전에
    이미 있던 page, (ⅱ) Playwright 가 새로 만든 BrowserContext 자체를 놓친다(`watchBrowserPages()`).
- **B 의 고유 강점 — `workers: 2` 에서 page 3개 전부 열거(`pagesAttached: 3`).** 모든 worker 가
  Runner 소유 브라우저 **하나**에 붙기 때문이다. D 는 worker 마다 브라우저를 띄우고 CDP 포트는
  하나만 바인딩되므로 `pagesAttached: 2` 에서 멈춘다.
- **B 의 비용 —** Runner 가 `BrowserServer` 수명을 직접 관리해야 한다. 테스트 프로세스가 비정상 종료하면
  브라우저가 남는다. 컨테이너 실행 모드(04-gen-6)에서는 이 정리 책임이 그대로 Runner 로 온다.

### C. Reporter 에서 붙기

**결과: 불가능하다. 추측이 아니라 실측이다.**

커스텀 reporter 의 `onTestBegin(test, result)` 인자 객체 그래프를 **깊이 4까지 실제로 훑어**
`Page` 처럼 생긴 객체(`.goto`/`.screenshot` 가 함수)를 찾았다. 결과:

```json
{ "pageFoundAt": [], "hasFixturesApi": false, "attachmentNames": [],
  "testKeys": ["_only","_requireFile","title","results","type","expectedStatus","timeout",
               "annotations","retries","repeatEachIndex","id","_poolDigest","_workerHash",
               "_projectId","_tags","_locks","_planAnnotations","fn","_testType","location","parent"],
  "resultKeys": ["retry","parallelIndex","workerIndex","duration","startTime","stdout","stderr",
                 "attachments","status","steps","errors","annotations"] }
```

- `pageFoundAt: []` — page 에 닿는 경로가 **하나도 없다.**
- `hasFixturesApi: false` — fixture 값에 접근하는 공식 API 가 없다.
- 구조적 이유: reporter 는 **Runner 프로세스**에서 돌고 page 는 **worker 프로세스**에 있다.
  reporter 가 받는 것은 직렬화된 결과다. `attachments`(스크린샷·비디오·trace)는 **테스트가 끝난 뒤
  파일로만** 온다 — 라이브가 아니다.

**단 reporter 는 진행 이벤트 경로로는 완벽하다** (아래 "진행 이벤트 매핑").

### D. (기타) `use.launchOptions` 로 CDP 포트를 열기 — ★ 채택

**결과: 동작한다. 그리고 가장 얇다.**

- 주입하는 것: `use: { launchOptions: { args: ["--remote-debugging-port=<p>", "--remote-debugging-address=127.0.0.1"] } }`
- Runner 는 worker 가 브라우저를 띄운 뒤 `connectOverCDP` 가 성공할 때까지 200ms 간격으로 재시도한다
  (포트가 열리는 시점을 우리가 모르기 때문이다. 실측 30초 한도 내 항상 성공).
- `enumeratedPageUrls` = `["http://127.0.0.1:42183/fixtures/record-login.html"]` — 열거 성공.
- **`test()` 여러 개**: `pagesAttached: 3` (테스트 3개 = page 3개). 테스트가 끝나 page 가 닫히고
  새 page 가 열리면 폴링이 잡아 **자동으로 새 page 에 screencast 를 다시 붙인다.**
- **`--ui` / trace viewer 는 조사만 했고 채택하지 않았다.** `--ui` 는 Playwright 자체 UI 프로세스를
  띄우는 것이라 우리 웹 화면에 프레임을 넣을 수 없다. trace viewer 는 **사후** 재생(스냅샷 기반)이다 —
  "실시간"이 아니라 이번 요구를 만족하지 않는다.

---

## 진행 이벤트 매핑

**실제로 받았다.** `--mode c` 한 번에 reporter 이벤트 **105건**을 수신했다(3 테스트).
`run.begin` 1 · `test.begin` 3 · `step.begin` 48 · `step.end` 48 · `test.end` 3 · `run.end` 1.

### 변환표 (Playwright reporter → 라운드 1 SSE 규약)

| Playwright | 조건 | SSE 이벤트 | 비고 |
|---|---|---|---|
| `onBegin` | — | `run.status` (`status: "running"`) | `config.workers`·`suite.allTests().length` 를 같이 받는다 |
| `onTestBegin` | — | (발행 안 함) | 여러 test 를 **하나의 run** 으로 본다. 필요하면 스텝 그룹 헤더로 쓴다 |
| `onStepBegin` | `category ∈ {pw:api, expect, test.step}` **AND `depth === 0`** | `step.started` | `sequence` 는 Runner 가 1부터 증가 부여 |
| `onStepEnd` | 위와 동일 | `step.finished` (+ `StepResult`) | `step.duration`·`step.error` 를 그대로 싣는다 |
| `onTestEnd` | — | (발행 안 함) | `status` 는 `run.end` 집계에 반영 |
| `onEnd` | — | `run.finished` | `passed`→`passed` / `failed`→`failed` / `timedOut`→`timeout` / `interrupted`·`skipped`→`cancelled` |
| `onError` | — | (`run.finished` 의 `errorMessage`) | |

**필터가 왜 필요한가** — Playwright 는 `hook`("Before Hooks"/"After Hooks"/"Worker Cleanup")과
`fixture`("Fixture \"browser\"" 등) 카테고리 step 도 보낸다. 이걸 그대로 흘리면 사용자 화면이
내부 구현으로 도배된다. `depth !== 0` 인 중첩 step(예: `expect` 안쪽의 locator 질의)도 뺀다.
실측 대비(3 테스트, `--mode d --spec functional`): **`step.begin` 51건 → 사용자에게 보여줄 스텝 22건.**
SSE 변환 결과 46건 = `run.status` 1 + `step.started` 22 + `step.finished` 22 + `run.finished` 1.

### 실제 변환 결과 (`RunEventSchema` 검증 통과, invalid 0건)

```json
{"event":"run.status","runId":"3bab4b44-…","status":"running","runnerId":"r2-poc","at":"2026-09-17T15:31:31.855Z"}
{"event":"step.started","runId":"3bab4b44-…","sequence":1,"name":"Navigate","totalSteps":1,"at":"…34.669Z"}
{"event":"step.finished","runId":"3bab4b44-…","sequence":1,"at":"…34.704Z",
 "result":{"id":"4976c17d-…","runId":"3bab4b44-…","stepId":null,"sequence":1,
           "nameSnapshot":"Navigate","actionType":"goto","status":"passed",
           "startedAt":"…34.669Z","durationMs":36,"errorMessage":null}}
{"event":"step.started","runId":"3bab4b44-…","sequence":2,"name":"Expect \"toBeVisible\"","totalSteps":2,"at":"…34.722Z"}
{"event":"step.started","runId":"3bab4b44-…","sequence":3,"name":"Fill \"***\"","totalSteps":3,"at":"…34.755Z"}
```

### ★ 반드시 넘겨야 할 발견 두 가지

**① step 제목에 입력값이 평문으로 실려 나온다.**
Playwright 가 보내는 실제 제목은 `Fill "hong.gildong"`, `Fill "s3cr3t-pw"` 다 — **비밀번호가 제목에 박혀 있다.**
라운드 1 규약(마스킹은 DB 쓰기 **전에**)을 코드 입력 실행에도 그대로 적용해야 한다. PoC 에서는
`stripStepValue()` 로 입력 계열(`Fill`/`Type`/`Set input`)만 `"***"` 로 벗겼다(위 출력의 `Fill "***"`).
`Expect "toHaveText"` 의 인용부호는 matcher 이름이므로 함께 지우면 안 된다.

**② step 제목은 API 이름이 아니라 사람이 읽는 라벨이다.**
`locator.click` 이 아니라 `Click`, `page.goto` 가 아니라 `Navigate`, `Wait for timeout`, `Select option`,
`Expect "toHaveText"` 다. 문서에서 추측해 `ActionType` 매핑을 짜면 전부 `wait` 로 떨어진다.
실제 매핑은 `poc/r2/map-events.ts` 의 `toActionType()` 에 실측 문자열로 넣었다.
**이 라벨은 Playwright 버전에 따라 바뀔 수 있다 — 매핑 회귀 테스트가 필요하다.**

---

## 병렬 worker / 다중 test 처리 결정

### 결정: **`workers: 1` 을 강제한다.**

근거는 측정이다. 같은 3개 테스트를 worker 수만 바꿔 돌렸다.

| 경로 | workers | pagesAttached | fps | p50 | p95 | 라이브 화면 |
|---|---|---|---|---|---|---|
| D | 1 | 3 | 12.33 | 11.3 ms | **13.7 ms** | 정상(한 화면이 순차 전환) |
| D | 2 | **2** ← 열거 실패 | **5.16** | 13.8 ms | **88.8 ms** | 두 테스트 화면이 섞인다 |
| B | 1 | 3 | 13.30 | 13.0 ms | 17.6 ms | 정상 |
| B | 2 | 3 | 12.99 | 14.3 ms | **43.2 ms** | 두 테스트 화면이 섞인다 |
| A | 1 | — | 12.99 | 12.5 ms | 15.2 ms | 정상 |
| A | 2 | — | 13.99 | 15.7 ms | **48.8 ms** | 두 worker 가 같은 소켓에 밀어 넣어 섞인다 |

- **화면이 1개다.** worker 가 2개면 page 도 2개이고, 둘의 프레임이 같은 캔버스에 교대로 그려진다.
  숫자는 기준 안에 있지만 **보이는 것은 쓸모가 없다**(두 테스트가 번갈아 깜빡인다).
- 경로 D 는 여기에 기능적 결함이 더 붙는다 — `--remote-debugging-port` 는 **한 브라우저만 바인딩**하므로
  두 번째 worker 의 브라우저는 CDP 로 보이지 않는다(`pagesAttached: 2`).
- p95 가 D 에서 13.7 → 88.8 ms (6.5배), B 에서 17.6 → 43.2 ms (2.5배)로 악화된다. 기준 내이긴 하다.

**본 구현 권고:** config 에 `workers: 1` 을 박고, 사용자 config 의 `workers`/`fullyParallel` 은 **덮어쓴다.**
병렬 실행이 필요한 사용자에게는 "라이브 보기 OFF" 모드를 따로 주는 것이 옳다(라이브를 포기하면 병렬 가능).

### 다중 `test()` — 스트림은 **끊기고, 자동으로 이어붙는다**

- 테스트마다 새 `BrowserContext`/`page` 가 생긴다(reporter 로그의 `Create context`/`Create page` 가 테스트마다 반복).
- D/B: 폴링이 새 page 를 잡아 `startScreencast` 를 **다시** 붙인다 → `pagesAttached: 3`.
  테스트 전환 구간에 **짧은 공백**이 생긴다(page 닫힘 ~ 새 page 첫 프레임). 실측으로는 프레임 간
  최대 간격이 커지는 것으로만 나타났고 세션은 끊기지 않았다.
- A: fixture 가 테스트마다 붙었다 뗀다 → 같은 ingest 소켓으로 이어지므로 뷰어 입장에서는 연속이다.
- **뷰어 쪽 대응이 필요하다**: 공백 구간에 "다음 스텝 준비 중" 같은 표시를 넣지 않으면 "멈췄다"로 오인된다.

### 사용자 자체 `playwright.config.ts` 와의 충돌

**충돌한다. 단 병합으로 해결된다 — 실측했다.**

- `playwright test --config` 는 **하나만** 먹는다. Playwright 에 config extends 가 없다.
- 그래서 **우리 config 가 사용자 config 를 동적 `import` 해서 병합**하는 것을 시험했다 → **동작한다.**
  ```
  [R2CFG] merged user config: ["testDir","timeout","expect","use","reporter"]
  1 passed (12.5s) · pagesAttached=1 · fps 12.49
  ```
  사용자의 `timeout: 45s` / `expect.timeout: 7s` / `use.locale: "ko-KR"` / `use.actionTimeout: 9s` 가 살아 있고,
  우리는 `testDir`·`workers`·`reporter`·`use.viewport`·`use.baseURL`·`use.launchOptions` 만 덮어썼다.
- **덮어쓰면 사용자가 잃는 것(반드시 고지해야 한다):**
  | 항목 | 왜 덮어쓰는가 | 완화 |
  |---|---|---|
  | `reporter` | live-reporter 가 없으면 진행 이벤트가 없다 | 사용자 reporter를 **배열에 append** 하면 둘 다 살 수 있다 |
  | `workers`, `fullyParallel` | 라이브 화면이 1개다 | 라이브 OFF 모드에서는 사용자 값 유지 |
  | `use.viewport` | screencast `size` 와 불일치하면 축소가 일어난다 | screencast size 를 사용자 viewport 에 맞추면 유지 가능 |
  | `use.launchOptions.args` | CDP 포트를 열어야 한다 | 사용자 args 에 **덧붙이기**(현재 PoC 는 통째로 교체 — 본 구현에서 고쳐야 한다) |
  | `use.baseURL` | PoC 가 fixture 를 서빙하려고 바꿨을 뿐 | 본 구현에서는 **덮어쓰지 마라** |
  | `projects`, `webServer` | — | **미검증.** 아래 "이슈/미검증" 참조 |

---

## headed vs headless 결론

**headless 로 간다.**

- **headless 로 화면이 나온다** — 위 모든 측정이 headless 다. 육안 증거(`r2-viewer-live.png`)도 headless 다.
- headed 도 **이 WSL 에서는 동작했다**(WSLg 가 `DISPLAY=:0` 를 제공한다).
  `chromium.launch({headless:false})` 성공, mode D + headed 측정 = **fps 13.09 / p50 13.4 / p95 18.9 ms /
  2.21 Mbps** — headless 와 유의미한 차이가 없다.
- 그래서 **headed 를 쓸 이유가 없다.** 화질·지연이 같고, headed 는 X 서버를 요구해
  Docker 실행 모드(04-gen-6)에서 배포 제약이 된다. 라운드 1의 "headed 미검증" 항목은 **이번에 해소됐고,
  결론은 '필요 없다'** 다.

---

## 측정 환경 / 재현 명령

WSL2 linux x64 (`/mnt/c` 마운트) · Node **v22.22.2** · TypeScript **6.0.3** ·
Playwright **1.63.0** (`playwright` + **`@playwright/test` 1.63.0 신규 추가**) ·
대상 = 로컬 `poc/fixtures/record-login.html`(**무수정**, rAF 막대 내장) ·
screencast `size` **1280×800** / `deviceScaleFactor: 1` / JPEG **quality 60** / **15fps 스로틀** ·
관측 **20초** 구간(경로별 샘플 264~269개, 기준 "100 프레임 이상" 충족) ·
**네트워크는 127.0.0.1 loopback (네트워크 홉 0)**.

측정 방법 — 라운드 1의 정직성 기준을 그대로 유지했다.

- **지연**: 캔버스 클라이언트를 **진짜 headless Chromium** 으로 띄워 WS 로 붙이고,
  프레임 봉투의 `capturedAtMs`(라운드 1 `screencast.ts` 가 첫 프레임에서 단위를 판별 —
  이번 측정 전부 `epoch-millis`) 와 클라이언트의 `drawImage` 완료 시각의 차이를 샘플링한다.
  보조로 `paint`(다음 rAF까지)도 같이 낸다. Node 에서 프레임 수신만 세지 않았다.
- **fps**: **렌더까지 끝난** 프레임 수 / 구간 초. 수신만 하고 버린 프레임은 세지 않는다.
- **대역폭**: 클라이언트가 실제로 받은 바이트 / 구간 초.
- **검은 캔버스 아님 검증**: 캔버스 픽셀을 샘플링해 `center = (244,248,247)` = 대상 페이지 `#f5f7f6`,
  서로 다른 색 51~54종. 추가로 뷰어 스크린샷을 남겼다.
- **음성 대조군**(A0): shim 만 빼고 같은 측정 → 프레임 0장. 측정이 실제로 무엇을 검사하는지 확인했다.

```bash
cd /mnt/c/Users/jhson1/Documents/GitHub/testflow
pnpm --filter @testflow/runner build:poc

# 전 경로 + JSON 산출 (약 5분)
node apps/runner/dist-poc/poc/r2/r2.js --all --spec measure --seconds 20 --specSeconds 45 \
  --out .pipeline/20260917-231945/r2-poc-measurements.json

# 개별
node apps/runner/dist-poc/poc/r2/r2.js --mode c --spec functional --seconds 0   # 경로 C 판정 + 진행 이벤트
node apps/runner/dist-poc/poc/r2/r2.js --mode a0 --spec measure --seconds 12    # 음성 대조군
node apps/runner/dist-poc/poc/r2/r2.js --mode d --spec functional --seconds 6 --workers 2
node apps/runner/dist-poc/poc/r2/r2.js --mode d --spec measure --seconds 10 --headed
TESTFLOW_R2_SHOT=/tmp/r2-viewer.png node apps/runner/dist-poc/poc/r2/r2.js --mode d --spec functional --seconds 6

# 사용자 자체 config 병합
node apps/runner/dist-poc/poc/r2/r2.js --mode d --spec ./specs-userconfig --seconds 6 \
  --userConfig "$PWD/apps/runner/poc/r2/pw/specs-userconfig/playwright.config.ts"

# 또는 pnpm 스크립트
pnpm --filter @testflow/runner poc:r2 -- --mode d --spec measure --seconds 12
```

검증 로그 (실제로 실행한 것만):

| 명령 / 항목 | 결과 |
|---|---|
| `pnpm --filter @testflow/runner add -D @playwright/test@1.63.0` | ✅ 설치. `playwright` 패키지의 CLI 에 `test` 서브커맨드가 이미 있지만 `@playwright/test` 가 없으면 spec 이 import 를 못 한다 |
| `pnpm --filter @testflow/runner typecheck` | ✅ exit 0 (tsconfig 3종 전부) |
| `pnpm typecheck` (전체) | ✅ **7 successful, 7 total** |
| `pnpm lint` (전체) | ✅ **7 successful, 7 total** |
| `pnpm build` (전체) | ✅ **5 successful, 5 total** |
| `pnpm test` (전체) | ✅ **7 successful, 7 total** (runner 75 tests) |
| `--mode c` (reporter) | ✅ 이벤트 105건, `pageFoundAt: []` — 경로 C 불가 확정 |
| `--mode a0` (음성 대조군) | ✅ 프레임 **0장** — 측정이 실제로 검사하고 있음 |
| `--mode a / b / d` | ✅ 3경로 전부 합격 기준 통과 (위 표) |
| `--workers 2` (a / b / d) | ✅ 열거·지연 악화를 수치로 확인 → `workers: 1` 근거 |
| headed (`--headed`) | ✅ WSLg 로 동작. 수치 차이 없음 → 쓸 이유 없음 |
| 사용자 config 병합 | ✅ `[R2CFG] merged user config: [...]` + 테스트 통과 |
| 뷰어 스크린샷 육안 확인 | ✅ 입력값·선택·체크·결과 텍스트가 **테스트 진행 중 상태로** 렌더 |
| `RunEventSchema` 검증 | ✅ 전 경로 `invalid: 0` (총 46건 변환) |
| 프레임 손실 | ✅ 백프레셔 드롭 **0건**, 클라이언트 드롭 **0건** (전 경로, 20초 구간) |

---

## 다음 단계에 전달할 사항

### 1. 본 구현 구조 (권고)

```
[Web]  ◀── SSE  run.status/step.started/step.finished/run.finished ──┐
       ◀── WS   프레임(25바이트 봉투, 15fps) ────────────────┐        │
                                                             │        │
[Runner]  RunReporter(기존) ◀── NDJSON/HTTP ── live-reporter ─┼────────┘
          screencast(기존, 무수정) ◀── connectOverCDP ── page │
                                                             │
          spawn: playwright test --config <우리 config> ──────┘
                  use.launchOptions.args = ["--remote-debugging-port=<p>"]   ← 경로 D
                  workers = 1 (강제)
                  reporter = [우리 live-reporter, ...사용자 reporter]
```

1. **`playwright.config.ts` 를 우리가 생성해 주입한다.** 사용자 config 가 있으면 **동적 import 해서 병합**하고,
   `workers`/`reporter`/`use.launchOptions.args`/`use.viewport` 만 덮는다.
   `use.baseURL`·`projects`·`webServer` 는 **사용자 값을 유지**하라(PoC 는 baseURL 을 덮었지만 그건 fixture 서빙 때문이다).
2. **경로 D 로 붙는다.** CDP 포트는 **실행마다 빈 포트를 할당**하라(PoC 는 host 포트에서 파생시켰다 —
   동시 실행 시 충돌한다). Runner 는 `connectOverCDP` 가 성공할 때까지 200ms 폴링.
3. **`watchBrowserPages()` 패턴을 그대로 가져가라** — `context.on("page")` + 폴링 **둘 다**.
   이벤트만으로는 기존 page 와 새 BrowserContext 를 놓친다(실측으로 확인).
4. **진행 이벤트는 커스텀 reporter → Runner → 기존 `RunReporter.publish()`** 로 흘린다.
   reporter 안에서 Redis/contracts 를 건드리지 마라(사용자 테스트의 의존성 그래프가 오염된다).
   SSE `seq` 부여와 Redis 버퍼링 순서(04-gen-5: RPUSH 후 PUBLISH)는 그대로 Runner 책임이다.
5. **마스킹을 잊지 마라.** step 제목에 입력값이 평문으로 온다(위 발견 ①). `mask.ts` 를
   `nameSnapshot`·`errorMessage` **양쪽** 경로에 강제 적용하라.

### 2. 라운드 1 코드 중 재사용 / 폐기

| 라운드 1 자산 | 판정 | 근거 |
|---|---|---|
| `src/record/screencast.ts` | **그대로 재사용 (무수정)** | `startScreencast(page, opts)` 의 `page` 인자는 CDP 로 얻은 page 여도 동작한다. 이번 PoC 는 이 파일을 **한 글자도 고치지 않았다** — 라운드 1이 시그니처를 `StartScreencast` 타입으로 못박은 것이 그대로 값을 했다 |
| 프레임 봉투 (`FRAME_HEADER_BYTES = 25`) | **재사용** | 경로 A/B/D 전부 같은 봉투로 측정했다. `poc-ws-server.ts` 에서 상수를 import 해 씀 |
| 드롭 정책 (서버 `bufferedAmount > 256KiB`, 클라 "렌더 중이면 최신 1장") | **재사용** | 20초 구간 드롭 0건 |
| 15fps 스로틀 (`RECORD_MAX_FPS`) | **재사용** | 2.28 Mbps 로 라운드 1의 1/10. `screencast.ts` 를 고치지 않고 `onFrame` 래퍼(`throttleFrames()`)로 구현했다 |
| `src/record/input-bridge.ts` (입력 역주입) | **코드 입력 실행에는 불필요** | 테스트 코드 실행은 **보기만** 한다. 사용자가 원격 조작을 하면 테스트가 깨진다. 녹화 모드에서만 쓴다 |
| `src/execute/interpreter.ts` (JSON 스텝 해석) | **유지 — 녹화 경로 전용** | 두 실행 엔진이 공존한다: 녹화 → interpreter, 코드 입력 → `playwright test`. 스텝 결과가 같은 `StepResult` 로 수렴하는 것이 이번 PoC 로 확인됐다(`RunEventSchema` invalid 0) |
| `src/execute/reporter.ts` (`RunReporter`) | **그대로 재사용** | 코드 입력 경로도 여기로 들어가면 SSE/DB 규약이 하나로 유지된다 |
| `poc/client/index.html` | **부분 재사용** | 프레임 수신·드롭·렌더는 그대로. 입력 역주입 경로는 코드 입력 모드에서 **빼라**(`poc/r2/client/index.html` 이 그 형태다) |

### 3. 이번 PoC 산출물의 승격 위치

| PoC 파일 | 승격 위치 (권고) |
|---|---|
| `poc/r2/host.ts` 의 `watchBrowserPages`/`launchOwnedBrowser`/`attachStream`/`throttleFrames` | `src/execute/code-browser.ts` (신규) |
| `poc/r2/pw/live-reporter.ts` | `src/execute/pw-reporter.ts` (신규, 사용자 프로세스로 주입됨) |
| `poc/r2/map-events.ts` | `src/execute/pw-event-mapper.ts` (신규). `toActionType` 매핑 회귀 테스트 **필수** |
| `poc/r2/pw/config.ts` | Runner 가 런타임에 생성하는 config 템플릿 |
| `poc/r2/client/index.html` | `apps/web` 의 라이브 뷰 컴포넌트(입력 없는 `StreamCanvas`) |
| `poc/r2/pw/shim-pkg/**` + `stream-fixture.mjs` (경로 A) | **폐기 후보.** 경로 D 를 채택하면 필요 없다. 후퇴용으로만 남긴다 |

### 4. 대안이 필요 없어진 것 (기록)

오케스트레이터가 준비한 대안 두 가지는 **쓰지 않아도 된다** —
"실행을 자체 interpreter 로 계속 하고 코드를 JSON 으로 변환"(코드 표현력이 깎인다),
"라이브를 포기하고 스텝별 스크린샷"(요구 자체를 못 만족한다).
**세 경로가 실제로 동작했고 기준을 여유롭게 통과했다.**

---

## 이슈 / 미검증

### 정직하게 — 이번에 **측정하지 않은** 것

| 항목 | 사유 / 리스크 |
|---|---|
| **`projects` 여러 개인 사용자 config** | 미검증. project 마다 브라우저가 따로 뜨면 `workers: 1` 이어도 page 가 여러 개가 된다. D 는 CDP 포트 충돌, B 는 열거는 되지만 화면이 섞인다. **본 구현 전에 반드시 시험하라** |
| **`webServer` 를 쓰는 사용자 config** | 미검증. 병합은 되지만 포트 충돌·기동 대기가 우리 타임라인과 섞인다 |
| **`use.launchOptions.args` 를 이미 쓰는 사용자** | PoC 는 `launchOptions` 를 통째로 교체한다. 본 구현에서는 **args 배열에 덧붙여야** 한다 |
| **Docker 실행 모드에서의 경로 D** | 미검증. 컨테이너 안에서 `--remote-debugging-port` 를 열고 Runner(호스트)가 붙으려면 포트 노출이 필요하다. 04-gen-6 의 컨테이너 실행 모드와의 결합은 별도 검증 항목이다 |
| **사내망 홉이 붙었을 때의 지연** | loopback 만 측정했다(라운드 1과 같은 한계) |
| **동시 세션 N개** | 단일 세션만. 2.28 Mbps/세션이면 1 Gbps LAN 에서 이론상 300+ 세션이지만 CPU(JPEG 인코딩)가 먼저 막힐 것이다 |
| **테스트 실패·타임아웃 시의 스트림 거동** | 부분 관측만. 첫 시도에서 `selectOption` 타임아웃(120초)이 났을 때 reporter 이벤트는 정상이었고 worker 가 재시작(workerIndex 0→1)됐다. **worker 재시작 시 새 브라우저가 뜨면 D 의 CDP 포트는 재바인딩에 실패할 수 있다 — 미검증** |
| **경로 A shim 의 Playwright 버전 내구성** | 1.63.0 에서만 확인. `@playwright/test → playwright/test` 재수출 구조에 의존한다 |
| **사용자 spec 이 `@playwright/test` 를 CJS 로 require 하는 경우** | shim 의 CJS 경로는 **명시적 에러를 던지게** 해 뒀다(조용히 스트리밍이 안 붙는 것보다 낫다). 실제 CJS 테스트는 돌려 보지 않았다 |
| **입력 역주입(원격 조작)** | 범위 밖. 코드 실행 모드는 "보기만" 이다 |

### 이번에 어쩔 수 없이 손댄 것 (범위 준수 보고)

- **`src/record/screencast.ts` 는 무수정.** 요청대로 import 만 했다. 15fps 스로틀은 `onFrame` **래퍼**로 구현.
- `apps/runner/package.json` — `@playwright/test@1.63.0` devDependency 추가 + `poc:r2` 스크립트 추가.
  (`@playwright/test` 없이는 `playwright test` 로 spec 을 실행할 수 없다.)
- `apps/runner/tsconfig.poc.json` — `exclude` 에 `poc/r2/pw` 추가.
  이 디렉토리는 **Playwright 가 직접 TS 로 로드**하므로 tsc 가 컴파일하면 dist-poc 에 사본이 생겨
  어느 쪽이 로드됐는지 흐려진다.
- `apps/runner/eslint.config.js` — `poc/r2/pw/**` ignore 추가.
  사용자 spec 역할 파일은 **무수정 대상**이라 린트 규칙 적용 자체가 부적절하고,
  `stream-fixture.mjs` 는 평문 JS 라 타입 기반 린트 프로젝트에 속하지 않는다.
- `apps/runner/vitest.config.ts` — **신규.** `poc/r2/pw/**/*.spec.ts` 는 Playwright Test 용 파일이라
  vitest 가 집어 들면 `test() 를 여기서 부를 줄 몰랐다` 로 터진다. vitest 는 `src/` 만 본다.
- `apps/runner/poc/r2/.gitignore` — 경로 A 가 런타임에 만드는 `pw/shimroot/` 제외
  (shim 원본은 `pw/shim-pkg/` 로 커밋한다).

### 손대지 않은 것

`docker-compose.yml` · `packages/db/src/cli/guard.ts` · `.gitattributes` · `.npmrc` ·
`packages/contracts` 기존 스키마 · `apps/api/**` · `apps/web/**` · `src/record/**`(전부) ·
`src/execute/**`(전부) · `poc/measure.ts` · `poc/poc-ws-server.ts` · `poc/client/index.html` ·
`poc/fixtures/record-login.html` — **전부 무수정.**

브랜치 `feat/code-input-live-stream` (base: `chore/pnpm-migration`). **커밋만 했고 push 하지 않았다.**
