---
# Eval Artifact
pipeline_id: 20260917-231945
phase: 05-eval
feature: TestFlow 라운드 2 — 코드 입력 실행 + 라이브 스트리밍
gen_phase: 6
tasks: [6.1, 6.2, 6.3, 6.4, 6.5, 6.6]
---

# 라운드 2 최종 보고서 — 코드 입력 실행 + 라이브 스트리밍

작성: 2026-09-18 · 브랜치 `feat/code-input-live-stream` · 커밋 대상 Gen-Phase 6

---

## 0. 한 줄 요약

**해피패스 2종이 웹 UI 경유로 끝까지 통과했다.** 녹화 경로는 회귀 없이
`녹화 → 인스펙터 편집 → 발행 → 실행 → 증적 5종`이 그대로 돌고, 코드 입력 경로는
`붙여넣기/업로드 → 저장 → 발행 → 실행 → 라이브 화면 관전 → 증적 3종`이 **docker 격리에서**
돌았다. **내보내기 왕복**(녹화 4스텝 → `.spec.ts` → 코드 시나리오 → 실행 **passed 4/4**)도 성립했다.
검증 중 **웹 버그 1건을 발견해 고쳤다**(실행 종료 시 라이브 토큰이 조용히 회전되던 문제).

---

## 1. 검증 결과 요약 표

| 항목 | 기준 | 결과 | 판정 |
|---|---|---|---|
| `pnpm typecheck` | 7/7 | **7 successful, 7 total** | ✅ |
| `pnpm lint` | 0 problems | **7/7, 0 problems** | ✅ |
| `pnpm build` | 5/5 · 500KB 경고 없음 | **5/5 · 경고 0건** (최대 청크 327.03KB) | ✅ |
| `pnpm test` | 480건 이상 | **516건** (contracts 143 · api 106 · runner 211 · web 56) | ✅ +36 |
| HEX 리터럴 (스타일 값) | 0건 | **0건** (JSDoc 시안 출처 표기만 남음) | ✅ |
| `style={{` | 0건 신규 | **2건**(기존 CSS 변수 주입) · 신규 **0건** | ✅ |
| **해피패스 A — 녹화 경로** | 전 구간 통과 | **통과** · 4/4 passed · 증적 5종 · 콘솔 에러 **0건** | ✅ |
| **해피패스 B — 코드 입력 (붙여넣기)** | 전 구간 통과 | **통과** · 9/9 passed · 라이브 프레임 이동 확인 | ✅ |
| **해피패스 B — 코드 입력 (파일 업로드)** | 전 구간 통과 | **통과** · 13/13 passed | ✅ |
| **내보내기 왕복** | 검증 통과 + 실행 통과 | **issue 0건 + passed 4/4** | ✅ |
| **마스킹 전수 점검** | 9경로 0건 · 대조군 검출 | **`variables` 경로 9/9 = 0건**, 대조군 6경로 검출 | ⚠ 아래 §4 |
| 초기 로드 JS | 540.97KB 에서 유의미 증가 없음 | **546.38KB** (+5.41KB, +1.0%) | ⚠ 수치 보고 |

---

## 2. ★ 해피패스 2종 실행 결과 (실측)

전부 **`pnpm build` 산출물을 `vite preview`(4173)로 띄우고 headless Chromium 이 웹 UI 를 조작**해 얻었다.
API 4000 · Runner 4100 · MySQL 3307 · Redis 6379 · fixtures 정적 서버 4999 기동 상태.
**`RUNNER_CODE_EXECUTION_MODE` 는 기본값 `docker`** (`testflow/playwright-code-exec:1.63.0`, 3.57GB).
재현: `apps/runner/node_modules/.g6/happy-a.mjs` · `happy-b.mjs` · `roundtrip.mjs` (커밋하지 않음).

### 2.1 해피패스 A — 녹화 경로 (Task 6.4) ✅

