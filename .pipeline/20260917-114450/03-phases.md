---
# Plan Artifact
pipeline_id: 20260917-114450
phase: 03-phases
feature: TestFlow (비회원제 MVP)
total_gen_phases: 12
---

# Feature: TestFlow — 비개발자용 E2E 테스트 자동화 플랫폼 (비회원제 MVP)
생성일: 2026-09-17

## 진행 전략

이 MVP의 유일한 치명 리스크는 **원격 브라우저 화면 스트리밍 + 클릭 좌표 역주입**이다. 여기서 실패하면 `recording-options.html`이 남긴 탈출구(1번 별도 창 방식)로 되돌아가야 하고, 그 판단은 빠를수록 싸다. 따라서 **Gen-Phase 1(스캐폴딩 + 버전 스파이크) → Gen-Phase 2(contracts + DB) → Gen-Phase 3(PoC-1 녹화 스트리밍)** 세 단계만 먼저 만들고, **Gen-Phase 3 끝에 사용자 확인 게이트**를 둔다. 게이트에서 "지연 200ms 이하 / 10fps 이상 / 클릭 요소 적중률 100%" 측정값을 보고 진행 여부를 결정한다. 게이트 통과 후 Gen-Phase 4~12를 전량 진행한다. PoC-1의 검증 대상은 사내 스테이징이 아니라 **공개 사이트(`https://playwright.dev`) + 로컬 더미 로그인 페이지**이며, 사내 대상 검증은 Gen-Phase 12의 별도 Task로 분리한다. PoC-2(한글 IME)·PoC-3(녹화→재생 왕복)은 해당 기능 코드가 존재해야 측정 가능하므로 Gen-Phase 12에 배치한다.

**전 Gen-Phase 공통 규율** (모든 Task에 암묵 적용)
- `packages/contracts`의 zod 스키마가 web·api·runner 3자의 **단일 타입 소스**다. 타입을 각 앱에서 재정의하지 않는다.
- Secret 마스킹은 `apps/api/src/common/utils/mask.ts` **단일 함수**만 쓴다. AES 암호화(`crypto.ts`)와 `project_variables` 테이블은 **만들지 않는다** (02-context "★ 사용자 최종 결정" (c)).
- 인증·권한·`created_by`·Guard·CurrentUser는 **전부 없다** (비회원제).
- CSS Selector는 테스터 화면에 노출하지 않는다. `target_json.fallbacks`의 `css` 항목은 API 응답 기본 제외.

---

## Gen-Phase 1 — 모노레포 스캐폴딩 & 버전 스파이크

### Task 1.1: 버전 스파이크 — decorator metadata / breaking change 검증
- **파일**: `.pipeline/20260917-114450/spike-versions.md` (신규 생성) + `/tmp/tf-spike/` (임시, 커밋 안 함)
- **작업**: 임시 디렉토리에서 최신 안정 조합(TS 7.0.2 / NestJS 12.0.3 / TypeORM 1.1.1 / Playwright 1.63 / React 19.3 / Vite 8.3 / Tailwind 4.3)을 실제로 설치해 아래 4건을 검증한다. ① TS 7.0.2에서 `experimentalDecorators`+`emitDecoratorMetadata`로 NestJS 12 컨트롤러/DI가 컴파일·기동되는가, ② TypeORM 1.1.1의 `DataSource`·`MigrationInterface`·`@Entity` API가 0.3.x 대비 바뀌었는가(릴리스 노트 + 실제 `migration:run` 1회), ③ NestJS 11→12 breaking(`ValidationPipe` 옵션, `@nestjs/config`, `@nestjs/bullmq` 호환), ④ Tailwind 4.3 `@theme` + shadcn/ui CLI 조합. 막히는 항목만 **개별적으로 한 단계 내린다**(예: TS만 5.9 계열로). ERDify 검증 조합(Nest 11 / TypeORM 0.3 / TS 5.x)이 최종 안전망.
- **참고**: 02-context "기술 스택 확정안" 표의 `미확인` 표시 3건 + "주의사항 및 의존성 > 버전 관련".
- **완료 기준**: `spike-versions.md`에 7개 패키지별 **확정 버전과 판정 근거**가 표로 기록된다. 하향한 항목이 있으면 그 사유와 재승급 조건이 명시된다. 스파이크 임시 디렉토리는 `PROJECT_DIR` 밖에 두고 남기지 않는다.
- **상태**: [x]

### Task 1.2: git 초기화 + `.gitattributes` / `.gitignore`
- **파일**: `.gitattributes`, `.gitignore` (신규 생성)
- **작업**: `git init` 후 **첫 커밋 전에** `.gitattributes`에 `* text=auto eol=lf` 를 명시한다(websystem CRLF 사고 재발 방지 — 02-context "기타"). `.gitignore`는 `node_modules/`, `dist/`, `.env`, `.turbo/`, `artifacts/`(= `ARTIFACT_ROOT` 기본값), `playwright-report/`, `test-results/` 포함. 브랜치는 CLAUDE.md 기본 규칙에 따라 `feat/testflow-mvp`.
- **참고**: 02-context "신규 프로젝트 구조" 루트 파일 목록, "기타".
- **완료 기준**: `git check-attr text -- README.md` 가 `text: auto` 를 출력한다. `git status`에 `node_modules`가 나타나지 않는다.
- **상태**: [x]

### Task 1.3: yarn workspaces 루트 + turbo 태스크 그래프
- **파일**: `package.json`, `turbo.json`, `.yarnrc.yml` (신규 생성)
- **작업**: 루트 `package.json`에 `"workspaces": ["apps/*", "packages/*"]`, `private: true`, 스크립트 `dev/build/lint/typecheck/test`를 turbo 위임으로 정의. `turbo.json`은 ERDify 태스크 그래프를 차용하되 **pnpm `--filter` 문법을 yarn 문법으로 변환**한다(`yarn workspace <name> <cmd>`, 의존은 `workspace:^`). `build`는 `dependsOn: ["^build"]`, `typecheck`/`lint`는 캐시 on.
- **참고**: 02-context "패키지 매니저 불일치" 절 — turbo는 PM 중립이므로 그래프만 그대로 가져온다.
- **완료 기준**: `yarn install` 이 에러 없이 끝나고 `yarn workspaces list` 가 `apps/*` + `packages/*` 를 모두 나열한다.
- **상태**: [x]

### Task 1.4: `packages/config-typescript` 프리셋 4종
- **파일**: `packages/config-typescript/{package.json,base.json,react.json,nest.json,node.json}` (신규 생성)
- **작업**: `base.json`에 `strict: true`, `noPropertyAccessFromIndexSignature: true`(→ env는 `process.env["X"]` bracket 접근 강제, ERDify 규약), `noUncheckedIndexedAccess`, `moduleResolution: bundler|node16` 를 Task 1.1 확정 버전에 맞춰 설정. `nest.json`은 `experimentalDecorators`+`emitDecoratorMetadata` **on**, `react.json`은 `jsx: react-jsx` + DOM lib, `node.json`은 runner용(DOM 없음, 단 `injected.ts`는 별도 tsconfig로 DOM 필요).
- **참고**: 02-context "새로 생성할 파일" 표 / "부트스트랩" 절의 bracket 접근 근거.
- **완료 기준**: 4개 파일이 존재하고 각각 단독으로 `tsc --showConfig -p <file>` 가 에러 없이 출력된다.
- **상태**: [x]

### Task 1.5: `packages/config-eslint` flat config 3종
- **파일**: `packages/config-eslint/{package.json,base.js,react.js,nest.js}` (신규 생성)
- **작업**: ESLint 9 flat config. `base.js`는 typescript-eslint 권장 + prettier 충돌 비활성화, `react.js`는 react-hooks 규칙(특히 `exhaustive-deps` on), `nest.js`는 decorator 사용을 허용하는 예외 설정. oxlint는 채택하지 않는다(Nest 룰셋 생태계 이유 — 02-context).
- **완료 기준**: 루트에서 `yarn lint` 실행 시 "0 problems" 또는 설정 오류 없이 종료한다(대상 파일이 아직 없어도 config 로드 에러가 없어야 한다).
- **상태**: [x]

### Task 1.6: `docker-compose.yml` + `.env.example`
- **파일**: `docker-compose.yml`, `.env.example` (신규 생성)
- **작업**: `mysql:8.4`(포트·`utf8mb4_0900_ai_ci` charset·초기 DB `testflow`·헬스체크) + `redis:7` 서비스 정의. `.env.example` 키: `DB_HOST/DB_PORT/DB_USER/DB_PW/DB_NAME`, `REDIS_HOST/REDIS_PORT`, `API_PORT=4000`, `RUNNER_WS_PORT`, `ARTIFACT_ROOT`, `RUNNER_CONCURRENCY`, `RUNNER_DOCKER_IMAGE`, `RUNNER_CONTAINER_MEMORY`, `RUNNER_CONTAINER_CPUS`, `CORS_ORIGINS`. **`SECRET_ENC_KEY`는 넣지 않는다**(AES 미구현 결정).
- **참고**: 02-context "새로 생성할 파일" 표 + "★ 최종 결정" (c)(d).
- **완료 기준**: `docker compose up -d` 후 `docker compose ps` 가 mysql·redis 둘 다 `healthy`를 보고한다. `.env.example`에 `SECRET_ENC_KEY`가 **없다**.
- **상태**: [x]

### Task 1.7: 앱 3종 빈 워크스페이스 생성
- **파일**: `apps/{web,api,runner}/package.json` + 각 `tsconfig.json` (신규 생성)
- **작업**: 3개 워크스페이스의 껍데기만 만든다. `web`은 Vite+React 템플릿 기반, `api`는 Nest CLI 없이 수동 구성(`nest.json` 확장), `runner`는 얇은 Node 프로세스(`node.json` 확장). 각각 `@testflow/config-typescript`를 `workspace:^`로 참조. 소스는 다음 Gen-Phase에서 채운다.
- **완료 기준**: `yarn typecheck` 가 3개 워크스페이스 전부에서 통과한다(파일이 비어 있어도 config 오류 0).
- **상태**: [x]

---

## Gen-Phase 2 — 공유 계약(contracts) + DB 패키지

> Gen-Phase 1 전체에 의존. Task 2.1이 **이 Gen-Phase의 선행 Task**다(나머지가 전부 참조).

### Task 2.1: `TestStepSchema` / `LocatorTargetSchema` 확정
- **파일**: `packages/contracts/src/step.ts` (신규 생성)
- **작업**: zod 4로 `ActionType` enum(`goto|click|fill|select|check|uncheck|press|hover|assert_visible|assert_text|assert_url|wait`), `LocatorTargetSchema`(`primary` + `fallbacks[]` + `frameUrl` + `snapshot`, `by: role|label|text|testid|css`), `TestStepInputSchema`(`{value, isSecret}`), `TestStepOptionsSchema`(`{timeoutMs, optional}`), `TestStepSchema`를 정의한다. **`css` fallback에는 "고급 설정 전용" 주석을 단다.** 추론 타입(`export type TestStep = z.infer<...>`)을 함께 내보낸다.
- **참고**: 02-context "DB 스키마 초안"의 `test_steps.target_json` 주석 블록이 정확한 형태. "설계상 반드시 지켜야 할 제약" — 이 파일을 가장 먼저 확정.
- **완료 기준**: `packages/contracts`에서 `yarn typecheck` 통과. `TestStepSchema.parse()` 단위 테스트가 target_json 예시(02-context의 role+4 fallback 예시)를 그대로 통과시키고, `by: "unknown"`은 거부한다.
- **상태**: [ ]

### Task 2.2: 시나리오·스위트 계약
- **파일**: `packages/contracts/src/scenario.ts`, `packages/contracts/src/suite.ts` (신규 생성)
- **작업**: `ScenarioStatus`(`draft|published|archived`), `ScenarioSchema`, 목록 응답(`ScenarioListItemSchema` — 시안 6열: 시나리오/기능/상태/최근 결과/수정일/작성자), `CreateScenarioDto`/`PatchScenarioDto`/`PutStepsDto` 스키마. `suite.ts`는 `SuiteSchema` + `CreateSuiteDto`(`{name, scenarioIds}`).
- **참고**: 02-context "API 스펙 초안" 시나리오·스위트 절, 01-clarify 화면 2 테이블 6열.
- **완료 기준**: `yarn typecheck` 통과 + 목록 응답 스키마 필드가 시안 6열과 1:1 대응함을 주석으로 확인 가능.
- **상태**: [ ]

