# 18 · 에러 핸들링 — 흰 화면과 "영원히 실행 중"을 없앤다

브랜치 `feat/error-handling` (워크트리 `../testflow-err`). **push 하지 않았다.**

실측 환경: 로컬 `docker compose`(MySQL 8.4 · Redis) · API `:4001` · Runner WS `:4101`
(`RUNNER_ID=err-runner-A`) · 웹 preview `:4291`. 배포 서버·운영은 건드리지 않았다.
같은 레포에서 다른 에이전트가 기본 포트(`:4000`/`:4173`)를 쓰고 있어 **포트만 비켜 잡았다.**

---

## 0. 한 줄 요약

| # | 공백 | 지금 |
|---|---|---|
| ① | ErrorBoundary 0건 → 렌더 예외 = 흰 화면 | **경계 3겹**. 라우트 경계는 사이드바를 살린 채 본문만 교체하고 "다시 시도"로 그 자리에서 복구된다 |
| ② | 프로세스 레벨 핸들러 0건 | API·Runner 둘 다 `unhandledRejection`/`uncaughtException` → **마스킹 로그 + graceful 종료** |
| ③ | stale run 회수 장치 0건 | **heartbeat 부재 기준 회수** — 실측 **죽인 뒤 58.2초**에 `error` 확정 + SSE 도달 + 삭제 가능 |
| ④ | 전역 예외 필터 없음(의도된 결정) | 응답은 **안전했다**(`{"statusCode":500,"message":"Internal server error"}`). 다만 그 영어 문구가 화면의 유일한 영어였어서 **표시하는 쪽에서** 한국어로 바꿨다 |

실측 도중 **설계에 없던 구멍 3개**를 발견해 같이 막았다 — §3.1(라우터 기본 errorElement가
스택을 뿌린다) · §5.2(마스킹이 스택에서 새어 나간다) · §7(회수한 run 이 BullMQ 재배달로
되살아난다). 셋 다 "실제로 망가뜨려 보지 않았으면 몰랐을" 것들이다.

---

## 1. ★ stale run 회수 — 판정 기준 · 주체 · 확정 상태

### 1.1 판정 기준 — **heartbeat 부재가 1차, 경과 시간은 2차**

```
회수 대상  ⟺  runs.status = 'running'
             AND  heartbeat 키(testflow:runner:heartbeat:<runner_id>) 가 없다
             AND  now - (started_at ?? queued_at) ≥ RUN_STALE_GRACE_MS(60초)
```

* **경과 시간을 1차 기준으로 쓰지 않았다.** 그렇게 하면 `RUNNER_RUN_TIMEOUT_MS`(기본 300초)와
  반드시 충돌한다 — 그 값보다 짧으면 정상 실행을 죽이고, 길면 회수가 늦다. 한도를 API 가
  자기 env 에서 읽는 것도 금지다(설정이 두 벌이 되어 화면이 조용히 거짓말한다 —
  `runs.service.readRunnerCapacity()` 가 세운 규율).
* **heartbeat 는 Runner 프로세스가 10초마다 갱신**한다. 실행이 아무리 길어도 프로세스가
  살아 있으면 키가 있다. 그래서 이 조건 하나로 §2 의 음성 검증이 성립한다.
* 유예 60초 = **heartbeat TTL(30초) × 2**. 갱신을 한 번 걸러도(Redis 순단), Runner 가 job 을
  집어 `running` 으로 바꾼 직후 첫 heartbeat 전이어도 오탐하지 않는다.
* 주기 15초. 따라서 **죽은 뒤 확정까지의 이론 상한 = 유예 60초 + 주기 15초 ≈ 75초.**
* `queued` 는 **대상이 아니다.** 큐 job 은 Redis 에 남아 있어 Runner 가 다시 뜨면 그대로
  집어 간다. 회수하면 멀쩡히 실행될 예약을 죽이는 셈이다.

상수는 전부 `packages/contracts/src/events.ts` 한 곳에 있다(API·Runner 공유).

### 1.2 누가 회수하나 — **둘 다.** 서로의 사각지대를 덮는다

| 주체 | 잡는 것 | 못 잡는 것 |
|---|---|---|
| **API 주기 작업** `StaleRunReaper` (1차) | Runner 가 **다시 뜨지 않아도** 회수된다 | `RUNNER_ID` 를 고정한 Runner 가 **유예 안에 재기동**하면 heartbeat 가 되살아나 영영 못 잡는다 |
| **Runner 기동 정리** `reclaimOwnOrphanRuns()` (2차) | 정확히 위 경우 — `runner_id` 가 나 자신인 `running` run | Runner 가 안 뜨면 영원히 안 돈다 |

회수 주체는 **죽는 쪽과 다른 프로세스**여야 하므로 API 가 1차인 것이 핵심이다.
컨테이너·systemd 의 자동 재시작 속도가 정확히 유예(60초) 안이라 2차도 실제로 필요하다.

`@nestjs/schedule` 을 쓰지 않았다(**런타임 의존성 추가 금지**). 주기 작업이 하나뿐이라
`setInterval` + `unref()` 로 충분하고, `onApplicationShutdown` 에서 해제한다.