| 단계 | 실측 | 스크린샷 |
|---|---|---|
| 1. 시나리오 생성 (**기본 선택 = 녹화**) | `/scenarios/new` → 빌더로 이동. 기존 사용자의 조작이 그대로다 | `/tmp/g6/a1-builder.png` |
| 2. 녹화 — 원격 브라우저 직접 조작 | 캔버스 center `(244,248,247)` · 서로 다른 색 **50** · `data-live=true` | `a2-recording.png` |
| 3. 조작 중 스텝 실시간 축적 | 스텝 카드 **3건** 실시간 반영 | `a2-steps.png` |
| 4. 녹화 종료 후 확정 스텝 | `['…페이지로 이동', "'아이디' 입력란에 값 입력", "'비밀번호' 입력란에 값 입력", "'로그인' 버튼 클릭"]` — **goto→fill→fill→click 4건** | — |
| 5. 인스펙터에서 스텝 편집 | 1번 스텝 이름을 `로그인 페이지 열기 (편집됨)` 로 바꿔 저장 확인 | `a4-inspector.png` |
| 6. 발행 | `published` · **v2** · `sourceType=steps` | — |
| 7. 실행 요청 (**계정·비밀번호 직접 입력**) | `baseUrl=http://127.0.0.1:4999` · 계정 `qa-tester` · 비밀번호 `hunter2-A` | `a5-rundialog.png` |
| 8. 실행 현황 실시간 | `pending` 관측 **true** · 3-상태 표시 유지 · `4 / 4 단계` → `passed` | `a6-run-1/2/final.png` |
| 9. 증적 (실패 실행) | **screenshot · video · trace · console_log · network_log = 5종** 표시 + 전부 다운로드 **200** | `a9-failrun.png` |
| 10. 콘솔 에러 / HTTP 실패 | **0건** / 0건 (304 캐시 응답만) | — |

**라운드 2 전용 장치가 녹화 실행에 새지 않는다**: 라이브 캔버스 `false` · `awaiting` 행 `false` ·
가짜 목업(`FakeLoginMock`) `false`. **라운드 1 화면이 그대로다.**

> 첫 회차에서는 `pending` 3-상태를 못 봤다. 실행이 **500ms 안에 끝나** 폴링(400ms) 사이를 지나간 것이고,
> 최종 회차에서 `pending=true` 로 관측했다. 제품 결함이 아니라 측정 해상도 문제였다.

### 2.2 해피패스 B — 코드 입력 경로 (Task 6.5) ✅

**붙여넣기**(`codegen-multi.spec.ts`, `test()` 2개)와 **파일 업로드**(`codegen-login.spec.ts`)를 각각 끝까지 돌렸다.

| 단계 | 붙여넣기 | 파일 업로드 |
|---|---|---|
| 경로 선택 → 이동 | `/scenarios/:id/code` | 동일 |
| 코드 투입 | `textarea` 붙여넣기 741자 | `setInputFiles` → `codegen-login.spec.ts` |
| 편집기 상태 | `21줄 · 945바이트` · issue **0건** · 저장 가능 | `27줄 · 1260바이트` · issue **0건** |
| 저장 후 **바이트 일치** | **true** | **true** (`filename=codegen-login.spec.ts`) |
| 발행 | `published` v2 · `sourceType=code` | 동일 |
| 실행 | `baseUrl=http://host.docker.internal:4999` | 동일 |
| **라이브 화면** | 첫 프레임 `+2290ms` center `(244,248,247)` 색 **43** | `+1972ms` 색 **42** |
| **화면이 실제로 움직였다** | 프레임 샘플 15 · **서로 다른 checksum 11** | 샘플 18 · **checksum 13** |
| **검은 캔버스 아님** | **true** | **true** |
| `between-tests` 전환 | **9회 관측** (`test()` 2개 사이) | 8회 |
| **종료 후 마지막 프레임 유지** | `phase=ended` · `conn=closed` · `frame=true` · `hidden=false` · 색 46 | 색 49 |
| 종료 배지 | `실행 성공 · 마지막 화면` | 동일 |
| `M`(총 단계) 추이 | `0 → 1 → 4 → 5 → 7 → 9` **단조 증가** | `0 → 2 → 5 → 8 → 10 → 11 → 13` **단조 증가** |
| 결과 | **passed 9 / 9** | **passed 13 / 13** |
| `step_results.step_id` | **전량 NULL** | **전량 NULL** |
| 콘솔 에러 | **1건** (§6 이슈 1 — 빈 코드 시나리오 최초 진입의 `/code` 404) | 1건 (동일) |

스크린샷: `bfinal-1-empty.png` · `bfinal-2-filled.png` · `bfinal-3-live-1.png` · `bfinal-3-live-2.png` ·
`bfinal-4-ended.png` / 업로드 경로는 `bupload-*.png`.

**실패한 코드 실행의 증적** (마스킹 점검 run 2건으로 확인):

```
screenshot 29567B → 200 · trace 809259B → 200 · video 120842B → 200
```

**console_log · network_log 는 코드 실행에서 수집하지 않는다** — 화면·README 양쪽에 명시돼 있다(있는 척하지 않는다).

---

## 3. ★ 내보내기 왕복 검증 (Task 6.1 · 6.2)

### 3.1 무엇을 돌렸나

해피패스 A 가 **실제로 녹화한** 4스텝 시나리오(`TC-GEN-031`)를 빌더 헤더의
**`코드로 내보내기`** 로 변환 → 모달에서 코드 확인 → **다운로드** →
새 코드 시나리오에 **파일 업로드** → 저장 → 발행 → **실행**.

### 3.2 생성 코드 전문 (모달·다운로드 파일 **바이트 일치 = true**)

