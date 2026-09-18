---
# Gen Artifact
pipeline_id: 20260917-231945
phase: 11-live-keyframe-replay
feature: 라이브 화면을 언제 접속해도 보이게 + 끝난 실행을 영상으로 다시 보기
branch: feat/live-keyframe-replay
base: main (e0c177b)
---

# 라운드 4 — 늦게 접속해도 보이는 라이브 + 끝난 실행 영상 다시 보기

## 0. 한 줄 요약

**정지 화면에 늦게 접속한 뷰어가 8초 동안 프레임을 0장 받던 것을 1장(6ms)으로 고쳤고**
(음성 대조군으로 before/after 를 같은 스크립트로 실측), **두 탭이 서로를 끊던 sink 1개 제약을
브로드캐스트로 풀었으며**, **끝난 실행은 `<video>` 로 실제 재생된다**(`readyState 4` ·
`currentTime 1.511` · seek 정확 · Range **206**). 성공한 실행도 영상을 남기도록 정책을 바꿨다
(실측 비용 **6.7 KB/s**). 기준선 4종 유지 · 초기 로드 JS **증가 0** · 콘솔 에러 0건.

---

## 1. ★★ 핵심 증명 — 정지 화면에서 늦게 접속한 뷰어 (픽셀·프레임 실측)

### 1.1 before / after — **같은 스크립트, 같은 시나리오, 빌드만 교체**

정지 구간이 시작되고 **16초 뒤**에 뷰어 2명이 새로 접속해 **8초간** 관측했다.
(`g11/wsprobe.mjs` — 웹 화면을 거치지 않고 WS 만 본다. "캔버스가 검다"의 원인이
화면인지 스트림인지 가르기 위해서다.)

| | **before** (main 빌드) | **after** (이 브랜치) |
|---|---|---|
| viewer1 프레임 / 8초 | **0장** · 첫 프레임 **없음** | **1장** · 첫 프레임 **6ms** |
| viewer2 프레임 / 8초 | **0장** · 첫 프레임 **없음** | **1장** · 첫 프레임 **1ms** |
| 받은 바이트 | 0 | **21,198 B** (양쪽 동일 = 같은 캐시 프레임) |
| viewer2 접속 시 viewer1 | **close 1000 "run finished"** ← 쫓겨났다 | **close = null** ← 살아 있다 |

before 로그 원문:

```
[viewer1] 프레임=0 첫프레임=★ 없음 bytes=0 close={"code":1000,"reason":"run finished"} states=[{"t":"state","state":"live"}]
[viewer2] 프레임=0 첫프레임=★ 없음 bytes=0 close=null                                   states=[{"t":"state","state":"live"}]
```

★ before 의 viewer1 은 **"실행이 끝났다"는 close 를 받았다** — 실제로는 실행 중이었다.
화면은 그것을 그대로 믿고 `실행 종료 · 마지막 화면` 배지를 그렸다(UI 실측으로도 재현했다).
즉 라운드 2의 sink 1개 제약은 "두 번째 탭이 이긴다"가 아니라 **첫 탭에 거짓말을 하는**
형태로 드러난다.

after 로그 원문:

```
[viewer1] 프레임=1 첫프레임=6ms bytes=21198 close=null states=[{"t":"state","state":"live"}]
[viewer2] 프레임=1 첫프레임=1ms bytes=21198 close=null states=[{"t":"state","state":"live"}]
```

### 1.2 ★ 캔버스 픽셀 — 검은 화면이 아님을 증명

웹 화면(`vite preview` 빌드 산출물)을 진짜 headless Chromium 으로 열어
`canvas.getContext("2d").getImageData()` 로 직접 읽었다.

| 뷰어 | 첫 프레임까지 | 좌상단 RGB | 중앙 RGB | 서로 다른 색 | `hidden` |
|---|---|---|---|---|---|
| **A** (정지 구간 16초 뒤 신규 접속) | **381 ms** | **(244,248,247)** | **(244,248,247)** | **256종** | false |
| **B** (A 이후 두 번째 탭) | **382 ms** | **(244,248,247)** | **(244,248,247)** | **256종** | false |

`(244,248,247)` = 대상 페이지 `record-login.html` 의 `#f5f7f6` 다(라운드 1·2·3과 같은 값).
**서로 다른 색 256종** = 단색(=검은 화면)이 아니다. 육안 증거
[`g11-late-viewerA.png`](./g11-late-viewerA.png) 에 **`FROZEN-VIEW` 가 입력된 로그인 폼 ·
계약서 A/B/C 목록**이 찍혔다 — 실행 중인 그 페이지 그대로다.

진단 속성도 같이 확인했다: `data-live-phase="live"` · `data-live-connection="open"` ·
`data-live-frame="true"` · `data-live-view="canvas"`.