### 1.3 확정 상태 — `error`

`failed` 는 "테스트가 틀렸다", `timeout` 은 "제한 시간을 넘겼다" 이고 **둘 다 사실이 아니다.**
시나리오가 아니라 **실행 환경이 무너진** 것이므로 `error` 다(라운드 1 결정 6번의 구분).

`errorMessage` 는 사람이 읽을 이유다:

* API 회수: `Runner 와 연결이 끊겨 실행 결과를 확인할 수 없습니다. 실행을 다시 시도해 주세요.`
* Runner 기동 정리: `Runner 가 재시작되어 실행이 중단되었습니다. 실행을 다시 시도해 주세요.`

같이 하는 일: 끝나지 않은 스텝(`pending`/`running`) → `skipped`(끝난 실행에 "대기 중"
스텝이 남지 않게), `scenarios.last_run_id` 갱신, 큐 job 제거 시도, **SSE 2건 발행**
(`run.status` → `run.finished`, `#5` 의 `INCR seq` → 버퍼 → `PUBLISH` 규약 그대로).
증적(`artifacts`)은 손대지 않는다 — Runner 가 죽기 전 flush 한 것이 있으면 그대로 남는다.

### 1.4 ★ 실측 — Runner 를 `SIGKILL` 로 죽였다 (API 회수 경로)

시나리오 `ERR-LONG90b`(코드 · `waitForTimeout(90000)` · docker 격리).

```
+0.1s   run 생성 109f35ad… (RUN-0281)
+0.1s   SSE run.status → running (runnerId=err-runner-A)
+15.2s  ★★ Runner(pid=45512) SIGKILL   ← 그 시점 run.status=running
+16.2s … +71.3s   GET /runs/:id → status=running   (5초 간격 폴링, 계속 running)
+73.4s  SSE run.status  → error
+73.4s  SSE run.finished → status=error  durationMs=73339
                         errorMessage="Runner 와 연결이 끊겨 실행 결과를 확인할 수 없습니다. …"
+74.3s  GET /runs/:id   → status=error  (+ 같은 메시지)
+74.3s  DELETE /runs/:id → 204          ← 이전에는 409 로 막혔다
```

API 로그: `[StaleRunReaper] WARN 고아 실행 회수 — RUN-0281 (runner=err-runner-A) → error`

**ⓐ 몇 초 뒤**: 죽인 지 **58.2초**(run 시작 기준 +73.4s). 이론 상한 75초 안이다.
분해하면 heartbeat 만료 ~30초 + 유예 60초(시작 기준) + 주기 15초 안의 첫 tick.
**ⓑ 어떤 상태로**: `error`. **ⓒ 어떤 메시지와 함께**: 위 한국어 한 문장.
**SSE 도달**: `run.status` · `run.finished` 둘 다 클라이언트까지 도달했다(위 로그는 실제 SSE
스트림을 붙여 받은 것이다). 화면은 `useRunEvents` 가 `run.finished` 에서 전체 재조회까지 한다.
**삭제**: 204.

### 1.5 ★ 실측 — Runner 기동 정리 경로 (같은 `RUNNER_ID` 로 즉시 재기동)

```
+0s    run 생성 ba401be9… (RUN-0282), status=running runner=err-runner-A
+12s   ★★ Runner(pid=54250) SIGKILL
+12s   같은 RUNNER_ID 로 즉시 재기동  ← heartbeat 가 되살아나므로 API 회수는 이 run 을 못 잡는다
+16s…+31s  status=running
+34s   status=error | "Runner 가 재시작되어 실행이 중단되었습니다. 실행을 다시 시도해 주세요."
       DELETE → 204
```

Runner 로그: `고아 실행 회수 — RUN-0282 (이전 생이 남긴 실행) → error` · `고아 실행 1건을 error 로 확정했다.`

죽인 지 **22초** — Runner 가 DB 에 붙고 Worker 를 만들기 **전에** 도는 절차라 재기동 시간이
곧 회수 시간이다. 이 경로가 없었다면 이 run 은 **영원히 `running`** 이었다(heartbeat 가
살아 있으므로 API 회수의 1차 조건이 영원히 거짓이다).

---

## 2. ★★ 음성 검증 — 정상적으로 오래 도는 실행을 죽이지 않는다

**이것이 이번 작업에서 가장 중요한 검증이다.** 정상 실행을 죽이는 회수 장치는 없는 것보다 나쁘다.

같은 시나리오(`waitForTimeout(90000)`, `test.setTimeout(150000)`)를 **Runner 를 죽이지 않고**
그대로 돌렸다. 유예(60초)의 **1.7배**, heartbeat TTL(30초)의 **3.4배**를 도는 실행이다.

```
+0.1s    run 생성 243d9083… · SSE run.status → running
+1.1s    status=running
 …       (5초 간격으로 20회 폴링 — 전 구간 running)
+61.2s   status=running   ← 유예(60초)를 넘겼다. 여기서 회수됐다면 실패였다
+71.3s   status=running
+96.3s   status=running
+101.0s  SSE artifact.ready (video)
+102.3s  SSE run.finished → status=passed  passedSteps=3/3  durationMs=102170  errorMessage=null
+102.3s  GET /runs/:id → status=passed
```