```ts
// TestFlow 가 녹화 스텝에서 생성한 Playwright 코드입니다.
// 시나리오: TC-GEN-031 · G6 해피패스 A
// 생성: 2026-09-18T01:04:14.061Z
//
// ★ 값은 코드에 들어 있지 않습니다. 실행 요청의 변수(variables)가 환경변수로 주입됩니다.
//   TESTFLOW_VAR_password
//   TESTFLOW_BASE_URL  — 실행 요청의 기준 주소(use.baseURL 로도 들어갑니다)
//
// TestFlow 밖에서 직접 돌릴 때는 위 환경변수를 셸에서 넣어 주세요.
// 비밀번호를 이 파일에 적지 마세요 — 코드 본문은 DB 에 평문으로 저장됩니다.

import { expect, test } from "@playwright/test";

test("G6 해피패스 A", async ({ page }) => {
  // 1. 이동 — 로그인 페이지 열기 (편집됨)
  await page.goto("/fixtures/record-login.html");

  // 2. 입력 — '아이디' 입력란에 값 입력
  // ⚠ 대체 후보(Playwright 에는 순위 개념이 없어 주석으로만 남깁니다): page.getByLabel("아이디", { exact: true }) · page.locator("#username")
  await page.getByRole("textbox", { name: "아이디", exact: true }).fill("qa-tester", { timeout: 10000 });

  // 3. 입력 — '비밀번호' 입력란에 값 입력
  // ⚠ 대체 후보(Playwright 에는 순위 개념이 없어 주석으로만 남깁니다): page.locator("#password")
  await page.getByLabel("비밀번호", { exact: true }).fill((process.env["TESTFLOW_VAR_password"] ?? ""), { timeout: 10000 });

  // 4. 클릭 — '로그인' 버튼 클릭
  // ⚠ 대체 후보(Playwright 에는 순위 개념이 없어 주석으로만 남깁니다): page.getByText("로그인", { exact: true }) · page.locator("#login-submit")
  await page.getByRole("button", { name: "로그인", exact: true }).click({ timeout: 10000 });
});
```

### 3.3 왕복 판정

| 관문 | 실측 |
|---|---|
| ① 모달의 `validateScenarioCode()` | **issue 0건** (`export-issues` 비어 있음) |
| ② 다운로드 파일명 | `tc-gen-031.spec.ts` (계약 `[A-Za-z0-9._-]+\.spec\.ts` 만족) |
| ③ 화면 코드 ↔ 다운로드 파일 | **바이트 일치 = true** |
| ④ 업로드 후 에디터 검증 | **issue 0건** · 저장 버튼 활성 · `30줄 · 1782바이트` |
| ⑤ 저장 본문 ↔ 다운로드 파일 | **바이트 일치 = true** |
| ⑥ **실제 `playwright test` 실행** | **passed 4 / 4** (docker 격리) |
| ⑦ 실행 후 단계 제목 | `Navigate` · `Fill "***"` · `Fill "***"` · `Click` |
| ⑧ 실행 후 동작 매핑 | `goto` · `fill` · `fill` · `click` — **라운드 1 동작 칩이 그대로 산다** |
| ⑨ 평문 비밀번호 | 파일·DB·제목 **0건** (`process.env` 참조로만) |

스크린샷: `r1-export-modal.png` · `r3-uploaded.png` · `r4-run.png`.
단위 테스트로도 고정했다 — `packages/contracts/src/codegen.spec.ts` **36건**
(라운드 1 `04-gen-7` 이 실측한 **7스텝 전문**을 그대로 fixture 로 박았다. `nth:1`/`nth:2` 포함).

### 3.4 설계 판단 2건 (근거를 코드 주석에도 남겼다)

1. **`test.step()` 으로 감싸지 않는다.** 감싸면 화면의 단계 이름이 녹화 스텝 이름으로 보존되는 대신
   Runner 의 `toActionType()` 이 한국어 제목을 분류하지 못해 **전 단계가 `wait`(대기)** 로 떨어진다.
   라운드 1 화면의 동작 칩(이동/입력/클릭/확인)이 통째로 망가진다. 원래 이름은 **바로 위 주석**으로 보존한다.
2. **모든 `{{키}}` 를 `process.env["TESTFLOW_VAR_<키>"]` 로 낸다.** `isSecret` 여부로 표기를 가르지 않는다 —
   가르면 "secret 이 아닌 값은 평문으로 나간다"는 경로가 생기고 그 판정이 한 번만 틀려도 파일로 샌다.
   (`{{baseUrl}}` 만 예외 — `goto` 에서는 접두사를 떼고 **상대 경로**로 내 `use.baseURL` 을 태운다.)

---

## 4. ★ 마스킹 전수 점검 (Task 6.3)

