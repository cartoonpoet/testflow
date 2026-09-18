---
# Gen Artifact
pipeline_id: 20260917-231945
phase: 13-artifacts-on-timeout
feature: 하드 타임아웃·취소로 죽은 실행에서도 증적(영상·trace·스크린샷)을 남긴다
branch: fix/artifacts-on-timeout
base: main (7c5dd70)
---

# 라운드 6 — 타임아웃·취소로 죽은 실행의 증적

## 0. 한 줄 요약

**`docker` 격리에서 타임아웃/취소로 죽은 실행의 증적이 0건이던 것을 3건(스크린샷·trace·영상)으로
고쳤고, 그 영상이 `readyState 4` · `duration 46.04` · `seek 23.02` 로 실제 재생·탐색된다는 것을
브라우저에서 읽어 증명했다.** 원인은 **Playwright 러너가 `SIGINT` 만 핸들링한다**는 것이었다
(`SIGTERM` 은 즉사 → `BrowserContext.close()` 가 돌지 않음 → 영상이 내부 임시 디렉토리에 미완성으로
남고 우리 스캐너는 그곳을 건너뛴다). **유예 0/2/5/10/15초 실측표**로 값을 정했고(§3),
kill 로 넘어간 경우를 위한 **부분 영상 수습 + 재생 가능성 검증**을 따로 뒀다(§4).
기준선 유지 · `pnpm test` **700건**(+11) · 초기 로드 JS **523.55 KB 증가 0** · 콘솔 에러 0건.

---

## 1. ★★ 진단 — 어디가 깨졌었나

### 1.1 "정상 경로에만 증적 수집이 있다"는 가설은 **틀렸다**

`code-executor.ts` 의 `collectPlaywrightArtifacts()` 는 이미 `try` 안, status 확정 **뒤**에 있었고
타임아웃/취소 경로도 그 줄을 지났다. 그런데 배포 서버에서는 0건이었다. 그래서 먼저 **재현**했다.

### 1.2 재현 — 모드에 따라 결과가 정반대였다

`main`(7c5dd70) 빌드 그대로, `waitForTimeout(600s)` 로 절대 안 끝나는 4스텝 시나리오를
하드 타임아웃으로 죽였다.

| 격리 모드 | 결과 |
|---|---|
| `local` (`RUNNER_CODE_EXECUTION_MODE=local`) | **증적 3건** · 영상 재생됨(`readyState 4` · `duration 14.84`) |
| **`docker`** (← **기본값**) | **증적 0건** · 영상·trace·스크린샷 전무 |

```
[BEFORE-docker #1] run=68086f17-… → timeout   · 증적 0건 []
[BEFORE-docker #2] run=773510e1-… → timeout   · 증적 0건 []
[BEFORE-docker-cancel #1] run=5cc8b24d-… → cancelled · 증적 0건 []
[BEFORE-docker-cancel #2] run=d2a1438d-… → cancelled · 증적 0건 []
```

★ `RUNNER_CODE_EXECUTION_MODE` 의 기본값은 **`docker`** 다(`env.ts`). 배포 서버의
RUN-0011~0014 가 정확히 이 줄에 있다.

### 1.3 왜 모드가 결과를 가르나 — 원인 3단

① **Playwright 러너가 직접 핸들링하는 신호는 `SIGINT` 뿐이다.**

```
$ grep -c "process.on(\"SIGINT\"" playwright/lib/runner/index.js   → FixedNodeSIGINTHandler 1건
$ grep    "SIGTERM"              playwright/lib/runner/index.js   → 0건
```

`SIGTERM` 은 핸들러가 없어 Node 기본 동작으로 **즉사**한다.

② 영상은 **`BrowserContext.close()` 가 돌아야** 완성된다. 녹화 중에는
`out/.playwright-artifacts-<worker>/<guid>.webm` 에 쌓이고, 테스트가 끝날 때 러너가
`out/<테스트-슬러그>/video.webm` 으로 **옮긴다.**