### 1.3 ★ "정지 화면"을 실제로 만들기까지 — 첫 측정은 함정에 빠졌다 (정직하게)

처음에 `page.waitForTimeout(45000)` 만으로 정지 구간을 만들었더니 **before 빌드에서도
프레임이 왔다**(912ms). 원인 두 가지 —

1. fixture `record-login.html` 에는 **fps 측정용 rAF 막대가 내장**돼 있다(04-gen-3 Task 3.1).
   매 프레임 리페인트다.
2. `page.fill()` 이 입력에 포커스를 남겨 **캐럿이 깜빡인다**. 이것도 리페인트다.

그래서 **fixture 를 고치지 않고 테스트 코드 안에서** 멈췄다
(`window.requestAnimationFrame = () => 0` + `animation/transition/caret-color` 무력화 + `blur()`).
그 뒤에야 before 가 **0장**으로 떨어졌다. **이 함정을 밟지 않았다면 "고쳤다"는 증거가
아무것도 검사하지 않는 측정이 될 뻔했다.**

---

## 2. 채택한 키프레임 전략과 근거 — **캐시 + 강제 캡처 조합**

| 단계 | 언제 | 무엇 | 비용 |
|---|---|---|---|
| ① **마지막 프레임 캐시** | 뷰어가 붙을 때 캐시가 **있으면** | 세션이 들고 있던 최신 JPEG 1장을 그 소켓에 **즉시** 보낸다 | **0** (메모리 JPEG 1장 = 실측 **21KB**) |
| ② **키프레임 강제 캡처** | 캐시가 **비었을 때만** | CDP `Page.captureScreenshot` 1회 → `pushFrame()` 으로 전 뷰어에 | 렌더러 1회 (700ms 스로틀·요청 합치기) |

**왜 조합인가.** 캐시만으로는 **그 page 의 첫 프레임이 아직 없는 구간**(테스트 시작 직후,
worker 재바인딩 직후)이 비고, 캡처만 쓰면 뷰어가 붙을 때마다 실행 중인 남의 페이지에
개입한다. 캐시가 ①의 99%를 0원에 처리하고, ②는 남은 구멍만 막는다.

**구현에서 지킨 것 3가지**

- **`page.screenshot()` 이 아니라 CDP 를 직접 쓴다.** Playwright 의 스크린샷은 기본값
  `caret: "hide"` 로 **페이지에 스타일을 주입**하고 폰트·애니메이션을 기다린다 — 실행 중인
  남의 테스트에 개입하는 짓이다. `Page.captureScreenshot` 은 렌더러의 현재 프레임을 읽을 뿐이고
  **screencast 와 같은 출처**다.
- **캡처 대상은 `handles` Set 이 아니라 "가장 최근에 붙은 page"** 다. 테스트 경계에서 이전
  page 가 아직 닫히지 않은 채 새 page 가 붙는 구간이 있는데, 그때 옛 page 를 찍으면
  **한 테스트 전 화면을 지금 화면인 것처럼** 보내게 된다.
- **키프레임도 `pushFrame()` 을 탄다.** 그래야 캐시가 채워지고 상태가 `live` 로 올라가
  다음 뷰어는 캡처 없이 즉시 본다. 실측: 1번째 뷰어만 `keyframesRequested=1`,
  2번째 뷰어는 캡처 0회 + 캐시로 즉시(단위 테스트로 고정).
- **실패는 조용히 넘긴다.** page 가 닫히는 중이면 `null` — 라이브는 실행의 전제가 아니다
  (04-gen-4 Task 4.4 규칙 그대로).

`pageAttached()` 에서도 **뷰어가 있을 때만** 키프레임을 당긴다. 새 테스트의 첫 화면이
정지 상태면 보고 있던 뷰어가 **이전 테스트의 마지막 화면**에 멈춘 채 남기 때문이다.

---

## 3. ★★ 다중 뷰어 — sink 1개 제약을 어떻게 풀었나

04-gen-4 **결정 7**("최신이 이긴다 · sink 1개")을 되돌렸다.

| | before | after |
|---|---|---|
| 자료구조 | `sink: LiveStreamSink \| null` | **`sinks: Set<LiveStreamSink>`** |
| `attach()` 반환 | 이전 sink(호출부가 `finish()` 로 닫았다) | **`void`** — 아무도 닫지 않는다 |
| 프레임 | `sink.frame(f)` | `for (const s of [...sinks]) s.frame(f)` |
| 상태·오류·종료 | `sink?.message(...)` | `broadcast(...)` |
| 백프레셔 | 소켓 1개 | **소켓별 그대로** (`ws-server.ts` 가 각자 `bufferedAmount` 를 본다) |