**회수되지 않고 끝까지 갔다.** 그 사이 API 로그에 `고아 실행 회수` 는 **0건**이다.
(회수 주기는 15초라 유예 초과 후에도 **3회** 이상 훑었고, 매번 heartbeat 가 있어 걸러졌다.)

단위 테스트로도 고정했다 — `apps/api/src/modules/runs/runs.reaper.spec.ts`:

```
★ 음성 검증: Runner 가 살아 있으면 아무리 오래 돌아도 회수하지 않는다
  → started_at + 1시간(하드 타임아웃 300초의 12배) · heartbeat 있음 → isStaleRun = false
```

Redis 조회가 실패할 때도 **"아무도 살아 있지 않다"로 단정하지 않는다** —
그 순간 전 run 이 회수 대상이 되어 정상 실행을 몰살한다. 실패하면 전부 "살아 있다"로 본다
(`aliveRunnerIds()`).

---

## 3. ErrorBoundary — 범위와 react-query 에러의 경계

### 3.1 ★ 실측으로 설계가 바뀌었다 — 경계는 **2겹이 아니라 3겹**이어야 했다

처음 설계는 "루트 1개 + 라우트마다 1개" 였다. 셸(`AppShellRoute`)이 렌더 중 던지는 상황을
임시 코드로 실제로 만들어 봤더니 **루트 경계까지 오지 않았다.**
`react-router` 가 **자기 기본 errorElement** 로 먼저 잡고 이렇게 뿌렸다(실측 본문 원문):

```
Unexpected Application Error! 의도적 셸 렌더 예외 — 루트 ErrorBoundary 실측용 임시 코드
Error: 의도적 셸 렌더 예외 — 루트 ErrorBoundary 실측용 임시 코드
    at MS (http://127.0.0.1:4291/assets/index-CeEnBV9p.js:104:3365)
    at os (http://127.0.0.1:4291/assets/vendor-react-p8dv98dL.js:8:49211)
    at Xc (…)
```

흰 화면은 아니지만 **영어 + 스택 트레이스 전문**이다 — "스택을 사용자에게 보여 주지 마라"를
정면으로 깬다. 라우터의 기본값을 이기는 방법은 **우리 `errorElement` 를 주는 것 하나뿐**이라
`RouteErrorElement` 를 한 겹 더 뒀다. 고친 뒤 같은 URL:

```
! 화면을 그리지 못했습니다
이 화면을 그리는 중 오류가 생겨 내용을 표시할 수 없습니다. 다시 시도해도 같다면 새로고침해 주세요.
[새로고침]  [대시보드로]
```
(`r18-boundary-03-root-throw.png`)

### 3.2 최종 구조

| 겹 | 어디 | 무엇을 잡나 | 화면 |
|---|---|---|---|
| ① 라우트 경계 (`ErrorBoundary` 클래스) | `routes.tsx` 의 `withSuspense` — `Suspense` **바깥** | 각 화면의 렌더 예외 · **청크 로드 실패** | 셸 유지, **본문만** 교체 |
| ② `RouteErrorElement` | 루트 라우트의 `errorElement` | 셸(`AppShellRoute`) 렌더 예외 | 화면 전체 |
| ③ 루트 경계 (`ErrorBoundary` 클래스) | `App.tsx`, `RouterProvider` **바깥** | `QueryClientProvider`·라우터 생성 자체의 실패 | 화면 전체 |

* **`errorElement` 하나로 통일하지 않은 이유**: `errorElement` 는 벗어날 방법이 **다른 경로로의
  내비게이션뿐**이다. 같은 경로로 다시 가도 리셋되지 않아 **"다시 시도" 한 번으로 그 자리에서
  복구**하는 동작을 만들 수 없다. 화면 하나가 깨졌을 때 가장 흔한 회복이 그것이므로 ①은
  클래스 경계다. ②는 문서를 통째로 다시 받는 것이 정답인 자리라 그 제약이 문제가 안 된다.
* **경계가 `Suspense` 바깥**이다. `lazy()` 의 청크 404(배포 직후 흔하다)는 Suspense 가 아니라
  그 바깥으로 던져진다. 안쪽에 두면 못 잡는다. 그 경우만 문구가 다르다 —
  "새 버전이 배포되어 …" + **[새로고침]**(재시도로는 절대 낫지 않는다).
* `resetKey={location.key}` — **다른 화면으로 가면 에러 상태가 저절로 풀린다.** 없으면 한 번
  깨진 경계가 이후 모든 라우트를 덮는다(경계는 언마운트되지 않고 element 만 바뀌기 때문).
* 링크는 `<Link>` 가 아니라 `<a href="/">` 다. 루트 경계는 라우터 바깥이라 `<Link>` 가 던지고,
  라우트 경계에서도 깨진 모듈 상태를 버리는 쪽이 확실하다.
* **스택은 `import.meta.env.DEV` 에서만** `<details>` 안에 접어 보여 준다. 운영 번들에서는
  그 분기가 통째로 제거된다. 운영에서도 `console.error("[ErrorBoundary]", …)` 는 남긴다.

### 3.3 ★ 실측 — 라우트 경계

