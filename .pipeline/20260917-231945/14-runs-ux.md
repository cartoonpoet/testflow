# 14 — 실행 화면 UX 3건: 병렬 실행 · 재실행 · 무대와 스텝 동시 보기

브랜치 `feat/runs-ux` (base `main 0ef5fea`)

## 0. 한 줄 요약

① 시나리오를 **여러 개 골라 한 번에** 실행하고(`POST /runs` 의 `scenarioIds[]` → `batch_id` 묶음 N건), **동시 실행 한도 2건과 큐 대기 순번을 화면에 그대로 적었다.** ② 끝난 실행을 그 화면에서 **재실행**하되 계정은 저장하지 않는다는 제약을 다이얼로그에 드러냈다(스키마 변경 0). ③ 무대 옆·위에 붙는 **스텝 레일**로 영상과 스텝을 같이 보게 했고, **1440×900 에서 무대 표시 크기는 85.5% 그대로다**(#9 수치 무변). 넓은 화면에서는 레일이 진짜 열이 되며 그때도 88.3~92.3% 로 #9 가 정한 85.5% 하한 위를 지킨다.

---

## ③ 영상과 스텝을 같이 본다 — 채택 레이아웃과 근거

### 1.1 문제의 정확한 위치

09-live-view-large 가 무대를 우측 360px(28.1%)에서 **본문 전폭**(85.5%)으로 올리고 스텝 목록을 **아래로** 내렸다. 그 결과 1440×900 에서

```
페이지헤드(≈60) + 요약바(86+15) + 무대(42+684+15) ≈ 902px  >  뷰포트 900px
```

스텝 목록의 **첫 줄조차 스크롤 없이 보이지 않는다.** 영상을 보려면 스크롤을 내려야 하고, 내리면 영상이 위로 사라진다. 사용자의 말(*"동영상 보면서 같이 볼순 없어서 그게 불편해"*)이 정확히 이 산수다.

### 1.2 ★ 버린 안 — "무대를 줄여 옆에 두기"는 **이미 기각된 안 B 다**

1440×900 의 본문 실사용 폭은 **1148px** 이다. 여기서 스텝 열 320px + gap 18px 을 떼면

| 안 | 무대 폭 | 1280 대비 | 프레임 안 12px 글자 | 판정 |
|---|---|---|---|---|
| 09 현재(전폭 + 아래 목록) | 1094.39 | **85.5 %** | 10.3px | 읽힌다 — 그런데 스텝이 안 보인다 |
| **옆에 320px 열** | 810 | **63.3 %** | 7.6px | **09 §2.2 의 "안 B"(60.2%, "아직 읽히지 않는다")와 같은 자리** |
| 옆에 244px 열 | 890 | 69.5 % | 8.3px | 여전히 하한 아래 |

→ **1440 급 화면에서 열을 만들면 무대를 다시 못 읽게 만든다.** 같은 실패를 반복하지 않는다.

### 1.3 채택안 — **레이아웃을 밀지 않는 스텝 레일**(폭에 따라 겹침 ↔ 열)

```
좁은 화면 (< 1680px)                     넓은 화면 (≥ 1680px)
┌────────────────────────────┐          ┌──────────────────┬───────┐
│ 무 대 (1094px = 85.5%)      │          │ 무대(1182=92.3%) │ 레일  │
│                   ┌───────┐│          │                  │ 244px │
│                   │ 레일  ││ ← 겹침    │                  │       │
│                   │ 244px ││          │                  │       │
└───────────────────┴───────┘          └──────────────────┴───────┘
      무대 폭 변화 0                        열이 가져간 만큼만 감소
```

- **< 1680px**: 레일이 캔버스 **위에 겹친다**(`position: absolute`). 무대 폭은 **한 픽셀도 줄지 않는다.** 대가는 프레임 오른쪽 약 22%(244/1094)가 가려지는 것이고, 그래서 **끌 수 있다**(기본 켜짐, `✕` → `스텝 보기`).
- **≥ 1680px**: 같은 엘리먼트가 `position: static` 이 되어 **진짜 열**이 된다. 겹침 0.
- **≤ 1050px**: 감춘다. 시안대로 1단으로 접히며 아래 전체 목록이 바로 이어진다.

**DOM 은 하나다.** 두 벌로 만들면 강조 상태가 두 곳에 생기고 하나는 언제나 화면 밖에서 조용히 어긋난다.

### 1.4 ★ 브레이크포인트 1680px 은 어디서 나왔나 (수치)

본문 폭은 `min(뷰포트 − 사이드바 232px, 1500px) − 패딩 60px` 이라 **1440px 에서 영원히 멈춘다**(`AppShell` 의 `max-w-[--spacing-content-max]`). 실측으로 확인했다 — **1920×1080 에서도 본문은 1440px 이다.**

> 그래서 "1280px 를 그대로 두고 레일을 옆에"(= 본문 1538px 필요)는 **어떤 뷰포트에서도 불가능하다.** 처음 세웠던 1900px 가설은 이 실측에서 깨졌고, 아래 식으로 다시 잡았다.

```
열 모드 무대 폭 = 본문 − 14(gap) − 244(레일)
09 가 "읽힌다"로 못박은 하한 = 1280 × 85.5% = 1094.4px
  → 본문 ≥ 1352.4px → 뷰포트 ≥ 1644.4px   ⇒  브레이크포인트 1680px
```

즉 **열 모드는 무대가 85.5% 아래로 떨어지지 않는 폭에서만 켜진다.**

또 하나: **세로가 상한인 화면에서는 열 모드의 대가가 0 이다.** `76dvh * 1.6` 항이 먼저 걸리면 무대 폭이 어차피 본문보다 작고, 레일은 남는 가로 여백만 쓴다(예: 1680×800 → 열 모드도 비열 모드도 972.8px 로 동일).

### 1.5 ★ 무대 표시 크기 before / after (실측)

측정: `getBoundingClientRect()`. `data-testid="live-canvas"`(라이브) / `[data-slot="live-video"]`(영상). 프레임 원본 1280×800.
raw: `g14-stage-measurements.json`(1차) · 아래 표는 레일 top 보정 후 재측정값.

| 뷰포트 | **before (#9)** | **after (라운드 7)** | 1280 대비 | 종횡비 | 레일 | 가로 스크롤 |
|---|---|---|---|---|---|---|
| **1440 × 900** | 1094.39 × 683.98 (85.5%) | **1094.39 × 683.98** | **85.5 % (± 0)** | 1.600 | 겹침 244px | 0 |
| 1366 × 768 | 933.88 × 583.67 (73.0%) | **933.88 × 583.67** | **73.0 % (± 0)** | 1.600 | 겹침 244px | 0 |
| 1680 × 1050 | (미측정) | **1130 × 706.25** | **88.3 %** | 1.600 | **열** 244px | 0 |
| 1920 × 1080 | 1280 × 800 (100%) | **1182 × 738.75** | **92.3 % (−7.7%p)** | 1.600 | **열** 244px | 0 |
| 2560 × 1440 | 1280 × 800 (100%) | **1182 × 738.75** | **92.3 % (−7.7%p)** | 1.600 | **열** 244px | 0 |
| 1050 × 900 | 758 × 473.75 (59.2%) | **758 × 473.75** | **59.2 % (± 0)** | 1.600 | 감춤 | 0 |
| 760 × 900 | 734 × 458.75 (57.3%) | **734 × 458.75** | **57.3 % (± 0)** | 1.600 | 감춤 | 0 |
| 390 × 844 | 364 × 227.5 (28.4%) | **364 × 227.5** | **28.4 % (± 0)** | 1.600 | 감춤 | 0 |
| **확대 모드 1440×900** | 1401.59 × 875.98 (109.5%) | **1401.59 × 875.98** | **109.5 % (± 0)** | 1.600 | 겹침 244px | — |

**줄어든 곳은 1680px 이상 뿐이고, −7.7%p 다.** 그 대가가 정당한 이유:

1. 그 폭에서 무대는 **92.3%** 로, #9 가 "읽힌다"고 실증한 **85.5% 보다 위**다(12px → 11.1px, 85.5%의 10.3px 보다 오히려 크다).
2. 겹침을 유지했다면 1920 에서 무대는 1280px(100%)이지만 **오른쪽 244px = 19% 가 가려진다.** 열 모드는 프레임을 **하나도 가리지 않고** 92.3% 로 보여 준다. 실제로 읽을 수 있는 화면은 열 모드가 더 넓다.
3. 좁은 화면(문제가 발생한 바로 그 폭)에서는 **1픽셀도 내주지 않았다.**

**★ 무대와 스텝이 한 화면에 동시에** — 증거 스크린샷
`g14-stage-1440x900.png`(라이브·겹침) · `g14-video-seek.png`(**영상 + 레일 + 재실행 버튼**) · `g14-stage-1920x1080.png`(열 모드) · `g14-expanded.png`(확대 모드 + 레일 + 하단 스트립).

### 1.6 레일은 스크롤도 이펙트도 없다

전체 목록(`RunStepList`)은 33개를 늘어놓고 **자동 추적 스크롤**을 건다. 레일은 반대로 **현재 스텝을 가운데 둔 창 9개**(`railWindow()`)를 렌더할 뿐이라 활성 행이 구조적으로 언제나 보이고 `useEffect` 가 하나도 필요 없다. 잘려 나간 앞뒤 개수는 숨기지 않고 `↑ 앞 N개` / `↓ 뒤 M개` 로 적는다. 순수 함수라 단위 테스트 7건으로 못박았다(`StepRail.spec.ts`).

### 1.7 #12(스텝 동기화)가 새 레이아웃에서도 그대로 — 실측

| 항목 | 실측 |
|---|---|
| 자동 추적(라이브) | 라이브 중 `data-rail-active` 가 12 → 18 → 20 으로 따라감 (`g14-stage-*.png` 의 강조 행) |
| 영상 모드 판정 | `data-step-sync-mode="video"` · 레일 행이 전부 `<button>` |
| **스텝 클릭 seek** | 레일에서 9번 스텝 클릭 → `video.currentTime` **0 → 10.687s** |
| 레일 ↔ 목록 일치 | seek 후 `data-rail-active` 8 · `data-active-sequence` **8** (같은 값) |
| 오차 안내 | 레일 하단 *"누르면 영상이 그 지점으로 이동합니다 (오차 약 ±1초)"* + 목록 아래 기존 문단 유지 |
| 확대 모드 | 레일 9행 + 하단 진행 스트립 **둘 다** 표시, `Esc` 로 닫힘, `body.overflow: hidden`, 프레임 유지 |
| `prefers-reduced-motion` | 애니메이션 엘리먼트 **0개**, `data-follow-behavior="auto"` |

> 정직하게: 9번 스텝을 눌렀는데 강조가 **8번**으로 잡힌다. 이는 `stepAtVideoTime` 의 ±1초 경계 동작이고 **전체 목록도 똑같이 8을 가리킨다**(두 뷰가 어긋난 것이 아니다). #12 가 이미 밝혀 둔 오차이고 레일도 같은 문장으로 알린다.

### 1.8 검증 중 실제로 잡은 버그 1건

레일을 무대 우상단(`top: 52px`)에 두자 **"크게 보기" 버튼을 덮어 클릭이 가로채였다**(Playwright: *"intercepts pointer events"*). z-index 로 눌리게만 만들지 않고 레일을 버튼 행 아래(`top: 92px`, 확대 모드 `50px`)로 내렸다 — 보이는 것과 눌리는 것이 달라지면 고친 게 아니다.

---

## ② 끝난 실행을 그 화면에서 재실행

### 2.1 계정 미저장 제약을 어떻게 다뤘나

`runs` 에는 `variables` 컬럼 자체가 없다(의도된 설계 — 평문은 BullMQ job 에만 있다가 만료된다). 그래서 **조용한 원클릭 재실행은 불가능하다.** 지어내지 않고 이렇게 했다.

- 상세 화면 헤더에 `↻ 재실행` — **종료 상태 전부**에서 보인다. 구현이 `isActive ? 중단버튼 : 재실행버튼` 이라 `passed·failed·timeout·cancelled·error` 5종이 **구조적으로** 모두 걸린다.
- 누르면 **그 run 의 설정으로 채워진** 실행 다이얼로그가 열린다 — `baseUrl` · `envLabel` · `browser`, 그리고 대상 시나리오(`sourceType` 은 시나리오가 갖는다).
- **계정/비밀번호 칸만 비어 있고**, 그 자리에 한 줄을 적는다:
  *"**보안상 계정·비밀번호는 저장하지 않습니다.** RUN-0260 의 대상 주소·환경·브라우저는 그대로 채웠고, 계정 칸만 직접 입력해 주세요(값이 필요 없는 시나리오면 비워 둔 채로 실행하면 됩니다)."*
- 시나리오가 삭제된 run(`scenario_id` SET NULL)은 버튼을 **지우지 않고 끄고** 이유를 `title` 로 붙인다 — 버튼이 사라지면 사용자가 규칙을 추측하게 된다.

### 2.2 실측

| run | 상태 | 다이얼로그 제목 | baseUrl | envLabel | browser | 계정/비번 | 안내 |
|---|---|---|---|---|---|---|---|
| RUN-0260 | passed | `재실행 · RUN-0260` | `http://127.0.0.1:4998/record-login.html` | 로컬-검증 | chromium | `""` / `""` | 있음 |
| RUN-0261 | failed | `재실행 · RUN-0261` | 〃 | 로컬-검증 | chromium | `""` / `""` | 있음 |
| RUN-0259 | timeout | `재실행 · RUN-0259` | **`http://127.0.0.1:5599/...`** | **로컬** | chromium | `""` / `""` | 있음 |
| RUN-0269 | cancelled | `재실행 · RUN-0269` | 〃4998 | **취소-검증** | chromium | `""` / `""` | 있음 |

RUN-0259 가 **다른 baseUrl·다른 envLabel** 로 채워진 것이 핵심 증거다 — 프로젝트 기본값이 아니라 **그 run 의 값**을 읽는다.

**실제로 돌았다**: RUN-0260 재실행 → `POST /runs` → **RUN-0268 생성 → passed(7 steps)**, `baseUrl`·`envLabel` 동일. 콘솔 에러 0.
(`g14-rerun.json` · `g14-rerun-submit.json` · `g14-rerun-*.png` · `g14-rerun-result.png`)

### 2.3 원본과 잇는 방법 — **스키마를 늘리지 않았다** (근거)

새 run 화면 상단에 배너: **"RUN-0260 을(를) 다시 실행한 결과입니다"** + 원본으로 가는 링크. 실측 문자열 그대로 확인했다(`lineage: true`).

`runs.rerun_of_run_id` 컬럼을 만들지 **않은** 이유:

1. 그 값으로 **할 수 있는 일이 지금은 이 배너 한 줄뿐**이다. 마이그레이션 + `RunSchema` + 매퍼 + 서비스가 같이 움직이는데 조회하는 곳은 없다.
2. **새 컬럼이 없어도 잃는 사실이 없다.** 실행 이력의 정합성(무엇이 언제 어떤 설정으로 돌았나)은 `runs` 의 스냅샷 컬럼들이 이미 전부 갖고 있다.
3. 전달 경로는 `maskedVariables` 가 이미 쓰는 react-router `state`(= `history.state`)를 **그대로 재사용**한다. 성질도 이미 실측돼 있다 — 새로고침에는 살아남고, 링크로 직접 들어오면 없다.

**대가(정직하게)**: 링크를 복사해 다른 탭에서 열면 배너가 없다. 배너가 사라질 뿐 화면은 깨지지 않는다. "재실행 계보"를 목록에서 **필터링**해야 할 일이 생기면 그때가 컬럼을 만들 때다.

---

## ① 여러 테스트를 한 번에 병렬 실행

### 3.1 설계 — 스위트 경로를 **재사용**했다(복사 아님)

- 계약: `CreateRunRequestSchema` 에 **`scenarioIds: z.array(uuid).min(1).max(50)`** 추가. `scenarioId` · `scenarioIds` · `suiteId` 는 **배타**(superRefine), 중복 id 거부. 계약 테스트 6건 추가.
- 서비스: `resolveTargets()` 에서 **단건과 다중이 같은 경로**로 합쳐졌다(단건 = 길이 1 배열). 스텝 수 집계 + 대상 변환은 `toTargets()` **한 곳**으로 뽑아 스위트 경로와 공유한다 — 복사하면 `code` 시나리오의 `stepCount=0` 규약이 한쪽에서만 지켜지는 사고가 난다.
- `batch_id` 판정을 **"스위트인가" → "대상이 여러 건인가"** 로 바꿨다. 순서는 **요청 배열 순서**가 그대로 `batch_sequence` 가 된다(스위트의 `sequence` 자리).
- 프로젝트가 섞인 묶음은 400 — run 은 프로젝트 1건에 속하고 `baseUrl` 기본값도 거기서 온다.

**API 실측** (5건 요청):
```
POST /runs {"scenarioIds":[5건]} →
{"runIds":[5개], "batchId":"b5019cd0-…", "status":"queued", "position":4}

mysql> SELECT run_code, batch_id, suite_id, status FROM runs WHERE batch_id='b5019cd0-…';
RUN-0260  b5019cd0-…  NULL  running
RUN-0261  b5019cd0-…  NULL  running
RUN-0262  b5019cd0-…  NULL  queued
RUN-0263  b5019cd0-…  NULL  queued
RUN-0264  b5019cd0-…  NULL  queued
```

### 3.2 화면 — 시나리오 목록 다중 선택

체크박스 열 + 전체 선택 + 선택 바(`N건 선택됨` / `선택 해제` / `▶ 선택 실행`). 선택은 **id 와 이름을 같이** 들고 있어 **페이지를 넘나들며 살아남는다**(2페이지에서 고르고 1페이지로 돌아와 실행 가능). URL 에는 넣지 않는다 — 선택은 공유할 상태가 아니다.

**회귀 주의점**: 행 전체가 `role="link"` 라 체크 칸에서 `click`/`keydown` 을 `stopPropagation` 한다. 실측 — 체크박스 4개를 눌러도 **URL 이 바뀌지 않았다**(`urlUnchangedOnCheck: true`). 전체 선택 → 8건, 해제 → 선택 바 사라짐.

### 3.3 ★ 동시성 한계를 화면에 어떻게 표시했나 — **숨기지 않았다**

Runner 동시 실행 한도는 **Runner 프로세스만 안다.** API 의 env 에서 읽으면 설정이 두 벌이 되어 한쪽만 바뀐 순간 화면이 조용히 거짓말을 한다. 그래서 **관측값만** 쓴다.

- Runner 가 heartbeat 와 **같은 주기·같은 TTL** 로 `testflow:runner:capacity:<id> = RUNNER_CONCURRENCY` 를 쓴다(신규 키 — heartbeat 값 형식을 건드리지 않아 `health` 판정은 한 줄도 안 바뀐다).
- 신규 `GET /api/runs/queue` → `{waiting, active, concurrency, runners, waitingRunIds}`. 전부 BullMQ/Redis 관측값. **키가 없으면 `concurrency: null` 이고 화면은 "확인할 수 없습니다"로 떨어진다 — 한도를 지어내지 않는다.**
- `jobId = runId` 규약 덕에 `waitingRunIds` 의 인덱스가 곧 **대기 순번**이다.

**실행 전(다이얼로그)**
> *"Runner 는 한 번에 최대 **2건**을 동시에 실행합니다. 나머지 **2건**은 큐에서 차례를 기다리며, 앞 실행이 끝나는 대로 순서대로 시작합니다."*

**실행 중(묶음 화면)** — 실측 `g14-batch.png`
```
묶음 실행 · 4건                                   batch 957dffec
실행 중 2 · 대기 2 · 완료 0 · Runner 는 한 번에 최대 2건을 동시에 실행합니다. …
 ①  G14-LONG 40단계   1/4 · RUN-0270 · …                         실행중
 ②  G14-A 성공 6단계   2/4 · RUN-0271 · …                         실행중
 ③  G14-E 성공 5단계   3/4 · RUN-0272 · … · 큐 대기 1번째           대기
 ④  G14-D 성공 5단계   4/4 · RUN-0273 · … · 큐 대기 2번째           대기
```
큐 순번은 **`queued` 인 행에만** 쓴다 — 도는 실행 옆에 순번이 남으면 "아직 기다리는 중"으로 읽힌다.

### 3.4 `RUNNER_CONCURRENCY` 판단 — **기본값 2를 유지한다** (실측 근거)

| | 값 |
|---|---|
| 측정 머신 | 6 코어 / RAM 3916 MB (WSL2) |
| 유휴 시 사용 메모리 | **2334 MB** |
| **동시 2건 실행 중** | **2669 MB** (가용 1247 MB) |
| **증가분** | **+335 MB / 2건 = 약 168 MB per run** |
| 그 시점 chrome-headless RSS | 127.7 + 104.7 + 90.1 + 67.2 MB |

- 4로 올리면 이 머신에서 +670 MB — 가용 1247 MB 의 절반을 한 번에 먹는다. 개발 머신에서 스왑이 시작되면 **모든 실행이 같이 느려지고**, 그러면 "병렬로 빨라졌다"가 거짓이 된다.
- `RUNNER_EXECUTION_MODE=docker` 면 run 마다 **컨테이너**다. 비용은 더 크고, 이 값은 그 모드에서도 같은 상수로 쓰인다.
- 기본값을 올리면 **모든 배포의 자원 프로필이 조용히 바뀐다.** 올리는 것은 실측을 가진 운영자가 env 로 할 일이다.
- 그리고 **사용자가 실제로 불편했던 것은 2라는 숫자가 아니라 "몇 개가 도는지 알 수 없는 것"** 이었다. 그건 위 §3.3 으로 닫았다.

### 3.5 서로 다른 run 의 라이브를 동시에 — 실측

같은 브라우저 컨텍스트의 두 탭에서 동시에 도는 두 run 을 열었다(`g14-dual-a.png` · `g14-dual-b.png`).

```json
{"A":{"runCode":"RUN-0276","connection":"open","phase":"live","hasFrame":"true","activeSeq":"8","meanLuma":251},
 "B":{"runCode":"RUN-0277","connection":"open","phase":"ended","hasFrame":"true","activeSeq":"6","meanLuma":250.7},
 "errors":[]}
```
**둘 다 `connection: "open"`**, 둘 다 프레임 수신(`meanLuma ≈ 251` → 검은 화면이 아니다), 활성 스텝이 서로 다르다(8 vs 6 — 스트림이 섞이지 않았다).

---

## 4. 회귀

| 항목 | 결과 |
|---|---|
| **`features/recorder/**`** | `git diff --stat` **0 files changed** — 한 줄도 안 건드렸다 |
| 녹화 경로 실제 동작 | 녹화 시작 → 캔버스 attr **1280×800**, 표시 756×473(비 0.591) → 원격 좌표 (306,405) 역산 클릭 → **스텝 `'확인' 버튼 클릭` 기록됨.** 좌표 역변환 정상, 콘솔 에러 0 |
| 배율 3종 재측정 | **불필요**(공용 컴포넌트 diff 0줄). 대신 위 1건으로 경로 자체는 확인 |
| 단건 실행 | RUN-0268(재실행 경로) `passed` |
| 영상 재생·seek | `currentTime 0 → 10.687s`, controls 동작 |
| 녹화(`steps`) 실행 상세 | `data-source-type="steps"`, 영상 있는 종료 run 은 #10 대로 무대 유지 + 레일 표시, 콘솔 에러 0 |
| 확대 모드 | 109.5% 유지 · `Esc` 닫힘 · 프레임 유지 · `body.overflow: hidden` |
| 스위트 실행 경로 | 코드 경로 **무변**(`suiteId` 분기 그대로, `toTargets()` 만 공유) |
| **콘솔 에러** | 모든 시나리오(라이브·영상·확대·반응형 8종·재실행 5건·다중선택·묶음·동시 라이브·녹화) **0건** |

---

## 5. 기준선

| 게이트 | 기준선 | 이번 | |
|---|---|---|---|
| `pnpm typecheck` | 7/7 | **7/7** | ✅ |
| `pnpm lint` | 0 problems | **0 problems** (7/7) | ✅ |
| `pnpm build` | 5/5, 500KB 경고 없음 | **5/5, 경고 없음** | ✅ |
| `pnpm test` | 700+ (704) | **717** (contracts 205 · web 114 · runner 253 · api 145) | ✅ **+13** |
| `apps/web/src` 스타일 HEX | 0건 | **0건** (diff 에 추가된 HEX 0 · `StepRail.tsx` 0) | ✅ |
| `style={{` | 2건 | **2건** (신규 0) | ✅ |
| 새 색 토큰 | — | **0개** (`--color-live-strip` / `--color-dark-panel` / `--color-run-summary-ink` / `--color-run-state` 재사용) | ✅ |
| 새 런타임 의존성 | 0 | **0** | ✅ |
| 마이그레이션 | — | **0건** (`pnpm db:migrate` → "적용할 마이그레이션이 없습니다") | ✅ |

### 번들 (같은 머신 · `pnpm build --force`, before = `main 0ef5fea`)

| 초기 로드 | before | after | 차이 |
|---|---|---|---|
| `index-*.js` | 304,757 B | 305,374 B | **+617 B** |
| `vendor-react-*.js` | 218,828 B | 218,828 B | 0 |
| **초기 로드 JS 합계** | **523,585 B (523.59 KB)** | **524,202 B (524.20 KB)** | **+617 B (+0.12 %)** |
| `dist-*.js`(녹화 청크) | 25,857 B | 25,857 B | 0 |
| `index-*.css` | 44,229 B | 45,228 B | +999 B |

지연 청크(초기 로드 아님): `RunDetail` 33,805 → 39,187 · `RunDialog` 7,009 → 11,539 · `scenarios` 7,204 → 9,596 · `runs` 3,811 → 4,832.
**초기 로드 JS 523.55 KB 수준 유지** ✅ · **500KB 경고 없음** ✅.

### 인프라 · 기동
```
docker compose up -d    → testflow-mysql Up(healthy) 3307 · testflow-redis Up(healthy) 6379
pnpm db:migrate         → "적용할 마이그레이션이 없습니다"
node apps/api/dist/main.js     → :4000
node apps/runner/dist/main.js  → ws://0.0.0.0:4100 · concurrency=2
vite preview :4173 · fixtures 정적 서버 :4998 (apps/runner/poc/fixtures, 서빙만)
GET /api/health     → {"status":"ok","db":"ok","redis":"ok","runner":"ok"}
GET /api/runs/queue → {"waiting":3,"active":2,"concurrency":2,"runners":1,"waitingRunIds":[3개]}
```
대상은 전부 **로컬 fixture / `page.setContent`**. **운영(`live.law365ai.com`)에는 어떤 요청도 보내지 않았다.**
검증용 시나리오 10건(`G14-*`)은 **전부 삭제**(`q=G14` 조회 **0건** 복귀). `runs` 이력은 append-only 라 남겼다(RUN-0260 ~ RUN-0277).

---

## 6. 생성 · 수정 파일

### 신규 (4)
| 파일 | 역할 |
|---|---|
| `apps/web/src/features/live/StepRail.tsx` | 스텝 레일 + `railWindow()` 순수 함수 |
| `apps/web/src/features/live/StepRail.spec.ts` | `railWindow` 단위 테스트 7건 |
| `.pipeline/20260917-231945/g14-verify.mjs` | 검증 하네스(일회성 기록) |
| `.pipeline/20260917-231945/14-runs-ux.md` | 이 문서 |

### 수정 (13)
| 파일 | 변경 |
|---|---|
| `packages/contracts/src/run.ts` | `scenarioIds[]` + 배타 refine · `RunQueueStatusSchema` |
| `packages/contracts/src/events.ts` | `RUNNER_CAPACITY_KEY_PREFIX` · `runnerCapacityKey()` |
| `packages/contracts/src/run.spec.ts` | 계약 테스트 6건 추가 |
| `apps/api/src/modules/runs/runs.service.ts` | 다중 시나리오 경로(스위트 로직 공유 `toTargets`) · `batch_id` 판정 변경 · `queueStatus()` |
| `apps/api/src/modules/runs/runs.controller.ts` | `GET runs/queue` (**`runs/:id` 앞에** 선언 — 뒤에 두면 `:id="queue"` 로 잡힌다) |
| `apps/runner/src/main.ts` | heartbeat 와 함께 capacity 키 기록 · 종료 시 삭제 |
| `apps/web/src/styles/globals.css` | `tf-live-stage`(relative·flex·1680 열 모드) · `tf-stage-panel` · `tf-step-rail` |
| `apps/web/src/features/live/LiveStage.tsx` | `rail` / `railToggle` 슬롯 |
| `apps/web/src/features/live/index.ts` | barrel |
| `apps/web/src/pages/runs/RunScreen.tsx` | 레일 조립(스텝 0건이면 안 띄운다) |
| `apps/web/src/pages/runs/RunDetail.tsx` | 재실행 버튼 · 계보 배너 · 레일 on/off 상태 |
| `apps/web/src/pages/runs/RunDialog.tsx` | `defaults` · `rerunOf` · `scenarioIds` 대상 · 계정 미저장 안내 · 동시성 안내 |
| `apps/web/src/pages/runs/index.tsx` | 묶음 패널을 큐 인지형으로(`useRunDetails` + 대기 순번) |
| `apps/web/src/pages/scenarios/ScenarioTable.tsx` | 선택 체크박스 열(행 이동 차단) |
| `apps/web/src/pages/scenarios/index.tsx` | 선택 상태 · 선택 바 · 실행 다이얼로그 |
| `apps/web/src/hooks/useRuns.ts` | `useRunQueue` · `useRunDetails` |
| `apps/web/src/lib/queryClient.ts` | `runQueue` 키 |

### 손대지 않은 것 (확인)
`apps/web/src/features/recorder/**`(**diff 0줄**) · `docker-compose.yml` · `packages/db/src/cli/guard.ts` · `.gitattributes` · `.npmrc` · `apps/runner/poc/**` · `packages/db/**`(마이그레이션 0) · `tsconfig`(`baseUrl` 추가 없음)

---

## 7. 이번에 **검증하지 않은** 것 (정직하게)

1. **`status: "error"` 인 run 의 재실행 버튼.** 4종(passed·failed·timeout·cancelled)은 실측했다. `error` 는 재현 수단이 없어 **코드 구조로만** 보장된다(`isActive ? 중단 : 재실행` 이라 종료 상태 전부가 걸린다).
2. **1680px 이상 실기기.** 열 모드 전환은 Playwright 논리 뷰포트(1680·1920·2560)로만 쟀다. 고DPI 실기기의 물리 픽셀 배율은 재지 않았다.
3. **레일의 스크린 리더 동작.** `<aside aria-label="테스트 순서">` + 행마다 `aria-label` 을 붙였지만 NVDA/VoiceOver 로 읽혀 보지는 않았다.
4. **동시 실행 3건 이상의 라이브.** 동시 2건(= 한도)까지만 실측했다. 한도가 2라 3건 동시 스트림은 이 설정에서 발생하지 않는다.
5. **`scenarioIds` 50건 상한 근처.** 4·5건까지만 실제로 돌렸다. 상한 50 은 계약 테스트로만 확인했다.
6. **큐 순번의 경합.** `waitingRunIds` 는 조회 시점의 스냅샷이다. 조회와 표시 사이에 Runner 가 job 을 집어 가면 순번이 1 틀릴 수 있다(2초 폴링이 곧 바로잡는다). 이 어긋남을 의도적으로 재현해 보지는 않았다.
7. **다중 선택으로 `steps`(녹화) 시나리오를 섞은 묶음.** 코드 시나리오로만 검증했다. 서버는 스위트와 같은 코드 경로를 쓰므로 `source_type` 스냅샷은 run 마다 갈린다(스위트에서 이미 검증된 성질).
8. **영상 seek 의 ±1초 경계.** §1.7 의 "9번 클릭 → 8번 강조"는 #12 의 기존 동작이고 레일이 만든 것이 아니다. 그 오차 자체를 줄이는 일은 이번 범위가 아니다.