### Task 2.3: 실행(run) 계약 — **변수 인라인 전달 경로 포함**
- **파일**: `packages/contracts/src/run.ts` (신규 생성)
- **작업**: `RunStatus`(`queued|running|passed|failed|cancelled|timeout|error`), `StepResultStatus`, `RunSchema`, `RunListItemSchema`(대시보드 최근 실행), `RunDetailSchema`(다크 요약바용 `summary`), `ArtifactSchema`. **`CreateRunDto`는 `{scenarioId?, suiteId?, baseUrl: string(url, 필수), envLabel, browser:'chromium', variables: Record<string,string>}`** 로 정의한다 — 02-context "★ 최종 결정" (a)(c)에 따라 `baseUrl`·계정·비밀번호는 **실행 요청 body가 주 경로**다. `variables` 중 Secret 키 판별 규칙(`password`·`pwd`·`secret` 접미/접두 또는 명시 `secretKeys: string[]`)도 여기서 정의한다.
- **참고**: 02-context "★ 최종 결정" (a)(c) 및 "(c) 결정의 파생 영향".
- **완료 기준**: `CreateRunDto.parse({scenarioId, baseUrl:'https://x', envLabel:'스테이징', browser:'chromium', variables:{}})` 통과. `scenarioId`·`suiteId` **둘 다 없으면 refine으로 거부**하는 테스트가 통과한다.
- **상태**: [ ]

### Task 2.4: 녹화·이벤트·스토리지 계약
- **파일**: `packages/contracts/src/recording.ts`, `packages/contracts/src/events.ts`, `packages/contracts/src/storage.ts` (신규 생성)
- **작업**: `recording.ts` — 세션 생성 요청/응답(`{sessionId, wsUrl, expiresAt, viewport}`), 세션 상태. `events.ts` — **SSE 이벤트 5종**(`run.status`/`step.started`/`step.finished`/`run.finished`/`artifact.ready`)과 **WS 메시지**(C→S `{t:'mouse'|'key'|'wheel'|'ime'|'resize'}`, S→C `{t:'frame'}`/`{t:'step'}`/`{t:'nav'}`)를 discriminated union으로 정의. `storage.ts` — `StorageKey` 규약(`runs/<runId>/step-<seq>.png`)과 `ArtifactType`.
- **참고**: 02-context "API 스펙 초안"의 SSE·WS 행, "원격 브라우저 녹화 기술 조사 > 입력 역주입" 표.
- **완료 기준**: WS 메시지 union이 `t` 필드로 판별되고, `frame` 메시지의 payload 타입이 **바이너리(`Uint8Array`) 전송을 전제**함이 타입으로 표현된다(base64 금지 — 02-context). `yarn typecheck` 통과.
- **상태**: [ ]

### Task 2.5: contracts barrel + 패키지 설정
- **파일**: `packages/contracts/{package.json,tsconfig.json,src/index.ts}` (신규 생성)
- **작업**: 1폴더 1책임 + barrel `index.ts` 재노출(websystem-design-system 배치 규율 차용 — 02-context "재사용 판단"). `exports` 필드로 `@testflow/contracts` 진입점 노출.
- **완료 기준**: `apps/api`에서 `import { TestStepSchema } from '@testflow/contracts'` 가 타입 해석된다(`yarn typecheck` 통과).
- **상태**: [ ]

### Task 2.6: `packages/db` DataSource + 엔티티 9종
- **파일**: `packages/db/src/data-source.ts`, `packages/db/src/entities/*.entity.ts` (신규 생성, 9개 파일 + barrel)
- **작업**: MySQL 8 DataSource(`synchronize:false`, `migrationsRun:false`, 마이그레이션 **명시 import 배열 등록** — glob 금지, ERDify 규약). 엔티티: `project`, `scenario`, `test-step`, `suite`, `suite-scenario`, `run`, `step-result`, `artifact`, `recording-session`. **`project-variable` 엔티티는 만들지 않는다**(02-context "★ 최종 결정" (c) 파생 영향).
- **참고**: 02-context "DB 스키마 초안" 전체 + "마이그레이션" 절(Postgres→MySQL 타입 치환: `JSONB`→`JSON`, `TIMESTAMPTZ`→`DATETIME(3)`, `now()`→`CURRENT_TIMESTAMP(3)`).
- **완료 기준**: 엔티티 파일이 정확히 **9개**이고 `project-variable.entity.ts`가 존재하지 않는다. `yarn workspace @testflow/db typecheck` 통과.
- **상태**: [ ]

### Task 2.7: 마이그레이션 8종 + 시드
- **파일**: `packages/db/src/migrations/001_create_projects.ts` ~ `008_create_recording_sessions.ts`, `009_seed_default_project.ts` (신규 생성)
- **작업**: 02-context DDL을 원시 `queryRunner.query()`로 그대로 옮긴다. **단 `project_variables` CREATE TABLE은 제외**한다. `009`는 기본 프로젝트 1건 INSERT(`base_url`은 **placeholder 기본값**일 뿐 주 경로가 아님 — 실행 다이얼로그 입력이 주 경로). 각 마이그레이션에 `down()` 필수.
- **참고**: 02-context "DB 스키마 초안" 001~009 + "★ 최종 결정" (a)(c).
- **완료 기준**: `yarn workspace @testflow/db migration:run` 이 성공하고, MySQL에서 `SHOW TABLES` 가 **9개 테이블**(projects, scenarios, test_steps, suites, suite_scenarios, runs, step_results, artifacts, recording_sessions)을 반환하며 `project_variables`는 **없다**. `migration:revert` 를 8회 실행하면 테이블이 모두 사라진다.
- **상태**: [ ]

---

## Gen-Phase 3 — PoC-1: 녹화 스트리밍 (프레임 왕복 지연 + 클릭 좌표 정확도) ★ 게이트

> Gen-Phase 1·2에 의존. **이 Gen-Phase의 목적은 제품 코드가 아니라 측정값 확보**다. 단, 여기서 만드는 `screencast.ts`·`input-bridge.ts`의 **인터페이스는 그대로 제품에 승격**되므로 파일 위치를 최종 위치에 둔다(02-context "설계상 반드시 지켜야 할 제약" — 화면 전달 계층 분리).

### Task 3.1: 더미 로그인 페이지 + PoC 실행 스크립트 골격
- **파일**: `apps/runner/poc/fixtures/login.html`, `apps/runner/poc/poc1.ts` (신규 생성)
- **작업**: 좌표 정확도 측정용 더미 페이지를 만든다 — **알려진 절대 좌표에 배치된 버튼 9개(3×3 그리드)** + 아이디/비밀번호 input + 로그인 버튼. 각 버튼은 클릭 시 `data-hit` 속성에 자기 id를 기록한다. `poc1.ts`는 이 페이지와 `https://playwright.dev` 두 대상을 모두 측정 대상으로 받는다(`--target` 인자).
- **참고**: 오케스트레이터 지시 — 사내 스테이징 대신 공개 사이트 + 로컬 더미로 우선 검증.
- **완료 기준**: `npx serve apps/runner/poc/fixtures` 로 띄운 페이지에서 9개 버튼을 브라우저로 직접 클릭하면 `data-hit`이 각각 갱신된다.
- **상태**: [ ]

### Task 3.2: `screencast.ts` — 프레임 송출 계층
- **파일**: `apps/runner/src/record/screencast.ts` (신규 생성)
- **작업**: `page.screencast.start({ onFrame, quality: 60, size: { width: 1280, height: 800 } })` 를 감싸는 얇은 어댑터. **`size`를 반드시 명시**한다(미지정 시 800×800으로 축소되어 좌표 변환이 깨진다 — 02-context). `onFrame` 시그니처(`{data: Buffer, timestamp, viewportWidth, viewportHeight}`)를 인터페이스로 고정해 **2안(CDP `Page.startScreencast`)으로 교체해도 시그니처가 동일**하도록 만든다. `pageScaleFactor`·`scrollOffset`이 필요하면 보조 CDP 세션을 병행할 수 있는 훅을 남긴다.
- **참고**: 02-context "화면 스트리밍" 1안/2안 및 권고.
- **완료 기준**: 파일이 `startScreencast(page, opts): Promise<Dispose>` 단일 export를 가지며, 내부 구현을 CDP로 바꿔도 **export 시그니처가 변하지 않음**이 타입으로 보장된다(인터페이스 타입을 별도 선언).
- **상태**: [ ]

### Task 3.3: `input-bridge.ts` — 좌표/키 역주입 계층
- **파일**: `apps/runner/src/record/input-bridge.ts` (신규 생성)
- **작업**: CDP `Input.dispatchMouseEvent`(mouseMoved/mousePressed/mouseReleased/mouseWheel)와 `Input.dispatchKeyEvent`를 감싼다. **IME 경로는 인터페이스만 뚫어 두고**(`insertText(text)` / `setComposition(...)` / `commitComposition()`) A안(`Input.insertText`)만 구현한다 — B안 승급 시 이 파일 안에서만 바뀌도록 가둔다. PoC에서 `page.mouse.move/down/up`(좌표 기반 고수준 API)과 CDP 직접 호출을 **둘 다 시도해 정확도를 비교**한다.
- **참고**: 02-context "입력 역주입" 표 + "권고: A안으로 MVP, PoC에서 실패 시 B안 승급".
- **완료 기준**: 두 경로(Playwright mouse / CDP Input)가 같은 인터페이스 뒤에 있고 환경변수 또는 인자로 전환 가능하다. `yarn typecheck` 통과.
- **상태**: [ ]

### Task 3.4: PoC용 WS 서버 + 캔버스 클라이언트
- **파일**: `apps/runner/poc/poc-ws-server.ts`, `apps/runner/poc/client/index.html` (신규 생성)
- **작업**: `ws` 8.x 서버가 Task 3.2의 프레임을 **JPEG 바이너리 그대로**(base64 금지) 푸시하고, 클라이언트 메시지(`mouse`/`wheel`/`key`)를 Task 3.3에 전달한다. 클라이언트는 `createImageBitmap(blob)` → `canvas.drawImage`로 렌더하고, **좌표 역변환** `(clientX - rect.left) * (remoteW / rect.width)` 를 적용해 클릭을 송신한다. **프레임 드롭 정책 필수** — `ws.bufferedAmount` 감시 + 렌더 중이면 최신 프레임만 남기고 버린다.
- **참고**: 02-context "전송" 절 + "좌표 변환 주의".
- **완료 기준**: 브라우저에서 클라이언트 페이지를 열면 원격 페이지 화면이 캔버스에 계속 갱신되고, 캔버스를 클릭하면 원격 페이지가 반응한다(눈으로 확인 가능).
- **상태**: [ ]

### Task 3.5: 지연·fps·좌표 정확도 자동 측정
- **파일**: `apps/runner/poc/measure.ts` (신규 생성)
- **작업**: ① **왕복 지연** — 프레임 `timestamp`와 클라이언트 렌더 완료 시각 차이를 100프레임 이상 수집해 p50/p95를 낸다. ② **실효 fps** — 30초간 렌더된 프레임 수 / 30. ③ **클릭 적중률** — Task 3.1의 3×3 버튼 9개 각각에 대해 캔버스 좌표를 계산해 클릭을 쏘고, `data-hit` 값이 의도한 id와 일치하는지 검사한다. **캔버스 표시 크기를 3가지(원본 100% / 축소 70% / 확대 130%)로 바꿔 각각 9회씩 총 27회** 측정한다(좌표 변환 버그는 스케일이 1이 아닐 때만 드러난다).
- **참고**: 02-context "PoC 우선 검증 3가지 > PoC-1" 합격 기준.
- **완료 기준**: 측정 결과가 JSON으로 출력되고, **27/27 적중**이면 좌표 항목 합격. 지연 p95와 실효 fps 수치가 숫자로 기록된다.
- **상태**: [ ]

### Task 3.6: PoC-1 결과 보고서
- **파일**: `.pipeline/20260917-114450/poc1-result.md` (신규 생성)
- **작업**: 측정값을 합격 기준(지연 200ms 이하 / 10fps 이상 / 적중률 100%)과 대조해 표로 정리한다. 대상별(로컬 더미 / `playwright.dev`)·스케일별 수치를 모두 싣는다. 불합격 항목이 있으면 **원인 가설과 후퇴 옵션**(quality 하향, `everyNthFrame`, size 축소, CDP 2안 전환, 최종적으로 1번 별도 창 방식)을 명시한다. 또한 `recording-options.html`이 추정한 "녹화 개발량 2~3배"를 실측 기반으로 **재추정**한다.
- **참고**: 02-context "일정 리스크" — `page.screencast` 도입으로 과대평가 가능성 지적.
- **완료 기준**: 보고서에 3개 합격 기준 각각에 대한 **PASS/FAIL 판정**과 근거 수치가 있다.
- **상태**: [ ]