③ 우리 증적 스캐너는 `.` 로 시작하는 디렉토리를 통째로 건너뛴다(`code-artifacts.ts` —
trace screencast jpeg 46장이 증적으로 올라간 실측 때문에 넣은 방어다). 즉 **옮겨지기 전에
죽으면 증적은 0건**이다.

그러면 왜 `local` 은 살아남았나 — **고아 worker 덕분이었다.** `local` 은 우리가 러너 프로세스
하나에만 `SIGTERM` 을 준다. worker 는 고아가 되어 IPC 단절을 감지하고 **스스로 정리하며
컨텍스트를 닫는다.** `docker` 는 컨테이너 PID 네임스페이스가 통째로 사라져 그 기회가 없다.
**즉 `local` 이 맞게 동작한 것은 설계가 아니라 우연이었다.**

---

## 2. 고친 것

### 2.1 2단 종료 — `SIGINT` → (유예) → `SIGTERM` → `SIGKILL`

`code-executor.ts` 의 중단 핸들러를 바꿨다.

| 단계 | 신호 | 언제 |
|---|---|---|
| 1 | **`SIGINT`** (`docker kill -s INT`) | 중단 신호 즉시. 러너가 워커를 접으며 컨텍스트를 닫는다 |
| 2 | `SIGTERM` (`docker kill -s TERM`) | 유예(`RUNNER_GRACEFUL_STOP_MS`, 기본 **10초**) 초과 |
| 3 | `SIGKILL` (`docker kill`) | 2단계 뒤 5초(`KILL_GRACE_MS`) |

`docker` 경로는 `CodeContainerHandle.interrupt()` 를 새로 뒀다. 신호는
`docker kill -s INT` → tini(`--init`) → `pw-container-boot.js`(이미 `SIGINT` 전달 루프가 있었다)
→ `playwright test` 로 3단을 거쳐 닿는다.

### 2.2 증적 수집을 `finally` 로 내렸다 — **어느 경로로 끝나도 지난다**

예전에는 `try` 안에만 있어 **작업공간 생성·spawn 이 던진 경우(`catch`)에는 증적이 통째로
사라졌다.** `finally` 의 첫 블록으로 옮겨 성공·실패·타임아웃·취소·예외가 전부 같은 줄을 탄다.
순서 규약(`artifact.ready` → `run.finished`)은 그대로다 — `finally` 는 `runFinished()` 앞이다(§6).

### 2.3 증적 실패가 run 을 `running` 에 가두지 못하게 했다

수집 전체를 `try/catch` 로 감싸고 실패는 로그로만 남긴다. **증적은 부가물이고 status 확정은
계약이다** — 둘 중 하나를 포기해야 한다면 증적이다(실측 §7).

### 2.4 강제 종료 뒤 **부분 영상 수습**(§4)

---

## 3. ★★ graceful 유예 — 유예별 실측표

`docker` 격리 · 하드 타임아웃 45초 · `waitForTimeout(600s)` 시나리오 · **유예마다 Runner 재기동 후 3회**.
영상 판정은 파일 존재가 아니라 **실제 Chromium `<video>` 에 물려** 읽었다(§5 하네스).

| 유예 | 증적 건수 | trace | 영상 크기 | **`duration`** | **seek** | 판정 |
|---|---|---|---|---|---|---|
| **0ms** (= 고치기 전 동작) | **1** | ✖ | 262,144B ×3 (전부 수습분) | **Infinity** ×3 | **✖** | 부분 파일. 재생은 되나 **탐색 불가** |
| 2,000ms | 2 | ✖ | 262,144 / 379,635 / 196,608 | **Infinity** / 45.28 / 45.60 | **1/3 실패** | **불안정** |
| **5,000ms** | **3** | **✔** | 390,734 / 392,368 / 398,682 | 46.16 / 46.24 / 46.44 | ✔ | 3/3 성공 — **이 환경의 최소값** |
| 10,000ms | 3 | ✔ | 382,463 / 459,279 / 444,944 | 46.04 / 46.40 / 46.04 | ✔ | 3/3 성공 |
| 15,000ms | 3 | ✔ | 393,649 / 383,035 / 453,258 | 46.20 / 46.00 / 46.32 | ✔ | 3/3 성공 — 10초 대비 **이득 0** |

