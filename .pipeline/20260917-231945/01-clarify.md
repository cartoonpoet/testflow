---
# Clarify Artifact
pipeline_id: 20260917-231945
phase: 01-clarify
feature: TestFlow 라운드 2 — 코드 입력 실행 + 라이브 스트리밍
---

## 배경 — 왜 라운드 2가 필요한가

라운드 1은 **"테스터가 코드 없이 녹화해서 시나리오를 만든다"** 로 만들었다.
사용자가 실제로 원한 것은 **"이미 있는 테스트 코드(Playwright codegen 산출물이든 손으로 쓴 것이든)를
넣으면, 테스트가 진행되는 화면을 실시간으로 보면서, 결과가 관리되는 것"** 이다.

**오케스트레이터의 요구사항 해석 오류였다.** 라운드 1 산출물이 틀린 것이 아니라 **범위가 빠져 있었다.**
라운드 2는 라운드 1을 되돌리지 않고 **경로를 하나 더 붙인다.**

---

## 기능 요약

시나리오가 **두 종류**가 된다.

| 종류 | 만드는 방법 | 저장 형태 | 실행 엔진 |
|---|---|---|---|
| **녹화 기반** (라운드 1) | 원격 브라우저를 직접 조작해 녹화 | `test_steps` JSON 스텝 | `execute/interpreter.ts` (자체 해석기) |
| **코드 기반** (라운드 2 신규) | 화면에 붙여넣기 / `.spec.ts` 파일 업로드 | 코드 본문 1개 | `playwright test` (외부 프로세스) |

두 경로 모두 **같은 `runs`·`step_results`·`artifacts` 테이블**에 결과를 남기고,
**같은 SSE 규약**(`run.status`/`step.started`/`step.finished`/`run.finished`/`artifact.ready`)으로 관찰된다.
실행 현황 화면의 **정적 브라우저 목업이 실시간 스트림으로 교체**된다.

---

## ★ 확정 요구사항 (사용자와 합의됨)

1. **레코더·빌더·인스펙터는 버리지 않는다.** 코드 입력 경로를 **추가**한다.
2. **코드 입력은 두 경로**: ① 화면에 붙여넣기(에디터) ② `.spec.ts` 파일 업로드.
   **git 레포 연동은 이번 범위가 아니다.**
3. **라이브 화면은 실시간 스트리밍이다.** 스텝별 스크린샷이나 사후 영상으로 대체하지 않는다.
   실행 현황 화면의 정적 목업(`RunSidePanel.tsx` 의 `FakeLoginMock`)을 실제 스트림으로 교체한다.
4. **codegen 산출물 반입 흐름**을 정리한다. 추가로 **녹화 스텝 → Playwright 코드 내보내기**도
   넣어 양방향으로 만든다 (**우선순위는 낮게** 둔다).
5. 라이브 스트리밍은 **녹화 세션에만 붙어 있던 screencast 를 실행 경로에도 붙이는 것**이다.
   PoC 가 **경로 D**(`use.launchOptions` 로 CDP 포트 개방 + Runner 가 `connectOverCDP`)를 채택했다.
6. **비회원제·단일 공용 워크스페이스 유지.** 인증·권한 없음.
7. 패키지 매니저는 **pnpm**(전환 완료). 확정 버전:
   TypeScript 6.0.3 / NestJS 12 (순수 ESM) / TypeORM 1.1.1 / Playwright 1.63.0 /
   React 19.3 / Vite 8.3 / Tailwind 4.3.

---

## 라운드 1과 달라지는 것

