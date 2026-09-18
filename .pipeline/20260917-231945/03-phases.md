---
# Plan Artifact
pipeline_id: 20260917-231945
phase: 03-phases
feature: TestFlow 라운드 2 — 코드 입력 실행 + 라이브 스트리밍
total_gen_phases: 6
---

# Feature: TestFlow 라운드 2 — 코드 입력 실행 + 라이브 스트리밍
생성일: 2026-09-18

## 진행 전략

기술 리스크의 핵심(라이브 스트리밍이 가능한가)은 **PoC 에서 이미 해소됐다** —
경로 D 가 p95 16.9ms / 13.20fps / 2.28Mbps 로 기준을 통과했고, 진행 이벤트 105건을
SSE 규약 46건으로 변환해 `RunEventSchema` invalid 0건을 받았다. **그러므로 PoC 성격의 게이트를
다시 두지 않는다.**

대신 **PoC 가 측정하지 않고 넘긴 3건**이 남아 있고, 그중 둘은 결과에 따라 **구조가 바뀐다.**
그래서 게이트를 그 두 지점에만 둔다.

| 게이트 | 위치 | 무엇을 결정하는가 | 실패 시 |
|---|---|---|---|
| **G1 — 사용자 config 적합성** | Gen-Phase 3 Task 3.1 끝 | `projects` 다중 구성 · `webServer` 사용 config 에서 경로 D 가 성립하는가 | 경로 B 승급 또는 "지원하지 않는 config" 로 명시 거부 |
| **G2 — 격리 정책** | Gen-Phase 4 Task 4.5 끝 | 코드 실행의 기본 격리를 `docker` 로 둘 수 있는가 (컨테이너 안에서 경로 D 가 되는가) | `local` 기본 + README 에 신뢰 전제 명시 (숨기지 않는다) |

순서는 **계약·스키마 → API → Runner 실행 엔진 → Runner 라이브 스트림 → Web → 내보내기·통합검증** 이다.
Runner 실행 엔진(Gen-Phase 3)과 라이브 스트림(Gen-Phase 4)을 **나눈 이유**는, 스트림 없이도
"코드가 실행되고 결과가 DB·SSE 에 남는다"가 먼저 성립해야 라이브가 붙었을 때 **무엇이 깨졌는지
구분할 수 있기** 때문이다. 합치면 실패 원인이 두 겹으로 섞인다.

### 전 Gen-Phase 공통 규율 (모든 Task 에 암묵 적용 — 라운드 1에서 확립됨)

- **타입은 `@testflow/contracts` 에서만.** web·api·runner 가 타입을 재정의하지 않는다.
  contracts 는 **추가만** 하고 기존 필드명·구조를 바꾸지 않는다(3자가 함께 깨진다).
- **`.js` 확장자 필수** (순수 ESM). `verbatimModuleSyntax` 금지.
- **인라인 CSS 금지** (`style={{` 0건 — CSS 커스텀 프로퍼티 주입 예외 2건은 기존 패턴).
- **HEX 하드코딩 금지** — 색은 `globals.css` 의 `@theme` 토큰만 쓴다. 새 색·새 반경을 만들지 않는다.
- **`useEffect` 자제** — 서버 상태는 react-query, 이벤트 구독은 훅 하나에 가둔다.
- **마스킹은 DB 쓰기 전에.** `nameSnapshot`·`errorMessage` **양쪽** 경로에 강제한다.
- **CSS Selector 는 테스터 화면에 노출하지 않는다** (`?advanced=1` 전용). 코드 경로는 예외 —
  사용자가 직접 쓴 코드이므로 그대로 보여 준다.
- **비회원제** — 인증·권한·`created_by`·Guard 없음. `[AUTHZ]` 주석 위치 유지.
- **`docker-compose.yml` · `packages/db/src/cli/guard.ts` 는 지시 없이 고치지 않는다.**
- 각 Gen-Phase 끝에 `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test` 4종을 돌려
  **라운드 1 기준선을 깨지 않았음을 확인**한다(맨 끝 절 참조).

---

## ★ 설계 쟁점 7건 — 판단과 근거

각 쟁점은 아래 Task 로 분해돼 있고, Task 의 "작업" 항목이 근거를 그대로 요구한다.

### 쟁점 1 — 코드 본문을 어디에 저장하는가 · 다중 파일을 지원하는가

**판단: `scenarios.source_type` 컬럼 추가 + 코드 본문은 `scenario_codes` 1:1 신규 테이블. 단일 파일로 제한한다.**