### ★ 사용자 확인 게이트 (Gen-Phase 3 종료 시점)
- **게이트 내용**: `poc1-result.md`를 사용자에게 제시하고 다음 중 하나의 결정을 받는다.
  - **(A) 통과 → Gen-Phase 4 이후 전량 진행** (계획 그대로)
  - **(B) 부분 미달 → 파라미터 조정 후 재측정** (quality/size/everyNthFrame 조정, 또는 CDP 2안으로 전환 후 Task 3.5 재실행)
  - **(C) 실패 → 녹화 방식 후퇴** (`recording-options.html` 1번 별도 창 방식). 이 경우 `screencast.ts`·`input-bridge.ts` 2개 파일만 교체하고 **수집 4단계(감지·Locator·변환·적재)는 계획 그대로 유지**한다 — Gen-Phase 7의 Task 7.3~7.5는 영향 없음.
- **이 게이트의 승인 없이 Gen-Phase 4로 진행하지 않는다.**

---

## Gen-Phase 4 — API 기반 (부트스트랩 · health · projects · scenarios · steps)

> 게이트 통과 후 시작. Gen-Phase 2에 의존.

### Task 4.1: NestJS 부트스트랩
- **파일**: `apps/api/src/main.ts` (신규 생성)
- **작업**: ERDify 부트스트랩 규약을 그대로 이식 — `NestFactory.create<NestExpressApplication>`, `compression()`, `app.setGlobalPrefix("api")`, `useGlobalPipes(new ValidationPipe({whitelist:true, forbidNonWhitelisted:true, transform:true}))`, CORS(프로덕션은 `CORS_ORIGINS` 분리), 포트 `Number(process.env["API_PORT"] ?? 4000)`. **env는 bracket 접근**. `cookieParser`는 비회원제이므로 제외한다.
- **참고**: 02-context "부트스트랩" 절의 실제 코드.
- **완료 기준**: `yarn workspace @testflow/api dev` 로 기동되고 `curl localhost:4000/api/health` 가 404가 아닌 응답을 준다(모듈 등록 전이면 404여도 무방하나 프로세스는 살아 있어야 한다).
- **상태**: [ ]

### Task 4.2: `app.module.ts` + 공통 설정
- **파일**: `apps/api/src/app.module.ts`, `apps/api/src/common/config/*.ts` (신규 생성)
- **작업**: `ConfigModule.forRoot({isGlobal:true})`, `TypeOrmModule.forRootAsync`(`packages/db`의 DataSource 옵션 재사용, `autoLoadEntities` 대신 엔티티 명시), `BullModule.forRootAsync`(ioredis 연결) 등록. 도메인 모듈 8개(projects, scenarios, recordings, runs, artifacts, suites, dashboard, health)를 import 자리만 잡는다. **커스텀 exception filter는 만들지 않는다**(ERDify 규약 — Nest 기본 예외 사용).
- **참고**: 02-context "에러 처리" 절.
- **완료 기준**: `apps/api/src/common/filters/` 디렉토리가 **존재하지 않는다**. API 기동 시 TypeORM·BullMQ 연결 로그가 에러 없이 출력된다.
- **상태**: [ ]

### Task 4.3: `mask.ts` — Secret 마스킹 단일 함수
- **파일**: `apps/api/src/common/utils/mask.ts` (신규 생성)
- **작업**: `maskSecrets(input: unknown, secretValues: string[]): unknown` — 문자열·객체·배열을 재귀 순회하며 `secretValues`에 포함된 값을 `'••••••••'`로 치환한다. 추가로 `maskByKey(obj)` — 키 이름이 `password|pwd|secret|token`에 해당하면 값 마스킹. **호출 지점 3곳**(API 응답 / 서버 로그 / `step_results.error_message` 저장)을 JSDoc에 명시한다. Playwright 에러 메시지에 입력값이 실려 나오는 케이스를 반드시 커버한다.
- **참고**: 02-context "★ 최종 결정 > (c) 파생 영향" — `crypto.ts`는 만들지 않고 `mask.ts`만 유지.
- **완료 기준**: `apps/api/src/common/utils/crypto.ts` 가 **존재하지 않는다**. 단위 테스트: `maskSecrets("locator resolved to input[value='hunter2']", ["hunter2"])` 결과에 `hunter2`가 포함되지 않는다.
- **상태**: [ ]

### Task 4.4: health 모듈
- **파일**: `apps/api/src/modules/health/{health.module.ts,health.controller.ts}` (신규 생성)
- **작업**: `GET /api/health` 가 `{status, db, redis, runner}` 를 반환. db는 `SELECT 1`, redis는 `PING`, runner는 Redis에 Runner가 등록한 heartbeat 키 존재 여부로 판정(없으면 `'down'`).
- **참고**: 02-context "API 스펙 초안" health 행.
- **완료 기준**: `curl localhost:4000/api/health` 가 **200**과 `{"status":"ok","db":"ok","redis":"ok","runner":"down"}` 형태 JSON을 반환한다(Runner 미기동 시 `runner:"down"`이 정상).
- **상태**: [ ]

### Task 4.5: projects 모듈 (화면 없음, 값 공급용)
- **파일**: `apps/api/src/modules/projects/{projects.module.ts,projects.controller.ts,projects.service.ts,dto/}` (신규 생성)
- **작업**: `GET /api/projects`, `GET /api/projects/:id`, `PATCH /api/projects/:id`. **응답에서 `variables` 필드는 제거한다** — 변수는 DB에 없고 실행 요청 body로만 온다(★ 최종 결정 (c)). `baseUrl`은 **실행 다이얼로그의 기본값 placeholder** 용도임을 서비스 JSDoc에 명시. 컨트롤러는 `@Controller()` 빈 인자 + 메서드별 전체 경로 스타일(ERDify 규약).
- **참고**: 02-context "컨트롤러" 절, "★ 최종 결정" (a)(c).
- **완료 기준**: `GET /api/projects` 가 시드된 기본 프로젝트 1건을 `{id,name,baseUrl,defaultEnvLabel}` 형태로 반환한다. 응답에 `variables` 키가 **없다**.
- **상태**: [ ]

### Task 4.6: scenarios 모듈 — CRUD + 목록 검색/필터
- **파일**: `apps/api/src/modules/scenarios/{scenarios.module.ts,scenarios.controller.ts,scenarios.service.ts,dto/}` (신규 생성)
- **작업**: `GET /api/projects/:projectId/scenarios`(`?q&status&feature&page&size`, 응답은 시안 6열 + `stepCount` + `lastResult`), `POST`(생성, `code` 자동 채번 `TC-<FEATURE>-<3자리>`), `GET/PATCH/DELETE /api/scenarios/:id`, `POST /api/scenarios/:id/publish`(status→published, version+1). `lastResult`는 `scenarios.last_run_id` 비정규화 컬럼 조인.
- **참고**: 02-context "API 스펙 초안" 시나리오 절, "DB 스키마 초안" scenarios 테이블.
- **완료 기준**: 시나리오 3건 생성 후 `GET /api/projects/:id/scenarios?q=로그인&status=draft` 가 필터링된 결과와 `total`을 반환한다. `POST /api/scenarios/:id/publish` 후 재조회 시 `status:'published'`, `version:2`.
- **상태**: [ ]

### Task 4.7: steps 엔드포인트 (scenarios 모듈 내)
- **파일**: `apps/api/src/modules/scenarios/steps.controller.ts`, `steps.service.ts` (신규 생성)
- **작업**: `PUT /api/scenarios/:id/steps`(전량 치환 — 순서변경·삭제 동시 처리, 트랜잭션 내에서 `sequence` 재기입), `POST /api/scenarios/:id/steps`(`afterSequence` 뒤 삽입 + 후속 sequence 밀기), `PATCH /api/steps/:stepId`, `DELETE /api/steps/:stepId`. 요청 검증은 `TestStepSchema`(contracts)로. **응답에서 `target_json.fallbacks`의 `by:'css'` 항목을 기본 제외**하고 `?advanced=1` 일 때만 포함한다.
- **참고**: 02-context "설계상 반드시 지켜야 할 제약" — CSS Selector 비노출.
- **완료 기준**: `PUT .../steps` 로 3개 스텝을 순서 바꿔 보내면 `uq_test_steps_seq` 제약 위반 없이 반영된다. 기본 `GET /api/scenarios/:id` 응답 JSON에 문자열 `"css"`가 **나타나지 않는다**.
- **상태**: [ ]

---

## Gen-Phase 5 — API 실행·녹화·증적·스위트·대시보드

> Gen-Phase 4에 의존.

### Task 5.1: runs 모듈 — 실행 요청 + 큐 등록
- **파일**: `apps/api/src/modules/runs/{runs.module.ts,runs.controller.ts,runs.service.ts,dto/}` (신규 생성)
- **작업**: `POST /api/runs` — `CreateRunDto`(baseUrl·variables 필수 경로) 검증 → `runs` 레코드 생성(`status:'queued'`, `base_url`·`scenario_name` 스냅샷 저장) → BullMQ `run` 큐에 job 등록 → **202 Accepted** + `{runId, status:'queued', position}` 즉시 반환. **`variables` 평문을 `runs` 테이블에 저장하지 않는다** — 실제 값은 큐 페이로드에만 존재하고 완료 후 만료된다. 스위트 실행이면 시나리오 수만큼 run을 만들고 동일 `batch_id` 부여. `GET /api/runs`, `GET /api/runs/:id`, `POST /api/runs/:id/cancel`도 구현.
- **참고**: 02-context "★ 최종 결정 > (c) 파생 영향" 3번째 항목, "규약 메모" 202 규칙.
- **완료 기준**: `POST /api/runs` 응답 코드가 **202**이고 요청~응답이 **1초 이내**(성능 목표). 직후 MySQL `SELECT * FROM runs` 결과 어느 컬럼에도 전달한 비밀번호 평문이 **없다**.
- **상태**: [ ]

### Task 5.2: `runs.sse.ts` — Redis pub/sub → SSE 중계
- **파일**: `apps/api/src/modules/runs/runs.sse.ts` (신규 생성)
- **작업**: `GET /api/runs/:id/events` 를 `text/event-stream`으로 응답. Redis 채널 `run:<id>` 을 구독해 `run.status`/`step.started`/`step.finished`/`run.finished`/`artifact.ready` 5종 이벤트를 전달. 각 이벤트에 증가하는 `id:` 를 붙이고 **`Last-Event-ID` 헤더로 재연결 시 누락분을 재전송**한다(최근 N건을 Redis List에 버퍼). **모든 이벤트 payload는 `mask.ts`를 통과시킨 뒤 전송한다.** 15초 keep-alive 주석(`:ping`) 전송.
- **참고**: 02-context "API 스펙 초안" SSE 행, "★ 최종 결정 (c) 파생 영향" — SSE는 마스킹 3경로 중 하나.
- **완료 기준**: `curl -N localhost:4000/api/runs/<id>/events` 가 `Content-Type: text/event-stream` 헤더와 함께 연결을 유지하고, Redis에 수동 publish한 메시지가 **2초 이내**에 출력된다.
- **상태**: [ ]

### Task 5.3: artifacts 모듈
- **파일**: `apps/api/src/modules/artifacts/{artifacts.module.ts,artifacts.controller.ts,artifacts.service.ts}` (신규 생성)
- **작업**: `GET /api/runs/:id/artifacts`(목록), `GET /api/artifacts/:id`(`?download=1`) — `ARTIFACT_ROOT` 아래 `storage_key` 경로 파일을 스트림으로 서빙하고 `Content-Type`·`Content-Disposition` 설정. **경로 순회 방어 필수**(`storage_key`에 `..` 포함 시 거부, resolve 후 `ARTIFACT_ROOT` 접두 검사). API와 Runner가 같은 호스트에서 `ARTIFACT_ROOT` 볼륨을 공유한다는 전제를 README에 기록.
- **참고**: 02-context "(b) 부가 제약" — 볼륨 공유 전제.
- **완료 기준**: `ARTIFACT_ROOT`에 테스트 PNG를 두고 artifacts 레코드를 넣으면 `GET /api/artifacts/:id` 가 200 + `image/png`로 파일을 반환한다. `storage_key`를 `../../etc/passwd`로 조작한 레코드는 **400 또는 404**로 거부된다.
- **상태**: [ ]