`/runs?boom=1` 에 임시 렌더 예외를 심었다 (`r18-boundary-01-render-throw.png`).

```
[boundary] 01-render-throw (/runs?boom=1)  sidebar=살아있음
본문: … 기본 프로젝트 / 실행 현황  ＋ 새 시나리오
      ! 화면을 그리지 못했습니다
      이 화면을 그리는 중 오류가 생겨 내용을 표시할 수 없습니다. 다시 시도해도 같다면 새로고침해 주세요.
      [다시 시도] [대시보드로]
경계 블록: 1   사이드바 살아있나: 1
사이드바로 /scenarios 이동 → 이동 후 에러 블록 남았나: 0   ← resetKey 가 동작한다
```
(`r18-boundary-02-after-navigate.png`)

**흰 화면 아님 · 사이드바·탑바·브레드크럼 생존 · 한국어 한 줄 · 재시도/대시보드 경로 존재 ·
스택 없음.** 확인 후 임시 코드는 **삭제했다**(§9.4 에 잔재 0건 확인).

### 3.4 react-query 에러와의 경계 — **대체하지 않는다**

`createQueryClient()` 는 `throwOnError` 를 켜지 않는다. 따라서 **쿼리 실패는 경계로 오지 않고**
각 화면이 `StateView`(tone=error) + `refetch` 로 그린다. 그 경로가 더 낫다 — 화면 골격이
유지되고 재시도가 **그 쿼리만** 다시 돈다. 경계로 바꾸면 화면이 통째로 날아가고 재시도가
전체 리마운트가 된다.

| 예외가 난 곳 | 누가 처리하나 | 사용자가 보는 것 |
|---|---|---|
| react-query 쿼리(=API 호출) 실패 | 각 화면의 `StateView` (기존) | 패널 안 오류 + [다시 시도] |
| 컴포넌트 **렌더 중** 예외 | ErrorBoundary ①/③ | 본문(또는 화면) 교체 + [다시 시도] |
| 셸 렌더 중 예외 | `RouteErrorElement` ② | 화면 교체 + [새로고침] |
| `lazy()` 청크 로드 실패 | ErrorBoundary ① | 본문 교체 + [새로고침] |
| **이벤트 핸들러 · 타이머 · await 안 된 Promise** | `lib/global-errors.ts` (§4) | **토스트**(화면은 그대로) |

---

## 4. ★ 렌더 밖의 예외 — `window.onerror` / `unhandledrejection`

ErrorBoundary 는 **렌더 중 예외만** 잡는다. 아래 셋은 예전에 **아무 흔적 없이 삼켜졌다** —
버튼을 눌렀는데 아무 일도 안 일어나고 콘솔에만 빨간 줄이 남는 상태다.

`installGlobalErrorHandlers()` 를 `main.tsx` 가 **React 렌더보다 먼저** 부른다.

실측(`r18-handlers-01-window-error.png`, `r18-handlers-02-unhandledrejection.png`):

```
① setTimeout 안에서 throw    → 토스트: "오류 처리 중 예상치 못한 오류가 발생했습니다. 다시 시도해 주세요."
② await 되지 않은 rejection  → 같은 토스트
③ 대시보드 본문 유지: true    ← 화면을 대체하지 않는다. 동작 하나가 실패한 것이므로
콘솔: [uncaught] Error: 이벤트 핸들러 안에서 터진 예외(검증용)  ← 원문은 콘솔에만
      [unhandledrejection] Error: 아무도 catch 하지 않은 rejection(검증용)
```

설계 선택:

* **토스트로만 알린다.** 화면을 통째로 대체하면 멀쩡히 보이던 데이터까지 날아간다.
* **원문(영어 스택)은 화면에 싣지 않는다.** 콘솔로만 보낸다.
* **중복 억제 2가지** — ⓐ `ErrorBoundary.componentDidCatch` 가 `markErrorHandled()` 로 표시해
  "화면 대체 + 토스트"가 겹치지 않게 하고(React 는 개발 모드에서 경계가 잡은 예외를 `window`
  로 한 번 더 흘린다), ⓑ 같은 메시지는 4초 창 안에 한 번만 — 매 프레임 던지는 타이머가
  토스트 폭풍을 만들지 않게.
* **리소스 로드 실패**(`<img>`·`<script>`; `event.error` 가 없다)는 거른다. 이미지 하나 깨졌다고
  오류 팝업을 띄우지 않는다.

`apps/web/src/lib/global-errors.spec.ts` 11건이 이 규칙을 고정한다.

---

## 5. 프로세스 레벨 핸들러 — 왜 "계속 돌기"가 아니라 "종료"인가

### 5.1 근거

`process.on("uncaughtException")` 으로 잡고 **계속 도는 것이 가장 흔한 실수**다.
그 시점의 프로세스는 **중간에서 끊긴 상태**다.

* **API**: 커밋도 롤백도 안 된 TypeORM 트랜잭션 / `writeHead()` 까지만 나간 SSE 응답 /
  리스너만 붙은 ioredis 구독. 그 상태로 다음 요청을 받으면 **조용한 데이터 오염**이 된다 —
  흰 화면보다 훨씬 나쁘다.