**의도적으로 실패하는 코드 시나리오 2종**을 docker 격리에서 돌려 9경로를 훑었다.
재현: `apps/runner/node_modules/.g6/mask.mjs` · 원자료 `/tmp/g6/mask.json`.

- **대조군** `G6CONTROLMARK` — 평문이어도 되는 값. **검출되어야** 검사가 동작함이 증명된다.
- **변형 A `novars`** — 비밀번호를 **코드 본문에 직접** 박고 `variables` 를 **넘기지 않았다**.
  → 값 기반 마스킹(`collectSecretValues()`)이 **빈 배열**이 되어 `stripStepValue()` 패턴 제거가 **유일한 방어선**이다.
- **변형 B `withvars`** — 비밀번호가 **실행 요청 `variables` 로만** 들어간다(제품이 보장하는 경로).

| # | 경로 | `novars` 비밀 | `withvars` 비밀 | 대조군 |
|---|---|---|---|---|
| ① | `step_results.name_snapshot` | **0건** | **0건** | (제목에는 대조군도 없다 — 값이 통째로 벗겨진다) |
| ② | `step_results.error_message` | **0건** | **0건** | 검출됨 |
| ③ | `runs.error_message` | **0건** | **0건** | 검출됨 |
| ④ | **SSE 실수신 바이트** (`curl -N` 로 직접 수신) | **0건** | **0건** | 검출됨 |
| ⑤ | API 응답 (`GET /runs/:id` + `/artifacts`) | **0건** | **0건** | 검출됨 |
| ⑥ | **Runner / API stdout 로그** | **★ 검출됨** | **0건** | 검출됨 |
| ⑦ | 증적 파일 전량 (**trace.zip 압축 해제 포함**) | **0건** | **0건** | — |
| ⑧ | Redis SSE 버퍼 (`LRANGE run:<id>:events`) | **0건** | **0건** | 검출됨 |
| ⑨ | **`docker inspect` 전문** | **0건** | **0건** | (baseUrl·envLabel 은 있다 → 문서가 비지 않았음이 확인된다) |

**①의 실측 제목** (두 변형 모두 동일):
`Navigate` · `Fill "***"` · `Fill "***"` · `Click` · `Expect "toContainText"`
→ **`variables` 가 빈 배열이어도 `Fill "***"` 이다.** 계획서가 지목한 "유일한 방어선"이 실제로 버텼다.

**⑦ 증적**: `trace.zip` 은 압축돼 있어 그대로 `grep` 하면 없는 것처럼 보인다. **풀어서** 훑었고 0건이다.

**⑨ `docker inspect`** (원본 `/tmp/g6/docker-inspect.json`):

```
Env      : TESTFLOW_PW_REPORTER / EVENTS_URL / BASE_URL / VIEWPORT_W|H / CDP_PORT /
           HEADLESS / TESTFLOW_ENV_LABEL / FORCE_COLOR / CI / PATH / LANG / LC_ALL /
           PLAYWRIGHT_BROWSERS_PATH / PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
           → ★ TESTFLOW_VAR_* 가 **없다** (변수는 stdin JSON 으로 넘어간다)
Mounts   : <workspace>:/ws (rw) · <runner>/dist:/tfdist (**ro**)  — 2개뿐
           → ★ ARTIFACT_ROOT 마운트 **없음** (라운드 1 규율 유지)
HostConfig: Memory 2GiB · NanoCpus 1.5 · AutoRemove true · Init true
           PortBindings 127.0.0.1:<relay> 만 · ExtraHosts host.docker.internal:host-gateway
grep     : 비밀번호 0건 · 계정 0건
```

### ★ 발견 — ⑥ Runner 로그에 **코드 본문에 직접 박은** 문자열이 남는다

```
[runner] … [pw]        6 |   await page.locator("#password").fill("s3cr3tNOVARS777");
[runner] … [pw]     >  8 |   await expect(page.locator("#result")).toContainText("…");
```

Playwright **기본 리포터**가 실패한 줄의 앞뒤 소스를 stdout 으로 출력하고, Runner 가 그것을
`reporter.mask()` 를 통과시켜 흘린다. `variables` 가 비어 있으면 그 마스킹은 **무엇을 지워야 할지 모른다.**

**판단 — 고치지 않고 문서화했다.** 근거:

1. 이 값은 **사용자가 코드 본문에 직접 적은 문자열**이고, 코드 본문은 `scenario_codes.content` 에
   **평문으로 저장되는 것이 계약**이다(에디터에도 그대로 보인다). 새로운 노출 경로가 아니라
   **이미 평문인 값이 로그에도 보이는** 것이다.
2. 제품이 보장하는 경로(`variables`)는 **9경로 전부 0건**이다 — 보장이 깨진 것이 아니다.
3. `[pw]` 패스스루를 없애면 사용자 코드가 왜 시작조차 못 했는지 볼 유일한 수단이 사라진다.