### Task 5.4: recordings 모듈 — 세션 수명주기
- **파일**: `apps/api/src/modules/recordings/{recordings.module.ts,recordings.controller.ts,recordings.service.ts}` (신규 생성)
- **작업**: `POST /api/scenarios/:id/recordings` — `recording_sessions` 레코드 생성 + **단명 세션 토큰 발급**(랜덤 32byte, Redis에 TTL 저장) + `{sessionId, wsUrl, expiresAt, viewport}` 반환. `wsUrl`은 **Runner 직결 주소**(`/rec/:sessionId?token=…`, nginx가 `/rec/`만 Runner로 프록시). `GET /api/recordings/:sessionId`, `POST .../stop`(초안 → 시나리오 스텝 반영), `DELETE`(브라우저 폐기). **API는 WS를 중계하지 않는다** — 프레임마다 홉이 늘면 지연이 배가된다.
- **참고**: 02-context "구조상 쟁점 1건" 절 전체.
- **완료 기준**: `POST /api/scenarios/:id/recordings` 응답의 `wsUrl`이 API 포트가 아닌 **`RUNNER_WS_PORT`**를 가리킨다. 발급 토큰이 Redis에 TTL과 함께 저장됨을 `TTL <key>` 로 확인 가능.
- **상태**: [ ]

### Task 5.5: suites 모듈
- **파일**: `apps/api/src/modules/suites/{suites.module.ts,suites.controller.ts,suites.service.ts}` (신규 생성)
- **작업**: `GET/POST /api/projects/:projectId/suites`, `GET/PATCH/DELETE /api/suites/:id`. `suite_scenarios`의 `sequence`로 순서 관리. 스위트 실행은 Task 5.1의 `POST /api/runs` 에 `suiteId`를 넘기는 경로를 쓴다(별도 엔드포인트 없음).
- **참고**: 02-context "규약 메모" — 부모 run 없이 `batch_id` 묶음 모델링.
- **완료 기준**: 시나리오 3건으로 스위트를 만들고 `POST /api/runs {suiteId}` 를 호출하면 **runs 3건이 동일 `batch_id`로 생성**된다.
- **상태**: [ ]

### Task 5.6: dashboard 모듈
- **파일**: `apps/api/src/modules/dashboard/{dashboard.module.ts,dashboard.controller.ts,dashboard.service.ts}` (신규 생성)
- **작업**: `GET /api/dashboard/summary` — 지표 4종(`todayRuns`, `successRate`, `automatedScenarios`, `avgDurationMs`)을 `runs`·`scenarios` 집계로 계산. `GET /api/dashboard/readiness` — `{percent, totalScenarios, passing, notices:[{level,message}]}`. notices는 "최근 실행이 실패한 시나리오", "스텝 0개인 시나리오" 등 규칙 기반 생성(시안 amber notice 대응).
- **참고**: 01-clarify 화면 1 설명, 02-context "API 스펙 초안" 대시보드 절.
- **완료 기준**: run 데이터를 시드한 뒤 `GET /api/dashboard/summary` 가 4개 키를 모두 포함하고 `successRate`가 실제 passed/total 비율과 일치한다. 응답 p95가 **500ms 이내**.
- **상태**: [ ]

---

## Gen-Phase 6 — Runner 실행 엔진 (JSON 시나리오 → Playwright)

> Gen-Phase 2·5에 의존.

### Task 6.1: `storage/` — StorageAdapter + 로컬 디스크 구현
- **파일**: `apps/runner/src/storage/adapter.ts`, `apps/runner/src/storage/local.ts`, `apps/runner/src/storage/index.ts` (신규 생성)
- **작업**: `StorageAdapter` 인터페이스(`put/get/getStream/delete/exists`)와 `LocalDiskStorage` 구현(`ARTIFACT_ROOT` 기준, `storage_key`를 상대 경로로 해석, 디렉토리 자동 생성). **S3/MinIO 구현체는 만들지 않는다** — 인터페이스만 남긴다(★ 최종 결정 (b)).
- **참고**: 02-context "(b) Artifact 저장소" 권고 승인.
- **완료 기준**: `apps/runner/src/storage/s3.ts` 가 **존재하지 않는다**. 단위 테스트: `put('runs/x/step-01.png', buf)` 후 `exists()` true, 실제 파일이 `$ARTIFACT_ROOT/runs/x/step-01.png`에 생긴다.
- **상태**: [ ]

### Task 6.2: `locator.ts` — target JSON → Playwright Locator 복원
- **파일**: `apps/runner/src/execute/locator.ts` (신규 생성)
- **작업**: `target_json.primary` 를 `getByRole/getByLabel/getByText/getByTestId/locator(css)` 로 복원하고, 실패(또는 매칭 0개·2개 이상) 시 `fallbacks`를 **순서대로** 시도한다. **어느 단계에서 성공했는지(`resolvedBy`)를 반환**해 나중에 "불안정한 스텝" 신호로 쓸 수 있게 한다. `frameUrl`이 있으면 해당 frame 안에서 탐색.
- **참고**: 02-context "Locator 생성 로직" — 순위 배열 저장 및 resolvedBy 기록.
- **완료 기준**: 더미 페이지(Task 3.1)에 대해 primary를 일부러 깨뜨린 target JSON을 주면 fallback으로 해결되고 `resolvedBy:'text'` 같은 값이 반환된다(단위 테스트).
- **상태**: [ ]

### Task 6.3: `interpreter.ts` — action_type 디스패치
- **파일**: `apps/runner/src/execute/interpreter.ts` (신규 생성)
- **작업**: 12개 `ActionType`을 Playwright 호출로 디스패치. `goto`는 `{{baseUrl}}` 치환, `fill`은 `{{변수}}` 치환(값은 **큐 페이로드의 `variables`에서만** 가져온다 — DB 조회 없음). `assert_visible/assert_text/assert_url`은 `expect()` 기반. 스텝별 타임아웃은 `options_json.timeoutMs`(기본 10000). 각 스텝 전후로 이벤트 콜백 호출.
- **참고**: 02-context "DB 스키마 초안" `test_steps.action_type` enum, "★ 최종 결정" (c).
- **완료 기준**: 12개 action_type 전부에 대한 디스패치 분기가 존재하고(`switch` exhaustiveness를 `never` 체크로 타입 보장), 더미 로그인 페이지에 대해 `goto→fill→fill→click→assert_url` 5스텝이 통과한다.
- **상태**: [ ]

### Task 6.4: `reporter.ts` — 스텝 이벤트 → Redis pub/sub + DB 기록
- **파일**: `apps/runner/src/execute/reporter.ts` (신규 생성)
- **작업**: `step.started`/`step.finished`/`run.status`/`run.finished`/`artifact.ready` 를 Redis 채널 `run:<id>` 에 publish하고 동시에 `step_results`·`runs` 테이블을 갱신한다. **`error_message`는 마스킹 후 저장**(Playwright 에러에 입력값이 실려 나온다). Redis List에 최근 N건을 버퍼링해 API의 `Last-Event-ID` 재전송을 지원한다.
- **참고**: 02-context "★ 최종 결정 (c) 파생 영향" — 마스킹 3경로 중 `error_message`.
- **완료 기준**: 실행 1회 후 `step_results` 행 수 = 시나리오 스텝 수, `runs.duration_ms`가 채워진다. 비밀번호를 틀리게 넣어 실패시킨 뒤 `error_message`에 평문 비밀번호가 **없다**.
- **상태**: [ ]

### Task 6.5: `artifacts.ts` — 증적 수집
- **파일**: `apps/runner/src/execute/artifacts.ts` (신규 생성)
- **작업**: 실행 컨텍스트를 `recordVideo` + `tracing.start({screenshots:true, snapshots:true})` 로 열고, **실패 스텝에서 스크린샷**, 실행 종료 시 video·trace·console log·network log를 수집해 `StorageAdapter.put()`으로 저장 후 `artifacts` 레코드를 만든다. 성공 실행의 video/trace는 보존할지 옵션(`KEEP_ARTIFACTS_ON_SUCCESS`)으로 제어(기본 false — 디스크 절약).
- **참고**: 02-context DB 스키마 `artifacts` 테이블(`artifact_type` 5종), FR-008.
- **완료 기준**: 일부러 실패하는 시나리오 실행 후 `GET /api/runs/:id/artifacts` 가 **screenshot·video·trace·console_log 4종**을 반환하고, 각 `url`을 열면 실제 파일이 내려온다. `trace` 파일이 `npx playwright show-trace` 로 열린다.
- **상태**: [ ]

### Task 6.6: Docker 실행 격리 + 자원 제한
- **파일**: `apps/runner/src/execute/container.ts`, `apps/runner/Dockerfile.exec` (신규 생성)
- **작업**: ★ 최종 결정 (d) — **실행 1회당 컨테이너 1개**. `mcr.microsoft.com/playwright:v1.63.0` 기반 이미지에 인터프리터를 넣고, `--memory=$RUNNER_CONTAINER_MEMORY --cpus=$RUNNER_CONTAINER_CPUS --rm` + `ARTIFACT_ROOT` 볼륨 마운트로 기동한다. 하드 타임아웃 초과 시 컨테이너 강제 종료 + run status를 `timeout`으로. `variables`는 **환경변수가 아니라 stdin JSON**으로 전달한다(`docker inspect`·프로세스 목록에 비밀번호가 남지 않도록).
- **참고**: 02-context "★ 최종 결정" (d) + "(d) Docker 불가 시" 대안은 **채택하지 않는다**.
- **완료 기준**: 실행 중 `docker ps` 에 컨테이너 1개가 보이고 `docker stats`가 설정한 메모리 상한을 반영한다. 실행 종료 후 컨테이너가 자동 제거된다(`docker ps -a`에 없음). `docker inspect <id>` 출력에 비밀번호 평문이 **없다**.
- **상태**: [ ]

### Task 6.7: `main.ts` — BullMQ Worker 기동
- **파일**: `apps/runner/src/main.ts` (신규 생성)
- **작업**: BullMQ Worker(`concurrency: RUNNER_CONCURRENCY`)로 `run` 큐를 소비하고 Task 6.3~6.6을 조립한다. Redis에 **runner heartbeat 키**를 주기 갱신(health의 `runner` 판정용). 취소 요청(`POST /api/runs/:id/cancel`)은 Redis 채널로 받아 컨테이너를 kill한다. 녹화 WS 서버 기동 자리는 Gen-Phase 7에서 채운다.
- **완료 기준**: Runner 기동 후 `GET /api/health` 의 `runner`가 `"ok"`로 바뀐다. `POST /api/runs` → 실행 완료까지 전체 경로가 동작하고 `runs.status`가 `passed`가 된다.
- **상태**: [ ]

---

## Gen-Phase 7 — Runner 녹화 파이프라인 (수집 4단계)

> Gen-Phase 3(PoC 산출물 `screencast.ts`·`input-bridge.ts`)과 Gen-Phase 6에 의존. **게이트 결정 (C)로 후퇴하더라도 Task 7.3~7.5는 그대로 유효하다.**

### Task 7.1: `session.ts` — 녹화 세션 수명주기
- **파일**: `apps/runner/src/record/session.ts` (신규 생성)
- **작업**: `sessionId` 1개 = 브라우저 컨텍스트 1개. 생성 시 `viewport` 고정, `addInitScript`로 `injected.js` 등록, `exposeBinding('__tfEmit')` 연결, screencast 시작. **유휴 타임아웃**(마지막 클라이언트 메시지로부터 N분) 시 자동 폐기하고 `recording_sessions.status='expired'`로 갱신. 초안 스텝은 **주기적으로 `recording_sessions.draft_steps` JSON 컬럼에 저장**한다(세션이 끊겨도 테스터 작업이 날아가지 않게 — DB에 둔 이유).
- **참고**: 02-context DB 스키마 `recording_sessions` 위의 설계 주석.
- **완료 기준**: 세션 생성 후 유휴 타임아웃을 1분으로 줄여 대기하면 브라우저 프로세스가 종료되고 DB status가 `expired`로 바뀐다. 세션 중간에 Runner를 죽여도 `draft_steps`에 직전까지의 초안이 남아 있다.
- **상태**: [ ]

### Task 7.2: 녹화 WS 서버 + 세션 토큰 검증
- **파일**: `apps/runner/src/record/ws-server.ts` (신규 생성) / `apps/runner/src/main.ts` (수정)
- **작업**: `ws` 서버를 `RUNNER_WS_PORT`에 띄우고 `/rec/:sessionId?token=…` 경로만 수락한다. 토큰은 Redis에서 검증(Task 5.4가 발급). 검증 실패 시 즉시 close(4401). Task 3.4의 PoC WS 서버 로직을 제품 코드로 승격하되 **프레임 드롭 정책과 `bufferedAmount` 감시를 유지**한다. 메시지 스키마는 `@testflow/contracts`의 WS union으로 검증.
- **참고**: 02-context "구조상 쟁점 1건" — Runner 직결, API 미중계.
- **완료 기준**: 올바른 토큰으로는 연결되고 `?token=bad` 는 close code **4401**로 거부된다. `wscat`으로 접속 시 바이너리 프레임이 수신된다.
- **상태**: [ ]