★ **느린 뷰어가 빠른 뷰어를 끌어내리지 않는다** — 드롭 판단은 여전히 소켓을 아는 쪽에만 있다
(`live-stream.ts` 의 `LiveStreamSink` 주석 규율 그대로. 여기에 큐를 만들면 드롭 정책이 두 벌이 된다).

### 3.1 실측 (UI, 두 탭)

```
★ 뷰어 A 첫 프레임까지 381ms   → phase=live conn=open frame=true  색 256종
★ 뷰어 B 첫 프레임까지 382ms   → phase=live conn=open frame=true  색 256종
★ A 소켓 살아 있나 = true (conn=open)      ← B 가 붙은 뒤
★ B 종료 후에도 A conn=open frame=true     ← B 탭을 닫은 뒤
[콘솔 에러] A: 0  B: 0
```

Runner 로그도 뷰어 수를 센다: `라이브 뷰어 접속 — 현재 뷰어 2명` /
`라이브 뷰어 종료 — … 남은 뷰어 1명(다른 뷰어는 계속 받는다)`.

### 3.2 ★ 토큰 슬롯도 같이 풀어야 했다 (실측으로 드러난 두 번째 제약)

브로드캐스트만 고치면 **여전히 두 탭이 동시에 열릴 때 한쪽이 4401** 을 맞는다.
`liveStreamTokenKey(runId)` 는 run 당 **슬롯이 하나**라, 두 번째 탭의
`GET /api/runs/:id/live` 가 첫 탭의 토큰을 **즉시 무효화**하기 때문이다.

→ **해시별 키를 하나 더** 쓴다(`liveStreamTokenMemberKey(runId, sha256(token))`).

- 기존 단일 슬롯은 **그대로 살아 있다** — Runner 는 그것을 **먼저** 보고(기존 동작·기존
  타이밍 안전 비교 무변경), 어긋날 때만 해시별 키의 **존재 여부**를 본다.
- 해시별 키는 **키 이름 자체가 `sha256(token)`** 이다. 토큰을 모르면 그 키에 닿을 수 없으므로
  추측 불가는 그대로고, 비교 대상이 비밀값이 아니라 타이밍 안전 비교가 필요 없다.
- **키 공간 분리는 한 글자도 흔들리지 않는다** — 접두사가 여전히 `testflow:run:token:` 이다.
  녹화 발급은 해시별 키를 **만들지 않는다**(테스트로 고정).
- 각 토큰은 자기 TTL(120초)로 사라진다.

---

## 4. ★ 토큰 TTL(120초) 초과 · 재연결 실측

### 4.1 긴 실행에서 소켓은 끊기지 않는다

`test.setTimeout(220000)` + `waitForTimeout(150000)` 짜리 실행에서 뷰어 1명을 계속 열어 뒀다.

```
[+7s]   {"phase":"live","conn":"open","frame":"true"}
[+27s]  … [+47s] … [+67s] … [+87s] … [+107s] …
[+127s] {"phase":"live","conn":"open","frame":"true"}    ← ★ TTL 120초 초과
[+147s] {"phase":"live","conn":"open","frame":"true"}
```

**토큰은 핸드셰이크에서만 검증된다** — 연결이 유지되는 한 TTL 은 영향이 없다.

### 4.2 TTL 이 지난 뒤 **새 뷰어**가 붙는다

```
★ +148s (TTL 120초 경과 후) 새 뷰어 프레임 수신 = true
```

새 뷰어는 그 시점에 토큰을 새로 발급받으므로 TTL 과 무관하다.

### 4.3 ★ 비정상 종료 뒤 자동 재연결 — **고쳤다**

라운드 2는 자동 재시도를 **전부 껐다**("토큰이 1회용이고 재발급이 곧 이전 토큰 무효화").
§3.2 로 그 전제가 사라졌으므로 **상한 5회 · 지수 백오프(1→2→4→8→10초)** 재연결을 넣었다.

**끊는 방법을 찾는 데 실측이 두 번 실패했다** — `context.setOffline(true)` 도
CDP `Network.emulateNetworkConditions {offline:true}` 도 **이미 열린 루프백 WS 를 끊지 못했다**
(둘 다 `conn=open` 유지, 재연결 0회 = 테스트가 아무것도 검사하지 않았다).
그래서 **4200 → 4100 TCP 중계**를 세우고 `RUNNER_WS_LIVE_PUBLIC_URL` 로 웹을 그쪽으로 보낸 뒤
중계 연결을 통째로 끊었다 = **nginx 재시작 / 프록시 타임아웃과 같은 형태**다.