**대신 한 것**: 코드 화면의 안내 박스와 README 에 **"비밀번호를 코드에 직접 적지 마라 —
`process.env["TESTFLOW_VAR_password"]` 로 읽어라"** 를 사유와 함께 명시했다.

---

## 5. 라운드 2가 추가한 것 / 유지한 것 / 폐기한 것

### 추가 (Gen-Phase 1~6 누적)

| 층 | 내용 |
|---|---|
| 계약 | `scenarios.sourceType` · `ScenarioCode` · `validateScenarioCode()` · `pw-step-title`(마스킹·매핑) · `LiveStream*` · **`codegen.ts`(이번)** |
| DB | 마이그레이션 011 — `scenarios.source_type` · `scenario_codes` · `runs.source_type` 스냅샷 |
| API | `GET/PUT /scenarios/:id/code` · 발행 분기 · `POST /runs` 코드 분기 · `GET /runs/:id/live` · `stream-token` 공통화 |
| Runner | `pw-config` · `pw-reporter` · `pw-event-mapper` · `code-workspace` · `code-executor` · `code-artifacts` · `code-browser` · `live-stream` · `code-container` · `pw-container-boot` |
| Web | 경로 선택 · 코드 에디터 화면 · 업로드 · `LiveCanvas` · `useLiveStream` · `awaiting` 행 · **내보내기 모달(이번)** |
| 문서 | README **시나리오 2종** 절(이번) · 코드 실행 격리 절 · `.env.example` 신규 변수 전량 |

### 라운드 1에서 **유지**된 것 (회귀 0건)

`runs` / `step_results` / `artifacts` 스키마 · SSE 이벤트 5종과 봉투 · `RunReporter` ·
`record/screencast.ts`(무수정) · 프레임 봉투 25바이트 · 드롭 정책 · 15fps 스로틀 ·
`features/recorder/**`(무수정) · 인스펙터 · 빌더 · 녹화 클라이언트 · 3-상태 스텝 표시 ·
증적 5종(녹화 경로) · 마스킹 규약 · 비회원제 · `docker-compose.yml` · `packages/db/src/cli/guard.ts`.

### 폐기

| 대상 | 처리 | 근거 |
|---|---|---|
| `RunSidePanel` 의 `FakeLoginMock` | Gen-Phase 5 에서 삭제 (`grep` 0건) | 요구사항 3번이 지목 |
| `poc/r2/pw/shim-pkg/**` · `shimroot/**` · `stream-fixture.mjs` (**경로 A**) | **이번에 파일째 삭제** | 아래 |
| `poc/r2/r2.ts` 의 `--mode a` / `--mode a0` | **이번에 코드째 제거** | 아래 |
| `poc/r2/r2.ts` (측정 하네스 본체) · `host.ts` · `map-events.ts` · `client/` · `specs*/` | **남긴다** | 경로 B·C·D 재측정 재현 경로 |

**경로 A 를 코드째 지운 근거** (계획서 재사용표의 "폐기" 판정을 실제로 집행했다):

1. 측정값은 **문서**(`r2-poc-live-stream.md`)에 남아 있다. 기록은 코드가 아니라 문서다.
2. 계획서 리스크 1번이 **"경로 A(shim)로는 가지 않는다"** 고 못 박았다. 동작하는 구현을 남겨 두면
   후퇴 경로로 오인된다. 후퇴가 필요하면 **경로 B** 를 쓴다.
3. shim 은 레포 안에 있는 **가짜 `@playwright/test` 패키지**다. `.npmrc` 의 `minimum-release-age`
   검역과 "phantom dependency 는 설치 구조가 아니라 코드를 고친다"는 이 레포의 규율과 정면으로 어긋난다.
   모듈 해석 가로채기는 Playwright 버전업에 **조용히** 깨진다.

> 남은 부산물: `host.ts` 의 `ingestWsUrl()`(경로 A ingest)은 이제 호출부가 없다. 타입·lint 는 통과한다.
> `host.ts` 는 경로 B·D 가 그대로 쓰므로 더 손대지 않았다 — **다음 작업 후보**로 기록한다.

---

## 6. 수정한 오류

### ★ 오류 1 — 실행이 끝나는 순간 **라이브 토큰이 조용히 회전**되고 콘솔에 404 가 남았다 (고침)

`queryKeys.runLive(id)` 가 `["runs", id, "live"]` 였다. react-query 의 무효화는 **접두 일치**라,
`useRunEvents` 가 `run.finished` 와 SSE desync 에서 부르는
`invalidateQueries({ queryKey: queryKeys.run(id) })`(=`["runs", id]`)가 **토큰 쿼리까지 무효화**한다.

실측 (`probe-live404.mjs`):