| 항목 | 라운드 1 | 라운드 2 |
|---|---|---|
| 시나리오의 원본 | `test_steps` JSON **하나뿐** | `steps`(녹화) / `code`(코드) **두 종류** — `scenarios.source_type` 으로 판별 |
| 실행 엔진 | `execute/interpreter.ts` **하나뿐** | interpreter **+** `playwright test` 외부 프로세스 (둘이 공존) |
| 실행 화면 | **headless — 화면이 웹으로 오지 않는다.** 정적 목업 + 실패 스크린샷 | **라이브 스트림** (15fps, 프레임 봉투 25바이트) |
| screencast 사용처 | 녹화 세션(`record/session.ts`) **전용** | 녹화 **+ 실행**(`execute/code-browser.ts`) |
| `runs.total_steps` | 실행 요청 시점에 **확정**(스텝 수 스냅샷) | 코드 실행은 **실행 중에 증가**한다 (스텝을 미리 알 수 없다) |
| `step_results` 선-INSERT | 실행 시작 시 전량 `pending` 시딩 | 코드 실행은 **불가능** — 스텝이 시작될 때 행이 생긴다 |
| `step_results.step_id` | `test_steps.id` 참조 | 코드 실행은 **항상 NULL** (대응하는 `test_steps` 행이 없다) |
| 신뢰 경계 | 없음 (우리가 만든 JSON 만 해석) | **생긴다** — 사용자가 넣은 코드는 **임의 Node 코드**다 |
| `@playwright/test` | 의존성에 **없었다**(04-gen-6 이슈 2) | **필수 의존성**(PoC 에서 이미 추가됨, 1.63.0) |
| 병렬 실행 | `RUNNER_CONCURRENCY` (run 단위) | 코드 실행 내부는 **`workers: 1` 강제** (라이브 화면이 1개다 — PoC 측정 근거) |

---

## 라운드 1에서 그대로 유지되는 것

- **화면 4종 · 사이드바 · 토큰 체계 · 디자인 규율** 전부. 새 색·새 반경을 만들지 않는다.
- **`packages/contracts` 가 단일 타입 소스.** 타입을 각 앱에서 재정의하지 않는다.
- **SSE 규약**(`{seq, payload}` 봉투 · `INCR → RPUSH/LTRIM/EXPIRE → PUBLISH` 순서 · `Last-Event-ID` 재전송).
- **`RunReporter`**(`execute/reporter.ts`) — 코드 실행도 이 클래스를 통과한다. DB/SSE 규약이 하나로 유지된다.
- **`record/screencast.ts`** — PoC 가 **한 글자도 고치지 않고** 재사용했다. 그대로 간다.
- **프레임 봉투 25바이트 · 백프레셔 드롭 정책 · 15fps 스로틀.**
- **마스킹은 DB 쓰기 전에.** `runs.error_message`/`step_results.error_message` 는 이미 마스킹된 값.
- **비회원제** — 인증·권한·`created_by` 없음. `[AUTHZ]` 주석 4곳 유지.
- **증적 5종**(screenshot/video/trace/console_log/network_log)과 `storage_key` 규약.
- **로컬 디스크 `StorageAdapter`**, API·Runner 동일 호스트 + 동일 `ARTIFACT_ROOT`.
- **FR-005 미충족 상태 유지** — 자격증명은 저장하지 않고 실행 시 입력받는다.

---

## 이번에 폐기하는 것

| 대상 | 사유 |
|---|---|
| `poc/r2/pw/shim-pkg/**` · `pw/shimroot/**` · `pw/stream-fixture.mjs` (**경로 A**) | 경로 D 채택으로 불필요. `@playwright/test` 내부 재수출 구조에 의존하는 **깨지기 쉬운 장치**다. 후퇴용으로도 경로 B 가 더 낫다 |
| `RunSidePanel.tsx` 의 `FakeLoginMock` (정적 가짜 로그인 화면) | 요구사항 3번이 직접 지목한 대상. 라이브 스트림이 그 자리를 차지한다 |
| "실행은 headless 라 실시간 화면이 없다" 는 전제 | PoC 가 **headless 로 화면이 나온다**는 것을 실측했다. headed 는 쓸 이유가 없다(수치 동일 + X 서버 요구) |

**폐기하지 않는 것(오해 방지)**: `record/input-bridge.ts`(입력 역주입)는 **녹화 모드에서 계속 쓴다.**
코드 실행 모드에서만 쓰지 않는다 — 사용자가 원격 조작을 하면 테스트가 깨진다. 코드 실행은 **보기만** 한다.

---

## 범위