원문(`playable.mjs`, 유예 10,000ms 3회):

```
13d3c882-… timeout 382463B → ★ 재생됨 readyState=4 duration=46.04 800x500 frames=102 error=null seeked=23.02
72f18e79-… timeout 459279B → ★ 재생됨 readyState=4 duration=46.4  800x500 frames=106 error=null seeked=23.2
edaf8474-… timeout 444944B → ★ 재생됨 readyState=4 duration=46.04 800x500 frames=102 error=null seeked=23.02
```

### 3.1 왜 최소값(5초)이 아니라 **10초**인가

- **2초에서 3회 중 1회가 무너졌다.** 모자라면 "절반"이 아니라 **"가끔"** 이 된다 —
  가장 고치기 어려운 종류의 고장이다. 최소값에 붙여 두면 그 지대에 들어간다.
- 유예가 덮는 일은 컨텍스트 close + **trace packing** 이고, 여기 trace 는 **4스텝에 2.9MB** 다.
  사용자의 실제 시나리오 `project-save` 는 **33스텝**이라 그만큼 더 걸린다.
  **5초는 이 환경의 4스텝짜리에 딱 맞는 값이지 여유가 아니다.**
- 15초는 10초보다 나은 점이 하나도 없었다(표의 마지막 줄).
- 비용: 300초 하드 타임아웃 기준 **+3.3%**. 취소는 체감이 다르지만 실측상 SIGINT 응답이
  빨라 **유예를 다 쓰지 않는다** — 취소 2건 모두 신호→종료 **2.7초**였다(§6).

`RUNNER_GRACEFUL_STOP_MS` 로 조정한다(0~60,000ms로 클램프. `0` 은 이 단계를 끈다 = 표의 첫 줄).

---

## 4. kill 했을 때의 부분 파일 — 올릴 것인가 버릴 것인가

### 4.1 판단: **검증을 통과한 것만 올린다**

0바이트/헤더뿐인 webm 을 증적으로 올리면 화면은 `<video>` 를 그리고 사용자는 재생 버튼을
눌렀다가 `MEDIA_ERR_SRC_NOT_SUPPORTED` 를 본다. **"증적이 남지 않았습니다"는 사실이지만
깨진 영상은 고장이다** — 없는 것보다 나쁘다. 그래서 `isPlayableWebm()` 3검사를 통과한 것만 올린다.

| 검사 | 근거 |
|---|---|
| **4KB 이상** | 그 아래는 EBML/Segment 헤더뿐이다(프레임 0장) |
| 머리 4바이트 `1A 45 DF A3` | EBML 매직. webm 이 아닌 쓰레기를 거른다 |
| **`Cluster`(`1F 43 B6 75`) 존재** | 실제 프레임 데이터가 시작된 표식. 없으면 디코드할 것이 없다 |

수습 대상은 **영상뿐**이다. 같은 내부 디렉토리의 `*.jpeg` 는 trace 조립용 screencast 프레임이고
(취소 1건에 46장 올라간 실측이 있다), `trace.zip` 은 packing 이 끝나야 존재하므로 애초에 없다.
또 **제자리(`out/<슬러그>/video.webm`)에 영상이 이미 있으면 수습하지 않는다** — 같은 화면이
두 벌이 되면 어느 쪽이 완전한지 사용자가 판단하게 된다.

### 4.2 실측 — 수습분은 **재생되지만 탐색은 안 된다**

유예 0ms(즉시 SIGTERM) 3회, 전부 `.playwright-artifacts-0/` 에서 주운 파일:

```
3b16c834-… timeout 262144B → ★ 재생됨 readyState=4 duration=Infinity 800x500 frames=34 error=null seeked=null
5a21b735-… timeout 262144B → ★ 재생됨 readyState=4 duration=Infinity 800x500 frames=34 error=null seeked=null
e2d69ef1-… timeout 262144B → ★ 재생됨 readyState=4 duration=Infinity 800x500 frames=34 error=null seeked=null
```