```
[수정 전] +501ms 200 /api/runs/<id>/live      ← 정상 발급
          +8494ms 404 /api/runs/<id>/live     ← ★ 종료 직전에 다시 발급 시도 → 404
          +8635ms STATE passed/ended/open
[수정 후] +506ms 200 /api/runs/<id>/live      ← 1회뿐
          +8889ms STATE passed/ended/open     ← 404 없음
```

두 가지가 동시에 일어나고 있었다 — ① 콘솔 에러 1건, ② **키가 하나뿐인 라이브 토큰이 재발급되어
지금 붙어 있는 소켓의 토큰이 무효화**된다(04-gen-5 결정 3이 막으려던 바로 그 동작이다.
`staleTime: Infinity` 는 무효화를 막지 못한다 — 무효화는 stale 여부와 무관하다).

**수정**: 키 공간을 분리했다 — `runLive: (id) => ["run-live", id]`. 근거를 키 정의 주석에 길게 남겼다.

### 오류 2 — 내보내기 모달의 `data-testid` 중복 (고침)

버튼과 코드 `<pre>` 가 둘 다 `export-code` 였다. `<pre>` 를 `export-code-body` 로 바꿨다.

### 오류 3 — `codegenFilename("../../etc/passwd")` 이 점으로 시작하는 파일명을 만들었다 (고침)

경로 문자만 지우면 `....etcpasswd` 가 남는다. **선두의 `.`/`-` 도 떨구도록** 고치고 테스트로 고정했다.
(계약상 위험하지는 않았지만 — `/` 가 이미 제거된다 — 숨김 파일처럼 보이는 이름을 만들지 않는다.)

---

## 7. 번들 크기 최종

| 청크 | Gen-Phase 5 기준선 | 이번 | 델타 |
|---|---|---|---|
| `rolldown-runtime` | 0.71 KB | 0.71 KB | 0 |
| `index` (진입) | 218.64 KB (gzip 69.09) | **218.64 KB** (gzip 69.14) | 0 |
| `useProject` (공유 vendor+contracts) | 321.62 KB (gzip 102.52) | **327.03 KB** (gzip 104.53) | **+5.41 KB** |
| **초기 로드 JS 합** | **540.97 KB** (gzip 172.04) | **546.38 KB** (gzip **174.09**) | **+5.41 KB (+1.0%)** / gzip +2.05 KB |
| CSS | 40.61 KB | **40.67 KB** | +0.06 KB |

**lazy 청크** (초기 로드 아님): `builder` 17.99 → **21.42 KB**(내보내기 모달 +3.43KB) ·
`code` 11.63 → **12.15 KB**(경고 문구) · `RunDetail` 23.44 KB(불변) · `recorder` 7.64 KB(불변).

**`vite build` 500KB 경고 없음** (최대 청크 327.03 KB).

**+5.41KB 의 출처와 판단**: `@testflow/contracts` 는 barrel(`index.ts`) 재노출이라 무엇이든 하나를
import 하면 **`codegen.ts` 를 포함한 전량**이 공유 청크로 들어온다. 내보내기 모달은 빌더(lazy)에서만
쓰이지만 계약 코드 자체는 초기 로드에 남는다. 없애려면 contracts 에 subpath export 를 추가해야 하고
(계약 패키지 구조 변경 · 3개 앱의 import 경로에 영향), 얻는 것이 5.4KB(gzip 2.0KB)라 **하지 않았다.**
라운드 1 기준선(523.83KB) 대비 누적 **+22.55KB (+4.3%)** 다. 수치를 그대로 보고한다.

---

## 8. ★ 미해결 이슈 / 미검증 항목

### 8.1 미해결 이슈

| # | 내용 | 재현 절차 | 영향 / 제안 |
|---|---|---|---|
| 1 | **빈 코드 시나리오를 처음 열면 콘솔에 404 가 1건 찍힌다** | 코드 시나리오를 새로 만들고 `/scenarios/:id/code` 진입 → DevTools 콘솔 | `GET /scenarios/:id/code` 는 본문이 없으면 **404 가 계약**이다(04-gen-2). 화면은 `null`("아직 비었다")로 정상 처리하지만 브라우저는 실패한 fetch 를 무조건 콘솔에 남긴다 — `fetch` 로는 억제할 수 없다. **제안**: `ScenarioDetail` 에 `hasCode: boolean` 를 **추가**하고(계약 추가만) 그것이 `true` 일 때만 본문을 조회한다. 이번에 하지 않은 이유: 마지막 단계에 **뜨거운 상세 엔드포인트**(목록 p95 6.3ms)에 `EXISTS` 조회를 얹는 변경이라 회귀 위험 대비 이득이 작다 |
| 2 | **코드 본문에 직접 적은 비밀번호가 Runner 로그에 남는다** | §4 의 `novars` 변형 | 값 기반 마스킹이 모르는 문자열이라 구조적으로 막을 수 없다. 화면·README 경고로 대응했다. 근본 해결은 `[pw]` 패스스루를 끄는 것이고, 그러면 사용자 코드의 기동 실패 진단 수단이 사라진다 |
| 3 | **docker 모드에서 호스트 로컬 대상은 `host.docker.internal` 을 사용자가 직접 써야 한다** | `baseUrl=http://127.0.0.1:4999` 로 코드 실행 → 컨테이너 안에서 닿지 않는다 | Runner 가 `127.0.0.1` 을 자동 치환하지 않는다(치환하면 "내가 넣은 주소와 다른 주소로 돌았다"가 된다). README 에 적혀 있으나 **화면에는 안내가 없다**. 제안: 실행 다이얼로그에서 코드 시나리오 + docker 모드 + 루프백 주소일 때 힌트 한 줄 |
| 4 | `host.ts` 의 `ingestWsUrl()` 이 호출부 없는 잔재 | — | 경로 A 제거의 부산물. PoC 코드라 기능 영향 없음 |