### 포함
- `scenarios.source_type` (`steps` | `code`) + 코드 본문 저장
- 코드 붙여넣기 에디터 · `.spec.ts` 업로드 · import 허용 목록 검증
- `playwright test` 실행 엔진 (config 생성·주입 / 사용자 config 병합 / 커스텀 reporter)
- Playwright reporter 이벤트 → 라운드 1 SSE 규약 변환 (+ **매핑 회귀 테스트**)
- 경로 D 라이브 스트리밍 (CDP + `connectOverCDP` + `watchBrowserPages`)
- 실행 현황 화면의 라이브 뷰 (입력 없는 `StreamCanvas`)
- Playwright 자체 증적(video/trace)을 `artifacts` 로 편입
- 녹화 스텝 → Playwright 코드 내보내기 (**우선순위 낮음**)

### 제외 (이번에 하지 않는다)
- **git 레포 연동** (사용자 명시)
- **다중 파일 / fixture / helper import** — 이번 범위는 **단일 파일**이다 (03-phases 에 근거 기록)
- `@playwright/test` 외 패키지 import 허용
- 라이브 OFF 병렬 실행 모드 (`workers > 1`)
- 원격 조작(입력 역주입)을 코드 실행 화면에 붙이는 것
- 다중 브라우저(Chromium 외) · `projects` 다중 구성 지원
- 회원제 전환 · `project_variables` · AES 암호화 (라운드 1 결정 유지)

---

## 주요 제약 및 주의사항

1. **★ step 제목에 입력값이 평문으로 실린다.** Playwright 가 보내는 실제 제목이
   `Fill "s3cr3t-pw"` 다. 마스킹을 **DB 쓰기 전에** 적용해야 한다.
   입력 계열(`Fill`/`Type`/`Set input`)만 벗기고 `Expect "toHaveText"` 의 인용부호는
   matcher 이름이라 지우면 안 된다.
   **더 어려운 점**: 코드 실행은 사용자가 `variables` 를 안 넘길 수 있어
   **값 기반 마스킹(`collectSecretValues`)이 빈 배열로 떨어진다.** 패턴 기반 제거가 유일한 방어선이 된다.
2. **★ step 제목은 API 이름이 아니라 사람이 읽는 라벨이다.** `locator.click` 이 아니라 `Click`,
   `page.goto` 가 아니라 `Navigate` 다. 문서만 보고 매핑하면 전부 `wait` 로 떨어진다.
   **Playwright 버전업에 깨지므로 매핑 회귀 테스트가 필수다.**
3. **reporter 는 `hook`·`fixture` 카테고리 step 도 보낸다.** `depth === 0` + 카테고리 필터가 없으면
   사용자 화면이 내부 구현으로 도배된다 (실측 51건 → 22건).
4. **신뢰 경계가 생긴다.** 사용자가 넣은 코드는 임의 파일 접근·네트워크 호출을 할 수 있다.
   개인 프로젝트라 멀티테넌트는 아니지만 **라운드 1의 `local` 기본값을 그대로 쓸지 판단이 필요하다**
   (03-phases 설계 쟁점 4).
5. **경로 D 는 `workers: 1` 에서만 온전하다.** `--remote-debugging-port` 는 한 브라우저만 바인딩한다.
   다중 worker 가시성이 필요해지면 **경로 B(`launchServer` + `connectOptions`)로 승급**한다.
6. **PoC 가 측정하지 않은 것** — `projects` 다중 구성 / `webServer` 사용 config /
   Docker 실행 모드에서의 경로 D / worker 재시작 시 CDP 재바인딩.
   **본 구현에서 시험해야 하며, 결과에 따라 경로가 바뀔 수 있다.**
7. **라운드 1 기준선을 깨면 안 된다** — typecheck 7/7 · lint 0 problems · build 5/5 · test 242건 ·
   초기 로드 JS 523.83KB · HEX 하드코딩 0건 · 인라인 CSS 0건.

---

## 현재 브랜치 상황

| 브랜치 | 내용 |
|---|---|
| `main` | 라운드 1 (Gen-Phase 1~12) |
| `chore/pnpm-migration` | pnpm 전환 — **PR #1 열림** (`https://github.com/cartoonpoet/testflow/pull/1`) |
| `feat/code-input-live-stream` | 라운드 2 PoC (base: `chore/pnpm-migration`). **라운드 2 작업은 여기서 이어간다** |