- **파일 + `storage_key` 를 쓰지 않는 이유**: contracts 의 `STORAGE_KEY_PATTERN` 이
  `runs/<uuid-36>/<파일명>` **만** 허용한다(04-gen-6 이슈 9 — "Runner 가 그 밖의 키로 쓰면 파일은
  만들어지는데 API 가 400 으로 거부한다"). 시나리오 코드를 파일로 두려면 그 패턴을 넓혀야 하고,
  그러면 **증적 경로의 traversal 방어 표면이 같이 넓어진다.** 코드 본문은 수 KB 다 — 파일로 둘 이유가
  성능에도 없다. DB 에 두면 백업·롤백·트랜잭션이 스키마 하나로 끝난다.
- **`scenarios` 에 컬럼을 붙이지 않고 별도 테이블로 두는 이유**: TypeORM `find()` 는 기본적으로
  전 컬럼을 선택한다. `scenarios` 는 목록 화면이 페이지당 20행씩 읽는 **뜨거운 테이블**이고
  (라운드 1 실측 p95 6.3ms / 249행), 여기에 `MEDIUMTEXT` 를 붙이면 목록 조회가 코드 본문을
  전부 끌고 온다. 1:1 분리가 그 위험을 구조적으로 없앤다.
- **단일 파일로 제한하는 근거**: ① 다중 파일은 가상 파일트리 + 상대 import 해석 + 경로 쓰기 검증이
  필요하고, 그 쓰기 검증이 곧 **임의 경로 쓰기 취약점의 입구**다. ② PoC 는 단일 spec 만 실증했다
  (다중 파일·`projects` 는 미검증 목록에 있다). ③ 사용자 요구는 "codegen 산출물을 넣는다" 인데
  codegen 산출물은 **언제나 단일 파일**이다. → 확장 지점만 남긴다(`scenario_codes` 가 1:N 이 되면 된다).
- 상한: **256KB**(`MAX_SCENARIO_CODE_BYTES`). codegen 산출물의 수백 배다.

### 쟁점 2 — 두 실행 엔진이 `runs`·SSE·증적을 어떻게 공유하는가

**판단: `runs` 스키마를 바꾸지 않는다. `RunReporter` 를 두 엔진의 공통 출구로 쓴다. 증적은 수집 경로만 다르고 적재 경로는 같다.**

- 공유되는 것: `runs` 테이블 전량 · `step_results` 전량 · `artifacts` 전량 · SSE 이벤트 5종 ·
  `RunReporter.publish()` · `storage/` 어댑터 · 취소 채널 · heartbeat.
- **다른 것 3가지 (전부 Task 로 명시)**:
  1. **`runs.total_steps` 가 실행 중에 증가한다.** 라운드 1은 요청 시점에 스텝 수를 확정해 넣는다.
     코드 실행은 **실행해 봐야 스텝 수를 안다** — PoC 의 `step.started.totalSteps` 가 1,2,3… 으로
     늘어나는 형태가 그것이다. 계약을 바꿀 필요는 없다(`totalSteps` 는 이미 숫자다).
     **화면이 "N / M 단계" 의 M 이 커지는 것을 견뎌야 한다.**
  2. **`step_results` 를 미리 `pending` 으로 시딩할 수 없다.** 04-gen-6 결정 4번이 성립하지 않는다.
     시안의 "대기 번호" 3-상태 중 **대기 행이 없다.** 화면 처리가 필요하다(Task 5.7).
  3. **`step_results.step_id` 가 항상 NULL.** `test_steps` 에 대응 행이 없다. FK 는 이미 NULL 허용이다.
- **증적**: Playwright 가 `outputDir` 에 video/trace 를 **파일로** 떨어뜨린다. Runner 가 실행 후
  그 디렉토리를 훑어 `storage.putFile()` → `artifacts` 행 INSERT → `artifact.ready` publish.
  적재 규약(`runs/<runId>/<파일명>`)과 순서(`artifact.ready` 가 `run.finished` 보다 먼저)는 그대로다.
  screenshot 은 Playwright 가 실패 시 자동 생성(`use.screenshot: "only-on-failure"`)한 것을 쓴다.

### 쟁점 3 — 라이브 스트리밍 세션을 녹화와 같은 WS 서버에 둘 것인가

**판단: 같은 서버(`RUNNER_WS_PORT`)의 다른 경로(`/live/:runId`)로 둔다. 토큰 방식은 재사용하되 키 공간을 분리한다.**

- **같은 서버인 이유**: 포트 1개 · nginx 프록시 규칙 1개 · **프레임 봉투 25바이트 · 백프레셔 드롭
  정책 · `bufferedAmount` 상한이 전부 동일**하다. 분리하면 이 네 가지가 두 벌이 되고, 둘이 어긋나는
  순간 한쪽 화면만 조용히 깨진다.
- **분리되는 것**: 세션 레지스트리(녹화 세션 ↔ 실행 스트림)와 **Redis 토큰 키 공간**
  (`testflow:rec:token:` ↔ `testflow:run:token:`). 녹화 토큰으로 실행 스트림에 붙을 수 없어야 한다.
- **토큰 검증**: `sha256` + `timingSafeEqual` + Redis 해시 저장 + 즉시 폐기 — 04-gen-5 설계를
  **그대로** 쓴다. 해시/비교 함수를 복사하지 않고 **contracts 로 일반화**해 두 경로가 같은 코드를 탄다.
- **★ 실행이 끝나면 스트림이 끊긴다 — 그때 화면 처리**:
  **마지막 프레임을 유지하고 그 위에 상태 배지를 덮는다.** 캔버스를 비우지 않는다.
  - 근거: 실행이 끝나는 순간 캔버스가 비면 사용자는 "화면이 죽었다"로 읽는다. 마지막 프레임은
    **실패 직전 화면**이라 가장 정보가 많다.
  - 영상 증적(`video.webm`)이 도착하면 "영상으로 보기" 전환 버튼을 준다. **자동 전환은 하지 않는다**
    (마지막 화면을 보고 있는데 처음으로 되감기는 꼴이 된다).
  - **테스트 전환 구간의 공백**(PoC: page 닫힘 ~ 새 page 첫 프레임)에는 "다음 테스트 준비 중"
    오버레이를 띄운다. 안 하면 "멈췄다"로 오인된다 — PoC 가 명시적으로 넘긴 항목이다.

### 쟁점 4 — 격리 정책 ★ (게이트 G2)

**판단(권고): 코드 입력 실행의 기본값을 `docker` 로 한다. 단 Task 4.5 의 실측으로 확정한다.**

- **왜 라운드 1과 판단이 달라지는가**: 라운드 1의 실행 대상은 **우리가 만든 JSON 스텝**이었다.
  신뢰 경계가 없었고, 그래서 `local`(고유 임시 프로필 + 동시성 상한 + 하드 타임아웃)로 충분했다.
  라운드 2는 **사용자가 넣은 임의 Node 코드를 `node` 프로세스로 실행**한다. 그 코드는
  `fs.readFile("/home/…/.ssh/id_rsa")` 도 `fetch("http://외부")` 도 할 수 있다.
  **"개인 프로젝트라 괜찮다"는 신뢰 경계가 없다는 뜻이 아니라 공격자가 자기 자신이라는 뜻일 뿐이다** —
  붙여넣은 코드가 어디서 왔는지는 우리가 모른다.
- **라운드 1의 컨테이너 설계를 그대로 못 쓴다.** 04-gen-6 은 **브라우저만** 컨테이너에 넣고
  인터프리터(와 비밀번호)는 호스트에 뒀다. 코드 실행에서는 **격리해야 할 대상이 바로 그 프로세스**다
  → `playwright test` 프로세스째 컨테이너에 들어가야 한다. 그 대가:
  | 항목 | 결과 |
  |---|---|
  | `variables` 평문 | **컨테이너 안으로 들어간다**(env). 라운드 1은 안 들어갔다 — 후퇴다 |
  | CDP 포트 | 컨테이너 → 호스트 노출이 필요하다 (**PoC 미검증**) |
  | reporter → Runner 경로 | 컨테이너 → 호스트 포트 접근이 필요하다 |
  | 증적 | `outputDir` 를 마운트하거나 종료 후 `docker cp` 해야 한다 |
  | 실행 오버헤드 | 라운드 1 실측 **+6.5초**, 이미지 3.57GB |
- **그래서 게이트다.** Task 4.5 가 위 4가지를 실제로 돌려 본다. 되면 기본값 `docker`,
  안 되면 **기본값 `local` + README 에 "붙여넣는 코드는 서버에서 그대로 실행된다"를 명시**한다.
  **되는 척하지 않는다.** 어느 쪽이든 `RUNNER_CODE_EXECUTION_MODE` 로 전환 가능하게 배선한다.

### 쟁점 5 — 사용자 코드가 다른 패키지를 import 하면

**판단: `@playwright/test` 만 허용한다. 저장 시점에 거부하고, 실행 시점에 한 번 더 잡는다.**

- 허용 목록: `@playwright/test` (그리고 Node 내장 모듈은 **불허** — 파일 접근의 직접 경로다).
  상대 경로 import 도 불허(단일 파일이므로 가리킬 대상이 없다).
- **검증 위치**: `packages/contracts` 의 **순수 함수**. web(저장 전 즉시 표시)과
  api(`PUT /code` 에서 400)가 **같은 함수**를 쓴다. 두 벌이면 규칙이 어긋나는 순간 한쪽이 뚫린다.
- **구현**: 정규식 스캐너(`import … from "x"` / `import("x")` / `require("x")` 3형태).
  **AST 파서를 쓰지 않는 이유**: TS 파서를 API 에 끌어들이면 의존성이 늘고
  `minimum-release-age` 게이트를 또 통과해야 한다. 그리고 —
- **★ 이 검사는 보안 장치가 아니다.** 정규식은 우회된다(`require(["f","s"].join(""))`).
  **보안은 쟁점 4(격리)가 담당하고, 이 검사는 "왜 안 돌아가는지"를 사용자에게 알려 주는 UX 장치다.**
  이 문장을 코드 주석과 README 양쪽에 남긴다 — 나중에 이걸 보안 경계로 착각하면 위험해진다.
- **사용자에게 알리는 방법**: `{line, column, moduleName, reason}` 배열을 400 응답 `details` 로
  돌려주고, 에디터가 해당 줄 번호와 함께 표시한다. 실행 중에 뚫고 들어간 경우
  (`ERR_MODULE_NOT_FOUND`)는 `run.status = error` + 한국어 안내 메시지로 확정한다
  (`failed` 가 아니다 — 04-gen-6 결정 6번의 "실행 환경 오류 ↔ 시나리오 실패" 구분을 따른다).

### 쟁점 6 — 코드 에디터 컴포넌트

**판단: `textarea` + 문법 강조 없음. CodeMirror/Monaco 를 넣지 않는다.**

- **번들**: 현재 초기 로드 **523.83KB**(gzip 164.59KB). CodeMirror 6 최소 구성
  (`@codemirror/state` + `view` + `lang-javascript` + 테마)은 **수백 KB 대**이고
  Monaco 는 MB 대다. 코드 입력 화면은 라우트 분할 대상이라 초기 로드를 직접 깨지는 않지만,
  **그 청크를 여는 순간 체감이 생긴다.**
- **테마 토큰**: 라운드 1 규율은 **HEX 하드코딩 0건**이다. CodeMirror 테마는 JS 객체 안의 HEX 다.
  규율을 지키려면 CSS 변수 → 테마 객체 변환 계층을 또 만들어야 한다. 얻는 것은 색칠 하나다.
- **의존성 정책**: `.npmrc` 의 `minimum-release-age=1440` 을 통과해야 하고, 새 런타임 의존은
  라운드 1이 끝까지 지킨 "의존성 추가 없음" 기조를 깬다.
- **라운드 2의 가치는 실행과 라이브 스트리밍에 있다.** 에디터 광택이 아니다.
- **대신 하는 것**: 모노 폰트 토큰(`ui-monospace…` 는 이미 시안에 있다) · `spellCheck=false` ·
  `Tab` 키를 들여쓰기로 처리 · 줄 수 표시 · 검증 오류의 줄 번호 표시 · **파일 업로드 경로**.
- **승급 조건(기록)**: 사용자가 "편집이 불편하다"를 실제로 말하면, **이미 lazy 인 빌더 청크 안에서만**
  CodeMirror 를 도입하고 초기 로드 델타를 측정해 보고한다.

### 쟁점 7 — 녹화 스텝 → Playwright 코드 내보내기 (우선순위 낮음)

**판단: `packages/contracts` 의 순수 함수로 만들고 마지막 Gen-Phase 에 둔다.**

- `target_json.primary`/`fallbacks` 의 `by` → 다음 형태로 낸다.
  | `by` | 출력 |
  |---|---|
  | `role` | `page.getByRole("button", { name: "로그인", exact: true })` |
  | `label` | `page.getByLabel("아이디", { exact: true })` |
  | `text` | `page.getByText("로그인", { exact: true })` |
  | `testid` | `page.getByTestId("confirm-a")` |
  | `css` | `page.locator("#login-submit")` |
  - `nth` 가 있으면 `.nth(n)` 를 뒤에 붙인다. `frameUrl` 이 있으면 **주석으로 표시**하고
    top frame 기준 코드를 낸다(frameLocator 변환은 이번 범위 밖 — 근거를 함수 주석에 남긴다).
- **`isSecret: true` 인 값은 절대 평문으로 내보내지 않는다.** `process.env["TESTFLOW_VAR_password"]`
  참조 + 상단 안내 주석으로 낸다. 라운드 1이 애초에 **평문을 수집하지 않으므로** 낼 값도 없다.
- **왕복 검증**: 생성된 코드가 쟁점 5의 import 검증을 통과해야 하고,
  **그 코드를 코드 시나리오로 넣어 실행하면 통과해야 한다**(Gen-Phase 6 해피패스 B 에 포함).

---

## 재사용 / 신규 / 폐기 구분

| 항목 | 판정 | 근거 |
|---|---|---|
| `src/record/screencast.ts` | **재사용 (무수정)** | PoC 가 한 글자도 안 고치고 세 경로 전부에서 썼다. `startScreencast(page, …)` 의 `page` 는 CDP 로 얻은 page 여도 동작한다 |
| 프레임 봉투 `FRAME_HEADER_BYTES = 25` | **재사용** | 경로 A/B/D 전부 같은 봉투로 측정. 웹 `frame.ts` 디코더도 그대로 |
| 드롭 정책(서버 `bufferedAmount > 256KiB`, 클라 "렌더 중이면 최신 1장") | **재사용** | 20초 구간 드롭 0건 |
| 15fps 스로틀 (`RECORD_MAX_FPS`) | **재사용** | 2.28 Mbps = 라운드 1 무제한의 1/10 |
| `src/execute/reporter.ts` (`RunReporter`) | **재사용** | 코드 실행도 여기로 들어가야 SSE/DB 규약이 하나로 유지된다 |
| `src/execute/interpreter.ts` · `locator.ts` · `variables.ts` | **유지 — 녹화 경로 전용** | 두 엔진이 공존한다. 손대지 않는다 |
| `src/execute/artifacts.ts` | **부분 재사용** | 적재(storage→artifacts 행→`artifact.ready`) 부분은 그대로, **수집** 부분만 다르다 |
| `src/storage/**` | **재사용 (무수정)** | `putFile()` 이 이미 있다 |
| `src/record/ws-server.ts` | **확장** | `/live/:runId` 경로를 추가한다. 봉투·드롭·토큰 구조를 그대로 물려받는다 |
| `src/record/input-bridge.ts` | **녹화 전용 — 코드 실행에는 붙이지 않는다** | 코드 실행은 "보기만" 한다. 원격 조작하면 테스트가 깨진다 |
| `apps/web/src/features/recorder/frame.ts` · `useFrameRenderer.ts` | **재사용** | 디코드·렌더·드롭은 동일. 입력 경로만 빠진다 |
| `apps/web/src/features/recorder/useInputBridge.ts` · `useImeBridge.ts` | **코드 실행 화면에서 쓰지 않음** | 위와 같은 이유 |
| `apps/web/src/lib/sse.ts` · `hooks/useRunEvents.ts` · `lib/run-events.ts` | **재사용 (무수정 목표)** | 이벤트 5종이 그대로다. `totalSteps` 증가만 견디면 된다 |
| `apps/api/src/modules/recordings/recording-token.ts` | **일반화 후 재사용** | 같은 토큰 규약을 실행 스트림에도 쓴다. **복사하지 않는다** |
| `poc/r2/host.ts` 의 `watchBrowserPages`/`attachStream`/`throttleFrames` | **승격 →** `src/execute/code-browser.ts` | PoC 가 실증한 코드 |
| `poc/r2/host.ts` 의 `launchOwnedBrowser`(경로 B) · `/r2/ingest`(경로 A) | **PoC 에 남긴다 — 제품으로 승격하지 않는다** | B 는 후퇴/승급 경로로만 필요하다. A 는 폐기 대상 |
| `poc/r2/pw/live-reporter.ts` | **승격 →** `src/execute/pw-reporter.ts` | 사용자 프로세스로 주입된다. contracts/Redis 의존 금지 |
| `poc/r2/map-events.ts` | **승격 →** `src/execute/pw-event-mapper.ts` | `toActionType` **매핑 회귀 테스트 필수** |
| `poc/r2/pw/config.ts` | **참고만 — 다시 쓴다** | PoC 는 mode a/b/d 분기 + baseURL 덮어쓰기 + launchOptions 통째 교체다. 제품은 **D 전용 + args 덧붙이기 + baseURL 유지** |
| `poc/r2/client/index.html` | **참고만** | 웹 `StreamCanvas` 로 다시 만든다(입력 없음) |
| `poc/r2/pw/shim-pkg/**` · `shimroot/**` · `stream-fixture.mjs` (경로 A) | **폐기** | 경로 D 채택으로 불필요. 모듈 해석 가로채기는 버전업에 조용히 깨진다 |
| `RunSidePanel.tsx` 의 `FakeLoginMock` | **폐기** | 요구사항 3번이 지목한 대상 |
| `poc/r2/r2.ts` (측정 하네스) | **PoC 에 남긴다** | 재측정 재현 경로. 제품 코드 아님을 주석에 이미 명시 |

---

## Gen-Phase 1 — 공유 계약 + DB 스키마

> 다음 전 단계가 여기에 의존한다. **Task 1.1 이 선행 Task 다.**

### Task 1.1: 시나리오 `sourceType` + 코드 본문 계약
- **파일**: `packages/contracts/src/scenario.ts` (수정 — **추가만**)
- **작업**: `SCENARIO_SOURCE_TYPES = ["steps","code"] as const` + `ScenarioSourceTypeSchema` 를 정의하고
  `ScenarioSchema` · `ScenarioListItemSchema` · `ScenarioDetailSchema` 에 `sourceType` 을 **추가**한다.
  `CreateScenarioDtoSchema` 에 `sourceType: ScenarioSourceTypeSchema.default("steps")` 를 추가한다
  (기본값을 `steps` 로 두어 기존 호출부가 그대로 통과해야 한다).
  `ScenarioCodeSchema`(`{scenarioId, filename, content, sizeBytes, updatedAt}`) 와
  `PutScenarioCodeDtoSchema`(`{filename, content}`) 를 추가한다.
  `MAX_SCENARIO_CODE_BYTES = 256 * 1024` 를 근거 주석(쟁점 1)과 함께 상수로 둔다.
  **기존 필드명·구조는 한 글자도 바꾸지 않는다.**
- **재사용**: `TestStepSchema` 계열 전부(무수정). 녹화 경로 계약은 손대지 않는다.
- **완료 기준**: ① `pnpm --filter @testflow/contracts test` 에서 `CreateScenarioDtoSchema.parse({name:"x"})`
  가 `sourceType === "steps"` 로 통과한다. ② `pnpm typecheck` 7/7 — 즉 `sourceType` 추가가
  web·api 의 기존 코드를 깨지 않는다(깨지면 추가가 아니라 변경이다).
- **상태**: [x]

### Task 1.2: 코드 검증 순수 함수 (import 허용 목록)
- **파일**: `packages/contracts/src/code-validation.ts` (신규 생성) + `code-validation.spec.ts` (신규)
- **작업**: `validateScenarioCode(content: string): CodeValidationIssue[]` 를 만든다.
  검사 항목 — ① 허용 목록 밖 import (`ALLOWED_IMPORTS = ["@playwright/test"]`),
  ② 상대 경로 import, ③ Node 내장 모듈(`node:fs` / `fs` 등), ④ 크기 초과, ⑤ 빈 본문,
  ⑥ `test(` 또는 `test.describe(` 가 하나도 없음(= 실행해도 아무 일도 안 일어난다 — **경고**).
  스캔 형태 3종: `import … from "x"` / `import("x")` / `require("x")`.
  `CodeValidationIssue = {line, column, severity: "error"|"warning", code, message, moduleName?}`.
  **파일 상단에 "이 검사는 보안 경계가 아니다 — 보안은 실행 격리(쟁점 4)가 담당한다" 를 명시**한다.
- **재사용**: 없음 (신규).
- **완료 기준**: ① 단위 테스트가 **정상 통과 케이스 + 거부 케이스 6종 + 우회 케이스**
  (`require(["f","s"].join(""))` 가 **검출되지 않음**)를 전부 고정한다 — 우회가 잡히지 않는다는 것을
  테스트로 **명시적으로 기록**해 이 함수를 보안 장치로 오해하지 못하게 한다.
  ② PoC 의 `poc/r2/pw/specs/codegen-login.spec.ts` 실물을 넣으면 issue 0건이다.
- **상태**: [x]

### Task 1.3: 라이브 스트림 계약 (토큰 · WS 메시지 · close code)
- **파일**: `packages/contracts/src/events.ts` (수정 — 추가만), `packages/contracts/src/recording.ts` (수정 — 추가만)
- **작업**: ① `LIVE_STREAM_TOKEN_KEY_PREFIX = "testflow:run:token:"` · `liveStreamTokenKey(runId)` ·
  `LIVE_STREAM_TOKEN_TTL_SEC` 를 추가한다(녹화 토큰 키 공간과 **분리** — 쟁점 3).
  ② S→C 텍스트 메시지 `LiveStreamServerMessageSchema` 를 판별 필드 `t` 로 정의한다:
  `{t:"state", state:"live"|"between-tests"|"ended", runStatus?}` · `{t:"error", code, message}`.
  프레임은 기존 25바이트 봉투 바이너리 그대로다(**새 포맷을 만들지 않는다**).
  ③ C→S 는 **없다** — 코드 실행 스트림은 단방향이다. 그 사실을 타입 주석으로 못 박는다.
  ④ `LiveStreamInfoSchema`(`{wsUrl, expiresAt}`) — `GET /api/runs/:id/live` 응답.
- **재사용**: `WS_CLOSE_UNAUTHORIZED`(4401) · `WS_CLOSE_SESSION_GONE`(4404) 상수 그대로.
- **완료 기준**: ① `LiveStreamServerMessageSchema.safeParse({t:"mouse",…})` 가 실패한다
  (= 입력 메시지가 이 union 에 들어올 수 없다). ② `pnpm --filter @testflow/contracts test` 통과.
- **상태**: [x]

### Task 1.4: DB 엔티티 + 마이그레이션 011
- **파일**: `packages/db/src/entities/scenario.entity.ts` (수정), `packages/db/src/entities/scenario-code.entity.ts` (신규),
  `packages/db/src/migrations/011-add-scenario-source.ts` (신규)
- **작업**: `scenarios` 에 `source_type ENUM('steps','code') NOT NULL DEFAULT 'steps'` 를 추가하고,
  `scenario_codes` 테이블을 만든다 —
  `id CHAR(36) PK` · `scenario_id CHAR(36) NOT NULL UNIQUE`(1:1) · `filename VARCHAR(255) NOT NULL` ·
  `content MEDIUMTEXT NOT NULL` · `size_bytes INT UNSIGNED NOT NULL` ·
  `created_at/updated_at DATETIME(3)` · `fk_scenario_codes_scenario … ON DELETE CASCADE`.
  MySQL 8 / `utf8mb4` / InnoDB / 원시 SQL / `pk_`·`fk_`·`uq_` 제약 이름 규약(ERDify)을 따른다.
  `down()` 도 실제로 되돌아가게 쓴다.
- **재사용**: 라운드 1 마이그레이션 001~010 의 DDL 스타일·제약 명명 규약 그대로.
- **완료 기준**: ① `pnpm db:migrate` 후 `SHOW CREATE TABLE scenario_codes` 가 위 제약을 그대로 보여 준다.
  ② `pnpm db:revert` 1회로 011 이 깨끗이 되돌아가고 재적용된다.
  ③ **기존 시나리오 행 전부가 `source_type='steps'` 로 채워진다**(SELECT 로 확인).
- **상태**: [x]

### Task 1.5: 마이그레이션 명시 등록 + 엔티티 barrel
- **파일**: `packages/db/src/migrations/index.ts` (수정), `packages/db/src/entities/index.ts` (수정)
- **작업**: `011` 을 배열 **끝에** 명시 등록한다(glob 금지 — ERDify 규약).
  `ScenarioCodeEntity` 를 barrel 에 추가한다.
- **재사용**: 라운드 1의 명시 등록 패턴.
- **완료 기준**: `pnpm db:migrate` 가 "적용할 마이그레이션이 없습니다"를 출력하고
  `SELECT * FROM typeorm_migrations` 에 **11건**이 있다.
- **상태**: [x]

---

## Gen-Phase 2 — API: 코드 시나리오 CRUD + 실행 분기 + 라이브 토큰

> Gen-Phase 1 전체에 의존.

### Task 2.1: 시나리오 생성·조회에 `sourceType` 배선
- **파일**: `apps/api/src/modules/scenarios/scenarios.service.ts` · `scenario.mapper.ts` (수정)
- **작업**: `POST /api/projects/:projectId/scenarios` 가 `sourceType` 을 받아 저장하고,
  목록·상세 응답에 노출한다. `code` 시나리오도 `code` 채번(`TC-…`) 규칙은 동일하게 쓴다.
  **`sourceType` 은 생성 후 변경할 수 없다** — `PATCH` 에서 받지 않는다(근거: 스텝과 코드가
  동시에 존재하는 상태를 만들면 어느 쪽으로 실행할지 규칙이 두 벌이 된다).
- **재사용**: 기존 시나리오 모듈 전량. 채번·검증·에러 처리 무수정.
- **완료 기준**: ① `POST …/scenarios {name, sourceType:"code"}` → 201, 응답 `sourceType==="code"`.
  ② `sourceType` 없이 만들면 `"steps"` 다(기존 웹 화면이 그대로 동작한다 — 실제로 호출해 확인).
  ③ `PATCH /api/scenarios/:id {sourceType:"steps"}` 가 **400** 이다(`forbidNonWhitelisted`).
- **상태**: [x]

### Task 2.2: 코드 본문 조회 · 저장 엔드포인트
- **파일**: `apps/api/src/modules/scenarios/scenario-code.controller.ts` (신규), `scenario-code.service.ts` (신규)
- **작업**: `GET /api/scenarios/:id/code` → `ScenarioCode` (없으면 404).
  `PUT /api/scenarios/:id/code` → 본문 저장(upsert). 저장 전 **`validateScenarioCode()` 를 호출해
  `severity:"error"` 가 하나라도 있으면 400 + `details: CodeValidationIssue[]`**.
  `sourceType !== "code"` 인 시나리오면 **400**(녹화 시나리오에 코드를 붙이지 않는다).
  `filename` 은 `[A-Za-z0-9._-]+\.spec\.ts` 만 허용하고 그 외는 400 (파일명이 나중에 디스크에 쓰인다 —
  경로 문자를 여기서 막는다).
  **업로드용 별도 엔드포인트를 만들지 않는다** — 웹이 `File` 을 텍스트로 읽어 이 엔드포인트로 보낸다.
  근거: multipart 를 받으려면 `main.ts` 의 `bodyParser:false` 부트스트랩에 새 미들웨어를 얹어야 하고,
  얻는 것이 없다(코드는 텍스트다).
- **재사용**: `zodBody(Schema)` 파이프 · Nest 기본 예외 · `@Controller()` 빈 인자 + 전체 경로 규약.
- **완료 기준**: ① `import fs from "fs"` 가 든 본문을 `PUT` 하면 **400** 이고 응답 `details[0].line` 이
  실제 줄 번호다. ② 정상 spec 을 `PUT` 하면 200 이고 `GET` 이 같은 본문을 돌려준다(바이트 일치).
  ③ `filename: "../../etc/passwd"` 는 400. ④ 256KB 초과 본문은 400.
- **상태**: [x]

### Task 2.3: 코드 시나리오의 발행(publish) 규칙
- **파일**: `apps/api/src/modules/scenarios/scenarios.service.ts` (수정)
- **작업**: 발행 조건을 `sourceType` 별로 가른다 — `steps` 는 기존 규칙(스텝 ≥ 1),
  `code` 는 **코드 본문이 있고 검증 오류가 0건**. 현재 발행 규칙이 무엇인지 **먼저 코드를 읽고 확인**한다
  (스텝 0건을 막는 규칙이 있는지 불확실하다). 기존 규칙을 바꾸지 말고 분기만 추가한다.
- **재사용**: 기존 `publish` 구현 · `version` 증가 로직.
- **완료 기준**: ① 코드 본문이 없는 `code` 시나리오 발행 → **400** + 한국어 메시지.
  ② 본문이 있으면 200 `{status:"published", version:2}`.
  ③ **녹화 시나리오 발행 동작이 전과 동일함을 실제로 호출해 확인한다**(회귀).
- **상태**: [x]

### Task 2.4: `POST /api/runs` 의 코드 시나리오 분기
- **파일**: `apps/api/src/modules/runs/runs.plan.ts` · `runs.service.ts` (수정)
- **작업**: 실행 계획 수립 시 `sourceType` 을 읽어 큐 페이로드에 싣는다
  (`RunJobDataSchema` 에 `sourceType` **추가** — contracts 변경은 Task 1.1 에서 이미 한다).
  `code` 시나리오는 `runs.total_steps = 0` 으로 시작한다(스텝 수를 알 수 없다 — 쟁점 2).
  **스텝 0건을 거부하는 규칙이 있으면 `code` 에서는 우회**한다. 그 규칙이 실제로 있는지
  `runs.plan.ts` 를 읽어 확인한다.
- **재사용**: `RUN-` 채번 · `batch_id` 묶음 · `jobId = runId` 규칙 · 202 응답 형태 전부 그대로.
- **완료 기준**: ① 코드 시나리오로 `POST /api/runs` → **202**, DB `runs.total_steps = 0`.
  ② 큐 페이로드(`HGET bull:run:<runId> data`)에 `"sourceType":"code"` 가 있다.
  ③ **스위트에 코드 시나리오와 녹화 시나리오를 섞어 넣어도 `batch_id` 묶음이 그대로 만들어진다.**
  ④ `runs.plan.spec.ts` 회귀 8건이 그대로 통과한다.
- **상태**: [x]

### Task 2.5: 라이브 스트림 토큰 발급 + 폐기
- **파일**: `apps/api/src/modules/runs/live-stream.controller.ts` (신규), `apps/api/src/common/utils/stream-token.ts` (신규),
  `apps/api/src/modules/recordings/recording-token.ts` (수정 — 공통 함수 사용으로 전환)
- **작업**: `GET /api/runs/:id/live` → `{wsUrl, expiresAt}`.
  `wsUrl = ws://RUNNER_WS_HOST:RUNNER_WS_PORT/live/<runId>?token=<평문>` (또는 `RUNNER_WS_PUBLIC_URL`).
  Redis `liveStreamTokenKey(runId)` 에 **sha256 해시만** TTL 과 함께 둔다.
  종료된 run(`isTerminalRunStatus`)이면 **404** — 끝난 실행에 스트림을 열어 주지 않는다.
  ★ 04-gen-5 의 토큰 발급·검증 로직을 **복사하지 않는다.** 공통 함수(`issueStreamToken`/`verifyStreamToken`)로
  뽑고 녹화 쪽이 그것을 쓰도록 바꾼다. 녹화 토큰의 **키 접두사·TTL·동작은 변하지 않아야 한다.**
- **재사용**: `recording-token.spec.ts` 9건이 그대로 통과해야 한다(리팩터링의 안전망).
- **완료 기준**: ① `GET /api/runs/:id/live` 응답 `wsUrl` 이 `:4100` 을 포함하고 `:4000` 을 포함하지 않는다.
  ② `redis-cli GET testflow:run:token:<runId>` 가 sha256 hex 64자이고 **평문 토큰이 아니다**.
  ③ 종료된 run 은 404. ④ **`pnpm --filter @testflow/api test` 93건이 그대로 통과한다**(기존 9건 포함).
- **상태**: [x]

### Task 2.6: `RunDetail` 에 `sourceType` 노출
- **파일**: `apps/api/src/modules/runs/run.mapper.ts` (수정), `packages/contracts/src/run.ts` (수정 — 추가만)
- **작업**: `RunSchema`(또는 `RunSummarySchema`)에 `sourceType` 을 **추가**한다. 화면이
  "이 실행은 코드 실행인가"를 알아야 라이브 뷰를 열지, 대기 행을 그릴지 판단할 수 있다.
  `runs` 테이블에 컬럼을 새로 만들지 말고 **`scenarios` 조인 또는 실행 시점 스냅샷** 중 무엇이 맞는지
  판단해 근거를 남긴다(권고: **run 에 스냅샷 컬럼을 추가** — 시나리오가 삭제돼도 이력이 남아야 한다는
  라운드 1 원칙(`scenario_name`·`base_url` 스냅샷)과 같은 이유다. 그러면 마이그레이션 011 에 컬럼 1개를 더 넣는다).
- **재사용**: `toRun`/`toRunSummary` 매퍼 구조.
- **완료 기준**: ① `GET /api/runs/:id` 응답에 `sourceType` 이 있다.
  ② **시나리오를 삭제한 뒤에도** 그 값이 유지된다(실제로 삭제하고 확인).
- **상태**: [x]

---

## Gen-Phase 3 — Runner: `playwright test` 실행 엔진 (스트림 없이)

> Gen-Phase 2 에 의존. **이 단계가 끝나면 라이브 화면 없이도 코드 시나리오가 실행되고
> 결과가 DB·SSE 에 남아야 한다.** 여기서 성립하지 않으면 Gen-Phase 4 로 넘어가지 않는다.

### Task 3.1: config 생성·주입 + 사용자 config 병합 ★게이트 G1
- **파일**: `apps/runner/src/execute/pw-config.ts` (신규 생성)
- **작업**: 실행마다 `playwright.config.ts` 를 **생성**해 작업 디렉토리에 쓴다.
  덮어쓰는 것은 **`testDir` · `workers:1` · `fullyParallel:false` · `reporter`(사용자 reporter 배열에
  **append**) · `use.viewport` · `use.launchOptions.args`(**기존 args 에 덧붙이기**)** 뿐이다.
  **`use.baseURL` · `projects` · `webServer` 는 사용자 값을 유지한다**(PoC 가 baseURL 을 덮은 것은
  fixture 서빙 때문이고 제품에서는 틀린 동작이다).
  사용자 config 가 있으면 **동적 `import` 해서 병합**한다(PoC 가 실증: `[R2CFG] merged user config`).
  이번 범위는 단일 파일이므로 **사용자 config 는 "없음"이 기본**이지만, 병합 경로는 만들어 둔다.
  ★ **게이트 G1 — PoC 미검증 3건을 여기서 실측한다**: ① `projects` 2개 이상인 config,
  ② `webServer` 를 쓰는 config, ③ `use.launchOptions.args` 를 이미 쓰는 config.
- **재사용**: `poc/r2/pw/config.ts` 의 **병합 방식만**. mode a/b 분기와 baseURL 덮어쓰기는 버린다.
- **완료 기준**: ① 생성된 config 로 PoC spec 이 실행되고 통과한다.
  ② `use.launchOptions.args:["--foo"]` 를 가진 사용자 config 를 병합하면 결과 args 에
  `--foo` 와 `--remote-debugging-port` 가 **둘 다** 있다.
  ③ **`projects` 2개 · `webServer` 있는 config 각각을 실제로 돌려 결과를 기록한다.**
  동작하면 "지원", 안 되면 **"지원하지 않음 + 사용자에게 보이는 거부 메시지"** 로 확정한다
  — 어느 쪽이든 판정을 문서화한다(추측 금지).
- **상태**: [x]

### Task 3.2: 커스텀 reporter (사용자 프로세스로 주입됨)
- **파일**: `apps/runner/src/execute/pw-reporter.ts` (신규 생성)
- **작업**: `onBegin`/`onTestBegin`/`onStepBegin`/`onStepEnd`/`onTestEnd`/`onEnd`/`onError` 를
  NDJSON 으로 Runner 에 보낸다.
  ★ **이 파일 안에서 `@testflow/contracts` 도 Redis 도 건드리지 않는다** — reporter 는
  사용자 테스트 프로세스 안에서 돌기 때문에 의존성 그래프를 오염시킨다(PoC 전달사항 4번).
  전송은 loopback HTTP POST(또는 WS) — **stdout 은 쓰지 않는다**(사용자 테스트의 `console.log` 와 섞인다).
  Runner 가 안 받아도 테스트는 계속돼야 한다(전송 실패를 삼킨다).
- **재사용**: `poc/r2/pw/live-reporter.ts` 승격.
- **완료 기준**: ① PoC spec 3건 실행 시 reporter 이벤트가 **`run.begin` 1 · `test.begin` 3 ·
  `step.begin`/`step.end` 다수 · `run.end` 1** 로 수신된다(PoC 실측 105건과 같은 구조).
  ② 이 파일의 import 목록에 `@testflow/contracts` · `ioredis` · `typeorm` 이 **0건**이다(grep 으로 확인).
- **상태**: [x]

### Task 3.3: reporter 이벤트 → SSE 규약 변환 + ★ 매핑 회귀 테스트
- **파일**: `apps/runner/src/execute/pw-event-mapper.ts` (신규 생성) + `pw-event-mapper.spec.ts` (신규)
- **작업**: `poc/r2/map-events.ts` 를 승격한다. 필수 3가지 —
  ① **필터**: `depth === 0` **AND** `category ∈ {pw:api, expect, test.step}`
  (`hook`/`fixture` 를 흘리면 화면이 내부 구현으로 도배된다. 실측 51 → 22).
  ② **마스킹**: `stripStepValue()` 를 `nameSnapshot` 에 **반드시** 적용한다.
  입력 계열(`Fill`/`Type`/`Set input`)만 값을 벗기고 `Expect "toHaveText"` 의 인용부호는 남긴다.
  ③ **`toActionType` 매핑** — 제목은 API 이름이 아니라 사람이 읽는 라벨이다
  (`Navigate`/`Click`/`Select option`/`Expect "toHaveText"`).
  ★ **매핑 회귀 테스트가 이 Task 의 핵심 산출물이다.** PoC 가 실측한 제목 문자열 전량을
  테이블로 고정하고, **미분류가 `wait` 로 떨어지는 비율이 기준을 넘으면 실패하는 테스트**를 둔다
  (Playwright 버전업에 조용히 깨지는 것을 막는 유일한 장치).
- **재사용**: contracts 의 `RunEventSchema` · `ActionType` · `StepResultSchema`.
- **완료 기준**: ① 단위 테스트에서 실측 제목 12종 이상이 각각 기대 `ActionType` 으로 매핑된다.
  ② `Fill "s3cr3t-pw"` → `Fill "***"` 이고 `Expect "toHaveText"` 는 **변형되지 않는다**.
  ③ 변환 결과 전량이 `RunEventSchema.safeParse` 를 통과한다(**invalid 0건**).
  ④ `hook`/`fixture` 카테고리와 `depth > 0` 이 전부 걸러진다.
- **상태**: [x]

### Task 3.4: 코드 작업공간 (임시 디렉토리 수명주기)
- **파일**: `apps/runner/src/execute/code-workspace.ts` (신규 생성)
- **작업**: run 1건마다 고유 임시 디렉토리를 만들어 ① 사용자 spec 1개 ② 생성한 config
  ③ reporter 진입점 ④ `outputDir` 를 배치한다. 종료 시 **항상** 삭제한다(성공·실패·취소·타임아웃 전부).
  `filename` 은 API 가 이미 검증했지만 **여기서도 다시 검증한다**(라운드 1의 storage traversal 3중 방어와 같은 규율).
  `variables` 는 **`TESTFLOW_VAR_<KEY>` 환경변수**로 테스트 프로세스에 넘긴다 — 사용자 코드가
  `process.env["TESTFLOW_VAR_password"]` 로 읽을 수 있고, 동시에 `collectSecretValues()` 가
  값 기반 마스킹을 걸 수 있게 된다(쟁점 5 · 라운드 1의 마스킹 규약을 코드 경로에서도 살리는 유일한 방법).
- **재사용**: 라운드 1 `local` 실행의 고유 임시 프로필 + 정리 패턴, `sanitizeFileName()`.
- **완료 기준**: ① 실행 후 임시 디렉토리가 **남지 않는다**(`ls /tmp/testflow-code-*` = 0개).
  ② 취소·타임아웃으로 중단시켜도 남지 않는다(실제로 중단시켜 확인).
  ③ `filename` 에 `../` 를 넣은 레코드를 DB 에 직접 INSERT 해도 **디렉토리 밖에 파일이 생기지 않는다**.
- **상태**: [x]

### Task 3.5: `playwright test` 실행 오케스트레이션
- **파일**: `apps/runner/src/execute/code-executor.ts` (신규 생성)
- **작업**: 작업공간 준비 → `playwright test --config <우리 config>` spawn → reporter 이벤트 수신 →
  `pw-event-mapper` 변환 → **`RunReporter.publish()`** 로 흘린다.
  `runs.total_steps` 를 스텝 발견에 따라 **갱신**한다(쟁점 2). `step_results` 행은 `step.started`
  시점에 INSERT 하고 `step_id = NULL` 이다. 취소는 프로세스 kill(`run:<id>:cancel` 구독 — 기존 경로).
  하드 타임아웃은 `RUNNER_RUN_TIMEOUT_MS` 를 그대로 쓴다.
  status 매핑: `passed→passed` / `failed→failed` / `timedOut→timeout` / `interrupted·skipped→cancelled`,
  **실행 환경 오류(spawn 실패 · `ERR_MODULE_NOT_FOUND`)는 `error`** (04-gen-6 결정 6번 구분 유지).
- **재사용**: `RunReporter`(무수정) · `RunAbortHandle` · 취소 채널 구독 · heartbeat.
- **완료 기준**: ① PoC spec 을 코드 시나리오로 넣어 `POST /api/runs` → SSE 로
  `run.status → step.started/step.finished × N → run.finished` 를 실수신한다.
  ② `step_results` 행 수 = 사용자에게 보여줄 스텝 수이고 `step_id` 가 전부 NULL 이다.
  ③ 일부러 실패하는 spec 으로 `status=failed` + `failed_seq` 가 채워진다.
  ④ **실행 중 취소하면 `cancelled` 로 확정되고 중단 스텝이 `failed` 가 아니다.**
- **상태**: [x]

### Task 3.6: 증적 수집 — Playwright 산출물 → `artifacts`
- **파일**: `apps/runner/src/execute/code-artifacts.ts` (신규 생성)
- **작업**: config 에 `use: {video:"retain-on-failure", trace:"retain-on-failure", screenshot:"only-on-failure"}`
  를 넣고, 실행 후 `outputDir` 를 훑어 video/trace/screenshot 을 `storage.putFile()` 로 옮긴 뒤
  `artifacts` 행을 만들고 `artifact.ready` 를 publish 한다.
  `storage_key` 는 **`runs/<runId>/<파일명>`** 규약을 그대로 지킨다(그 밖의 키는 API 가 400 으로 거부해
  증적이 조용히 사라진다 — 04-gen-6 이슈 9).
  console/network 로그는 **이번에 수집하지 않는다** — Playwright test 경로에서는 page 를 우리가
  소유하지 않아 리스너를 걸 자리가 다르다. **수집하지 않는다는 사실을 화면에도 문서에도 명시**한다
  (있는 척하지 않는다).
- **재사용**: `storage/local.ts`(무수정) · `execute/artifacts.ts` 의 적재·publish 부분.
- **완료 기준**: ① 실패하는 코드 시나리오 실행 후 `GET /api/runs/:id/artifacts` 가
  **video · trace · screenshot** 을 돌려주고 각 `url` 이 **200** 으로 실제 파일을 내려준다.
  ② `artifact.ready` 가 `run.finished` **보다 먼저** 온다(라운드 1 순서 규약 유지).
  ③ 성공한 실행은 증적을 남기지 않는다.
- **상태**: [x]

### Task 3.7: `executor.ts` 분기
- **파일**: `apps/runner/src/execute/executor.ts` (수정)
- **작업**: 큐 페이로드의 `sourceType` 으로 `interpreter` 경로와 `code-executor` 경로를 가른다.
  **기존 경로의 코드를 한 줄도 바꾸지 않고 분기만 앞에 붙인다.**
- **재사용**: 기존 오케스트레이션 전량.
- **완료 기준**: ① 녹화 시나리오 실행이 **라운드 1과 동일하게** 동작한다
  (04-gen-6 의 `goto→fill→fill→click→assert_text→assert_url` 6스텝을 다시 돌려 6/6 passed 확인).
  ② 코드 시나리오 실행이 Task 3.5 대로 동작한다. ③ `pnpm --filter @testflow/runner test` 75건 통과.
- **상태**: [x]

---

## Gen-Phase 4 — Runner: 라이브 스트리밍 (경로 D)

> Gen-Phase 3 에 의존. **스트림이 없어도 실행이 성립하는 상태 위에 붙인다.**

### Task 4.1: CDP 브라우저 부착 + 프레임 생산
- **파일**: `apps/runner/src/execute/code-browser.ts` (신규 생성)
- **작업**: PoC `host.ts` 에서 `watchBrowserPages` · `attachStream` · `throttleFrames` 를 승격한다.
  ① **CDP 포트는 실행마다 빈 포트를 할당**한다(PoC 는 host 포트에서 파생시켰다 — 동시 실행 시 충돌한다).
  ② `connectOverCDP` 가 성공할 때까지 **200ms 간격 폴링**(포트가 열리는 시점을 우리가 모른다).
  ③ **`context.on("page")` + 100ms 폴링을 둘 다** 쓴다 — 이벤트만으로는 연결 전 page 와
  새 BrowserContext 를 놓친다(PoC 실측).
  ④ `startScreencast` 는 **`record/screencast.ts` 를 무수정 import** 한다. 15fps 스로틀은 `onFrame` 래퍼.
  ⑤ **worker 재시작(테스트 타임아웃 후)으로 새 브라우저가 뜨면 CDP 재바인딩에 실패할 수 있다** —
  PoC 미검증 항목이다. 재시도·포기 동작을 정하고 실제로 재현해 확인한다.
- **재사용**: `record/screencast.ts`(**무수정**) · PoC 의 `watchBrowserPages` 패턴.
- **완료 기준**: ① 테스트 3건짜리 spec 실행 시 `pagesAttached >= 3` (테스트마다 새 page 를 잡아 붙는다).
  ② 실효 fps ≥ 10, 프레임 왕복 p95 ≤ 200ms 를 **실측해 기록**한다(PoC 기준 유지).
  ③ 동시 실행 2건에서 **CDP 포트가 충돌하지 않는다**(실제로 동시에 2건 돌려 확인).
- **상태**: [x]

### Task 4.2: WS 서버에 `/live/:runId` 경로 추가
- **파일**: `apps/runner/src/record/ws-server.ts` (수정)
- **작업**: 기존 `/rec/:sessionId` 옆에 `/live/:runId?token=…` 을 연다.
  토큰 검증은 Task 2.5 의 공통 함수(`verifyStreamToken`) + **실행 스트림 키 공간**.
  실패 **4401**, run 이 이미 종료됐으면 **4404**. 프레임 봉투·`bufferedAmount > 256KiB` 드롭 정책은
  기존 것을 **그대로** 쓴다(복사하지 않고 같은 함수를 호출한다).
  ★ **C→S 메시지를 받지 않는다** — 코드 실행 스트림은 단방향이다. 들어온 메시지는 **무시**하고,
  `input-bridge` 를 **붙이지 않는다**(원격 조작이 테스트를 깨뜨린다).
  녹화 세션과 달리 **여러 뷰어를 허용할지** 판단한다(권고: 이번에도 sink 1개 — 04-gen-7 이슈 4번과
  같은 제약. 관전 기능이 생기면 그때 다중 sink).
- **재사용**: 토큰 검증 · 프레임 봉투 · 드롭 정책 · 제어 채널 구독 구조.
- **완료 기준**: ① 잘못된 토큰 → close **4401**. ② 녹화 토큰으로 `/live/` 에 붙으면 **4401**
  (키 공간 분리가 실제로 동작한다). ③ 종료된 run → **4404**.
  ④ **기존 `/rec/` 경로 동작이 전과 동일하다** — 04-gen-7 의 녹화 검증을 다시 돌려 확인한다.
- **상태**: [x]

### Task 4.3: 스트림 수명주기 + 상태 메시지
- **파일**: `apps/runner/src/execute/live-stream.ts` (신규 생성)
- **작업**: run 단위 스트림 레지스트리. `{t:"state"}` 메시지를 발행한다 —
  `live`(프레임이 흐르는 중) / `between-tests`(page 가 닫히고 새 page 를 기다리는 중) /
  `ended`(실행 종료, `runStatus` 동봉).
  ★ **종료 시 소켓을 즉시 닫지 않는다.** `{t:"state", state:"ended"}` 를 보내고 **마지막 프레임을
  화면에 남긴 채** 잠시 뒤 정상 종료(1000)한다. 그래야 화면이 검게 죽지 않는다(쟁점 3).
  `between-tests` 판정은 "마지막 프레임 이후 N ms 동안 프레임 없음 + page 없음" 이다 —
  임계값을 정하고 근거를 주석에 남긴다.
- **재사용**: 라운드 1 세션 레지스트리 패턴.
- **완료 기준**: ① 테스트 3건 spec 실행 시 `between-tests` 가 **최소 1회** 발행된다
  (PoC 가 관측한 전환 공백이 실제로 메시지로 표면화된다).
  ② `ended` 수신 후에도 **마지막 프레임이 캔버스에 남는다**(Gen-Phase 5 에서 육안 확인).
- **상태**: [x]

### Task 4.4: `code-executor` 에 스트림 배선
- **파일**: `apps/runner/src/execute/code-executor.ts` (수정), `apps/runner/src/execute/pw-config.ts` (수정)
- **작업**: config 의 `use.launchOptions.args` 에 **할당받은 CDP 포트**를 넣고(기존 args 에 덧붙이기),
  실행 시작과 함께 `code-browser` 를 붙인다. **스트림 부착이 실패해도 실행은 계속돼야 한다** —
  라이브는 관찰 수단이지 실행의 전제가 아니다. 실패는 `{t:"error"}` 로 뷰어에만 알린다.
- **재사용**: Task 3.5 의 오케스트레이션.
- **완료 기준**: ① CDP 연결을 일부러 막아도(포트 선점) **실행은 정상 완료**되고 `run.finished` 가 온다.
  ② 정상 경로에서 실행 시작 후 프레임이 흐른다.
- **상태**: [x]

### Task 4.5: ★ 격리 정책 확정 (게이트 G2)
- **파일**: `apps/runner/src/execute/code-container.ts` (신규 생성 — 판정 결과에 따름), `.env.example` (수정),
  `README.md` (수정)
- **작업**: 쟁점 4의 4가지를 **실제로 돌려 본다** — ① 컨테이너 안에서 `playwright test` 실행,
  ② 컨테이너 → 호스트로 CDP 포트 노출 후 경로 D 성립 여부, ③ reporter → 호스트 전송 경로,
  ④ 증적 반출. 되면 **코드 실행 기본값을 `docker`** 로 하고 `RUNNER_CODE_EXECUTION_MODE` 로 전환 가능하게 한다.
  안 되면 **`local` 기본 + README 에 "붙여넣은 코드는 서버에서 그대로 실행된다. 신뢰할 수 없는
  코드를 넣지 마라" 를 경고 블록으로 명시**한다. **되는 척하지 않는다.**
  어느 쪽이든 `variables` 평문이 어디까지 들어가는지(컨테이너 env 포함)를 사실대로 기록한다.
- **재사용**: 라운드 1 `container.ts` 의 `--memory`/`--cpus`/`--rm`/`--init` + `waitForServerReady` 패턴,
  `Dockerfile.exec`.
- **완료 기준**: ① 4가지 각각에 **동작/불가 판정과 실측 근거**가 문서에 기록된다.
  ② 채택한 기본값이 `.env.example` 과 README 에 **같은 값**으로 적혀 있다.
  ③ `docker` 로 확정한 경우: `docker inspect` 전문에서 **컨테이너에 마운트된 경로 목록**을 기록한다
  (`ARTIFACT_ROOT` 가 노출되지 않아야 한다 — 라운드 1 규율).
- **상태**: [x]

---

## Gen-Phase 5 — Web: 코드 입력 화면 + 라이브 뷰

> Gen-Phase 2·4 에 의존.

### Task 5.1: 시나리오 만들기 — 경로 선택
- **파일**: `apps/web/src/pages/scenarios/NewScenarioPage.tsx` (수정)
- **작업**: 이름 입력 위에 **경로 선택 2종**을 둔다 — "브라우저에서 녹화하기"(기본) /
  "테스트 코드 넣기". 선택에 따라 `sourceType` 을 실어 생성하고, 생성 후 이동 경로를 가른다
  (`steps` → 빌더 `/scenarios/:id`, `code` → 코드 화면 `/scenarios/:id/code`).
  버튼 라벨도 바뀐다("만들고 녹화하기" / "만들고 코드 넣기").
  **새 색·새 반경을 만들지 않는다** — 빌더의 선택 스텝 색(`--color-step-selected-*`)을 재사용한다.
- **재사용**: `PageHead` · `Panel` · `Input` · `Button` · `ProjectGate` · `toast` 전부.
- **완료 기준**: ① 두 경로로 각각 만들어 **서로 다른 화면으로 이동**한다.
  ② 기본 선택이 "녹화" 라서 **기존 사용자의 조작이 그대로다**.
  ③ `style={{` 0건 · HEX 리터럴 0건(grep 으로 확인).
- **상태**: [x]

### Task 5.2: 코드 에디터 패널
- **파일**: `apps/web/src/pages/scenarios/code/CodeEditorPanel.tsx` (신규 생성), `apps/web/src/pages/scenarios/code/index.tsx` (신규 생성)
- **작업**: 쟁점 6 판단대로 **`textarea`** 로 만든다. 모노 폰트 토큰 · `spellCheck=false` ·
  `Tab` 을 들여쓰기로 · 줄 수 표시 · **검증 오류를 줄 번호와 함께 목록으로** 표시.
  검증은 **contracts 의 `validateScenarioCode()`** 를 그대로 호출한다(웹에서 규칙을 재구현하지 않는다).
  저장은 `PUT /api/scenarios/:id/code`. 서버가 400 을 주면 `details` 를 같은 목록에 합쳐 표시한다.
  라우트는 **lazy** 로 등록한다(초기 로드 영향 0).
- **재사용**: `Panel` · `Button` · `StateView` · `Skeleton` · `toast` · `api` 클라이언트.
- **완료 기준**: ① `import fs from "fs"` 를 넣으면 **저장 전에** 줄 번호와 함께 오류가 보이고
  저장 버튼이 막힌다. ② 정상 코드는 저장되고 새로고침 후에도 남아 있다.
  ③ `pnpm build` 후 **초기 로드 JS 가 523.83KB 에서 유의미하게 늘지 않는다**(수치를 기록한다).
- **상태**: [x]

### Task 5.3: `.spec.ts` 업로드 + codegen 반입 안내
- **파일**: `apps/web/src/pages/scenarios/code/CodeUploadField.tsx` (신규 생성)
- **작업**: `<input type="file" accept=".ts,.spec.ts">` 로 파일을 받아 **클라이언트에서 텍스트로 읽어**
  에디터에 채운다(서버에 multipart 를 보내지 않는다 — Task 2.2 근거).
  확장자·크기를 먼저 검사하고, 읽은 즉시 `validateScenarioCode()` 를 돌린다.
  같은 패널에 **codegen 반입 안내**를 둔다 — `npx playwright codegen <대상주소>` 명령을 복사 버튼과 함께
  보여 주고, "생성된 코드를 그대로 붙여넣거나 파일로 저장해 올리면 됩니다" 를 적는다.
- **재사용**: `Button` · `NoticeBox`(amber notice 패턴) · `toast`.
- **완료 기준**: ① 실제 codegen 산출물 `.spec.ts` 파일을 올려 저장 → 실행까지 이어진다(Gen-Phase 6 에서 재확인).
  ② `.txt` / 300KB 파일은 거부되고 한국어 사유가 표시된다.
- **상태**: [x]

### Task 5.4: 라이브 캔버스 컴포넌트 (입력 없음)
- **파일**: `apps/web/src/features/live/LiveCanvas.tsx` (신규 생성), `apps/web/src/features/live/index.ts` (신규)
- **작업**: 프레임 디코드·렌더·드롭은 **`features/recorder/frame.ts` 와 `useFrameRenderer.ts` 를
  그대로 재사용**한다(복사 금지). 입력 경로(`useInputBridge`/`useImeBridge`)는 **붙이지 않는다**.
  상태 오버레이 3종: `between-tests` → "다음 테스트 준비 중", `ended` → 마지막 프레임 유지 +
  상태 배지, 연결 전 → 스켈레톤. **캔버스를 절대 비우지 않는다**(쟁점 3).
- **재사용**: `frame.ts`(무수정) · `useFrameRenderer.ts`(무수정 목표) · `StreamCanvas` 의 레이아웃 패턴.
- **완료 기준**: ① 실행 중 화면이 실제로 그려진다(스크린샷으로 육안 확인 — 검은 캔버스가 아님을
  **픽셀 샘플링으로도** 확인한다. PoC 가 쓴 검증 방식 그대로).
  ② `ended` 이후에도 마지막 프레임이 남아 있다. ③ 캔버스에 클릭·키 입력이 **전송되지 않는다**
  (네트워크 탭에 C→S 메시지 0건).
- **상태**: [x]

### Task 5.5: 라이브 스트림 훅
- **파일**: `apps/web/src/hooks/useLiveStream.ts` (신규 생성)
- **작업**: `GET /api/runs/:id/live` 로 `wsUrl` 을 받아 WS 에 붙는다.
  ★ `onopen` 이 떠도 안심하지 않는다 — **4401/4404 는 핸드셰이크 성공 후 close 로 온다**
  (04-gen-7 규약). `onclose.code` 를 반드시 본다.
  run 이 종료 상태면 열지 않고, 열려 있으면 `ended` 수신 후 스스로 닫는다
  (`useRunEvents` 가 SSE 를 닫는 방식과 같은 구조 — 새 패턴을 만들지 않는다).
  **이펙트를 화면에 만들지 않는다.** 훅 하나에 가둔다.
- **재사용**: `useRecorderSocket.ts` 의 구조(핸들러 ref · 상태 파생 · close 분류)를 그대로.
- **완료 기준**: ① 토큰 거부 시 화면에 한국어 사유가 뜬다.
  ② 실행이 끝나면 **연결이 스스로 닫힌다**(`data-live-connection` 진단 속성으로 관측).
  ③ react-hooks lint 경고 0건.
- **상태**: [x]

### Task 5.6: 실행 현황 화면 — 정적 목업을 라이브 스트림으로 교체 ★
- **파일**: `apps/web/src/pages/runs/RunSidePanel.tsx` (수정)
- **작업**: `FakeLoginMock` 을 **삭제**하고 그 자리에 `LiveCanvas` 를 넣는다.
  표시 우선순위: ① 실행 중 + 스트림 연결됨 → **라이브** ② 종료 + 마지막 프레임 있음 → **마지막 프레임 + 배지**
  ③ 실패 스크린샷 증적 있음 → 스크린샷 ④ 아무것도 없음 → 중립 안내(가짜 로그인 화면을 **다시 만들지 않는다**).
  브라우저 크롬 바(42px · URL 바)는 시안 그대로 유지한다.
  영상 증적이 있으면 "영상으로 보기" 전환 버튼을 둔다(**자동 전환 없음** — 쟁점 3).
  **녹화 기반 실행(`sourceType === "steps"`)에서는 라이브가 없다** — 그때는 ③④ 만 쓴다.
  그 차이를 화면에 한 줄로 설명한다(있는 척하지 않는다).
- **재사용**: 증적 목록·실행 정보 kv·다운로드 링크 전부 무수정. 시안 실측값(42px·`aspect-ratio 16/10`) 유지.
- **완료 기준**: ① 코드 시나리오 실행 중 화면에 **실제 테스트 화면이 움직인다**(스크린샷 2장 시차 비교).
  ② 녹화 시나리오 실행은 **라운드 1과 동일한 화면**이다(회귀).
  ③ `grep -c FakeLoginMock` = **0**. ④ HEX 리터럴 0건 · `style={{` 0건.
- **상태**: [x]

### Task 5.7: 스텝 목록 — 코드 실행의 "대기 행 없음" 대응
- **파일**: `apps/web/src/pages/runs/RunStepList.tsx` · `RunSummaryBar.tsx` (수정)
- **작업**: 코드 실행은 `pending` 행이 없고 `totalSteps` 가 실행 중에 **증가**한다(쟁점 2).
  요약바의 `N / M 단계` 에서 M 이 커지는 것을 견디고, "총 단계 수는 실행하면서 확정됩니다" 를
  코드 실행일 때만 한 줄 덧붙인다. 스텝 리스트는 도착한 행만 그린다.
  **녹화 실행의 3-상태(완료 ✓ / 스피너 / 대기 번호) 표시는 바꾸지 않는다.**
- **재사용**: `StepStatusIcon`(5-상태, 무수정) · `tf-exec-row` 유틸리티 · `applyRunEvent`(멱등 리듀서).
- **완료 기준**: ① 코드 실행 중 M 이 1→2→3… 으로 커져도 화면이 깨지지 않고 되돌아가는 프레임이 0건이다.
  ② 녹화 실행의 `pending → running → passed` 3단계 관측이 **라운드 1과 동일**하다(회귀).
  ③ `lib/run-events.spec.ts` 10건이 그대로 통과한다.
- **상태**: [x]

---

## Gen-Phase 6 — 내보내기 + 통합 검증

> 전 단계에 의존. 마지막 Gen-Phase.

### Task 6.1: 녹화 스텝 → Playwright 코드 생성 (순수 함수)
- **파일**: `packages/contracts/src/codegen.ts` (신규 생성) + `codegen.spec.ts` (신규)
- **작업**: `stepsToPlaywrightCode(steps: TestStep[], opts): string`.
  `by` 별 출력은 쟁점 7 표 그대로. `nth` → `.nth(n)`. `frameUrl` 은 주석 표시.
  **`isSecret: true` 는 `process.env["TESTFLOW_VAR_<key>"]` 참조로** 낸다(평문 금지).
  `assert_*` 는 `expect(...)` 로, `wait` 는 `page.waitForTimeout(...)` 로.
  `@playwright/test` import 1줄 + `test(...)` 블록 1개를 낸다.
- **재사용**: `TestStepSchema` · `LocatorTargetSchema` · `ACTION_TYPES`.
- **완료 기준**: ① 04-gen-7 이 실측한 **7스텝 녹화 결과**를 넣으면 코드가 생성되고,
  그 코드가 **Task 1.2 의 `validateScenarioCode()` 를 issue 0건으로 통과**한다.
  ② `{{password}}` 스텝의 출력에 **평문이 0건**이다.
  ③ `nth:1` 스텝이 `.nth(1)` 로 나온다.
- **상태**: [x]

### Task 6.2: 빌더에 "Playwright 코드로 내보내기"
- **파일**: `apps/web/src/pages/scenarios/builder/BuilderHeader.tsx` (수정)
- **작업**: 헤더에 버튼 1개. 누르면 생성된 코드를 모달로 보여 주고 **복사** / **`.spec.ts` 다운로드** 를
  제공한다. 스텝 0개면 비활성 + 사유를 `title` 로 설명(`▶ 실행` 버튼과 같은 패턴).
- **재사용**: `Modal`(무수정) · `Button` · `toast`.
- **완료 기준**: ① 녹화 시나리오에서 버튼 → 코드가 보이고 다운로드된 파일이 생성 코드와 바이트 일치.
  ② **그 파일을 코드 시나리오로 업로드하면 저장까지 된다**(왕복).
- **상태**: [x]

### Task 6.3: 마스킹 전수 점검 (코드 실행 경로)
- **파일**: 점검 전용 — 발견 시에만 해당 파일 수정
- **작업**: 비밀번호를 담은 코드 시나리오를 **의도적으로 실패**시켜
  ① `step_results.name_snapshot`(← `Fill "…"` 제목) ② `step_results.error_message`
  ③ `runs.error_message` ④ SSE 스트림 실수신 바이트 ⑤ API 응답 ⑥ Runner stdout 로그
  ⑦ 증적 파일 전체 ⑧ Redis SSE 버퍼 ⑨ (docker 인 경우) `docker inspect` 전문
  — **9경로를 grep** 한다. **대조군**(평문이어도 되는 계정명)이 검출되는지도 함께 확인해
  검사가 실제로 동작함을 증명한다(라운드 1 규율).
  ★ **값 기반 마스킹이 빈 배열이 되는 경우**(사용자가 `variables` 를 안 넘긴 경우)도 반드시 포함한다 —
  그때 `stripStepValue` 패턴 제거가 **유일한 방어선**이다. 뚫리면 그 사실을 기록하고 고친다.
- **재사용**: 라운드 1 `mask.ts`(api/runner 양쪽) · `mask.spec.ts` 규칙.
- **완료 기준**: ① 9경로 전부 평문 **0건**, 대조군 **검출됨**.
  ② `variables` 를 넘기지 않은 실행에서도 step 제목에 평문이 **0건**.
- **상태**: [x]

### Task 6.4: 해피패스 A — 녹화 경로 전 구간 회귀
- **파일**: 검증 전용
- **작업**: 라운드 1의 해피패스를 **웹 UI 로만** 끝까지 다시 돌린다 —
  시나리오 생성 → 녹화(캔버스 조작) → 스텝 편집 → 발행 → 실행 요청 → SSE 관전 → 결과 확인 →
  실패 실행의 증적 5종 다운로드. 라운드 2 변경이 **아무것도 깨지 않았음**을 증명한다.
- **재사용**: 04-gen-11 / 05-eval 의 검증 절차 그대로.
- **완료 기준**: ① 스텝 전량 `passed`, 콘솔 에러 0건.
  ② 증적 **5종** 표시 + 5종 전부 다운로드 200.
  ③ 비밀번호 평문이 HTML·localStorage·sessionStorage·cookie·`history.state` 에 **0건**.
- **상태**: [x]

### Task 6.5: 해피패스 B — 코드 입력 경로 전 구간 (2경로)
- **파일**: 검증 전용
- **작업**: **붙여넣기 경로**와 **파일 업로드 경로**를 각각 끝까지 돌린다 —
  시나리오 생성(코드) → 코드 입력/업로드 → 검증 통과 → 발행 → 실행 요청 →
  **라이브 화면 관전(움직이는 것을 스크린샷 2장 시차로 증명)** → SSE 스텝 진행 → 결과 확인 →
  실패 실행의 증적(video/trace/screenshot) 다운로드.
  대상은 로컬 fixture(`poc/fixtures/record-login.html`) + **공개 사이트 1건**.
  `test()` 가 **여러 개**인 spec 도 포함해 `between-tests` 전환을 실제로 본다.
- **재사용**: PoC 의 `codegen-login.spec.ts` · `codegen-multi.spec.ts` 를 입력 자료로 쓴다.
- **완료 기준**: ① 두 경로 모두 `passed` 로 끝나고 스텝이 화면에 쌓인다.
  ② 라이브 화면의 **픽셀이 실제로 변한다**(2장 시차 비교 + 검은 캔버스 아님 확인).
  ③ 실행 종료 후 **마지막 프레임이 남아 있다**. ④ 콘솔 에러 0건.
- **상태**: [x]

### Task 6.6: 기준선 회귀 + 번들 + 문서
- **파일**: `README.md` (수정), `.env.example` (수정), `.pipeline/20260917-231945/03-phases.md` (상태 갱신)
- **작업**: 4종 게이트 재측정. 번들 크기 before/after 기록.
  README 에 추가할 것 — ① 시나리오 2종(녹화/코드)의 차이 ② codegen 반입 절차
  ③ **코드 실행의 격리 정책과 신뢰 전제**(Task 4.5 판정 그대로) ④ 허용 import 목록과
  **"이 검사는 보안 경계가 아니다"** ⑤ console/network 로그를 코드 실행에서 수집하지 않는다는 사실
  ⑥ 새 환경변수 전량.
- **재사용**: 라운드 1 README 구조.
- **완료 기준**: ① `pnpm typecheck` **7/7** · `pnpm lint` **0 problems** · `pnpm build` **5/5** ·
  `pnpm test` **242건 이상**(줄지 않았다). ② 초기 로드 JS 수치가 before/after 로 기록된다.
  ③ HEX 리터럴 0건 · `style={{` 0건. ④ README 6항목이 전부 들어 있다.
- **상태**: [x]

---

## 리스크와 후퇴 경로

| # | 리스크 | 신호 | 후퇴 / 승급 |
|---|---|---|---|
| 1 | **경로 D 가 부족해진다** (다중 worker · 다중 브라우저 가시성) | `pagesAttached` 가 기대보다 적다 / 화면이 섞인다 / `projects` 다중 config 가 필요해진다 | **경로 B 승급** (`launchServer` + `use.connectOptions` + CDP 포트). PoC 가 `workers:2` 에서 page 3개 전부 열거함을 실증했다. 대가: Runner 가 `BrowserServer` 수명을 책임진다(테스트가 죽으면 브라우저가 남는다). **경로 A(shim) 로는 가지 않는다** — 모듈 해석 가로채기는 버전업에 조용히 깨진다 |
| 2 | **게이트 G1 실패** — 사용자 config 의 `projects`/`webServer` 에서 경로 D 가 안 된다 | Task 3.1 실측 | ① 경로 B 로 승급하거나 ② **"지원하지 않는 config" 로 명시 거부**(사용자에게 보이는 메시지). 이번 범위는 단일 파일이라 사용자 config 자체가 드물다 — 거부가 현실적이다 |
| 3 | **게이트 G2 실패** — 컨테이너 안에서 경로 D 가 안 된다 | Task 4.5 실측 | `local` 기본 + **README 경고 블록**. "격리된다"고 쓰지 않는다. `RUNNER_CODE_EXECUTION_MODE` 배선은 남겨 두고, 나중에 sandbox(gVisor 등)나 전용 호스트로 옮길 지점으로 기록한다 |
| 4 | **step 제목 매핑이 Playwright 버전업에 깨진다** | 회귀 테스트 실패 / `wait` 비율 급증 | Task 3.3 의 회귀 테스트가 **CI 에서 먼저 잡는다**. 실측 문자열로 매핑표를 갱신한다. 이 테스트가 없으면 조용히 전부 `wait` 가 된다 |
| 5 | **worker 재시작 시 CDP 재바인딩 실패** (PoC 미검증) | 타임아웃 후 프레임이 끊긴다 | Task 4.1 에서 재현·확정. 재바인딩이 안 되면 **스트림만 포기**하고 실행은 계속한다(Task 4.4 규칙) |
| 6 | **에디터 번들 초과** | `pnpm build` 500KB 경고 재발 / 초기 로드 증가 | 쟁점 6 판단대로 `textarea` 라 애초에 발생하지 않는다. 그럼에도 늘면 **코드 화면 라우트를 lazy 로 유지**하고 수치를 보고한다. CodeMirror 승급은 사용자 요청이 실제로 나온 뒤 |
| 7 | **코드 실행이 녹화 경로를 깨뜨린다** | 회귀 테스트 실패 | Task 3.7 이 분기만 앞에 붙이는 구조라 기존 코드가 안 바뀐다. Task 6.4 해피패스 A 가 최종 방어선 |
| 8 | **`total_steps` 증가를 화면이 못 견딘다** | "N / M 단계" 가 되돌아가 보인다 | `applyRunEvent` 가 이미 멱등이다. Task 5.7 에서 M 단조 증가를 명시적으로 처리하고 관측으로 확인 |

---

## 라운드 1 기준선 회귀 방지

**모든 Gen-Phase 의 완료 조건에 아래 4종이 포함된다.** 하나라도 깨지면 그 Gen-Phase 는 끝난 것이 아니다.

| 항목 | 라운드 1 기준선 | 판정 |
|---|---|---|
| `pnpm typecheck` | **7 successful, 7 total** | 줄어들면 실패 |
| `pnpm lint` | **7 successful, 0 problems** | 경고 1건도 허용하지 않는다 |
| `pnpm build` | **5 successful, 5 total** · `vite build` 500KB 경고 **없음** | 경고가 다시 나오면 실패 |
| `pnpm test` | **242건** (contracts 22 / web 52 / runner 75 / api 93) | **줄면 실패.** 라운드 2는 여기에 더한다 |

추가 규율 점검 (Gen-Phase 5·6 필수):

| 항목 | 기준 |
|---|---|
| 초기 로드 JS | **523.83KB / gzip 164.59KB** 에서 유의미하게 늘지 않는다. 늘면 수치와 사유를 보고한다 |
| HEX 리터럴 (스타일 값) | **0건** (JSDoc 의 시안 출처 표기는 예외) |
| `style={{` | **0건** (CSS 커스텀 프로퍼티 주입 2건은 기존 패턴) |
| 비밀번호 평문 | DB · 로그 · SSE · API 응답 · 증적 · Redis 버퍼 전 경로 **0건**, 대조군 검출됨 |
| 녹화 해피패스 | Task 6.4 로 전 구간 재확인 |
| SSE 규약 | 이벤트 5종 · 봉투 `{seq,payload}` · `INCR → RPUSH/LTRIM/EXPIRE → PUBLISH` 순서 **무변경** |
| `packages/contracts` | **추가만.** 기존 필드명·구조 변경 0건 |
| `docker-compose.yml` · `packages/db/src/cli/guard.ts` | 지시 없이 수정하지 않는다 |