- 262,144B = 정확히 256KB. 브라우저가 쓰다 만 버퍼 경계다.
- **프레임 34장이 실제로 디코드된다** — 화면은 보인다.
- **`duration = Infinity`, seek 실패.** 스트리밍 webm 이라 Duration/Cues 가 없다.
  화면 쪽은 이것을 **조용히 잘 견딘다**: `useStepSync` 가 `Number.isFinite(duration)` 일 때만
  시간축을 만들므로 `timeline === null` → 스텝 클릭 seek 버튼이 **나오지 않고** 강조는
  run 상태 기준으로 떨어진다. 없는 기능을 있는 척하지 않는다.
- 부작용 1건: 그 run 의 화면에서 `net::ERR_ABORTED` 가 **1건** 관측됐다(아래 §8). 길이를 모르는
  미디어에 Chromium 이 건 요청을 스스로 취소하는 것으로, `readyState=4` 로 재생은 정상이었다.

**결론: 수습은 "없는 것보다 낫다"는 안전망이고, 목표는 어디까지나 §3 의 우아한 종료다.**
그래서 수습은 **강제 종료로 넘어갔을 때만**(`hardKilled`) 켠다 — 정상 종료에서 내부
디렉토리를 훑으면 packing 전 중간 산출물을 증적으로 올리게 된다.

---

## 5. 검증 하네스

| 파일 | 하는 일 |
|---|---|
| `apps/runner/g13/runner.sh` | 유예·모드·`ARTIFACT_ROOT` 를 바꿔 Runner 재기동 |
| `apps/runner/g13/grace.mjs` | 시나리오 생성 → 실행 → 타임아웃/취소 → 증적 조회 |
| `apps/runner/g13/sweep.sh` | 유예 스윕(0/2/5/10/15초 × 3회) |
| `apps/runner/g13/playable.mjs` | ★ **실제 Chromium `<video>`** 에 물려 `readyState`·`duration`·`error`·seek·디코드 프레임 수를 읽는다 |
| `apps/runner/g13/ui.mjs` | 화면 상태·문구·콘솔 에러·가로 넘침 |
| `apps/runner/g13/regress.mjs` | 정상 성공 / 시나리오 실패 회귀 |

> `g13/**` 는 **커밋하지 않는다**(`g12/**` 와 같은 규율). 운영(`live.law365ai.com`)에는
> 한 줄도 쓰지 않았다 — 전부 로컬 `127.0.0.1:4000` · 로컬 fixture(`:5599`)다.

---

## 6. ★ 타임아웃 / 취소 실측 (after)

### 6.1 하드 타임아웃 — `docker`

```
[g10000 #1] run=13d3c882-… → timeout · 증적 3건 [screenshot:27794 trace:2939354 video:382463]
[g10000 #2] run=72f18e79-… → timeout · 증적 3건 [screenshot:27794 trace:2941272 video:459279]
[g10000 #3] run=edaf8474-… → timeout · 증적 3건 [screenshot:27782 trace:2981879 video:444944]
```

### 6.2 취소 — `docker` (`POST /runs/:id/cancel`, `running` 20초 시점)

```
[AFTER-docker-cancel #1] run=dab0c9a1-… → cancelled · 증적 3건 [screenshot:27794 trace:1467313 video:169437]
[AFTER-docker-cancel #2] run=301cf365-… → cancelled · 증적 3건 [screenshot:27793 trace:1432544 video:168831]

dab0c9a1-… cancelled 169437B → ★ 재생됨 readyState=4 duration=20.12 800x500 frames=162 error=null seeked=10.06
301cf365-… cancelled 168831B → ★ 재생됨 readyState=4 duration=20.12 800x500 frames=162 error=null seeked=10.06
```

★ **`duration 20.12` 가 취소를 누른 시각(20,000ms)과 일치한다** — 영상이 "취소 직전까지"를
담고 있다는 뜻이다. 신호→종료는 **2.7초**로 10초 유예를 다 쓰지 않았다.