```
  [ws open] 1번째 라이브 소켓 · token=RR3rJWco…
[접속 직후] {"phase":"live","conn":"open","frame":"true"}
— 135초 대기(토큰 TTL 120초 초과 구간 진입) —
[대기 +135s] {"phase":"live","conn":"open","frame":"true"}
— 프록시 연결 강제 종료 — destroyed 2
  [ws close] 소켓 종료
  [ws open] 2번째 라이브 소켓 · token=JgX1aOmO…      ← ★ 새 토큰으로 다시 붙었다
[복구 +1.5s] {"phase":"live","conn":"open","frame":"true"}
★ 자동 재연결 성공 = true
★ 끊긴 동안 마지막 프레임 유지 = true
[콘솔 에러] 0
```

★ **끊긴 동안에도 캔버스가 비지 않는다.** `hasFrame` 은 소켓이 아니라 **캔버스**의 성질이라
재연결 중(`settled === false`)에도 유지하도록 고쳤다. 안 그러면 재연결 1초 사이에 캔버스가
숨고 "화면이 없습니다" 안내가 번쩍인다(라운드 2 버그와 같은 꼴).

**재연결 중에는 오류 문구를 띄우지 않는다**(`notice = null`). 상한 5회를 다 쓴 뒤에만
close 분류 문구 + "다시 연결" 버튼이 남는다.

---

## 5. ★★ 끝난 실행을 영상으로 다시 보기

### 5.1 먼저 확인한 사실 — 라운드 2의 "영상으로 보기"는 **있었지만 닿을 수 없었다**

- `LiveCanvas` 에 `<video>` 인라인 재생과 토글 버튼이 **이미 있었다**(다운로드 전용이 아니다).
- 그러나 ⓐ **끝난 run 을 새로 열면 자동으로 켜지지 않았고**(사용자가 버튼을 찾아야 한다),
  ⓑ `video: "retain-on-failure"` 라 **성공한 실행에는 영상 자체가 없었고**,
  ⓒ **녹화(steps) 실행에는 무대 자체가 없었으며**,
  ⓓ API 가 **Range 를 지원하지 않아** 탐색이 받쳐지지 않았다.

네 가지를 전부 고쳤다.

### 5.2 ★ 실제로 재생되는가 — `<video>` 실측

**성공한** 코드 실행(RUN-0189)을 **새 탭에서 처음** 열었다.

```
무대 속성: {"phase":"idle","view":"video","frame":"false"}      ← ★ 자동 영상 모드
★ video 요소 개수 = 1
★ 메타데이터 로드 후: {"readyState":4,"networkState":1,"duration":4.4,"currentTime":0,
                      "videoWidth":800,"videoHeight":500,"paused":true,"error":null}
★ play() 1.5초 후:   {"readyState":4,"duration":4.4,"currentTime":1.511,"paused":false,"error":null}
★ 실제로 재생됐다 = true
★ seek(3.08) 후:     {"readyState":4,"duration":4.4,"currentTime":3.08,"paused":true,"error":null}
★ seek 성공 = true
토글 후 view = canvas · video 개수 = 0        ← 사용자 선택이 자동 모드를 이긴다
Range 요청/206: bytes=0-, → 206
[콘솔 에러] 0
```

`readyState 4`(HAVE_ENOUGH_DATA) · `error null` · `currentTime` 이 **실제로 흐른다**.
육안 증거 [`g11-replay-video.png`](./g11-replay-video.png) 에 `REPLAY-ME` 가 입력된
녹화 프레임(t=3.08s)이 찍혔다.

### 5.3 자동 전환을 **두 경우로 갈랐다**

라운드 2 결정("자동 전환하지 않는다 — 마지막 화면을 보고 있는데 처음으로 되감기는 꼴")은
**실행 중 → 종료 순간**의 것이다. **이미 끝난 run 을 새로 열 때는 반대**다 — 라이브는 404 라
캔버스가 영영 비고, 버튼을 찾기 전까지 아무것도 볼 수 없다.

| 경우 | 판단 | 동작 |
|---|---|---|
| 보고 있던 실행이 **끝나는 순간** | 마지막 프레임이 정보가 가장 많다 | **전환하지 않는다**(라운드 2 그대로) |
| **이미 끝난 run 을 새로 연다** | 보여 줄 라이브가 없다 | **영상이 기본** |
| 사용자가 토글을 누른 뒤 | 명시적 의사 | **사용자 선택이 언제나 이긴다** |

구현은 `autoVideo` prop 하나다. 값은 **마운트 시점의 사실**로 고정한다
(`useState(() => isTerminalRunStatus(run.status))` — `useRef` 는 `react-hooks/refs` 가 렌더 중
접근을 막는다). 사용자의 선택은 `videoChoice: boolean | null` 로 따로 들고,
`null` 일 때만 `autoVideo` 를 따른다.

### 5.4 ★ Range / Content-Type 실측 (`curl`)