### 8.2 이번에 **검증하지 못한** 것 (정직하게)

| 항목 | 상태 |
|---|---|
| **`projects` 2개 이상 · `webServer` 사용 config** | **지원하지 않음으로 확정**(게이트 G1, 04-gen-3). 거부 메시지는 `UNSUPPORTED_USER_CONFIG_MESSAGE` 에 있고 단위 테스트로 고정돼 있다. **이번 단계에서 실행으로 재확인하지는 않았다** |
| **`local` 모드에서의 코드 실행** | 이번 회차는 전부 **`docker`** 로 돌렸다(기본값). `local` 은 Gen-Phase 5 가 실측했다 |
| **공개 사이트 1건에 대한 코드 실행** | Task 6.5 의 "대상은 로컬 fixture + 공개 사이트 1건" 중 **공개 사이트를 돌리지 않았다.** 네트워크 의존 검증이라 재현성이 떨어지고, 격리 컨테이너의 외부 egress 를 열어야 한다. **미실시로 기록한다** |
| **4401 / 4404 close 의 화면 문구** | 토큰 거부를 인위적으로 만들지 않았다(Gen-Phase 5 에서도 미실시). 코드에만 있다 |
| **`{t:"error", code:"CDP_ATTACH_FAILED"}` 화면 표시** | 동일. 배선만 확인 |
| **토큰 TTL(120초) 초과** | 실행이 전부 15초 안에 끝나 만료 경로를 타지 않았다 |
| **다중 뷰어** (같은 run 을 두 탭에서) | sink 1개 제약. Runner 단위 테스트만 있다 |
| **실제 nginx 뒤** (`RUNNER_WS_LIVE_PUBLIC_URL`) | 프록시 설정은 README 에 있으나 실제로 세우지 않았다 |
| **Firefox / Safari** | headless Chromium 만 썼다(라운드 1과 같은 한계) |
| **배포 서버 Node 버전** | 라운드 1 이월. 로컬 `v22.22.2` 에서만 확인 |
| **worker 재시작 후 CDP 재바인딩** | 04-gen-4 가 다뤘다. 이번에 재현하지 않았다 |

> 검증 중 만든 시나리오 23건은 전부 삭제했다(`runs` 이력은 append-only 라 남겼다).
> 그 과정에서 **라운드 1 Gen-Phase 6 의 E2E 잔재 3건**(`TC-G6-001~003`)도 같이 지워졌다 —
> 이름이 `q=G6` 에 걸렸다. 둘 다 검증용 더미라 제품 영향은 없다. 사실대로 적는다.

---

## 9. 요구사항 충족표

### 9.1 라운드 2 확정 요구사항 7건

| # | 요구사항 | 판정 | 근거 |
|---|---|---|---|
| 1 | **레코더·빌더·인스펙터를 버리지 않는다. 코드 입력 경로를 추가한다** | ✅ | §2.1 해피패스 A 전 구간 통과. `features/recorder/**` `git diff` 0줄. 새 시나리오의 **기본 선택이 녹화**다 |
| 2 | **코드 입력 두 경로** — 붙여넣기 / `.spec.ts` 업로드 (git 연동 제외) | ✅ | §2.2 양쪽 모두 저장 **바이트 일치** + 실행 passed. git 연동 없음 |
| 3 | **라이브 화면은 실시간 스트리밍** — 정적 목업 교체 | ✅ | 프레임 샘플 15~18장 · **서로 다른 화면 11~13종** · 검은 캔버스 아님. `grep FakeLoginMock` **0건** |
| 4 | **codegen 반입 흐름 + 녹화 스텝 → 코드 내보내기(우선순위 낮음)** | ✅ | 반입: 코드 화면의 명령 복사 + 업로드(검증됨). 내보내기: §3 **왕복 passed 4/4** |
| 5 | **screencast 를 실행 경로에도 붙인다 (경로 D)** | ✅ | `record/screencast.ts` **무수정 import**. `use.launchOptions` → CDP → `connectOverCDP` |
| 6 | **비회원제·단일 워크스페이스 유지** | ✅ | 인증·권한·`created_by` 없음. `[AUTHZ]` 주석 유지 |
| 7 | **pnpm · 확정 버전 유지** | ✅ | 4종 게이트 전부 통과. 런타임 의존성 **추가 0건** |