* **Runner**: 상태가 프로세스 밖으로 뻗어 있다 — Playwright 브라우저 · docker 컨테이너 ·
  임시 작업공간 · BullMQ job lock. 다음 job 을 받으면 **증적이 섞이거나 컨테이너가 누수**된다.

종료를 택하면 손실은 "그 순간"으로 끝나고, 프로세스 관리자(pm2 / systemd `Restart=always` /
docker `restart: unless-stopped`)가 깨끗한 프로세스를 다시 띄운다.
**복구는 재시작이 하고, 우리가 하는 일은 "왜 죽었는지 남기고 곱게 닫는 것"이다.**

그리고 이번 작업에서 **그 "손실"조차 회수된다** — 죽는 순간 돌던 run 은 ②
`worker.close()` 의 graceful 경로로 증적을 남기고, 못 끝내면 §1 의 회수 장치가
`error` 로 확정한다. 세 갈래가 여기서 맞물린다.

**Runner 는 새 종료 절차를 만들지 않았다.** `setupShutdown()` 이 돌려주는 `terminate` 를
신호 핸들러와 예외 핸들러가 **같이 쓴다**. 그래야 `worker.close()` → 중단 시
**#13 이 만든 graceful 종료(`RUNNER_GRACEFUL_STOP_MS`, 기본 10초)** 를 거쳐 Playwright 가
영상·trace 를 완성한다. 여기서 `process.exit(1)` 을 바로 불렀다면 그 증적이 통째로 사라진다.
정리가 매달릴 때만 강제 종료한다(API 5초 · Runner `gracefulStopMs + 20초`).

### 5.2 ★ 실측 — 그리고 마스킹 구멍 하나를 잡았다

임시 엔드포인트로 `password="hunter2"` 가 실린 rejection 을 만들었다.

**1차 실측 (구멍 발견)**

```
ERROR [ProcessGuard] 처리되지 않은 Promise rejection — 프로세스를 종료합니다:
        처리되지 않은 rejection 검증: password="••••••••"      ← 메시지는 가려졌다
Error: 처리되지 않은 rejection 검증: password="hunter2"         ← ★ 스택 첫 줄에 그대로 남았다
    at Timeout._onTimeout (…/health.controller.js:39:33)
```

`error.stack` 의 첫 줄은 `Error: <message>` 라서 **메시지만 가리면 바로 아래 줄에서 샌다.**
`safeStack()` 으로 스택에도 마스킹을 걸었다.

**2차 실측 (수정 후)**

```
ERROR [ProcessGuard] 처리되지 않은 Promise rejection — 프로세스를 종료합니다:
        처리되지 않은 rejection 검증: password="••••••••"
Error: 처리되지 않은 rejection 검증: password="••••••••"        ← 가려졌다
    at Timeout._onTimeout (…)
--- 프로세스 살아있나 --- 죽었다(의도대로)
```

**Runner 도 같은 방식으로 실측**(임시 `RUNNER_BOOM_MS`):

```
[runner] 처리되지 않은 Promise rejection: 처리되지 않은 rejection 검증: password="••••••••"
[runner] 처리되지 않은 Promise rejection — 종료 절차 시작
[runner] 종료 신호 수신 — 진행 중인 실행을 마치고 정리합니다.   ← 기존 graceful 경로를 그대로 탔다
[runner] 정리 완료.
--- alive? --- 죽었다(의도대로)
--- heartbeat 키 남았나 --- (없음)                              ← 정리까지 끝냈다
```

**왜 새 마스킹 함수가 필요했나**: 기존 값 기반 마스킹(`maskErrorMessage` / `maskSecretText`)은
**그 run 의 평문 값 목록을 알 때만** 동작한다. 프로세스 레벨 핸들러는 **어느 run 의 예외인지
알 수 없는 지점**이라 목록이 언제나 비어 있고, 실제로 아무것도 가려지지 않았다.
그래서 `maskSecretsInText()`(contracts)를 더했다 — 자유 텍스트에서 `password=…` ·
`"token":"…"` · `Authorization: Bearer …` 같은 **모양**을 찾아 값만 지운다.
**보조 방어선이지 대체재가 아니다** — 키 이름이 없는 값(Playwright 의
`input[value='hunter2']`)은 여기서 안 잡히고, 그건 값 목록을 아는 경로(SSE·DB 저장)가 잡는다.
그 한계를 테스트로도 명시해 뒀다(`run.spec.ts`).

---

## 6. ④ 예상치 못한 예외가 사용자에게 어떻게 보이나 — 점검 결과

### 6.1 API 응답 — **안전했다**

임시 엔드포인트 2개를 만들어 확인하고 **지웠다**.

| 경로 | 응답 |
|---|---|
| 일반 `throw new Error('내부 실패: password="hunter2" token=abc123 at /srv/…/dist/x.js')` | `{"statusCode":500,"message":"Internal server error"}` |
| 드라이버 예외 `SELECT * FROM 존재하지않는테이블 WHERE secret_col='hunter2'` | `{"statusCode":500,"message":"Internal server error"}` |

**스택 · SQL · 비밀값 · 파일 경로 전부 응답에 없다.** 라운드 1의 "커스텀 exception filter 를
만들지 않는다"는 결정은 **옳았고, 그래서 그대로 뒀다.**

