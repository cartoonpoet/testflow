# TestFlow

비개발자용 E2E 테스트 자동화 플랫폼 (**비회원제 MVP**).

브라우저에서 업무 시나리오를 **녹화**하고, 저장된 JSON 시나리오를 Playwright 로 **재생**해
실행 결과와 증적(스크린샷 · 영상 · trace · 콘솔 로그 · 네트워크 로그)을 남긴다.

> ## ⚠️ 먼저 읽을 것 — 이 MVP 에는 **접근 제어가 없다**
> 로그인도, 권한도, `created_by` 도 없다. **URL 을 아는 누구나 모든 시나리오와 증적을 열람·삭제할 수 있다.**
> 증적에는 테스트 대상 화면의 스크린샷과 영상이 들어간다.
> → **반드시 사내망(VPN/방화벽) 안에서만 서비스한다.** 공인 IP 에 그대로 노출하면 안 된다.
> 자세한 미충족 요구사항은 [MVP 범위와 미충족 항목](#mvp-범위와-미충족-항목) 참조.

---

## 목차

1. [구조](#구조)
2. [요구 사항](#요구-사항)
3. [처음 받았다면 — 로컬 구동 10분](#처음-받았다면--로컬-구동-10분)
4. [⚠️ 회사 env 오염 주의](#️-회사-env-오염-주의--가장-많이-걸리는-함정)
5. [환경변수 전량](#환경변수-전량)
6. [타임존](#타임존)
7. [실행 격리 모드](#실행-격리-모드-runner_execution_mode)
8. [배포 전제](#배포-전제)
9. [MVP 범위와 미충족 항목](#mvp-범위와-미충족-항목)
10. [고정된 기술 결정](#고정된-기술-결정)
11. [문제 해결](#문제-해결)

---

## 구조

```
apps/
  web/      React 19 + Vite 8 + Tailwind 4 — 화면 4종 + 스위트 + 녹화 클라이언트  (:5173 dev / :4173 preview)
  api/      NestJS 12 — 업무 로직·영속화·큐 등록·SSE 중계 (Playwright 직접 실행 안 함)  (:4000)
  runner/   Playwright 1.63 실행 엔진 + 녹화 WS 호스트 (유일하게 Playwright 에 의존)     (:4100 WS)
packages/
  contracts/          zod 스키마 — web·api·runner 공유 **단일 타입 소스**
  db/                 TypeORM DataSource + 엔티티 9종 + 마이그레이션 10종 (MySQL 8)
  config-typescript/  tsconfig 프리셋 (base / react / nest / node)
  config-eslint/      ESLint 9 flat config (base / react / nest)
```

세 런타임이 어떻게 맞물리는지:

```
   테스터 브라우저
        │  ① 화면·API (같은 오리진, nginx 프록시)
        ▼
   ┌─────────┐   BullMQ(run 큐)    ┌──────────┐
   │   API   │ ──────────────────► │  Runner  │──► Playwright ──► 테스트 대상
   │ :4000   │ ◄──────────────────  │  :4100   │
   └─────────┘   Redis pub/sub      └──────────┘
        │        (run:<id> 채널)          │
        │  ② SSE(실행 현황)               │  ③ 녹화 WebSocket **직결**
        └────────────────────────────────┘     (API 를 경유하지 않는다)
                     공유 디스크: ARTIFACT_ROOT
```

- **API 는 Playwright 를 직접 부르지 않는다.** 실행은 전부 Runner 가 한다.
  API 가 하는 일은 ① 스냅샷 행 INSERT → ② 큐 등록 → ③ **202 Accepted 즉시 반환**뿐이다.
- **녹화 프레임은 API 를 경유하지 않는다.** 프레임마다 홉이 늘면 지연이 배가되기 때문이다.
  API 는 단명 세션 토큰만 발급하고, 브라우저가 Runner WS 에 직접 붙는다.

### 공유 계약 (`packages/contracts`)

`TestStepSchema` 가 이 프로젝트의 중심 계약이다. web(편집 폼) · api(검증) · runner(해석)
**세 런타임이 동시에 의존**하므로 타입을 각 앱에서 재정의하지 않는다.

- Locator 는 단일 값이 아니라 **순위 배열**이다 — `{ primary, fallbacks[] }`,
  후보 판별자는 `by: role | label | text | testid | css` (FR-004 우선순위 순서).
- `by: "css"` 후보는 **고급 설정 전용**이다. API 응답 직전에 `toPublicLocatorTarget()` 로 제거하고,
  `?advanced=1` 일 때만 내보낸다.
- 계정·비밀번호는 DB 에 저장하지 않는다. 스텝에는 `{{변수}}` 참조 + `isSecret: true` 만 남는다.

---

## 요구 사항

| | 개발 검증 버전 | 최소 |
|---|---|---|
| **Node.js** | 22.22.2 | **22.0.0 이상** (`package.json` 의 `engines` 로 강제) |
| Yarn | 4.18.0 (corepack) | 4.x |
| Docker | Docker Desktop / Engine | 로컬 MySQL·Redis 용. `RUNNER_EXECUTION_MODE=docker` 면 실행 격리에도 필요 |
| MySQL | 8.4 (compose 제공) | 8.0 이상 |
| Redis | 7 (compose 제공) | 7 이상 |

> ⚠️ **배포 서버의 Node 버전은 아직 확인되지 않았다.** (파이프라인 4단계 연속 이월 항목)
> 위 표의 **22.0.0 이상**이 필요 최소 버전이다. 그 미만이면 기동 자체가 되지 않는다
> (`node --env-file-if-exists`, ESM `import.meta`, `fetch` 전역을 전제한다).
> 배포 전에 대상 서버에서 `node -v` 를 반드시 확인하라.

---

## 처음 받았다면 — 로컬 구동 10분

아래 순서 그대로 따라 하면 시나리오 1건을 녹화하고 실행할 수 있다.
**순서가 중요하다** — 빌드가 마이그레이션보다 먼저다(마이그레이션은 컴파일된 JS 로 돈다).

### 0) 사전 준비

```bash
corepack enable                # yarn 4 활성화
git clone <repo> && cd testflow
```

### 1) 의존성

```bash
yarn install
```

Playwright 브라우저가 없으면 한 번 받는다:

```bash
yarn workspace @testflow/runner exec playwright install chromium
```

### 2) 환경변수

```bash
cp .env.example .env
```

로컬에서는 **그대로 두면 동작한다.** `.env` 는 **절대 커밋하지 않는다.**

### 3) 인프라 기동 (MySQL + Redis)

```bash
docker compose up -d
docker compose ps           # mysql · redis 둘 다 healthy 가 될 때까지 기다린다 (최초 40초쯤)
```

### 4) 빌드 → 마이그레이션

```bash
yarn build                  # contracts → db → api/runner/web 순 (turbo 가 순서를 안다)
yarn db:migrate             # 테이블 9개 + 기본 프로젝트 1건 시드 + 인덱스
```

`db:migrate` 가 회사 DB 를 가리켜 실패하면 → [회사 env 오염 주의](#️-회사-env-오염-주의--가장-많이-걸리는-함정)

### 5) 세 프로세스 기동 (터미널 3개)

```bash
# 터미널 1 — API
yarn workspace @testflow/api start          # http://localhost:4000/api

# 터미널 2 — Runner (실행 워커 + 녹화 WS)
yarn workspace @testflow/runner start       # ws://localhost:4100/rec

# 터미널 3 — 웹
yarn workspace @testflow/web dev            # http://localhost:5173
```

개발 중 자동 재시작이 필요하면 `start` 대신 `dev` 를 쓴다(`yarn dev` 로 turbo 가 셋을 동시에 띄울 수도 있다).

### 6) 살아 있는지 확인

```bash
curl localhost:4000/api/health
# {"status":"ok","db":"ok","redis":"ok","runner":"ok"}
```

- `runner":"down"` 이면 Runner 가 안 떠 있는 것이다. **이 상태에서도 실행 요청은 접수되지만
  큐에 쌓인 채 진행되지 않는다.** Runner 를 띄우면 자동으로 이어서 실행된다(검증됨).

### 7) 첫 시나리오 만들기 (해피패스)

브라우저로 <http://localhost:5173> 를 연다.

1. 우측 상단 **`＋ 새 시나리오`** → 이름을 넣고 **`만들고 녹화하기`**
2. 빌더 화면에서 **녹화할 주소**를 넣고 **`● 녹화 시작`**
   - 연습 대상이 필요하면 저장소에 들어 있는 더미 페이지를 띄운다:
     ```bash
     cd apps/runner/poc && python3 -m http.server 5311 --bind 127.0.0.1
     # → http://127.0.0.1:5311/fixtures/record-login.html
     ```
3. 캔버스에 **원격 브라우저 화면**이 나온다. 거기에 직접 클릭·입력하면
   아래 목록에 **업무 단계가 실시간으로 쌓인다.**
   - `type="password"` 칸에 친 값은 **수집되지 않는다.** `{{password}}` 참조만 남는다.
   - 같은 칸에 10자를 쳐도 스텝은 **1개**다(디바운스).
4. **`■ 녹화 종료`** → 왼쪽 목록에서 단계를 골라 우측 **인스펙터**에서 이름·확인 조건을 다듬는다.
5. **`발행하기`** → 상태가 `published`, 버전 +1.
6. **`▶ 실행`** → 대상 주소 · 환경 라벨 · **계정/비밀번호를 직접 입력** → `▶ 실행 시작`
   - 비밀번호는 DB 에 저장되지 않는다. 큐 페이로드에만 존재하고 실행이 끝나면 사라진다.
7. **실행 현황** 화면으로 자동 이동한다. 단계가 하나씩 `대기 → 실행 중 → 완료` 로 바뀐다(SSE).
8. 실패하면 우측 **증적** 패널에서 스크린샷 · 영상 · trace · 콘솔 로그 · 네트워크 로그를 받는다.
   - trace 는 `npx playwright show-trace trace.zip` 으로 연다.
   - **성공한 실행의 영상·trace 는 기본적으로 보관하지 않는다**(디스크 절약).
     남기려면 `KEEP_ARTIFACTS_ON_SUCCESS=true`.

### 검증 명령

```bash
yarn typecheck    # 7 workspaces
yarn lint         # 7 workspaces
yarn test         # contracts 22 · web 52 · runner 75 · api 93 = 242
yarn build        # 5 workspaces
```

---

## ⚠️ 회사 env 오염 주의 — 가장 많이 걸리는 함정

**셸에 회사 공용 `DB_HOST` / `DB_USER` / `DB_PW` 가 export 돼 있으면 그 값이 `.env` 를 이긴다.**
Node 의 `--env-file` 은 **이미 존재하는 환경변수를 덮어쓰지 않기** 때문이다.
그대로 두면 마이그레이션이 **회사 운영 DB 에 실행된다.**

그래서 두 가지 방어를 넣어 두었다.

### ① 마이그레이션 CLI 의 로컬 호스트 가드 — `packages/db/src/cli/guard.ts`

대상이 로컬(`127.0.0.1`/`localhost`)이 아니면 **실행을 거부한다.** 걸리면 지우고 다시 실행한다:

```bash
env -u DB_HOST -u DB_USER -u DB_PW -u DB_PORT -u DB_NAME yarn db:migrate
```

API·Runner 도 같은 이유로 엉뚱한 DB 에 붙을 수 있다. 기동 로그의
`DB 연결 완료 (호스트:포트)` 를 **매번 눈으로 확인**하라.

### ② `docker-compose.yml` 의 `TESTFLOW_` 접두 변수

compose 는 ambient 환경변수를 `.env` 보다 우선한다. 그래서 `${DB_PW}` 를 쓰면
**로컬 컨테이너가 회사 운영 비밀번호를 root 암호로 들고 뜬다**(`docker compose config` 출력에
실제로 찍히는 것을 확인했다). 따라서 compose 전용 변수명을 따로 둔다:

| 용도 | 변수 |
|---|---|
| **앱이 접속할 주소** | `DB_HOST` `DB_PORT` `DB_USER` `DB_PW` `DB_NAME` |
| **컨테이너를 띄울 값** | `TESTFLOW_DB_PW` `TESTFLOW_DB_NAME` `TESTFLOW_DB_PORT` `TESTFLOW_REDIS_PORT` |

**이 분리와 `guard.ts` 는 건드리지 마라.**

---

## 환경변수 전량

`.env.example` 이 원본이다. 아래는 그 설명이다.

### Database

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DB_HOST` | `127.0.0.1` | 앱이 접속할 MySQL 호스트 |
| `DB_PORT` | `3307` | compose 가 3306 을 3307 로 노출한다(회사 로컬 MySQL 과 충돌 회피) |
| `DB_USER` / `DB_PW` | `root` / `testflow_local` | |
| `DB_NAME` | `testflow` | |

### Redis — 큐 + 실행 이벤트 pub/sub + 녹화 세션 토큰

| 변수 | 기본값 | 설명 |
|---|---|---|
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | BullMQ · `run:<id>` 채널 · `testflow:rec:token:*` 3가지를 모두 쓴다 |

### API

| 변수 | 기본값 | 설명 |
|---|---|---|
| `API_PORT` | `4000` | 전역 prefix 는 `/api` |
| `CORS_ORIGINS` | `http://localhost:5173` | 콤마 구분. **프로덕션에서만 적용**되고 개발에서는 전체 허용. 단일 오리진 배포(nginx)면 CORS 자체가 등장하지 않는다 |

### Runner — 실행

| 변수 | 기본값 | 설명 |
|---|---|---|
| `RUNNER_CONCURRENCY` | `2` | 동시 실행 시나리오 수(BullMQ Worker concurrency). 브라우저 수와 같다 — 메모리를 보고 올린다 |
| `RUNNER_ID` | (자동) | 비우면 `<호스트명>-<pid>`. `health` 의 `runner` 판정 키(`testflow:runner:heartbeat:<id>`) |
| `RUNNER_HEADLESS` | `true` | 눈으로 보려면 `false` |
| `RUNNER_RUN_TIMEOUT_MS` | `300000` | 실행 1건 하드 타임아웃. 넘기면 브라우저를 끊고 `status=timeout` 확정 |

### Runner — 녹화 WS

| 변수 | 기본값 | 설명 |
|---|---|---|
| `RUNNER_WS_PORT` | `4100` | 녹화 WebSocket 포트. **API 포트가 아니다** |
| `RUNNER_WS_HOST` | `127.0.0.1` | API 가 응답에 넣을 호스트. **테스터 브라우저가 닿을 수 있는 주소**여야 한다 |
| `RUNNER_WS_PUBLIC_URL` | (빈 값) | nginx 뒤에 둘 때만. 예 `wss://testflow.internal/rec`. 비면 `ws://RUNNER_WS_HOST:RUNNER_WS_PORT/rec` |
| **`RECORD_MAX_FPS`** | **`15`** | ★ 송출 fps 상한. PoC-1 은 60fps 를 그대로 흘려 세션당 **14.6~33.1 Mbps** 를 썼다. 필요한 건 10fps 이므로 15 로 제한한다 — 대역폭이 **9.83 → 2.16 Mbps(약 1/4.5)** 로 줄고 합격 기준(지연 ≤200ms / ≥10fps)은 그대로다. **동시 녹화 N명이면 이 값 × N 이 회선을 먹는다.** `0` 이하면 무제한 |
| `RECORDING_IDLE_TIMEOUT_MS` | `300000` | 마지막 클라이언트 메시지 후 이 시간이 지나면 브라우저를 폐기하고 `status=expired`. **초안(`draft_steps`)은 남긴다** — 테스터가 잠깐 자리를 비운 것일 수 있다 |

### 증적 저장소

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ARTIFACT_ROOT` | `./artifacts` | 상대 경로면 **레포 루트 기준**으로 해석한다(진입점마다 cwd 가 다르다). **API 와 Runner 가 같은 경로를 공유해야 한다** |
| `KEEP_ARTIFACTS_ON_SUCCESS` | `false` | 성공 실행의 영상·trace 보관 여부. 영상 1건이 수 MB~수십 MB다 |

### 실행 격리

| 변수 | 기본값 | 설명 |
|---|---|---|
| `RUNNER_EXECUTION_MODE` | `local` | `local` \| `docker`. 아래 절 참조 |
| `RUNNER_DOCKER_IMAGE` | `testflow/playwright-exec:1.63.0` | docker 모드 전용 |
| `RUNNER_CONTAINER_MEMORY` / `RUNNER_CONTAINER_CPUS` | `2g` / `1.5` | 컨테이너 1개당 커널 수준 상한 |
| `RUNNER_DOCKER_BIN` | (자동) | WSL + Docker Desktop 에서는 리눅스 `docker` 가 없고 `docker.exe` 만 PATH 에 있다. 비우면 `docker` → `docker.exe` 순으로 탐색 |

### compose 전용

`TESTFLOW_DB_PW` `TESTFLOW_DB_NAME` `TESTFLOW_DB_PORT` `TESTFLOW_REDIS_PORT`
— [위 절](#️-회사-env-오염-주의--가장-많이-걸리는-함정) 참조.

### 없는 변수

- **`SECRET_ENC_KEY` 는 의도적으로 없다.** 계정·비밀번호를 DB 에 저장하지 않기로 했으므로
  복호화 대상 자체가 없다. → [MVP 범위와 미충족 항목](#mvp-범위와-미충족-항목)

---

## 타임존

### 운영 MySQL 에 **`default-time-zone=+00:00` 은 필수다**

앱의 DataSource 는 `timezone: "Z"` 라 DB 가 돌려주는 `DATETIME` 을 **UTC 로 읽는다.**
그런데 MySQL 기본값은 `time_zone=SYSTEM`(= 컨테이너/호스트 TZ)이라,
`DEFAULT CURRENT_TIMESTAMP(3)` 로 채워지는 컬럼에 로컬 벽시계(KST)가 들어가고
그 값이 UTC 로 해석돼 **9시간 미래**로 API 에 나간다(실측으로 잡은 버그다).

- compose 는 이미 `--default-time-zone=+00:00` + `TZ=UTC` 로 못 박아 두었다.
- **관리형 MySQL(RDS 등)을 쓰면 파라미터 그룹에서 `time_zone = UTC` 를 직접 설정하라.**
- 확인:
  ```sql
  SELECT @@global.time_zone, @@session.time_zone;   -- 둘 다 +00:00 이어야 한다
  ```
- `TZ` 환경변수만 바꾸는 것으로는 부족하다(호스트/이미지에 따라 `SYSTEM` 이 흔들린다).

대시보드의 "오늘"은 **서버 로컬 타임존의 자정**을 앱에서 계산해 파라미터로 넘긴다
(`CURDATE()` 를 쓰지 않는다 — 자정 근처에서 서로 다른 날을 가리키기 때문).

---

## 실행 격리 모드 (`RUNNER_EXECUTION_MODE`)

| 모드 | 무엇을 하는가 | 언제 쓰나 |
|---|---|---|
| **`local`** (기본) | 실행마다 새 브라우저 프로세스 + **고유 임시 프로필** | 개발 머신 · CI. 3.5GB Playwright 이미지를 전제하지 않는다 |
| **`docker`** | **실행 1회당 컨테이너 1개** + `--memory` / `--cpus` 커널 수준 제한, `--rm` | **운영 권장** |

docker 모드 준비:

```bash
docker build -f apps/runner/Dockerfile.exec -t testflow/playwright-exec:1.63.0 .
# .env 에서
RUNNER_EXECUTION_MODE=docker
```

docker 모드에서 주의할 점:

- **컨테이너 안에 들어가는 것은 브라우저뿐이다.** 인터프리터 · DB 자격증명 · 실행 변수(계정/비밀번호)는
  호스트에 남는다(`apps/runner/src/execute/container.ts`).
- 변수는 **환경변수가 아니라 stdin JSON** 으로 전달한다 —
  `docker inspect` 나 프로세스 목록에 비밀번호가 남지 않게 하기 위해서다(확인함).
- **대상 사이트가 호스트 로컬이면** `baseUrl` 에 `127.0.0.1` 대신 `host.docker.internal` 을 써야
  컨테이너에서 닿는다.

---

## 배포 전제

### 1) Runner 와 API 는 **같은 호스트**에 두고 `ARTIFACT_ROOT` 를 공유한다

증적 저장소가 로컬 디스크이고 API 가 **Runner 가 쓴 파일을 서빙**하기 때문이다.
(`StorageAdapter` 인터페이스는 있지만 S3 구현체는 만들지 않았다.)

API 는 `storage_key` 를 그대로 fs 경로로 쓰지 않는다 — 형식 검증 + 절대경로 거부 +
resolve 후 root 접두 검사 **3중**으로 막는다(`modules/artifacts/artifacts.path.ts`).

### 2) 녹화 WebSocket 은 **Runner 직결**이다 (nginx 에서 `/rec/` 만 프록시)

API 를 끼우면 프레임마다 홉이 늘어 지연이 배가된다.
API 는 세션 토큰만 발급하고 **Redis 에는 `sha256(token)` 만** TTL 10분으로 둔다
(`testflow:rec:token:<sessionId>`). Runner 가 그 해시로 검증하고, 세션 종료 시 키를 지우면
즉시 접속이 막힌다.

```nginx
server {
  listen 443 ssl;
  server_name testflow.internal;

  # ① 웹 정적 산출물 (apps/web/dist)
  location / {
    root /srv/testflow/web;
    try_files $uri /index.html;        # SPA — 새로고침이 404 가 되지 않게
  }

  # ② API — 같은 오리진이라 CORS 가 등장하지 않는다
  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # ★ SSE — 이게 없으면 실행 현황 이벤트가 몰아서 도착한다
    proxy_buffering off;
    proxy_read_timeout 3600s;
    chunked_transfer_encoding off;
  }

  # ③ 녹화 WebSocket — **Runner 직결**. API 를 거치지 않는다
  location /rec/ {
    proxy_pass http://127.0.0.1:4100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
```

`.env` 에 `RUNNER_WS_PUBLIC_URL=wss://testflow.internal/rec` 를 넣으면
API 가 응답하는 `wsUrl` 이 이 주소를 가리킨다.

### 3) SSE 이벤트 규약

`run:<runId>` 채널 + `run:<runId>:events` 버퍼(Redis List, 최근 500건).
Runner 가 publish 하고 API 가 중계하며 `Last-Event-ID` 재전송이 그 버퍼로 동작한다
(규약 전문은 `packages/contracts/src/events.ts` 의 `RunEventEnvelopeSchema` JSDoc).

**HTTP/1.1 은 오리진당 동시 연결 6개다.** 실행 현황 **상세 화면 1개만** SSE 를 열고
목록형 화면은 폴링한다. 이 규율을 깨면 탭을 몇 개만 열어도 연결이 고갈된다.

### 4) 확장 시 알아 둘 것

**Runner 를 여러 대로 늘리면 녹화가 깨진다.** 녹화 WS 가 Runner 직결이라
**세션–노드 어피니티**(sticky routing)가 필요하다. MVP 는 단일 서버 전제다.
실행(run 큐)만 늘리는 것은 안전하다 — BullMQ 가 알아서 나눈다.

---

## MVP 범위와 미충족 항목

### ★ FR-005 (Secret 암호화, **MUST**) — **미충족**

요구사항은 "계정·비밀번호를 AES-256-GCM 으로 암호화해 저장" 이었다.
**사용자 결정으로 다른 방식으로 대체했다** — **아예 저장하지 않는다.**

- 계정·비밀번호는 **실행 요청 body 로만** 받는다(`POST /api/runs` 의 `variables`).
- 실제 값은 **BullMQ 큐 페이로드에만** 존재하고 job 만료와 함께 사라진다.
- `runs` 테이블에 컬럼 자체가 없다. `project_variables` 테이블도 **만들지 않았다.**
- 녹화 시 `type="password"` 필드는 값을 수집하지 않고 `{{password}}` 참조만 남긴다.
- 남은 요구사항은 "노출 차단"뿐이고 그것이 `mask.ts` 다.

**트레이드오프(정확히 알고 쓰라)**: 실행할 때마다 테스터가 비밀번호를 다시 입력해야 한다.
**저장된 자격증명으로 스케줄 실행을 하는 것은 불가능하다.**
그 기능이 필요해지는 순간 FR-005 를 제대로 구현해야 한다
(`SECRET_ENC_KEY` + `crypto.ts` + `project_variables` 테이블 신설).

### 그 밖의 미충족 / 의도적 제외

| 항목 | 상태 | 이유 |
|---|---|---|
| **인증 · 권한 · 감사 로그** | **없음** | 비회원제 MVP. **사내망 제한이 전제다.** 전환 지점은 `[AUTHZ]` 주석 4곳(projects / scenarios / runs / 신설 project_members) — 전부 NULL 허용 컬럼 추가 + 신규 테이블이라 데이터 파괴 없이 전환된다 |
| 실행 환경 · 테스트 데이터 · 프로젝트 설정 화면 | **라우트 없음** | 사이드바에 비활성으로만 보인다 |
| S3 / MinIO 증적 저장소 | 인터페이스만 | `StorageAdapter` 는 있고 구현체는 로컬 디스크뿐 |
| 스케줄 실행 · CI 연동 | 없음 | Phase 2 |
| Firefox · WebKit | 없음 | `browser` 는 `chromium` 고정 |
| 증적 보존 정책(자동 만료) | 없음 | `artifacts` 에 `expires_at` 추가 + 배치 삭제가 도입 지점. **지금은 디스크가 무한히 찬다** |
| `queued` 실행의 큐 위치 표시 | 미충족 | `RunDetail` 계약에 `queuePosition` 이 없다(`CreateRunResponse` 에만 있어 새로고침하면 사라진다) |
| 다중 사용자 · 다중 탭 동시 관전 | 미측정 | 전부 loopback 단일 탭 측정이다 |
| 접근성 자동 검사(axe) | 미실시 | 수동 확인만 |
| 한글 IME — 마스킹 input 의 `preventDefault` | **부분 미충족** | `keydown` 핸들러는 돌지만 `insertText` 를 취소할 수는 없다. 근거와 개선 경로는 [`poc2-result.md`](.pipeline/20260917-114450/poc2-result.md) |

---

## 고정된 기술 결정

자세한 근거는 [`spike-versions.md`](.pipeline/20260917-114450/spike-versions.md).

| 항목 | 값 | 비고 |
|---|---|---|
| TypeScript | **6.0.3** | 7.0.2 는 typescript-eslint 가 아직 미지원(#10940). 지원되면 즉시 승급 |
| NestJS | 12.0.3 | **순수 ESM.** 상대 import 에 `.js` 확장자 필수 |
| TypeORM | 1.1.1 | `synchronize:false`, 마이그레이션 **명시 배열 등록**(glob 금지) |
| Playwright | 1.63.0 | `page.screencast` 사용 |
| React / Vite / Tailwind | 19.3.0 / 8.3.0 / 4.3.3 | Tailwind 는 `@theme` 토큰. **인라인 CSS · HEX 하드코딩 금지** |
| 패키지 매니저 | yarn 4.18 (node-modules linker) | PnP 아님 — Playwright/Nest 런타임 호환 |
| 테스트 | vitest 5.0.1 | WSL 에서 jest 네이티브 바인딩 문제 회피 |

### DB (`packages/db`)

```bash
yarn build                 # contracts → db 순으로 빌드 (마이그레이션은 컴파일된 JS 로 돈다)
yarn db:migrate            # 마이그레이션 실행
yarn db:revert             # 마지막 1건 되돌리기
```

테이블은 **9개**다 — `projects` / `scenarios` / `test_steps` / `suites` / `suite_scenarios` /
`runs` / `step_results` / `artifacts` / `recording_sessions`.
`project_variables` 는 **의도적으로 없다**(위 FR-005 절).

마이그레이션은 **glob 이 아니라 명시 import 배열**로 등록한다
(`packages/db/src/migrations/index.ts`). 새로 만들면 그 배열 **끝에** 반드시 추가하라.

### 알려진 install 경고 1건 (양성)

```
YN0060: ioredis 6.0.0 doesn't satisfy what typeorm requests (^5.0.4)
```

TypeORM 의 ioredis peer 는 optional 이고 Redis **쿼리 캐시 전용**이다. 우리는 쓰지 않는다.
BullMQ 6 은 ioredis `>=5.0.0` 을 명시 지원하므로 문제 없다.

---

## 보안 규약

- **`.env` 는 커밋하지 않는다.** `.env.example` 만 관리한다.
- 계정·비밀번호는 **실행 요청 body 로만** 받는다. DB 에 영구 저장하지 않는다.
- 마스킹은 `apps/api/src/common/utils/mask.ts` 를 단일 규칙으로 하고
  **① API 응답 ② 서버 로그 ③ `step_results.error_message` ④ SSE 이벤트** 네 경로 모두에서 건다.
  Playwright 에러 메시지에 입력값이 그대로 실려 나오는 형태가 여러 가지다
  (`locator.fill` 타임아웃의 call log, `expect().toHaveValue()` 의 기대/실제, `waiting for locator(...)` …).
  - Runner 는 `apps/runner/src/mask.ts` 에 **같은 규칙의 문자열 경로만** 따로 두고 있다
    (앱끼리 import 하지 않기 때문). **다음 작업 권고**: `mask.ts` 를 `packages/contracts` 로
    승격해 한 파일로 합칠 것.
- 녹화 시 `type="password"` 필드는 값을 수집하지 않고 `{{password}}` 참조로만 남긴다.
- **CSS Selector 는 테스터 화면에 노출하지 않는다**(`?advanced=1` 전용).
- PR 을 올리기 전에 `.env`·비밀번호·사내 URL 이 diff 에 없는지 확인하라.

---

## 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `db:migrate` 가 "로컬이 아닙니다" 로 거부 | 셸의 회사 `DB_HOST` 가 `.env` 를 덮었다. `env -u DB_HOST -u DB_USER -u DB_PW -u DB_PORT -u DB_NAME yarn db:migrate` |
| `health` 의 `runner` 가 `down` | Runner 프로세스가 없다. 실행 요청은 `queued` 로 쌓이고 Runner 를 띄우면 자동으로 이어진다 |
| 녹화 시작 버튼이 비활성 | 같은 이유(Runner heartbeat 없음). 모달/패널에 안내가 뜬다 |
| 녹화 WS 가 close code **4401** | 세션 토큰이 틀렸거나 만료(TTL 10분). 세션을 다시 만든다 |
| 시각이 **9시간 미래** | MySQL `time_zone` 이 UTC 가 아니다. [타임존](#타임존) 절 참조 |
| 실행 현황 이벤트가 몰아서 도착 | nginx `proxy_buffering off` 가 빠졌다 |
| docker 모드에서 대상에 못 닿음 | `baseUrl` 의 `127.0.0.1` 을 `host.docker.internal` 로 |
| WSL 에서 `docker` 명령을 못 찾음 | `RUNNER_DOCKER_BIN=docker.exe` |
| 새로고침하면 404 | nginx `try_files $uri /index.html` 이 빠졌다 (SPA 라우팅) |
| `vite build` 가 500KB 경고 | 해결됨 — 라우트 단위 `React.lazy` 로 분할했다(`apps/web/src/routes/routes.tsx`) |