### Task 7.3: `injected.ts` — 행동 감지 리스너
- **파일**: `apps/runner/src/record/injected.ts` (신규 생성)
- **작업**: 원격 페이지 컨텍스트에서 도는 유일한 코드. **캡처 단계(`{capture:true}`)**에 리스너를 건다(대상 페이지의 `stopPropagation()`을 우회). 수집 이벤트: `click`, `input`/`change`, `submit`, `keydown`의 Enter·Tab. **`input` 디바운스 필수** — 같은 요소 연속 입력은 **마지막 값 하나의 `fill` 스텝으로 합친다**(안 하면 "아이디 입력"이 스텝 20개가 된다). `isComposing` 중에는 이벤트를 흘리지 않는다. **`type="password"` 필드는 값을 수집하지 않고** `{{password}}` 변수 참조 + `isSecret:true`로 승격한다. 수집 결과는 `window.__tfEmit(payload)`로 전송.
- **참고**: 02-context "행동 → 스텝 변환" 절 전체 + "★ 최종 결정 (c) 파생 영향" 마지막 항목.
- **완료 기준**: 더미 로그인 페이지에서 아이디 10자를 타이핑하면 `__tfEmit` 호출이 **1회**(디바운스 후)만 발생한다. 비밀번호 필드에 입력한 값이 emit payload 어디에도 **없고** `{{password}}` 참조만 있다.
- **상태**: [ ]

### Task 7.4: `injected.ts` — Locator 후보 생성 + 고유성 검증
- **파일**: `apps/runner/src/record/injected.ts` (Task 7.3에 이어 수정)
- **작업**: 감지한 `event.target`에서 **role → label → text → test-id → css** 5단계 후보를 생성한다. **각 후보마다 그 자리에서 매칭을 돌려 문서 내 1개만 맞는지 검증**하고, 2개 이상이면 조상 컨테이너로 범위를 좁히거나 다음 순위로 내려간다. **이 검증을 빼먹으면 "녹화는 되는데 재생이 깨지는" 최악의 실패 모드가 나온다.** 결과를 `{primary, fallbacks[], frameUrl, snapshot}` 형태로 만든다. `playwright-selector-generator` 사용 여부는 Task 1.1 스파이크에서 호환성이 확인된 경우에만 검토하고, 기본은 자체 구현.
- **참고**: 02-context "Locator 생성 로직" 절 전체.
- **완료 기준**: 같은 텍스트("확인") 버튼이 3개 있는 테스트 페이지에서 각각을 클릭했을 때 생성된 primary locator가 **서로 다르고 각각 정확히 1개**에 매칭된다(단위 테스트 3케이스).
- **상태**: [ ]

### Task 7.5: `step-mapper.ts` — 원시 행동 → 업무 문장 스텝
- **파일**: `apps/runner/src/record/step-mapper.ts` (신규 생성)
- **작업**: `{action, role, accessibleName}` → `"'로그인' 버튼 클릭"`, `"'아이디' 입력란에 값 입력"` 같은 **한국어 업무 문장**으로 변환하고 `TestStep`(contracts)을 생성한다. 시안의 `<code>` 칩(**이동/입력/클릭/확인**)과 1:1 대응하는 매핑 테이블을 둔다. CDP `Page.frameNavigated` → `goto` 스텝. 자동 생성 문장은 초안일 뿐이며 테스터가 덮어쓴다는 점을 주석에 명시.
- **참고**: 02-context "업무 문장 변환" 절, 01-clarify 화면 3의 `<code>` 칩 4종.
- **완료 기준**: 단위 테스트에서 role=button/name=로그인 payload가 `{name:"'로그인' 버튼 클릭", actionType:'click'}` 을 만든다. 4종 칩 각각에 대응하는 action_type 매핑이 존재한다.
- **상태**: [ ]

### Task 7.6: 초안 확정 → 시나리오 반영
- **파일**: `apps/runner/src/record/session.ts` (수정) / `apps/api/src/modules/recordings/recordings.service.ts` (수정)
- **작업**: `POST /api/recordings/:sessionId/stop` 시 `draft_steps`를 `test_steps` 테이블로 확정 삽입하고(기존 스텝 뒤에 이어붙임) `sequence`를 재기입한다. 브라우저 폐기 + `status='stopped'`. 응답으로 확정된 `{steps:[TestStep]}` 반환.
- **완료 기준**: 녹화 5스텝 후 stop을 호출하면 `GET /api/scenarios/:id` 응답의 `steps` 길이가 5가 되고 `sequence`가 1~5로 연속한다.
- **상태**: [ ]

---

## Gen-Phase 8 — Web 기반: 디자인 토큰 · 레이아웃 · 공용 컴포넌트

> Gen-Phase 2에 의존(API 미완성이어도 진행 가능). **이 Gen-Phase의 모든 Task는 `01-clarify.md`의 "디자인시안 요약" 절(디자인 토큰 표 · 타이포그래피 · 컴포넌트 스펙 · 공통 UI 요소)에 기록된 HEX·px 값을 그대로 사용한다. 값을 임의로 바꾸지 않는다.**

### Task 8.1: Vite + Tailwind 4 + shadcn/ui 초기화
- **파일**: `apps/web/{vite.config.ts,index.html,components.json}`, `apps/web/src/{main.tsx,App.tsx}` (신규 생성)
- **작업**: Vite 8 + React 19 + TS. Tailwind 4(CSS-first) 설정. shadcn/ui `components.json`은 **css variables 모드 + baseColor 커스텀**으로 설정해 시안 토큰이 그대로 먹게 한다. 폰트는 `"Pretendard","SUIT","Apple SD Gothic Neo", sans-serif`, 모노는 `ui-monospace, SFMono-Regular, Menlo, monospace`.
- **참고**: 01-clarify "타이포그래피", 02-context "UI" 행 — Tailwind 4의 `@theme`가 시안 `:root`와 구조가 같아 이식 비용이 거의 0.
- **완료 기준**: `yarn workspace @testflow/web dev` 로 개발 서버가 뜨고 빈 화면이 렌더된다. `yarn workspace @testflow/web build` 통과.
- **상태**: [ ]

### Task 8.2: `globals.css` — 시안 토큰 1:1 이식 (단일 지점)
- **파일**: `apps/web/src/styles/globals.css` (신규 생성)
- **작업**: **01-clarify "디자인 토큰" 표 15개 토큰**(`--bg #f2f4f2`, `--panel #ffffff`, `--ink #17211f`, `--muted #68736f`, `--line #dde3e0`, `--brand #087f5b`, `--brand-dark #086044`, `--soft #e5f3ed`, `--success #16825f`, `--warn #c57814`, `--danger #c34343`, `--danger-soft #fff0ef`, `--nav #15211e`, `--shadow`, `--radius 16px`)을 Tailwind 4 `@theme` 블록으로 옮긴다. **시안이 하드코딩한 보조색 20여 개**(사이드바 hover `#1f302b` / active 배경 `#29413a` / active 텍스트 `#71d4ae` / 사이드바 텍스트 `#aebbb7` / 로고마크 `#49c493` / nav-label `#71827c` / 다크 패널 `#18302a` / 브라우저 목업 `#17201e`·바 `#232d2a`·URL `#34403d` / 테이블 헤더 `#f5f7f6` / notice `#fff8e9`·`#f1ddb4`·`#80520d` / 아바타 `#e8c471`·`#4b3503` / toast `#16241f`·`#6dd0aa`)는 **primitives 계층**으로 내려 별도 변수로 정의한다(websystem-design-system의 2계층 토큰 분리 방법론 차용). body `14px`/`letter-spacing:-.018em` 등 타이포 기본값도 여기서.
- **참고**: **01-clarify "디자인 토큰" 표 + "보조 색상" 문단 + "타이포그래피" 절** / 02-context "재사용 판단" — 토큰 계층 구조만 차용.
- **완료 기준**: 이 파일에 01-clarify 토큰 표의 **15개 HEX가 전부** 등장한다. 다른 어떤 `.tsx`/`.css` 파일에도 `#087f5b`·`#15211e` 같은 HEX 리터럴이 **직접 등장하지 않는다**(grep으로 확인). `@media (prefers-reduced-motion: reduce)` 블록에서 전 애니메이션·트랜지션을 제거한다.
- **상태**: [ ]

### Task 8.3: `Sidebar.tsx` — 232px 고정 사이드바
- **파일**: `apps/web/src/components/layout/Sidebar.tsx` (신규 생성)
- **작업**: `position:fixed`, 폭 **232px**, 배경 `--nav`, padding `22px 14px`, z-index 20. 구성: 로고(TF 마크 30×30 반경9, 마크색 `#49c493`) → 프로젝트 스위처(`#21302c` 배경 + `#34443f` 테두리, 반경12) → `WORKSPACE` 그룹(대시보드·테스트 시나리오·시나리오 만들기·실행 현황) → `MANAGE` 그룹(테스트 스위트·실행 환경·테스트 데이터·프로젝트 설정) → 하단 사용자 정보. nav-label은 `10px`/`letter-spacing:.12em`/`font-weight:800`. **MANAGE 그룹 중 실행 환경·테스트 데이터·프로젝트 설정은 MVP 제외 화면이므로 비활성 표시**한다. 하단 "사용자 정보"는 비회원제이므로 고정 텍스트(예: "공용 워크스페이스")로 대체.
- **참고**: **01-clarify "공통 UI 요소" 사이드바 항목 + "보조 색상" 문단** / 01-clarify "MVP 범위 > 제외".
- **완료 기준**: 렌더된 사이드바 폭이 정확히 232px이고, 현재 경로에 해당하는 항목이 `#29413a` 배경 + `#71d4ae` 텍스트로 표시된다.
- **상태**: [ ]

### Task 8.4: `Topbar.tsx` + `Breadcrumb.tsx` + `AppShell`
- **파일**: `apps/web/src/components/layout/{Topbar.tsx,Breadcrumb.tsx,AppShell.tsx}` (신규 생성)
- **작업**: Topbar 높이 **68px**, `rgba(255,255,255,.93)` + `backdrop-filter: blur(12px)`, 하단 1px `--line`, `position:sticky; top:0`, padding `0 28px`. Breadcrumb은 `프로젝트명 / 현재 페이지`. `AppShell`은 `.app = grid-template-columns: 232px 1fr` 레이아웃 + 콘텐츠 영역 `padding:30px; max-width:1500px; margin:0 auto`.
- **참고**: **01-clarify "전역 레이아웃"**.
- **완료 기준**: 스크롤해도 Topbar가 상단에 고정되고 blur가 적용된다. 콘텐츠 최대 폭이 1500px를 넘지 않는다.
- **상태**: [ ]

### Task 8.5: 반응형 브레이크포인트 (1050px / 760px)
- **파일**: `apps/web/src/components/layout/AppShell.tsx` (수정), `apps/web/src/styles/globals.css` (수정)
- **작업**: **1050px** — 2단 그리드가 1단으로, 인스펙터가 sticky → static. **760px** — 사이드바 오프캔버스 + 오버레이 `rgba(0,0,0,.3)`, 탑바 60px, 콘텐츠 패딩 `18px 13px`, h1 23px, metric 수치 22px.
- **참고**: **01-clarify "공통 UI 요소" 반응형 브레이크포인트 + "타이포그래피" 모바일 값**.
- **완료 기준**: 브라우저 폭 1049px에서 2단 레이아웃이 1단이 되고, 759px에서 사이드바가 화면 밖으로 나가며 햄버거로 열린다.
- **상태**: [ ]

### Task 8.6: `Toaster.tsx` — 우하단 토스트
- **파일**: `apps/web/src/components/layout/Toaster.tsx`, `apps/web/src/hooks/useToast.ts` (신규 생성)
- **작업**: 고정 위치 `right:26px; bottom:26px`, 배경 `#16241f`, 반경 12, 강조색 `#6dd0aa`. 진입 애니메이션 `translateY(90px)→0` + opacity, **2.2초 후 자동 소멸**. 저장·적용·발행 결과 알림 경로 단일화.
- **참고**: **01-clarify "공통 UI 요소" toast 항목 + "UX 결정사항"**.
- **완료 기준**: `toast('저장되었습니다')` 호출 시 우하단에서 올라오고 정확히 2.2초 후 사라진다. `prefers-reduced-motion` 에서는 애니메이션 없이 즉시 표시/제거된다.
- **상태**: [ ]