```
$ curl -D- http://…/api/artifacts/<id>
HTTP/1.1 200 OK
Content-Type: video/webm
Content-Disposition: inline; filename="video.webm"
Accept-Ranges: bytes                      ← ★ 이게 없으면 브라우저가 seek 을 시도조차 않는다
Content-Length: 37528

$ curl -r 0-1000 …
HTTP/1.1 206 Partial Content               ← ★
Content-Range: bytes 0-1000/37528
Content-Length: 1001                       ← 실제로 1001 바이트만 왔다

$ curl -r 30000- …          → 206 Partial Content
$ curl -r 99999999-…        → 416 Range Not Satisfiable · Content-Range: bytes */37528
```

- **다중 구간(`bytes=0-9,20-29`)은 지원하지 않는다** — `multipart/byteranges` 를 만들지 않고
  **null 로 떨어뜨려 200 + 전체**를 준다. 지원하는 척하며 206 에 한 구간만 실으면
  브라우저가 **조용히 깨진 파일**을 받는다. 미디어 재생은 다중 구간을 쓰지 않는다.
- Range 가 오면 `createReadStream(path, {start, end})` 로 **그 구간만 읽는다**. 전체를 읽고
  잘라 주면 200MB 영상의 마지막 1초를 보려는 seek 이 200MB 디스크 읽기가 된다.
- 파서는 순수 함수라 **단위 테스트 13건**으로 고정했다(`artifacts.range.spec.ts`).

### 5.5 ★ 성공한 실행 영상 보관 정책 — **남긴다**. 디스크 비용 실측.

| 경로 | before | after | 근거 |
|---|---|---|---|
| 코드 실행 (`pw-config.ts`) | `video: "retain-on-failure"` | **`video: "on"`** | 성공 실행에 영상이 **아예 없었다** |
| 녹화 실행 (`artifacts.ts`) | 성공이면 `workDir` 통째 삭제 | **영상만 남기고 나머지는 버린다** | 두 경로가 다른 정책이면 "어떤 실행은 다시 보기가 되고 어떤 실행은 안 되는" 꼴 |
| `trace` · `screenshot` · console/network | 실패 시에만 | **그대로 실패 시에만** | 그것들은 **디버깅** 자료다. 영상보다 비싸고(trace 실측 328KB / 2스텝) 성공 실행에서 볼 이유가 없다 |

**실측 비용** (1280×800 · Playwright webm):

| 표본 | 영상 시간 | 크기 | 초당 |
|---|---|---|---|
| 정지 화면 45초 실행 × 8건 | ~50초 | 284~369 KB | **약 6.7 KB/s** |
| 짧은 코드 실행(RUN-0189) | 4.4초 | 37.5 KB | 8.5 KB/s |
| 녹화 실행 2스텝(RUN-0196) | ~1초 | 60.6 KB | — |

**추정**: 평균 30초 실행 ≈ **200 KB/건**. 하루 200 실행이면 **약 40 MB/일 · 1.2 GB/월**.
(참고로 실패 1건의 trace 만 328 KB 다. 영상 전량 보관이 trace 보관보다 싸다.)
보관 기간 정책은 이번 범위 밖이다 — §10 에 남긴다.

### 5.6 ★ 끝난 **녹화(steps) 실행**도 같은 자리에서 본다

라운드 3까지 전폭 무대는 `sourceType === "code"` 전용이었다. 이제 **끝난 녹화 실행에
영상이 있으면** 같은 무대를 쓴다(`showStage()`). 우측 360px 축소판으로는 1280×800 영상을
볼 수 없고(28%), "다시 보기"가 실행 종류에 따라 되기도 안 되기도 하면 그건 기능이 아니라 우연이다.

**진행 중인 녹화 실행에는 무대를 세우지 않는다** — 스트림이 오지 않는 자리에 전폭 빈 상자를
세우면 "고장났다"로 읽힌다(라운드 3 규율 그대로).

실측(성공한 녹화 실행 RUN-0196):

```
[steps 실행] 무대 = 1 · 우측 목업 = 0 · video = 1
[steps 실행] 스텝 행 = 2
증적 수 1 →  video video/webm 60620        ← ★ 성공인데 영상이 남았다(trace·로그는 없다)
```

`RunSidePanel` 은 `sourceType === "code"` 가 아니라 **`stageShown`** 으로 브라우저 목업을
접는다 — 같은 화면을 두 번 그리면 "어느 쪽이 진짜인가"를 매번 판단하게 만든다.

---

## 6. ★ 상태별 문구 표 (실측)

라운드 3까지는 프레임이 없으면 **언제나** `"표시할 실행 화면이 아직 없습니다 …"` 였다.
실행이 한창 도는 중에도 그 문구가 떠서 사용자에게는 "고장났다"로 읽혔다 — 진단의 눈에
보이는 증상이 정확히 이것이다.