```
10:19:37.603   실행 중단 신호(cancelled) — 컨테이너에 SIGINT · 영상 flush 유예 10000ms
10:19:40.340 run dab0c9a1-… 종료 — cancelled (3/4), 증적 3건
```

### 6.3 `local` 모드 (같은 코드, 유예 10초)

```
[AFTER-local #1]        run=b23f71ba-… → timeout   · 증적 3건 [screenshot:24622 trace:2588937 video:309305]
[AFTER-local #2]        run=fb00751f-… → timeout   · 증적 3건 [screenshot:24610 trace:2590580 video:311256]
[AFTER-local-cancel #1] run=6054e1a4-… → cancelled · 증적 3건 [screenshot:24620 trace:959738  video:91180]
[AFTER-local-cancel #2] run=61d09a61-… → cancelled · 증적 3건 [screenshot:24604 trace:994521  video:92031]

b23f71ba-… timeout   309305B → ★ 재생됨 readyState=4 duration=34.8 frames=89  seeked=17.4
6054e1a4-… cancelled  91180B → ★ 재생됨 readyState=4 duration=9.6  frames=158 seeked=4.8
```

`local` 도 **trace 가 새로 남기 시작했다**(고치기 전에는 타임아웃에서 trace 1.33MB 가
간헐적으로만 나왔다) — SIGINT 로 러너가 스스로 packing 을 끝내기 때문이다.

### 6.4 ★ 순서 규약 — `artifact.ready` 가 `run.finished` **보다 먼저**

DB 시각으로 확인했다(수집을 `finally` 로 옮긴 뒤에도 유지된다).

| run | status | 증적 종류 | `runs.finished_at` − `artifacts.created_at` |
|---|---|---|---|
| `13d3c882` | timeout | screenshot / trace / video | **+108 / +61 / +37 ms** |
| `dab0c9a1` | cancelled | screenshot / trace / video | **+109 / +69 / +47 ms** |

전부 **양수** = 증적 행이 먼저다.

---

## 7. ★ 증적 수집이 실패해도 status 는 확정되는가

`ARTIFACT_ROOT` 를 **디렉토리가 아닌 파일**로 지정해 모든 `putFile` 을 `ENOTDIR` 로 터뜨렸다.

```
증적 적재 실패 — runs/11ebf349-…/screenshot.png: ENOTDIR: not a directory, mkdir '/tmp/tfg13/blocked-artifact-root/runs/…'
증적 적재 실패 — runs/11ebf349-…/trace.zip:      ENOTDIR: …
증적 적재 실패 — runs/11ebf349-…/video.webm:     ENOTDIR: …
run 11ebf349-… 종료 — timeout (3/4), 증적 0건, 필터로 제외한 내부 스텝 17건
```

**증적 3건이 전부 실패했는데도 `timeout` 으로 확정됐다.** `running` 에 남지 않았고,
실패는 조용히 넘어가지 않고 로그 3줄로 남았다. 화면도 정상이다(§8 의 `11ebf349` 행).

---

## 8. 화면 — 증적이 없는 끝난 실행 / 있는 끝난 실행

| run | status | 증적 | `data-step-sync-mode` | `data-live-view` | `<video>` | 문구 | 콘솔 에러 |
|---|---|---|---|---|---|---|---|
| `11ebf349` | timeout | **0** | **`ended`** | canvas | 0 | **"실행이 끝났습니다. 이 실행에는 다시 볼 화면 증적이 남아 있지 않습니다."** | 0 |
| `13d3c882` | timeout | 3 | `video` | video | 1 (`rs=4` `dur=46.04`) | — | 0 |
| `3b16c834` | timeout | 1(수습) | `video` | video | 1 (`rs=4` `dur=Infinity`) | — | 0 |
| `dab0c9a1` | cancelled | 3 | `video` | video | 1 (`rs=4` `dur=20.12`) | — | 0 |
| `5aa1110a` | passed | 1 | `video` | video | 1 (`rs=4` `dur=1.16`) | — | 0 |
| `e86c85d0` | failed(녹화) | 5 | `video` | video | 1 (`rs=4` `dur=12.04`) | — | 0 |