### Task 8.7: 공용 프리미티브 — Button / Input / Select / Panel / StatusDot
- **파일**: `apps/web/src/components/ui/*` (shadcn 생성물 + 커스터마이즈), `apps/web/src/components/{Panel.tsx,StatusDot.tsx}` (신규 생성)
- **작업**: shadcn button/input/select/dialog/table을 추가한 뒤 시안 스펙으로 조정 — `.btn`: `border:1px solid var(--line)`, 반경 **10px**, padding `9px 13px`, `min-height:38px`, `font-weight:700`, hover `border-color:#aeb8b4; background:#fafbfa`. `.btn-primary` 배경 `--brand`/hover `--brand-dark`. `.btn-danger`는 **텍스트만** `--danger`. 입력 필드: 반경 **9px**, `min-height:39px`, padding `0 10px`, focus `border-color:var(--brand)` + `box-shadow:0 0 0 3px var(--soft)`. `Panel`: 반경 16px + `1px solid var(--line)`, 헤더 `padding:18px 20px` + 하단 라인, `h2` 16px. `StatusDot`: 6px 점 + green/red/gray (`.mini-status`).
- **참고**: **01-clarify "컴포넌트 스펙" 절 전체**.
- **완료 기준**: Button/Input의 렌더 결과 `min-height`가 각각 38px/39px이고, Input focus 시 3px `--soft` 링이 나타난다.
- **상태**: [ ]

### Task 8.8: `lib/api.ts` + `lib/sse.ts` + `lib/mask.ts` + react-query 설정
- **파일**: `apps/web/src/lib/{api.ts,sse.ts,mask.ts}`, `apps/web/src/main.tsx` (수정) (신규 생성)
- **작업**: `api.ts` — fetch 래퍼(`/api` prefix, 에러 시 Nest 기본 포맷 `{statusCode,message,error}` 파싱). `sse.ts` — `EventSource` 래퍼, **`Last-Event-ID` 기반 재연결**과 지수 백오프. `mask.ts` — 화면 표시용 `••••••••` 마스킹(서버 마스킹과 별개로 UI 레벨). `QueryClientProvider` 설정(staleTime 등). **서버 상태는 전부 react-query, 로컬 상태는 편집 중 임시값만.**
- **참고**: 02-context "경로 표 > apps/web" 행, "새로 생성할 파일" 표.
- **완료 기준**: `yarn workspace @testflow/web typecheck` 통과. `sse.ts`가 연결 끊김 후 재연결 시 `Last-Event-ID` 헤더를 실제로 보낸다(개발자도구 네트워크로 확인 가능).
- **상태**: [ ]

---

## Gen-Phase 9 — Web 화면 1·2: 대시보드 · 테스트 시나리오 목록

> Gen-Phase 8과 Gen-Phase 4·5(API)에 의존. **모든 수치·색은 `01-clarify.md` "화면 4종" 1·2번 항목을 따른다.**

### Task 9.1: `MetricCard.tsx` + 지표 그리드
- **파일**: `apps/web/src/components/MetricCard.tsx`, `apps/web/src/pages/dashboard/MetricGrid.tsx` (신규 생성)
- **작업**: 4개 지표 카드(`grid: 1.2fr 1fr 1fr 1fr`), **첫 카드는 다크 `featured` 변형**(`#18302a`). 카드 반경 **14px**, 수치 `27px`/`letter-spacing:-.04em`(모바일 22px). 지표: 오늘 실행 / 성공률 / 자동화 시나리오 / 평균 실행 시간.
- **참고**: **01-clarify "화면 4종" 1번**.
- **완료 기준**: 4개 카드가 `1.2fr 1fr 1fr 1fr` 비율로 배치되고 첫 카드만 다크 배경이다.
- **상태**: [ ]

### Task 9.2: `RunRow.tsx` + 최근 실행 패널
- **파일**: `apps/web/src/components/RunRow.tsx`, `apps/web/src/pages/dashboard/RecentRunsPanel.tsx` (신규 생성)
- **작업**: `run-row` 그리드 **`34px 1fr 90px 100px 80px`** = 상태심볼 · 이름/RUN-ID · 브라우저 태그 · 상태 텍스트 · 경과 시간. 클릭 시 해당 실행 현황 화면으로 이동.
- **참고**: **01-clarify "화면 4종" 1번의 run-row 그리드 사양**.
- **완료 기준**: `GET /api/runs?limit=8` 실데이터가 5열로 렌더되고 각 행 클릭 시 `/runs/:id` 로 라우팅된다.
- **상태**: [ ]

### Task 9.3: `ReadinessPanel.tsx` — 진행바 + amber notice
- **파일**: `apps/web/src/pages/dashboard/ReadinessPanel.tsx`, `apps/web/src/components/NoticeBox.tsx` (신규 생성)
- **작업**: "회귀 테스트 준비도" 진행바(**높이 6px, 반경 5px**) + amber notice 박스(배경 `#fff8e9`, 테두리 `#f1ddb4`, 텍스트 `#80520d`). 데이터는 `GET /api/dashboard/readiness`.
- **참고**: **01-clarify "화면 4종" 1번 + "보조 색상" notice 항목**.
- **완료 기준**: `percent` 값이 진행바 폭에 반영되고 `notices` 배열이 amber 박스로 렌더된다.
- **상태**: [ ]

### Task 9.4: 대시보드 페이지 조립 + 훅
- **파일**: `apps/web/src/pages/dashboard/index.tsx`, `apps/web/src/hooks/useDashboard.ts` (신규 생성)
- **작업**: 본문 `grid: 1.45fr .75fr` (좌 최근 실행 / 우 준비도). react-query 훅으로 `summary`·`readiness`·`runs`를 병렬 조회. `.ts` 커스텀 훅으로 분리하고 `useEffect` 사용을 자제한다.
- **참고**: **01-clarify "화면 4종" 1번**, 02-context "새로 생성할 파일" 표의 hooks 행.
- **완료 기준**: `/` 진입 시 API 3건이 호출되고 지표·최근 실행·준비도가 실데이터로 표시된다. 1050px 미만에서 1단으로 접힌다.
- **상태**: [ ]

### Task 9.5: 시나리오 목록 툴바
- **파일**: `apps/web/src/pages/scenarios/ScenarioToolbar.tsx` (신규 생성)
- **작업**: 검색 input + 상태 select + 기능 select. toolbar 반경 **14px**. 변경 시 쿼리스트링에 반영해 새로고침해도 필터가 유지되게 한다.
- **참고**: **01-clarify "화면 4종" 2번**.
- **완료 기준**: 검색어 입력 후 URL이 `?q=...&status=...` 로 갱신되고 새로고침 시 필터가 복원된다.
- **상태**: [ ]

### Task 9.6: 시나리오 테이블 6열
- **파일**: `apps/web/src/pages/scenarios/ScenarioTable.tsx`, `apps/web/src/pages/scenarios/index.tsx`, `apps/web/src/hooks/useScenarios.ts` (신규 생성)
- **작업**: 6열(시나리오/기능/상태/최근 결과/수정일/작성자). 시나리오 셀에 **`TC-AUTH-001 · 5개 스텝`** 형태 보조 텍스트. 상태는 `.mini-status`(6px 점 + green/red/gray). `th` **10px**/`letter-spacing:.04em`, `td` **12px**, 헤더 배경 `#f5f7f6`, table-wrap 반경 16px. 행 클릭 → 빌더 화면.
- **참고**: **01-clarify "화면 4종" 2번 + "타이포그래피" 테이블 값 + "보조 색상" 테이블 헤더**.
- **완료 기준**: 6개 컬럼이 모두 렌더되고 보조 텍스트가 `TC-XXX-000 · N개 스텝` 형식으로 표시된다. 빈 목록일 때 빈 상태 UI가 시안 토큰 범위 안에서 표시된다.
- **상태**: [ ]

---

## Gen-Phase 10 — Web 화면 3: 시나리오 빌더 + 인스펙터 + 녹화 클라이언트

> Gen-Phase 8·9와 Gen-Phase 7(Runner 녹화)에 의존. **`01-clarify.md` "화면 4종" 3번 항목의 수치를 따른다.**

### Task 10.1: `StepCard.tsx`
- **파일**: `apps/web/src/components/StepCard.tsx` (신규 생성)
- **작업**: 그리드 **`34px 1fr auto`** = 번호칩(**28×28, 반경 9**) · 이름+동작설명 · 드래그 핸들(`••`). 카드 반경 **12px**, hover `border-color:#9db1aa; box-shadow:0 5px 18px rgba(21,48,41,.06)`, transition `.15s`. **선택 상태**는 `border-color:#74ad99; background:#f6fbf8`. 동작 유형은 `<code>` 칩(**이동/입력/클릭/확인**), 값은 `{{baseUrl}}/login`·`{{testUser.email}}` 변수 표기, **비밀번호는 `••••••••` 마스킹**.
- **참고**: **01-clarify "화면 4종" 3번 + "컴포넌트 스펙" step-card 항목**.
- **완료 기준**: 선택된 카드만 `#74ad99` 테두리 + `#f6fbf8` 배경으로 렌더된다. `isSecret:true` 스텝의 값이 `••••••••`로 표시되고 원본 값이 DOM에 **없다**.
- **상태**: [ ]

### Task 10.2: 스텝 목록 + 순서 변경 + `AddStepButton`
- **파일**: `apps/web/src/pages/scenarios/builder/StepList.tsx`, `apps/web/src/components/AddStepButton.tsx` (신규 생성)
- **작업**: 드래그로 순서 변경(변경 시 `PUT /api/scenarios/:id/steps` 전량 치환). `AddStepButton`은 **`1px dashed #aebbb6` + 배경 `#f9fbfa` + 텍스트 `--brand`**, 라벨 "＋ 다음 스텝 추가". `prefers-reduced-motion`에서 드래그 애니메이션 비활성.
- **참고**: **01-clarify "컴포넌트 스펙" `.add-step` 항목**.
- **완료 기준**: 스텝을 드래그해 순서를 바꾸면 PUT 요청 1건이 나가고 새로고침 후에도 순서가 유지된다.
- **상태**: [ ]

### Task 10.3: `Inspector.tsx` — 우측 인스펙터 (sticky)
- **파일**: `apps/web/src/pages/scenarios/builder/Inspector.tsx` (신규 생성)
- **작업**: `grid: 1fr 330px` 의 우측 패널, **sticky `top: 88px`**, `h2` **15px**. 필드: 업무 단계 이름 / 동작 select(**화면에 표시되는지 확인 · 텍스트 값 확인 · URL 확인**) / 확인할 대상 / 최대 대기 시간 select(**5초·10초·30초**). **힌트박스** 문구 그대로: "요소를 찾을 때 접근성 역할과 표시 텍스트를 우선 사용합니다. CSS 선택자는 고급 설정에서만 노출됩니다." 하단 삭제/적용 버튼. 폼은 react-hook-form + zod(`TestStepSchema` 파생). **CSS 선택자는 화면에 절대 노출하지 않는다.** 적용 시 `PATCH /api/steps/:stepId` + 토스트.
- **참고**: **01-clarify "화면 4종" 3번 인스펙터 서술** / 02-context "설계상 반드시 지켜야 할 제약".
- **완료 기준**: 인스펙터가 스크롤 시 `top:88px`에 고정되고, 1050px 미만에서 static으로 바뀐다. 렌더된 DOM 어디에도 CSS selector 문자열이 **없다**(고급 설정 플래그 off 기준).
- **상태**: [ ]

### Task 10.4: 빌더 헤더 — 제목 인라인 편집 + `RecordBadge`
- **파일**: `apps/web/src/pages/scenarios/builder/BuilderHeader.tsx`, `apps/web/src/components/RecordBadge.tsx` (신규 생성)
- **작업**: 제목 인라인 input(**18px / font-weight 800**). `RecordBadge`는 기록 상태를 **항상 노출**한다 — 녹화 중 `● 기록 중`(danger 계열 점 + pulse), 종료 시 `● 기록 종료`. 옆에 임시 저장 / 발행 버튼.
- **참고**: **01-clarify "화면 4종" 3번 + "UX 결정사항"**.
- **완료 기준**: 녹화 시작/종료에 따라 배지 텍스트와 색이 전환된다. 발행 버튼 클릭 시 `POST /api/scenarios/:id/publish` 호출 + 토스트 표시.
- **상태**: [ ]