| run 상태 | 스트림 상태 | 화면 | 문구 | 실측 |
|---|---|---|---|---|
| `queued` | 소켓 open, 세션 대기 | 안내 | **"실행이 큐에서 대기 중입니다. Runner 가 이 실행을 가져가면 이 자리에 실제 브라우저 화면이 그려집니다."** | ✅ `phase=connecting` |
| `running` · 첫 프레임 전 | `between-tests` | 오버레이 | **"실행 화면을 준비하는 중…"** | ✅ |
| `running` · 테스트 경계 | `between-tests` (첫 프레임 이후) | 마지막 프레임 + 오버레이 | **"다음 테스트 준비 중…"** | ✅ (400ms 지연 표시 유지) |
| `running` · 화면 정지 | `live` | **캔버스(캐시/키프레임)** | 없음 | ✅ §1 |
| `running` · 프레임 없음(안내만) | — | 안내 | **"실행 중입니다. 실행 화면을 불러오는 중이며, 화면이 준비되는 대로 이 자리에 그려집니다."** | ✅ |
| 재연결 중 (그림 있음) | `connecting` | 마지막 프레임 + 오버레이 | **"실행 화면에 다시 연결하는 중… (N회)"** | 코드 확인 |
| 종료 · 프레임 있음 | `ended` | 마지막 프레임 + 배지 | **"실행 성공/실패 · 마지막 화면"** | ✅ |
| 종료 · 영상 있음(새로 열기) | `idle` | **`<video>`** | (자동 재생 모드) | ✅ §5.2 |
| 종료 · 영상 없음 | `idle` | 안내 | **"실행이 끝났습니다. 이 실행에는 다시 볼 화면 증적이 남아 있지 않습니다."** | 코드 확인 |
| CDP 부착 실패 | `unavailable` | 안내 + 서버 문구 | 서버가 준 한국어 그대로 | 라운드 2 그대로 |

```
[대기]   status=queued  {"phase":"connecting",...}  "◇ 실행이 큐에서 대기 중입니다. …"
[실행중] status=running {"phase":"live","frame":"true"}   오버레이 없음
[첫프레임 전] status=running {"phase":"between-tests","frame":"false"} 오버레이="실행 화면을 준비하는 중…"
[종료]   status=passed  {"phase":"idle","view":"video"}   "… 크게 보기 실행 화면으로"
★ 모든 상태에서 "화면이 아직 없습니다" 포함 = false
```

**연결 오버레이는 그림이 있을 때만 띄운다.** 프레임이 하나도 없을 때는 아래 안내가 이미
run 상태에 맞는 말을 하고 있어, 그 위에 "연결하는 중"을 덮으면 **같은 순간에 두 설명이 겹친다.**

### 6.1 실측으로 발견해 같이 고친 것 — `phase` 가 `idle` 에 머물렀다

run 이 **큐에 있는 동안**에는 핸드셰이크는 끝났지만 Runner 가 아직 세션을 열지 않아
`{t:"state"}` 가 오지 않는다(서버가 최대 15초 기다린다 — 04-gen-4 이슈 1).
그 구간 내내 `data-live-phase="idle"`("스트림을 열지 않았다")로 남아 **진단 속성이 사실과
어긋났다**. 소켓이 열렸으면 최소한 "연결됨 · 첫 신호 대기 중" = `connecting` 이다.
`onopen` 에서 `idle → connecting` 으로 올리도록 고쳤고, 위 표의 `queued` 행이 그 결과다.

---

## 7. 회귀 확인

| 항목 | 결과 |
|---|---|
| **★ 녹화 클릭 정확도 (공용 `screencast.ts` 를 고쳤으므로 재측정)** | **27/27 = 100.0% · 최대 오차 0.00 px** · pageScale 1.000 · 입력 드라이버 **2종 모두** (배율 100/70/130% 매트릭스) |
| 프레임 지연 / fps (같은 측정) | p50 11.6ms · **p95 14.2ms** (기준 200ms) · **60.13 fps** · 드롭 0 |
| **녹화 경로 실제 녹화 1회** | 캔버스 중앙 **(244,248,247)** · 색 **245종** · 캔버스 클릭 3회 → **스텝 3건 누적** → 종료 후 4건 |
| 기존 코드 실행 1회 | RUN-0189 `passed 5/5` · 라이브·영상 정상 |
| 녹화 기반(steps) 실행 1회 | RUN-0196 `passed 2/2` · 무대 1 · 우측 목업 0 · `<video>` 1 |
| 라이브 전폭 / 확대 모드 | `data-expanded=true` · 캔버스 **1402×876** · **Esc 로 축소** |
| 반응형 1440 / 1050 / 760 | 가로 넘침 **전부 false** |
| `prefers-reduced-motion` | 가로 넘침 false · 렌더 정상 |
| **콘솔 에러** | **0건** (모든 시나리오) |
| **HTTP 실패** | **0건** |
| `features/recorder/**` | **`git diff` 0줄** (무수정) |
| 손대지 말 것 (`docker-compose.yml` · `guard.ts` · `.gitattributes` · `.npmrc` · `poc/**`) | **`git diff` 0줄** |