⚠️ **다만 서버 로그에는 TypeORM 이 실패 쿼리를 통째로 찍는다** — 위 실측에서
`sql: "SELECT * FROM 존재하지않는테이블 WHERE secret_col = 'hunter2'"` 가 그대로 남았다.
이건 프로세스 가드가 아니라 **Nest 의 요청 예외 로깅 경로**이고, 우리 코드의 쿼리는 전부
바인딩 파라미터(`?`)를 쓴다(그 실측은 값을 일부러 인라인한 임시 쿼리였다. 같은 로그의
`parameters:` 는 `undefined` 였다). **이번 범위에서 고치지 않았다** — §9.5 미검증에 남긴다.

### 6.2 화면의 영어 문구 두 개를 없앴다

실측하다 보니 **화면에 남은 영어는 딱 둘**이었다. 서버를 고칠 일이 아니라(응답 포맷은 그대로
두는 것이 맞다) **표시하는 쪽**에서 닫았다.

| 상황 | before(실측 본문) | after |
|---|---|---|
| API 미기동 | `! 서버에 연결하지 못했습니다` / **`Failed to fetch`** | `네트워크 또는 API 서버 연결이 끊겼습니다. 서버 상태를 확인한 뒤 다시 시도해 주세요.` |
| DB 정지(500) | `! 서버에 연결하지 못했습니다` / **`Internal server error`** | `서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.` |

* `toNetworkError()` — fetch 자체가 거부한 경우를 `ApiError(0, …)` 로 감싼다.
  **`AbortError` 는 그대로 던진다**(취소는 고장이 아니다 — 감싸면 화면을 떠날 때마다
  오류가 뜬다). `status=0` 이라 `queryClient` 의 4xx-비재시도 규칙에 걸리지 않아
  **네트워크 실패는 그대로 2회 재시도**된다(잠깐 끊긴 경우 저절로 낫는다).
* `toApiError()` — **Nest 기본 문구(`Internal server error`)일 때만** 바꾼다. 서버가 준 다른
  메시지(예: `진행 중인 실행은 삭제할 수 없습니다 (RUN-0281, status: running).`)는 그대로 쓴다.
  지어낸 문구로 진짜 원인을 덮지 않는다. 테스트로 고정했다.

### 6.3 ★ DB 정지 (`docker stop testflow-mysql`)

`GET /api/health` → `{"status":"degraded","db":"down","redis":"ok","runner":"ok"}`

| 화면 | 사이드바 | StateView | 스켈레톤 | 에러블록 | 본문 |
|---|---|---|---|---|---|
| 대시보드 | 살아있음 | 1 | 0 | 0 | `! 서버에 연결하지 못했습니다` / `서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.` / `[다시 시도]` |
| 실행 현황 | 살아있음 | 1 | 0 | 0 | 동일 |
| 테스트 시나리오 | 살아있음 | 1 | 0 | 0 | 동일 |

**흰 화면 없음 · 무한 로딩 없음**(스켈레톤 0 = 로딩 상태에 갇히지 않았다) · ErrorBoundary 로
번지지 않음(에러블록 0 = 의도한 경계 분리대로다).
스크린샷 `r18-dbdown-0{1,2,3}-*.png`.

**복구**: `docker start` → health `ok` → 세 화면 + 스위트까지 전부 정상, **콘솔 에러 0건**
(`r18-recovered-0{1..4}-*.png`). 새로고침 외 조작 없이 회복된다.

### 6.4 ★ API 미기동 (가장 흔한 상황)

| 화면 | 사이드바 | StateView | 스켈레톤 | 에러블록 | 본문 |
|---|---|---|---|---|---|
| 대시보드 / 실행 현황 / 시나리오 | 살아있음 | 1 | 0 | 0 | `! 서버에 연결하지 못했습니다` / `네트워크 또는 API 서버 연결이 끊겼습니다. 서버 상태를 확인한 뒤 다시 시도해 주세요.` / `[다시 시도]` |

콘솔에는 `net::ERR_CONNECTION_REFUSED` 만 남는다(브라우저가 찍는 것으로, 우리가 없앨 수 없다).
스크린샷 `r18-apidown-0{1,2,3}-*.png`.

---

## 7. ★ 실측이 아니었으면 몰랐을 것 — 회수한 run 이 되살아났다

회수 직후 Runner 를 다시 띄웠더니 이런 로그가 찍혔다:

```
[runner] run 1b624b45… 시작 (코드) — long.spec.ts 375자
[runner]   [격리] docker — 컨테이너 testflow-code-109f35ad-…
```

**이미 `error` 로 확정했고 한 건은 행까지 지운 run 2건을 그대로 집어 들었다.**
BullMQ 는 Worker 가 죽으면 lock 만료 후 그 job 을 **stalled 로 재배달**하는데,
회수 쪽에서 부르는 `job.remove()` 는 **lock 이 걸린 active job 의 삭제를 거부**하기 때문이다.
그대로 두면 `error` → `running` → `passed` 로 **상태가 뒤로 간다**(04-gen-5 이슈 4번과 같은 부류).
행이 지워진 run 은 `step_results` INSERT 가 FK 위반으로 터진다.