### Task 10.5: `StreamCanvas.tsx` — 프레임 렌더
- **파일**: `apps/web/src/features/recorder/StreamCanvas.tsx` (신규 생성)
- **작업**: WS 바이너리 프레임을 `createImageBitmap(blob)` → `canvas.drawImage`로 렌더. **프레임 드롭 정책** — 렌더 중이면 최신 프레임만 남기고 버린다. `ws.bufferedAmount` 감시. 캔버스 표시 크기와 원격 뷰포트 크기를 함께 상태로 보유해 좌표 변환에 넘긴다. Gen-Phase 3 PoC 클라이언트 코드를 React 컴포넌트로 승격.
- **참고**: 02-context "전송" 절, Gen-Phase 3 Task 3.4 산출물.
- **완료 기준**: 녹화 세션 시작 후 캔버스에 원격 화면이 10fps 이상으로 갱신된다(PoC-1 측정값 기준).
- **상태**: [ ]

### Task 10.6: `useInputBridge.ts` — 좌표 변환 + 입력 송신
- **파일**: `apps/web/src/features/recorder/useInputBridge.ts` (신규 생성)
- **작업**: 마우스 이동/클릭/휠/키 이벤트를 캡처해 **`(clientX - canvasRect.left) * (remoteViewportW / canvasRect.width)`** 로 역변환한 뒤 WS로 송신한다. `pageScaleFactor`가 1이 아니면 한 번 더 나눈다. **이 계산이 틀리면 클릭이 엉뚱한 요소에 꽂혀 녹화 스텝이 전부 오염된다** — Gen-Phase 3에서 검증한 공식을 그대로 이식한다. 마우스 이동은 스로틀(예: 30ms).
- **참고**: 02-context "좌표 변환 주의".
- **완료 기준**: 캔버스를 CSS로 70%·130% 크기로 바꿔도 클릭이 의도한 요소에 정확히 꽂힌다(Gen-Phase 3 Task 3.5와 동일한 27케이스 수동 확인).
- **상태**: [ ]

### Task 10.7: `useImeBridge.ts` — 한글 IME 브리지 (A안)
- **파일**: `apps/web/src/features/recorder/useImeBridge.ts` (신규 생성)
- **작업**: 화면에 보이지 않는 `<input>`에 포커스를 잡아 **로컬 IME가 거기서 조합**하게 하고, `compositionend`에서 최종 문자열만 꺼내 `{t:'ime', text}` 로 1회 송신한다(A안). **조합이 없는 입력(영문·숫자)은 `{t:'key'}` 경로로 보낸다** — `isComposing` 여부로 경로를 가른다. B안(`imeSetComposition` 중계) 승급이 필요해질 경우를 대비해 **경로 전환 플래그를 이 파일 안에 둔다**.
- **참고**: 02-context "한글 IME 처리" A안/B안 + "추가 권고".
- **완료 기준**: 캔버스에 포커스한 상태로 "안녕하세요"를 입력하면 원격 입력란에 **자모 분리·중복·누락 없이** 그대로 들어간다. 영문 "abc" 입력 시 원격에서 `keydown` 이벤트가 발생한다(콘솔로 확인).
- **상태**: [ ]

### Task 10.8: 녹화 세션 제어 + 빌더 페이지 조립
- **파일**: `apps/web/src/pages/scenarios/builder/index.tsx`, `apps/web/src/hooks/useRecording.ts` (신규 생성)
- **작업**: 녹화 시작 다이얼로그(시작 URL 입력) → `POST /api/scenarios/:id/recordings` → `wsUrl`로 WS 연결 → `StreamCanvas` + 스텝 목록 실시간 증가(S→C `{t:'step'}` 수신 시 좌측에 append) → 녹화 종료 → `POST .../stop` → 확정 스텝 반영. 해피패스(01-clarify "UX 결정사항")를 화면에서 완결시킨다.
- **완료 기준**: 녹화 시작 → 원격 브라우저에서 클릭·입력 → **좌측 스텝 목록이 실시간으로 늘어남** → 종료 → `GET /api/scenarios/:id` 에 스텝이 확정 저장됨, 이 전체 흐름이 수동으로 1회 성공한다.
- **상태**: [ ]

---

## Gen-Phase 11 — Web 화면 4: 실행 현황(SSE) + 실행 다이얼로그 + 스위트

> Gen-Phase 8·9와 Gen-Phase 5·6에 의존. **`01-clarify.md` "화면 4종" 4번 항목의 수치를 따른다.**

### Task 11.1: `RunDialog.tsx` — 실행 요청 다이얼로그 ★ 핵심 경로
- **파일**: `apps/web/src/pages/runs/RunDialog.tsx` (신규 생성)
- **작업**: ★ 최종 결정 (a)(c)의 **주 경로**. 필드: **baseUrl(직접 입력, `projects.base_url`을 placeholder 기본값으로 채워 두되 수정 가능)**, 환경 라벨, 브라우저(chromium 고정), **계정 / 비밀번호(직접 입력)**. 비밀번호 필드는 `type="password"`. 제출 시 `POST /api/runs` body의 `variables`로 전달. **입력값을 localStorage·쿠키·react-query 캐시에 남기지 않는다**(제출 후 폼 상태 즉시 초기화). 폼은 react-hook-form + zod(`CreateRunDto`).
- **참고**: 02-context "★ 최종 결정" (a)(c) + "(c) 결정의 파생 영향" 2번째 항목.
- **완료 기준**: 다이얼로그에 baseUrl·계정·비밀번호 입력 필드가 존재한다. 제출 후 브라우저 DevTools의 Application > Local Storage / Session Storage 어디에도 비밀번호가 **남지 않는다**. 제출 응답이 202이고 실행 현황 화면으로 이동한다.
- **상태**: [ ]

### Task 11.2: `RunSummaryBar.tsx` — 상단 다크 요약바
- **파일**: `apps/web/src/pages/runs/RunSummaryBar.tsx` (신규 생성)
- **작업**: 배경 `#18302a`, 반경 **17px**. 좌측: 환경 · 브라우저 · Runner · 시작시각. 우측: **`pulse` 점 애니메이션 + `4 / 5 단계`** 진행 표시. `prefers-reduced-motion`에서 pulse 제거.
- **참고**: **01-clarify "화면 4종" 4번 + "보조 색상" 다크 패널**.
- **완료 기준**: SSE로 스텝이 진행될 때마다 `N / M 단계` 숫자가 갱신되고, 실행 종료 시 pulse가 멈춘다.
- **상태**: [ ]

### Task 11.3: `RunStepList.tsx` — 3-상태 스텝 리스트
- **파일**: `apps/web/src/pages/runs/RunStepList.tsx`, `apps/web/src/components/StepStatusIcon.tsx` (신규 생성)
- **작업**: 그리드 **`32px 1fr 70px`** = 상태체크(**25px 원형**) · 스텝명+부가정보 · 소요시간(모노). **3-상태**: 완료 `✓` / 실행 중 스피너(`border-top-color:transparent` + **0.9s 회전**) / 대기 스텝 번호. 실패 스텝은 `--danger` + `--danger-soft` 배경.
- **참고**: **01-clarify "화면 4종" 4번 + "UX 결정사항"의 3-상태 표현**.
- **완료 기준**: 실행 중 화면에서 완료·실행중·대기 스텝이 각각 `✓`·회전 스피너·숫자로 동시에 보인다. `prefers-reduced-motion`에서 스피너가 회전하지 않고 정적 표시로 대체된다.
- **상태**: [ ]

### Task 11.4: SSE 연결 훅 + 실시간 반영
- **파일**: `apps/web/src/hooks/useRunEvents.ts` (신규 생성)
- **작업**: `lib/sse.ts`로 `GET /api/runs/:id/events` 구독. 이벤트 5종을 react-query 캐시에 반영(`setQueryData`)한다. 연결 끊김 시 `Last-Event-ID`로 재연결. 실행 종료(`run.finished`) 시 연결 닫고 증적 목록을 재조회.
- **참고**: 02-context "API 스펙 초안" SSE 행, 성능 목표(상태 이벤트 지연 2초 이내).
- **완료 기준**: 실행 중 네트워크를 잠시 끊었다 복구하면 **누락 없이** 스텝 상태가 이어진다. 스텝 완료 후 화면 반영까지 **2초 이내**.
- **상태**: [ ]

### Task 11.5: 우측 패널 — 브라우저 목업 + 실행 정보 + 증적
- **파일**: `apps/web/src/pages/runs/RunSidePanel.tsx` (신규 생성)
- **작업**: `grid: 1fr 360px` 의 우측. 상단 브라우저 목업(**`aspect-ratio:16/10`**, 다크 크롬 바 `#232d2a` / URL 바 `#34403d` / 본문 `#17201e`) — 실행 중에는 최신 스크린샷 증적이 있으면 그것을 표시하고 없으면 시안의 정적 목업. 하단 kv 리스트(**환경 / 테스트 데이터 / 영상 녹화 / 실패 시 Trace**). **테스트 데이터 항목의 비밀번호는 `••••••••`**. 증적 링크(스크린샷·영상·Trace·콘솔 로그) 다운로드 버튼.
- **참고**: **01-clarify "화면 4종" 4번 + "보조 색상" 브라우저 목업** / FR-008.
- **완료 기준**: 실패한 실행의 상세에서 스크린샷·영상·Trace·콘솔 로그 4종 링크가 모두 표시되고 각각 다운로드된다. kv 리스트 어디에도 비밀번호 평문이 **없다**.
- **상태**: [ ]

### Task 11.6: 실행 현황 페이지 조립 + 취소
- **파일**: `apps/web/src/pages/runs/index.tsx`, `apps/web/src/pages/runs/RunDetail.tsx` (신규 생성)
- **작업**: `/runs` 목록 + `/runs/:id` 상세를 조립. 실행 중이면 "취소" 버튼(`.btn-danger` 텍스트 스타일) → `POST /api/runs/:id/cancel`. 대기(`queued`) 상태일 때 큐 위치 표시.
- **완료 기준**: 실행 중 취소 버튼을 누르면 2초 이내에 상태가 `cancelled`로 바뀌고 Runner 컨테이너가 종료된다(`docker ps`로 확인).
- **상태**: [ ]

### Task 11.7: 스위트 화면 (시안 미제공 — 신규 설계)
- **파일**: `apps/web/src/pages/suites/{index.tsx,SuiteDetail.tsx}`, `apps/web/src/hooks/useSuites.ts` (신규 생성)
- **작업**: 시안이 없는 화면이므로 **기존 4화면의 패턴(패널·테이블·툴바)과 토큰만 재사용**해 설계한다. 목록은 시나리오 목록과 동일한 table-wrap + 헤더 스타일(`#f5f7f6`), 상세는 시나리오 선택 체크박스 + 순서 변경 + "스위트 실행" 버튼(→ `RunDialog`를 `suiteId`로 재사용). **새 색·새 반경을 만들지 않는다.**
- **참고**: **01-clarify "시안 미제공 화면"** + 02-context "주요 제약" 마지막 항목.
- **완료 기준**: 이 화면의 어떤 파일에도 `globals.css`에 없는 HEX 리터럴이 등장하지 않는다(grep 확인). 스위트 실행 시 runs 3건이 같은 `batch_id`로 생성되고 목록에 묶여 표시된다.
- **상태**: [ ]

### Task 11.8: 라우터 + 빈 상태 / 로딩 / 에러 화면
- **파일**: `apps/web/src/router.tsx`, `apps/web/src/components/{EmptyState.tsx,ErrorState.tsx,LoadingState.tsx}` (신규 생성)
- **작업**: 5개 화면 라우팅(`/`, `/scenarios`, `/scenarios/:id`, `/runs`, `/runs/:id`, `/suites`). 01-clarify가 "시안이 제공하지 않아 다음 Phase에서 설계"로 넘긴 **로딩·빈 상태·에러 화면을 시안 토큰 범위 안에서** 설계한다 — 스켈레톤은 `--line` 기반, 빈 상태는 `--muted` 텍스트 + `--brand` CTA, 에러는 `--danger-soft` 배경 + `--danger` 텍스트.
- **참고**: **01-clarify "UX 결정사항" 마지막 항목**.
- **완료 기준**: 데이터가 0건인 상태에서 각 화면이 빈 화면이 아니라 빈 상태 UI를 보여준다. API를 내린 상태에서 에러 화면이 표시되고 재시도 버튼이 동작한다.
- **상태**: [ ]

---

## Gen-Phase 12 — 통합 검증 (PoC-2 / PoC-3) · 사내 대상 검증 · 마무리