> ⚠️ `poc:measure` 는 `.pipeline/20260917-114450/poc1-measurements.json` 을 덮어쓴다.
> 라운드 1의 30초 측정 기록이므로 **원본으로 되돌렸다**(`git checkout`). 위 수치는 6초 구간이다.

---

## 8. 기준선 · 번들

| 항목 | 기준선 | 이번 | 판정 |
|---|---|---|---|
| `pnpm typecheck` | 7/7 | **7 successful, 7 total** | ✅ |
| `pnpm lint` | 0 problems | **7/7 · 0 problems** | ✅ |
| `pnpm build` | 5/5 · 500KB 경고 없음 | **5/5 · 경고 0건** | ✅ |
| `pnpm test` | 641건 이상 | **667건** (contracts 199 · api **145** · web 81 · runner **242**) | ✅ **+26** |
| HEX 스타일 값 (`apps/web/src`) | 0건 | **0건** (문법상 31건은 전부 시안 참조 **주석** — main 과 동일) | ✅ |
| `style={{` | 2건(기존 CSS 변수 주입) | **2건** (신규 0) | ✅ |
| `globals.css` 새 토큰 | — | **0개** (기존 토큰만 씀) | ✅ |

### 번들 (같은 머신 · 같은 명령 · before 는 `git stash` 상태에서 측정)

| 청크 | before | after | 델타 |
|---|---|---|---|
| `vendor-react` | 218.82 KB (gzip 68.24) | **218.82 KB** | **0** |
| `index` (진입) | 304.73 KB (gzip 95.44) | **304.73 KB** (gzip 95.44) | **0** |
| **초기 로드 JS 합** | **523.55 KB** | **523.55 KB** | **0** |
| CSS | 43.94 KB (gzip 9.76) | **43.94 KB** | **0** |
| `RunDetail` (lazy) | 26.87 KB (gzip 8.28) | **28.52 KB** (gzip 8.78) | **+1.65 KB** |

★ **초기 로드가 1바이트도 늘지 않았다.** 변경이 전부 lazy 청크(`RunDetail`) 안에 있다.
(기준선 문구의 "549KB 수준"은 라운드 2 시점 값이다. 현재 main 의 실측이 523.55KB 이고
이 브랜치도 같다 — 비교는 같은 머신에서 직접 잰 두 값으로 했다.)

---

## 9. 생성 / 수정 파일

### 신규 (1)

| 파일 | 내용 |
|---|---|
| `apps/api/src/modules/artifacts/artifacts.range.spec.ts` | Range 파서 **13건** — 단일 구간 6 · 거부/미지원 7 |

### 수정 (19)

**Runner**

| 파일 | 변경 |
|---|---|
| `src/execute/live-stream.ts` | ★ **`Set<LiveStreamSink>` 브로드캐스트** · **마지막 프레임 캐시** · **키프레임 공급자**(합치기 + 700ms 스로틀) · `stats()` 3필드 추가 · `hasCachedFrame()` |
| `src/record/screencast.ts` | ★ `ScreencastHandle.captureKeyframe()` **추가**(CDP `Page.captureScreenshot`). **시그니처 `StartScreencast` 불변** |
| `src/execute/code-browser.ts` | 키프레임 공급자 배선 · **최근 page 핸들** 추적 · `stop()` 에서 해제 |
| `src/record/ws-server.ts` | `attach()` 반환 없음(이전 뷰어를 닫지 않는다) · **해시별 토큰 키 허용** · 뷰어 수 로그 |
| `src/execute/pw-config.ts` | ★ `use.video` → **`"on"`** (trace·screenshot 은 그대로) |
| `src/execute/artifacts.ts` | ★ 성공한 실행에서도 **영상만** 남긴다 |
| `src/execute/live-stream.spec.ts` | 다중 뷰어 2건 · 늦은 뷰어/키프레임 **5건** 추가, sink-1 테스트 1건 교체 |
| `src/record/ws-server.spec.ts` | 해시별 키 성질 **3건** |
| `src/execute/pw-config.spec.ts` | `video: "on"` 고정 + 사용자 값 덮어쓰기 1건 |

**API**