가로 넘침 **전부 false** · 콘솔 에러 **전부 0건**.
스크린샷: `g13-ui-11ebf349.png`(증적 없음) · `g13-ui-13d3c882.png` · `g13-ui-3b16c834.png` · `g13-ui-dab0c9a1.png`

### 8.1 고친 것 — 끝난 실행이 `live` 로 남던 문제

진단에서 본 `data-step-sync-mode="live"`(끝난 `timeout` run) 는 **화면 동작은 옳았다** —
`data-live-phase=idle`, 안내 문구도 §6 표대로였고 콘솔 에러도 0건이었다.
틀린 것은 **이름**이다. `StepSyncMode` 가 `"live" | "video"` 뿐이라 "영상이 안 붙었다"가
전부 `live` 로 뭉개졌고, DOM 을 보는 사람에게 **끝난 실행이 라이브 모드로 멈춘 것처럼** 읽혔다
(실제로 그 오독이 일어났다). `"ended"` 를 더해 사실과 이름을 맞췄다.
**강조 로직은 한 줄도 바뀌지 않는다**(`live` 와 같은 값을 쓴다). `mode === "video"` 를 보는
호출부 2곳(`RunScreen`·`RunStepList`)도 그대로다.

판단 자체는 `stepSyncMode(run, videoAttached)` 순수 함수로 빼서 단위 테스트로 못박았다 —
이 레포에는 훅 렌더 하네스가 없고 **새 의존성을 넣지 않기** 때문이다.

### 8.2 `net::ERR_ABORTED` 1건 — 사실대로

`13d3c882`·`3b16c834` 화면에서 `GET /api/artifacts/<id>` 가 `net::ERR_ABORTED` 로 **1건**
잡혔다(회차에 따라 0건이기도 하다). `<video preload="metadata">` 가 메타데이터만 읽고 요청을
스스로 끊는 Chromium 동작이고, 같은 화면에서 `readyState=4`·`duration=46.04`·seek 성공이라
**재생에는 영향이 없다.** HTTP 4xx/5xx 가 아니다. 고치려면 `preload` 정책을 건드려야 하는데
그건 이번 범위가 아니다 — §11 에 남긴다.

---

## 9. 회귀