> Gen-Phase 4~11 전부에 의존.

### Task 12.1: PoC-2 — 한글 IME 입력 정확도
- **파일**: `apps/runner/poc/poc2-ime.ts`, `apps/runner/poc/fixtures/ime-test.html` (신규 생성) / `.pipeline/20260917-114450/poc2-result.md` (신규 생성)
- **작업**: `ime-test.html`에 ① 일반 텍스트 input, ② **입력 중 실시간 자동완성**(keydown 의존), ③ **숫자만 허용하는 마스킹 input**(keydown 의존) 3종을 둔다. "안녕하세요 테스트"를 A안(`Input.insertText`)으로 주입해 왕복 정확도를 측정하고, ②③에서 A안이 깨지는지 확인한다. 깨지면 **B안(`imeSetComposition`) 승급 필요성을 확정**하고 `useImeBridge.ts`의 전환 플래그로 B안을 구현한다.
- **참고**: 02-context "PoC-2" 합격 기준 + "한글 IME 처리" A안 한계 1·3.
- **완료 기준**: `poc2-result.md`에 한글 왕복 정확도(목표 100%)와 keydown 의존 위젯 2종의 PASS/FAIL이 기록된다. FAIL이면 B안 구현 후 재측정 결과까지 포함한다.
- **상태**: [ ]

### Task 12.2: PoC-3 — 녹화 → 재생 왕복 (공개 사이트)
- **파일**: `apps/runner/poc/poc3-roundtrip.ts` (신규 생성) / `.pipeline/20260917-114450/poc3-result.md` (신규 생성)
- **작업**: Task 3.1의 더미 로그인 페이지에서 **이동→입력→입력→클릭→확인 5스텝을 실제 UI로 녹화**하고, 저장 후 **headless Runner로 재생해 5/5 통과**하는지 확인한다. 검증 포인트 4가지: ① role/label 우선순위가 실제로 뽑히는가, ② 고유성 검증이 동작하는가, ③ `input` 디바운스가 "아이디 입력"을 스텝 1개로 합치는가, ④ 비밀번호가 `{{변수}}`로 승격되고 평문이 어디에도 안 남는가.
- **참고**: 02-context "PoC-3" 절 전체 — "녹화와 실행은 별개 코드 경로. 왕복이 안 되는 경우가 가장 흔한 실패."
- **완료 기준**: `poc3-result.md`에 **5/5 통과** 여부와 검증 포인트 4가지 각각의 PASS/FAIL이 기록된다. ④는 DB·로그·SSE 3곳을 grep한 결과를 근거로 제시한다.
- **상태**: [ ]

### Task 12.3: 사내 스테이징 대상 검증 (분리된 Task)
- **파일**: `.pipeline/20260917-114450/internal-verification.md` (신규 생성)
- **작업**: **사내 스테이징 주소를 사용자로부터 받은 뒤** 실제 로그인 화면에서 PoC-1(지연·좌표)·PoC-2(한글 IME)·PoC-3(왕복) 3종을 재측정한다. 공개 사이트 대비 차이(사내망 지연, 실제 로그인 폼의 keydown 의존 여부, iframe·SPA 라우팅 유무)를 기록한다. **주소를 받지 못하면 이 Task는 블록 상태로 남기고 나머지를 진행한다.**
- **참고**: 오케스트레이터 지시 — 사내 대상 검증은 별도 Task로 분리.
- **완료 기준**: 사내 URL에 대해 3개 PoC의 재측정 수치가 기록되거나, 주소 미제공 시 "블록 — 사내 스테이징 URL 대기"로 명시된다. **사내 실데이터 스크린샷이 증적으로 남을 수 있으므로 검증 후 artifact를 삭제**한 사실도 기록한다.
- **상태**: [ ]

### Task 12.4: 마스킹 3경로 전수 점검
- **파일**: `apps/api/src/common/utils/mask.spec.ts` (신규 생성) / 관련 호출 지점 (수정)
- **작업**: `mask.ts`가 **① API 응답 ② 서버 로그 ③ `step_results.error_message`** 3경로 모두에서 호출되는지 코드 grep으로 전수 확인하고, 누락 지점을 보강한다. 추가로 **SSE 이벤트** 경로도 포함(★ 최종 결정 (c) 파생 영향은 SSE를 3경로 중 하나로 명시). 비밀번호를 틀리게 넣어 Playwright 에러를 유발한 뒤 DB·로그 파일·SSE 스트림 3곳을 grep한다.
- **참고**: 02-context "설계상 반드시 지켜야 할 제약" — 한 곳이라도 빠지면 비밀번호가 샌다.
- **완료 기준**: 의도적 실패 실행 후 `grep -r "<테스트비밀번호>" $ARTIFACT_ROOT logs/` 와 `SELECT error_message FROM step_results` 양쪽에서 **0건**이 나온다.
- **상태**: [ ]

### Task 12.5: 성능 목표 측정
- **파일**: `.pipeline/20260917-114450/perf-result.md` (신규 생성)
- **작업**: 문서에 명시된 3개 목표를 측정한다 — ① **일반 API p95 500ms 이내**(주요 GET 6개에 대해 100회씩), ② **실행 요청 후 1초 이내 Queue 등록**, ③ **상태 이벤트 지연 2초 이내**(Runner publish → 브라우저 수신).
- **참고**: 01-clarify "비기능 요구사항 > Performance", 02-context "기타" — 문서 명시값이므로 유지.
- **완료 기준**: 3개 항목의 실측값이 표로 기록되고 각각 PASS/FAIL 판정이 있다. FAIL 항목에는 원인과 개선안이 적힌다.
- **상태**: [ ]

### Task 12.6: README + 실행 가이드
- **파일**: `README.md` (신규 생성)
- **작업**: 로컬 구동 순서(`docker compose up` → `.env` 작성 → `yarn install` → `migration:run` → `yarn dev`), 3개 런타임(web/api/runner)의 역할과 포트, **Runner와 API는 같은 호스트에서 `ARTIFACT_ROOT` 볼륨을 공유해야 한다**는 제약, nginx `/rec/` 프록시 설정 예시, **"사내망 제한이 전제"**라는 보안 경고(접근 제어가 없어 URL을 아는 누구나 모든 증적을 열람 가능), FR-005 미충족 기록.
- **참고**: 02-context "(b) 부가 제약", "구조상 쟁점 1건", "회원제 전환 시 부채로 남는 지점" / 01-clarify "주요 제약" 2번째 항목.
- **완료 기준**: README만 보고 신규 개발자가 로컬 환경을 구동해 시나리오 1건을 실행할 수 있다. 보안 경고와 FR-005 미충족 기록이 명시적으로 포함된다.
- **상태**: [ ]

### Task 12.7: 최종 검증 + PR
- **파일**: — (PR 생성)
- **작업**: 루트에서 `yarn lint && yarn typecheck && yarn build && yarn test` 전량 통과 확인. PR 제목 `[feat] TestFlow 비회원제 MVP 구현`, 본문에 변경 이유 / 변경 내용 / 테스트 방법 + PoC 1·2·3 결과 요약. **민감 정보 노출 여부 확인 후 푸시**(`.env` 미커밋, 증적 파일 미커밋).
- **참고**: CLAUDE.md "작업 완료 시", "보안 수칙".
- **완료 기준**: 4개 명령이 모두 exit 0. `git log -p` 에 `.env`·비밀번호·사내 URL이 포함되지 않는다. PR URL이 생성된다.
- **상태**: [ ]

---

## 리스크와 후퇴 경로

### PoC-1 실패 시 (Gen-Phase 3 게이트)
1. **1차 후퇴 — 파라미터 조정**: `quality` 60→40, `size` 1280×800→1024×640, `everyNthFrame` 1→2. 지연·fps만 미달이고 좌표 적중률이 100%면 여기서 해결될 가능성이 높다.
2. **2차 후퇴 — CDP 2안 전환**: `page.screencast`가 문제면 `Page.startScreencast` + `screencastFrameAck` 직접 구현으로 내려간다. **`screencast.ts`의 export 시그니처는 그대로**이므로 이 파일 1개만 바뀐다(Task 3.2의 완료 기준이 이를 보장).
3. **최종 후퇴 — 녹화 방식 1번(별도 창)**: 좌표 적중률 자체가 안 나오면 웹 UI 안 스트리밍을 포기하고 `recording-options.html` 1번 방식으로 되돌린다. **이 경우에도 수집 4단계(Task 7.3 감지 · 7.4 Locator · 7.5 변환 · 7.6 적재)와 Gen-Phase 6 실행 엔진 전체는 손대지 않는다** — 02-context가 "화면 전달 계층만 교체 가능"을 설계 제약으로 못박은 이유가 이것이다. 영향 범위는 `screencast.ts`·`input-bridge.ts`·`ws-server.ts` + `apps/web/src/features/recorder/` 전체(Gen-Phase 10의 Task 10.5~10.7)로 한정된다. Gen-Phase 10에서 **약 3개 Task 분량이 "로컬 브라우저 확장/별도 창 연동"으로 대체**된다.

### 버전 스파이크(Task 1.1) 실패 시
- 항목별로 **개별 하향**한다. 전부 한꺼번에 내리지 않는다.
  - TS 7.0.2에서 decorator metadata가 안 되면 → **TS 5.9 계열**로. 프론트(`apps/web`)만 7을 유지하는 혼재 구성도 가능(tsconfig 프리셋이 분리돼 있어 비용이 낮다).
  - TypeORM 1.1.1 breaking이 크면 → **0.3.x**로. ERDify가 실제로 돌리는 조합이라 선례가 있다.
  - NestJS 12 breaking이 있으면 → **11**로.
- 최악의 경우 ERDify 검증 조합(**Nest 11 / TypeORM 0.3 / TS 5.x**)이 안전망이다. 이 경우 Task 1.4의 tsconfig 프리셋과 Task 2.6의 DataSource만 수정되고 나머지 Task는 영향 없다.

### 그 외
- **PoC-2 실패(keydown 의존 위젯에서 A안 깨짐)** → B안(`imeSetComposition` 중계) 승급. 영향은 `input-bridge.ts` + `useImeBridge.ts` 2개 파일로 한정(Task 3.3·10.7의 설계가 이를 보장).
- **PoC-3 실패(녹화는 되는데 재생이 깨짐)** → 원인은 거의 항상 Locator 고유성 검증(Task 7.4) 누락. `resolvedBy` 기록(Task 6.2)으로 어느 단계에서 깨지는지 추적 가능하게 설계돼 있다.
- **Runner 수평 확장 필요 시** → 녹화 WS가 Runner 직결이라 **세션-노드 어피니티 재설계**가 필요하다. MVP는 단일 서버 전제이므로 문제되지 않으나 재설계 지점으로 기록.
- **회원제 전환 시** → `[AUTHZ]` 주석 4곳(projects / scenarios / runs / 신설 project_members)이 정확한 마이그레이션 지점. 모두 NULL 허용 컬럼 추가 + 신규 테이블이라 데이터 파괴 없이 전환된다.

---

## 축소 후보 (일정 압박 시)

01-clarify가 정한 축소 순서를 그대로 따른다.

1. **① 스위트 묶음 실행 (FR-010)** — 문서상 SHOULD·Phase 2 항목이다. 제거 시 영향: **Task 2.2(suite 계약 일부) · Task 5.5(suites 모듈) · Task 11.7(스위트 화면)** 3개 Task가 통째로 빠지고, Task 5.1의 `batch_id` 분기와 Task 2.7의 `004_create_suites` 마이그레이션만 남겨 둔다(스키마는 유지해 나중에 화면만 붙인다). **약 3 Task 절감.**
2. **② 대시보드 지표 실데이터 집계** — `GET /api/dashboard/summary`·`readiness`를 실집계 대신 **단순 COUNT 또는 고정값**으로 대체한다. 영향: **Task 5.6** 의 작업량이 대폭 줄고 Task 9.1~9.4의 화면은 그대로 유지된다(시안 외형은 손상되지 않는다). **약 0.5 Task 절감.**

그 이상 압박이 심하면 다음 순서로 검토한다(01-clarify에 없는 추가 제안이므로 사용자 확인 필요): ③ 증적 4종 중 **network_log 제외**(Task 6.5), ④ **빈 상태/에러 화면을 공통 1종으로 통합**(Task 11.8).

**축소해서는 안 되는 항목**: Gen-Phase 3(PoC-1) · Task 7.4(Locator 고유성 검증) · Task 12.4(마스킹 3경로 점검). 각각 프로젝트 성패 · 재생 신뢰성 · 보안 수칙에 직결된다.