**최종 방어선을 실행 직전으로 옮겼다** — Worker 앞단에서 DB 한 줄을 읽고,
행이 없거나 이미 종료 상태면 job 을 버린다. 결정적으로 재현해 확인했다
(같은 `jobId` 로 큐에 재투입):

```
[runner] run RUN-0281 은 이미 error 다 — 재배달된 job 을 버린다.
[runner] run 00000000-1111-… 행이 없다(삭제됨) — 재배달된 job 을 버린다.
→ GET /runs/RUN-0281 : status=error (그대로 유지, 되살아나지 않는다)
```

회수 쪽의 `job.remove()` 도 남겨 뒀다 — 아직 `waiting`/`delayed` 인 job 을 일찍 치운다.

---

## 8. 중복 회수 방지

**2겹이고, 정확성의 근거는 2번이다.**

1. **Redis 락** `SET testflow:reaper:runs:lock <token> PX 60000 NX` — API 인스턴스가 여러 대여도
   한 번에 한 대만 훑는다. 해제는 **토큰이 같을 때만**(남의 락을 풀지 않는다). 락은 **중복
   작업을 줄이는 최적화**일 뿐이다.
2. **조건부 UPDATE** `UPDATE runs … WHERE id = ? AND status = 'running'` →
   `affected === 0` 이면 그 사이 누군가(Runner 의 지연된 보고 · 다른 API · 사용자 취소)가 이미
   확정한 것이므로 **스텝 정리도 SSE 발행도 하지 않고 조용히 넘어간다.**
   **락을 못 잡아도 상태가 두 번 확정되거나 SSE 가 두 번 나가지 않는다.**
   API 회수와 Runner 기동 정리가 **같은 근거**를 쓰므로 둘이 동시에 돌아도 안전하다.
   `sweeping` 플래그로 같은 인스턴스의 tick 중첩도 막는다.

실측에서 `RUN-0281` 이 API 로그에 두 번 보이지만 **다른 run 이다** — 앞의 run 을 삭제하면서
`RUN-` 일련번호가 재사용됐다(`run_code` 는 `MAX(...)+1` 채번이라 삭제 후 빈다). 같은 run 이
두 번 회수된 사례는 없었다.

---

## 9. 회귀 · 기준선 · 번들 · 파일

### 9.1 회귀 (API 실측 · 실제 실행 13건)

```
✅ 시나리오 생성 + 코드 저장 — TC-GEN-098
✅ ① 실행 → 종료 확정 — status=passed 7873ms
✅ ① 스텝 동기화(모든 스텝이 종료 상태) — steps=passed,passed
✅ ① 증적 — 1건
✅ ② 라이브 스트림 토큰 발급 — HTTP 200
✅ ② 취소 요청 — HTTP 200
✅ ② 취소 확정 — status=cancelled
✅ ③ 재실행 — status=passed
✅ ③ 종료된 실행 삭제 — HTTP 204
✅ ④ 진행 중 삭제 거부(409 유지) — HTTP 409     ← #16 의 규칙이 그대로다
✅ ⑤ 녹화 세션 생성 — POST /scenarios/:id/recordings → 200 + wsUrl(토큰 포함)
✅ ⑥ 큐 상태 — {"waiting":0,"active":0,"concurrency":2,"runners":1,…}
✅ ⑥ health — {"status":"ok","db":"ok","redis":"ok","runner":"ok"}
```

화면 회귀: 대시보드 · 실행 현황 · 테스트 시나리오 · 테스트 스위트 정상 렌더,
**브라우저 콘솔 에러 0건**(`r18-normal-0{1..4}-*.png`). 의도적으로 유발한 것만 콘솔에 남았다.

### 9.2 기준선