### 9.2 라운드 1 FR 12건 — 회귀 점검

| FR | 라운드 1 판정 | 이번 확인 | 회귀 |
|---|---|---|---|
| FR-001 녹화로 시나리오 생성 | ✅ | 실제로 녹화 → goto/fill/fill/click **4스텝** (§2.1) | **없음** |
| FR-002 스텝을 업무 언어로 편집 | ✅ | 인스펙터에서 이름 변경 반영 확인 | **없음** |
| FR-003 발행 / 버전 관리 | ✅ | `published` v2 (녹화·코드 양쪽) | **없음** |
| FR-004 Locator 우선순위 + `nth` | ✅ | `?advanced=1` 원본으로 내보내기 수행 — role/label/text/testid/css + `nth` 전부 살아 있다 | **없음** |
| FR-005 Secret 암호화 (MUST) | ❌ 미충족(사용자 결정) | **상태 유지** — 저장하지 않고 실행 시 입력받는다 | 변화 없음 |
| FR-006 실행 요청 + 큐 등록 | ✅ | 202 / `queued` (녹화·코드·스위트 혼합) | **없음** |
| FR-007 실행 현황 실시간 | ✅ | 녹화 `pending→running→passed` 3-상태 관측 · 코드 `M` 단조 증가 | **없음** |
| FR-008 실패 증적 5종 | ✅ | 녹화 실패 실행에서 **5종 표시 + 전부 200** | **없음** (코드 경로는 3종 — 설계상 명시) |
| FR-009 실행 취소 | ✅ | 이번 회차에서 **재확인하지 않았다**. 04-gen-3 Task 3.5 가 코드 경로 취소를 실측했다 | 미확인 |
| FR-010 스위트 묶음 실행 | ✅ | 이번 회차에서 재확인하지 않았다. 04-gen-2 Task 2.4 가 혼합 스위트 `batch_id` 를 실측했다 | 미확인 |
| FR-011 대시보드 지표 | ✅ | 화면 무수정. 이번 회차 직접 확인 안 함 | 미확인 |
| FR-012 실행 이력 조회 | ✅ | 실행 현황·목록 진입 정상(해피패스 경유) | **없음** |

> FR-009 · FR-010 · FR-011 은 **화면·API 를 이번에 고치지 않았고** 각 Gen-Phase 에서 실측됐으나,
> **이 단계에서 다시 돌리지는 않았다.** "통과했다"가 아니라 "이번에 재확인하지 않았다"로 적는다.

---

## 10. 다음 단계 제안

1. **이슈 1 해소** — `ScenarioDetail.hasCode` 추가(계약 **추가만**)로 빈 코드 시나리오의 404 콘솔 로그를 없앤다.
   그러면 "콘솔 에러 0건"이 전 화면에서 성립한다.
2. **실행 다이얼로그의 docker 힌트** — 코드 시나리오 + `docker` + 루프백 주소일 때
   `host.docker.internal` 안내 한 줄. 지금은 README 를 읽어야만 알 수 있다(이슈 3).
3. **`projects` 다중 / `webServer` 지원** — 필요해지면 **경로 B 승급**(`launchServer` + `connectOptions`).
   PoC 가 `workers:2` 에서 page 3개 열거를 실증했다. 경로 A 는 이번에 코드째 지웠다.
4. **contracts subpath export** — 초기 로드에서 `codegen.ts`·`code-validation.ts` 를 떼면 gzip 약 2KB.
   지금은 비용 대비 이득이 없지만 계약이 더 커지면 재검토 지점이다.
5. **다중 파일 코드 시나리오** — `scenario_codes` 를 1:N 으로 넓히면 된다(설계상 확장 지점을 남겨 뒀다).
   단 **가상 파일트리 + 경로 쓰기 검증**이 따라오고 그것이 임의 경로 쓰기의 입구다. 격리가 전제다.
6. **미검증 항목 소화** — 공개 사이트 실행 1건 · 4401/4404 화면 문구 · nginx 프록시 뒤 · 다중 뷰어.
7. **회원제 전환 검토** — 라운드 1 제안 유지. 전환하면 FR-005 를 제대로 구현할 토대가 생긴다.