| 파일 | 변경 |
|---|---|
| `src/modules/artifacts/artifacts.service.ts` | ★ `parseByteRange()` · `RangeNotSatisfiableError` · `openFile(id, rangeHeader)` 부분 스트림 |
| `src/modules/artifacts/artifacts.controller.ts` | ★ `Accept-Ranges` 항상 · **206 + `Content-Range`** · **416** |
| `src/common/utils/stream-token.ts` | `live` 발급 시 **해시별 키 추가 기록**(녹화 무변경) |
| `src/common/utils/stream-token.spec.ts` | 다중 뷰어 토큰 **4건** |

**Web**

| 파일 | 변경 |
|---|---|
| `src/hooks/useLiveStream.ts` | ★ **자동 재연결**(5회·지수 백오프) · 재연결 중 `hasFrame` 유지 · `onopen` 에서 `idle → connecting` · `reconnectAttempt` 노출 |
| `src/features/live/LiveCanvas.tsx` | ★ `autoVideo` · `videoChoice` · `<video preload="metadata" playsInline object-contain>` · 상태별 오버레이 문구 · 진단 속성 2개 |
| `src/pages/runs/RunScreen.tsx` | ★ `autoVideo`(마운트 시점 고정) · **`emptyScreenText()`** 상태별 문구 · `RunScreenStill` 에 `emptyText` |
| `src/pages/runs/RunDetail.tsx` | ★ `showStage()` — **끝난 녹화 실행도 무대**를 쓴다 |
| `src/pages/runs/RunSidePanel.tsx` | `stageShown` prop · 영상 보관 정책 문구 2곳 |

**contracts**

| 파일 | 변경 |
|---|---|
| `src/recording.ts` | **추가만** — `liveStreamTokenMemberKey()`. 기존 스키마·상수·키 **무변경** |

### 손대지 않은 것 (확인)

`apps/web/src/features/recorder/**`(**0줄**) · `docker-compose.yml` · `packages/db/**` ·
`packages/db/src/cli/guard.ts` · `.gitattributes` · `.npmrc` · `apps/runner/poc/**` ·
`apps/web/src/styles/globals.css`(새 토큰 불필요) · 마이그레이션(**DB 변경 없음**).

---

## 10. 이번에 **검증하지 않은** 것 / 남는 것 (정직하게)

- **docker 모드의 라이브**. 전부 `RUNNER_CODE_EXECUTION_MODE=local` 로 쟀다. 키프레임 캡처는
  컨테이너 안 CDP 중계를 한 홉 더 지나므로 **지연이 더 붙는다**(04-gen-4 실측 p95 +51ms).
  코드 경로는 같지만 docker 에서 재 보지 않았다.
- **뷰어 3명 이상**. 2명까지만 실측했다. 브로드캐스트는 N 을 가정하지만 대역폭은
  **뷰어 수에 비례**한다(15fps · 2.3 Mbps/뷰어). 상한을 두지 않았다 — 필요해지면 그때 잰다.
- **큐 대기가 아주 긴 run**(약 90초 초과). 4404 재연결이 5회 상한에 걸리면 "라이브 화면을
  열 수 없습니다" 문구 + "다시 연결" 버튼으로 떨어진다. 실행은 정상이다.
- **영상 보관 기간 정책**. 성공 실행도 남기기로 했으니 **삭제 주기가 필요해진다.**
  이번에는 만들지 않았다(1.2 GB/월 추정). 다음 라운드 항목으로 남긴다.
- **다중 구간 Range**(`multipart/byteranges`). 지원하지 않고 200 으로 떨어뜨린다(§5.4).
- **Firefox / Safari**. headless Chromium 만 썼다. `<video>` webm 재생은 Safari 가 다르다.
- **실제 nginx 뒤**. TCP 중계로 흉내만 냈다(§4.3). `RUNNER_WS_LIVE_PUBLIC_URL` 경로는 그 중계로
  실제로 돌려 봤다.
- **키프레임 캡처가 실행을 방해하지 않는가**를 **부하 상태에서** 재지 않았다. 정상 실행
  20여 건에서 실패·지연을 관측하지 못했고, 실패해도 `null` 로 삼켜 실행에 새지 않는 구조다.
- **검증 하네스는 커밋하지 않았다**(`apps/runner/g11/`). 스크립트 7개 —
  `mk.mjs`(시나리오·실행 생성) · `wsprobe.mjs`(★ 프레임 수 before/after) · `late.mjs`(★ 늦은 뷰어·다중 뷰어 픽셀) ·
  `replay.mjs`(★ `<video>` 실측) · `ttl.mjs` · `reconnect.mjs` + `proxy.mjs`(TCP 중계) · `regress.mjs` · `wording.mjs`.
  스크린샷은 `/tmp/g11/` 에 있다.