| 항목 | 결과 |
|---|---|
| 정상 **성공** 코드 실행 | `passed` · 증적 **1건**(`video:15916`) — §5.5 정책(성공은 영상만) 유지 |
| **실패** 코드 실행 | `failed` · 증적 **3건**(`screenshot:24377 trace:787156 video:66741`) |
| **녹화(steps)** 실행 | 증적 **5건**(`screenshot video trace console_log network_log`) — 경로 무수정 |
| 라이브 스트림 | `[live] CDP 부착 성공` · `frames 244/1105` 정상 (타임아웃 실행 중에도) |
| 영상 ↔ 스텝 동기화(#12) | 타임아웃 run 영상에서 강조가 `#2 → #4` 로 따라가고 **모든 지점에서 행이 보임=true** |
| `features/recorder/**` | **`git diff` 0줄** |
| 손대지 말 것(`docker-compose.yml`·`guard.ts`·`.gitattributes`·`.npmrc`·`poc/**`·`packages/contracts`) | **`git diff` 0줄** |
| DB 마이그레이션 | **없음**(스키마 무변경) |
| 새 런타임 의존성 | **0개** |

---

## 10. 기준선 · 번들

| 항목 | 기준선 | 이번 | 판정 |
|---|---|---|---|
| `pnpm typecheck` | 7/7 | **7 successful, 7 total** | ✅ |
| `pnpm lint` | 0 problems | **7/7 · 0 problems** | ✅ |
| `pnpm build` | 5/5 · 500KB 경고 없음 | **5/5 · 경고 0건** | ✅ |
| `pnpm test` | 689건 이상 | **700건** (contracts 199 · api 145 · web **103** · runner **253**) | ✅ **+11** |
| `style={{` (tsx) | 2건 | **2건** (신규 0) | ✅ |
| HEX 스타일 값 | 0건 | **0건** (문법상 매치는 전부 시안 참조 **주석** — main 과 동일) | ✅ |

### 번들 (같은 머신 · 같은 명령 · before 는 `git stash`(web만) 상태에서 측정)

| 청크 | before | after | 델타 |
|---|---|---|---|
| `vendor-react` | 218.82 KB (gzip 68.24) | **218.82 KB** (gzip 68.24) | **0** |
| `index` (진입) | 304.73 KB (gzip 95.45) | **304.73 KB** (gzip 95.45) | **0** |
| **초기 로드 JS 합** | **523.55 KB** | **523.55 KB** | **0** ✅ |
| CSS | 44.10 KB (gzip 9.81) | **44.10 KB** (gzip 9.81) | **0** |
| `RunDetail` (lazy) | 33.74 KB (gzip 10.44) | **33.80 KB** (gzip 10.46) | **+0.06 KB** |

★ 변경이 전부 lazy 청크 안에 있다. 초기 로드 **1바이트도 늘지 않았다.**

---

## 11. 생성·수정 파일

### 수정
| 파일 | 내용 |
|---|---|
| `apps/runner/src/env.ts` | `gracefulStopMs` + `DEFAULT_GRACEFUL_STOP_MS`(**실측표 주석**) |
| `apps/runner/src/execute/code-executor.ts` | **2단 종료**(SIGINT→TERM→KILL) · 증적 수집을 `finally` 로 · 수집 실패 격리 |
| `apps/runner/src/execute/code-container.ts` | `CodeContainerHandle.interrupt()` (`docker kill -s INT`) |
| `apps/runner/src/execute/code-artifacts.ts` | `salvage` 옵션 · `isPlayableWebm()` · `salvagePartialVideos()` |
| `apps/runner/src/execute/code-artifacts.spec.ts` | +11건 (webm 검증 6 · salvage 5) |
| `apps/web/src/features/live/useStepSync.ts` | `StepSyncMode` 에 `"ended"` 추가 · `stepSyncMode()` 순수 함수로 분리 |
| `apps/web/src/features/live/useStepSync.spec.ts` | +4건 |

### 신규(커밋 안 함)
`apps/runner/g13/**` — 검증 하네스 6종.

### 신규(커밋)
`.pipeline/20260917-231945/13-artifacts-on-timeout.md` + `g13-ui-*.png` 4장.

---

## 12. 미검증 · 남은 것

1. **`project-save`(33스텝) 실물로는 못 돌렸다.** 실측은 4스텝 시나리오다. 10초 유예를 고른
   근거에 "33스텝은 trace packing 이 더 걸린다"를 넣었지만 그 값 자체는 **추정**이다.
   배포 후 첫 타임아웃에서 `우아한 종료 유예 초과` 로그가 나오는지 확인해야 한다 —
   나오면 `RUNNER_GRACEFUL_STOP_MS` 를 올리면 된다(코드 변경 없음).
2. **동시 실행 2건이 동시에 타임아웃**하는 경우는 안 돌렸다. 신호는 run 별 컨테이너·프로세스에
   가므로 독립이지만 실측은 없다.
3. **`net::ERR_ABORTED`**(§8.2) — `preload` 정책은 손대지 않았다.
4. **보관 기간 정책** — 라운드 4의 §10 그대로 남는다. 타임아웃 실행에도 영상이 남기 시작했으므로
   디스크 증가분이 조금 더 커진다(실측 45초 실행 ≈ 400KB).
5. 세션 중 **`apps/runner/ui-verify.mjs`(이전 라운드의 미추적 스크래치 파일)가 사라졌다.**
   원인을 특정하지 못했고 git 에 없어 복구할 수 없다. 이번 변경과의 인과는 확인되지 않았다.