| 항목 | before | after |
|---|---|---|
| `pnpm typecheck` | 7/7 | **7/7** |
| `pnpm lint` | 0 problems | **0 problems** |
| `pnpm build` | 5/5 · 500KB 경고 없음 | **5/5 · 500KB 경고 없음** |
| `pnpm test` | 751 (contracts 214 · runner 253 · web 126 · api 158) | **793** (contracts 221 · runner 253 · web 147 · api 172) — 이 브랜치가 더한 것은 **+40건**이고, 나머지 +2 는 rebase 로 따라온 `main`(#17)의 가이드 테스트다 |
| `apps/web/src` 스타일 값 HEX | 0건 | **0건** (31건은 전부 시안 스펙을 적은 **주석**. 새 파일은 HEX 0) |
| `style={{` | 2건 | **2건** |
| 새 색 토큰 | — | **0개** (기존 `danger`·`muted`·`hint`·`line`·`bg` 만 씀) |
| 새 런타임 의존성 | — | **0개** |
| 마이그레이션 | — | **0건** (스키마 변경 없이 해냈다) |

`pnpm test` 는 `pnpm build` 뒤에 돌려야 한다 — `code-workspace.spec.ts` 가 `dist/` 산출물
존재를 검사한다(기준선에서도 같다).

### 9.3 번들 (초기 로드)

| 청크 | before | after |
|---|---|---|
| `index-*.js` | 306.38 kB | 309.70 kB |
| `vendor-react-*.js` | 218.82 kB | 218.82 kB |
| **초기 로드 합계** | **525.20 kB** | **528.52 kB (+3.32 kB · +0.63%)** |
| `CodeMirrorEditor-*.js` (지연) | 420.54 kB | 420.54 kB |
| css | 45.54 kB | 45.54 kB |

경계·전역 리스너·`ErrorFallback` 이 전부 **초기 청크**에 들어가야 한다(화면이 깨진 뒤에
청크를 받으러 갈 수는 없다). 524KB 수준 유지.

### 9.4 생성 · 수정 파일

**생성**

| 파일 | 무엇 |
|---|---|
| `apps/api/src/common/process-guards.ts` (+`.spec.ts`) | API 프로세스 레벨 핸들러 |
| `apps/api/src/modules/runs/runs.reaper.ts` (+`.spec.ts`) | ★ 고아 run 회수(주기 작업) |
| `apps/runner/src/reclaim.ts` | ★ Runner 기동 시 자기 이름 고아 정리 |
| `apps/web/src/components/ErrorBoundary/{ErrorBoundary,ErrorFallback,RouteErrorElement}.tsx` + `index.ts` | 경계 3겹 |
| `apps/web/src/lib/global-errors.ts` (+`.spec.ts`) | `window.onerror`·`unhandledrejection` |
| `apps/web/src/lib/api.spec.ts` | 네트워크·500 메시지 |

**수정**

| 파일 | 무엇 |
|---|---|
| `packages/contracts/src/events.ts` | 회수 규약 상수 5개(추가만) |
| `packages/contracts/src/run.ts` (+`.spec.ts`) | `maskSecretsInText()` (추가만) |
| `apps/api/src/main.ts` | `installProcessGuards({ shutdown: () => app.close() })` |
| `apps/api/src/modules/runs/runs.module.ts` | `StaleRunReaper` 등록 |
| `apps/runner/src/main.ts` | 기동 정리 · **재배달 방어** · 종료 경로 일원화 · 예외 핸들러 |
| `apps/web/src/{App,main}.tsx`, `routes/routes.tsx` | 경계·`errorElement`·전역 리스너 배선 |
| `apps/web/src/lib/api.ts` | `toNetworkError` · Nest 기본 500 문구 한국어화 |
| `apps/web/src/{components,lib}/index.ts` | barrel |

**손대지 않은 것**: `docker-compose.yml` · `packages/db/src/cli/guard.ts` · `.gitattributes` ·
`.npmrc` · `apps/runner/poc/**` · `features/recorder/**` · **`apps/web/src/pages/guide/**`** ·
`packages/contracts` 기존 스키마의 필드명·구조.

**임시 검증 코드 잔재 0건** — `grep -rn "TEMP-ERRBOUNDARY-VERIFY|TEMP-EXCEPTION-VERIFY|TEMP-BOOM-VERIFY|__boom"`
결과는 주석 속 URL 언급 2건뿐이고 실행 코드는 없다(`health.controller.ts` 는 `git checkout` 으로 원복).

### 9.5 미검증 · 남긴 것

* **TypeORM 이 실패 쿼리를 서버 로그에 통째로 찍는다**(§6.1). 응답에는 안 나가고, 우리 쿼리는
  바인딩 파라미터를 쓰므로 값이 SQL 문자열에 박히지 않는다. 그래도 로그 마스킹 정책의
  마지막 구멍이다 — TypeORM logger 교체가 필요해 이번 범위 밖으로 남긴다.
* **API 다중 인스턴스 동시 회수**를 실제로 2대 띄워 보지는 않았다. 방어는 조건부 UPDATE 로
  구조적으로 보장되고(§8) 락은 최적화다. 1대 기준 실측만 했다.
* **`queued` 로 영원히 남는 경우**(Redis 가 비워져 job 이 사라졌는데 행만 남는 경우)는 회수
  대상이 아니다. 지금 구조에서는 사용자가 취소로 치울 수 있어 "치울 수 없는 행"이 아니다.
* **`uncaughtException` 실측은 `unhandledRejection` 경로로만** 했다(둘이 같은 `fatal()` 을 타고,
  Node 기본값에서 전자는 후자가 된다). 분기 차이는 단위 테스트로 덮었다.
* **모바일 폭(390/760px)에서 오류 화면**은 별도로 찍지 않았다. `StateView`·`Panel` 기존
  컴포넌트만 써서 반응형 규칙을 새로 만들지 않았다.
* 웹 preview 검증 빌드는 `VITE_API_BASE_URL=http://127.0.0.1:4001/api` 로 만들었다(포트 충돌
  회피). **§9.3 번들 수치는 그 값 없는 표준 빌드**에서 잰 것이다.
* 브랜치는 `0b2d302` 에서 떴는데 작업 중 `main` 에 `fad0fcd (#17 가이드)` 가 올라와
  **`main` 위로 rebase 했다**(충돌 0건 — 건드린 파일이 겹치지 않는다). rebase 후에도
  typecheck 7/7 · lint 0 · build 5/5 · test 793건을 다시 확인했다. **push 는 하지 않았다.**
