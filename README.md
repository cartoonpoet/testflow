# TestFlow

비개발자용 E2E 테스트 자동화 플랫폼 (비회원제 MVP).

브라우저에서 업무 시나리오를 **녹화**하고, 저장된 JSON 시나리오를 Playwright 로 **재생**해
실행 결과와 증적(스크린샷·video·trace·console)을 남긴다.

## 구조

```
apps/
  web/      React 19 + Vite 8 + Tailwind 4 — 화면 4종 + 녹화 클라이언트
  api/      NestJS 12 — 업무 로직·영속화·큐 등록·SSE 중계 (Playwright 직접 실행 안 함)
  runner/   Playwright 1.63 실행 엔진 + 녹화 WS 호스트 (유일하게 Playwright 에 의존)
packages/
  contracts/          zod 스키마 — web·api·runner 공유 단일 타입 소스
  db/                 TypeORM DataSource + 엔티티 + 마이그레이션 (MySQL 8)
  config-typescript/  tsconfig 프리셋 (base / react / nest / node)
  config-eslint/      ESLint 9 flat config (base / react / nest)
```

## 공유 계약 (`packages/contracts`)

`TestStepSchema` 가 이 프로젝트의 중심 계약이다. web(편집 폼) · api(검증) · runner(해석)
**세 런타임이 동시에 의존**하므로 타입을 각 앱에서 재정의하지 않는다.

- Locator 는 단일 값이 아니라 **순위 배열**이다 — `{ primary, fallbacks[] }`,
  후보 판별자는 `by: role | label | text | testid | css` (FR-004 우선순위 순서).
- `by: "css"` 후보는 **고급 설정 전용**이다. API 응답 직전에 `toPublicLocatorTarget()` 로 제거한다.
- 계정·비밀번호는 DB 에 저장하지 않는다. 스텝에는 `{{변수}}` 참조 + `isSecret: true` 만 남는다.

## DB (`packages/db`)

```bash
yarn build                 # contracts → db 순으로 빌드 (마이그레이션은 컴파일된 JS 로 돌린다)
yarn db:migrate            # 마이그레이션 실행
yarn db:revert             # 마지막 1건 되돌리기
```

> ⚠️ 셸에 회사 공용 `DB_HOST` / `DB_PW` 가 export 돼 있으면 **그 값이 `.env` 보다 우선한다**
> (Node 의 `--env-file` 은 기존 환경변수를 덮어쓰지 않는다). 마이그레이션 CLI 에 로컬 호스트
> 가드를 넣어 두었으며, 걸리면 아래처럼 지우고 실행한다.
>
> ```bash
> env -u DB_HOST -u DB_USER -u DB_PW -u DB_PORT -u DB_NAME yarn db:migrate
> ```

테이블은 **9개**다 — projects / scenarios / test_steps / suites / suite_scenarios /
runs / step_results / artifacts / recording_sessions.
`project_variables` 는 **의도적으로 없다**(실행 요청 body 로 변수를 받고 저장하지 않는 결정).

## 요구 사항

- Node.js **22+** (개발 검증: 22.22.2)
- Yarn **4.18** (corepack)
- Docker (로컬 MySQL·Redis, 그리고 실행 격리용 컨테이너)

## 시작하기

```bash
corepack enable
yarn install

cp .env.example .env      # .env 는 절대 커밋하지 않는다

docker compose up -d      # mysql:8.4 + redis:7
docker compose ps         # 둘 다 healthy 확인

yarn typecheck
yarn lint
yarn build
```

## 고정된 기술 결정

자세한 근거는 [`.pipeline/20260917-114450/spike-versions.md`](.pipeline/20260917-114450/spike-versions.md) 참조.

| 항목 | 값 | 비고 |
|---|---|---|
| TypeScript | **6.0.3** | 7.0.2 는 typescript-eslint 가 아직 미지원(#10940). 지원되면 즉시 승급 |
| NestJS | 12.0.3 | **순수 ESM.** 상대 import 에 `.js` 확장자 필수 |
| TypeORM | 1.1.1 | `synchronize:false`, 마이그레이션 명시 배열 등록 (glob 금지) |
| Playwright | 1.63.0 | `page.screencast` 사용 |
| 패키지 매니저 | yarn 4.18 (node-modules linker) | PnP 아님 — Playwright/Nest 런타임 호환 |
| 테스트 | vitest 5.0.1 | WSL 에서 jest 네이티브 바인딩 문제 회피 |

### 알려진 install 경고 1건 (양성)

```
YN0060: ioredis 6.0.0 doesn't satisfy what typeorm requests (^5.0.4)
```

TypeORM 의 ioredis peer 는 optional 이고 Redis **쿼리 캐시 전용**이다. 우리는 쓰지 않는다.
BullMQ 6 은 ioredis `>=5.0.0` 을 명시 지원하므로 문제 없다.

## 보안 규약

- **`.env` 는 커밋하지 않는다.** `.env.example` 만 관리한다.
- 계정·비밀번호는 **실행 요청 body 로만** 받는다. DB 에 영구 저장하지 않으며
  실제 값은 Redis 큐 페이로드에만 존재하고 실행 종료와 함께 만료된다.
- 마스킹은 `apps/api/src/common/utils/mask.ts` **단일 함수**로 하고
  API 응답 / 서버 로그 / `step_results.error_message` **3경로 모두**에서 호출한다.
  Playwright 에러 메시지에 입력값이 그대로 실려 나오는 경우가 있다.
- 녹화 시 `type="password"` 필드는 값을 수집하지 않고 `{{password}}` 참조로만 남긴다.
- `docker-compose.yml` 은 `TESTFLOW_*` 접두 변수를 쓴다.
  개발자 셸의 회사 공용 `DB_PW` 가 로컬 컨테이너 root 암호로 새어 들어가는 것을 막기 위해서다.

## 배포 전제

- **Runner 와 API 는 같은 호스트에 두고 `ARTIFACT_ROOT` 볼륨을 공유한다.**
  증적 저장소가 로컬 디스크이고 API 가 Runner 가 쓴 파일을 서빙하기 때문이다.
  `ARTIFACT_ROOT` 가 상대 경로면 **레포 루트 기준**으로 해석한다(진입점마다 cwd 가 달라서다).
  API 는 `storage_key` 를 그대로 fs 경로로 쓰지 않는다 — 형식 검증 + 절대경로 거부 +
  resolve 후 root 접두 검사 3중으로 막는다(`modules/artifacts/artifacts.path.ts`).
- 녹화 WebSocket 은 API 를 경유하지 않고 **Runner 직결**이다
  (nginx 에서 `/rec/` 경로만 Runner 로 프록시). API 를 끼우면 프레임마다 홉이 늘어 지연이 배가된다.
  API 는 세션 토큰만 발급하고 **Redis 에는 `sha256(token)` 만** TTL 10분으로 둔다
  (`testflow:rec:token:<sessionId>`). Runner 가 그 해시로 검증하고, 세션 종료 시 키를 지우면
  즉시 접속이 막힌다. nginx 뒤에 두면 `RUNNER_WS_PUBLIC_URL` 을 설정한다.
- **SSE 이벤트는 `run:<runId>` 채널 + `run:<runId>:events` 버퍼 규약**을 따른다.
  Runner 가 publish 하고 API 가 중계하며, `Last-Event-ID` 재전송이 버퍼로 동작한다
  (규약 전문은 `packages/contracts/src/events.ts` 의 `RunEventEnvelopeSchema` JSDoc).
