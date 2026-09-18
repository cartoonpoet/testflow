---
# Gen Artifact
pipeline_id: 20260917-231945
phase: 12-step-sync
feature: 스텝 목록을 화면(라이브·영상)과 동기화 + 다음 스텝으로 슬라이드
branch: feat/step-sync
base: main (3dcd3a8)
---

# 라운드 5 — 스텝 목록 ↔ 화면 동기화

## 0. 한 줄 요약

**33스텝 실행에서 강조 스텝이 `4 → 7 → 11 → 14 → 18 → 21 → 25 → 28 → 31 → 33` 으로 따라갔고**
(DOM 에서 읽은 `sequence` 수치 · 10종 · 단조 증가 · **10회 모두 상자 안에 보임**),
**사용자가 휠을 굴리면 추적이 멈추고**(`following=false` · 4초간 스크롤 변동 **0px**)
**"현재 스텝으로"로 복귀**한다. **영상 재생 중에는 시각에 따라 강조가 바뀌고**
(0/10/30/50/70/90/100% → `1 → 4 → 11 → 18 → 24 → 31 → 33`),
**스텝을 누르면 그 지점으로 seek 된다 — 실측 오차 최대 0.42초**(픽셀 정답과 비교).
오차는 화면에 **"대략적인 값(±1초)"** 으로 명시했다. 기준선 4종 유지 · 초기 로드 JS **증가 0** ·
새 토큰 **0개** · 인라인 스타일 신규 **0건** · 콘솔 에러 **0건**.

---

## 1. ★ 자동 추적 설계 — 언제 멈추고 언제 복귀하는가

### 1.1 규칙표

| | 동작 | 근거 |
|---|---|---|
| **따라간다** | `activeSequence` 가 **바뀔 때만** 목록 상자의 `scrollTop` 을 옮겨 현재 행을 가운데 놓는다 | 행이 늘어난 것만으로 움직이면 33스텝에서 상자가 들썩인다 |
| **멈춘다** | 목록에 **휠 · 터치 드래그 · 방향키/PageUp/PageDown/Home/End** 가 오는 순간 | 제스처는 **사용자만** 만든다 |
| **복귀한다** | **"↓ 현재 스텝으로" 버튼**을 누를 때. 그리고 **스텝을 눌러 seek 할 때** | 스텝을 누른 것은 "여기를 보겠다"는 뜻이다 |
| **복귀 후** | 다음 스텝부터 다시 따라간다 | |

### 1.2 ★ `scroll` 이벤트로 판단하지 않는다

부드러운 스크롤(`behavior:"smooth"`)은 **우리가 건 것이어도** `scroll` 이벤트를 수십 번 뿜는다.
그것을 "사용자가 스크롤했다"로 읽으면 **자동 추적이 자기 첫 이동에서 스스로 꺼진다.**
실측: 이 브랜치의 기본 모드 스크롤 1회가 `scroll` 이벤트 **7회**(157ms 에 걸쳐)를 만든다.
그래서 판단 근거를 **제스처 이벤트**(`wheel`/`touchmove`/`keydown`)로 잡았다 — 오판이 원리적으로 없다.

### 1.3 ★ 페이지를 스크롤하지 않는다 (하이재킹 금지)

`element.scrollIntoView()` 는 **모든 조상을 스크롤한다** — 창까지 움직인다. 그래서 쓰지 않고
목록 상자의 `scrollTop` 만 옮긴다. 상자는 새 유틸 `tf-step-scroll`
(`max-height: min(52dvh, 560px)` · `overflow-y:auto` · `overscroll-behavior:contain`)이 만든다.

실측 — 실행 내내 **`window.scrollY` 변동 0px**:

```
샷 1: 강조 #4  "단계 3 — 계약서 항목 3 확인"  · 화면 y=-290 · 목록 y=408~735 · 페이지 scrollY=628
샷 2: 강조 #13 "단계 12 — 계약서 항목 12 확인" · 화면 y=-290 · 목록 y=408~876 · 페이지 scrollY=628
샷 3: 강조 #22 "단계 21 — 계약서 항목 21 확인" · 화면 y=-290 · 목록 y=408~876 · 페이지 scrollY=628
★ 페이지 스크롤 변동 = 0px
```

★ `tf-step-scroll` 에 `position: relative` 가 **필수**다. 추적 코드가 `row.offsetTop` 으로 위치를
재는데 그 값은 `offsetParent` 기준이라, 상자가 static 이면 기준이 바깥으로 올라가 계산이 어긋난다.

### 1.4 구조 — 훅 하나에 가뒀다

무대(`RunLiveScreen`)와 목록(`RunStepList`)은 **형제**다(공통 부모 `RunDetail`). 그래서 상태는
`RunDetail` 에 있고, 생명주기가 필요한 것 세 가지(`<video>` 시간축 구독 · 제스처 감지 · 스크롤)는
**`useStepSync` 훅 한 곳**에 있다. 컴포넌트에는 값과 콜백만 내려간다(`useRunEvents` 와 같은 규율).

> ★ `<video>` 만 state 가 아니라 **ref + 붙었는가 플래그**다. `seekToStep` 이
> `video.currentTime = t` 로 엘리먼트를 고쳐 쓰는데, state 에 담긴 값을 고치는 것은
> `react-hooks/immutability` 가 막는다(그 규칙이 옳다). DOM 엘리먼트는 원래 가변 객체라 ref 가 제자리다.
> 렌더 중 `ref.current` 를 읽을 수 없으므로(`react-hooks/refs`) "붙어 있는가"만 state 로 따로 든다.

---

## 2. ★★ 33스텝 실행 실측 — 시점별 강조 스텝 `sequence`

시나리오: `page.goto` 1 + `test.step()` 32 = **33스텝**(각 스텝 안에서 `fill` + 1초 대기).
run `90aa8f86-9d7a-4c86-94a3-527a67028621` · `passed 33/33` · 1440×900.

```
  +  3.5s  mode=live active=   rows=0   scrollTop=0/81
  +    7s  mode=live active=   rows=0   scrollTop=0/81
  + 10.5s  mode=live active=4  row=4  "단계 3 — 계약서 항목 3 확인"   rows=4  scrollTop=0/325    (보임=true)
  +   14s  mode=live active=7  row=7  "단계 6 — 계약서 항목 6 확인"   rows=7  scrollTop=42/508   (보임=true)
  + 17.5s  mode=live active=11 row=11 "단계 10 — 계약서 항목 10 확인" rows=11 scrollTop=286/752  (보임=true)
  +   21s  mode=live active=14 row=14 "단계 13 — 계약서 항목 13 확인" rows=14 scrollTop=469/935  (보임=true)
  + 24.5s  mode=live active=18 row=18 "단계 17 — 계약서 항목 17 확인" rows=18 scrollTop=709/1179 (보임=true)
  +   28s  mode=live active=21 row=21 "단계 20 — 계약서 항목 20 확인" rows=21 scrollTop=896/1362 (보임=true)
  + 31.5s  mode=live active=25 row=25 "단계 24 — 계약서 항목 24 확인" rows=25 scrollTop=1105/1606(보임=true)
  +   35s  mode=live active=28 row=28 "단계 27 — 계약서 항목 27 확인" rows=28 scrollTop=1323/1789(보임=true)
  + 38.5s  mode=live active=31 row=31 "단계 30 — 계약서 항목 30 확인" rows=31 scrollTop=1506/1972(보임=true)
  +   42s  mode=live active=33 row=33 "단계 32 — 계약서 항목 32 확인" rows=33 scrollTop=1567/2033(보임=true)

★ 관측된 강조 sequence: 4 → 7 → 11 → 14 → 18 → 21 → 25 → 28 → 31 → 33
★ 서로 다른 값 10종 · 단조 증가 = true
★ 강조 행이 항상 상자 안에 보였는가 = true   (행의 top/bottom 을 상자의 top/bottom 과 비교해 계산)
★ 목록이 늘어난 구간: rows 0 → 33
[콘솔 에러] 0
```

"보임"은 눈짐작이 아니라 `row.getBoundingClientRect()` 가 `list.getBoundingClientRect()` 안에
완전히 들어가는지로 판정했다.

육안: [`g12-live-1.png`](./g12-live-1.png) · [`g12-live-2.png`](./g12-live-2.png) ·
[`g12-live-3.png`](./g12-live-3.png) — **실행 화면과 스텝 목록이 한 화면에** 있고 강조가 다르다.

### 2.1 ★ 사용자 스크롤 → 정지 → 복귀 (실측)

```
  (목록 상자 y=397 h=468 → 커서 y=631)
  스크롤 전: following=true  scrollTop=1567
  휠 이후  : following=false scrollTop=1167 · "현재 스텝으로" 버튼 = 1개
  4초 뒤   : following=false scrollTop=1167 (변동 0px) active=33   ← ★ 멈춘 동안 화면이 움직이지 않는다
  복귀 후  : following=true  scrollTop=1567 active=33 row=33 (보임=true) 버튼=0개
```

[`g12-scroll-paused.png`](./g12-scroll-paused.png) · [`g12-scroll-resumed.png`](./g12-scroll-resumed.png)

> ⚠️ **첫 측정은 아무것도 검사하지 않았다.** 전폭 무대가 76dvh 를 먹어 **목록이 뷰포트 밖**에
> 있었고, 그 자리로 보낸 `mouse.wheel` 은 목록에 닿지 않았다(`following` 이 `true` 로 남았다).
> 커서를 목록 위로 올린 뒤에야 판정이 살아났다. 이 함정을 밟지 않았다면 "추적이 멈춘다"를
> 통과한 셈 쳤을 것이다.

### 2.2 ★ 목록이 늘어날 때 스크롤이 튀지 않는가

코드 실행은 `totalSteps` 가 **실행 중에 증가**하고 대기 행이 없다. 새 실행을 열어 0.4초 간격으로
`(activeSequence, scrollTop, rows)` 를 찍고, **현재 스텝이 그대로인데 스크롤이 움직인 횟수**를 셌다.

```
★ 표본 77개 · 행이 늘어난 구간 29회 · 현재 스텝이 같은데 스크롤이 움직인 횟수 = 0
```

> ⚠️ 이 측정도 처음엔 틀렸다. 기본(부드러운) 스크롤로 재면 **애니메이션 도중의 중간값**이
> "점프"로 잡혀 10건이 나왔다(실제로는 같은 목적지로 가는 중이었다). `reducedMotion:"reduce"`
> 로 즉시 이동시켜 재야 "움직였다 = 옮기라는 지시가 있었다"가 성립한다.

---

## 3. ★★ 영상 시간축 ↔ 스텝 매핑 — 방법과 **오차 실측값**

### 3.1 먼저 확인한 사실 — `run.startedAt` 은 영상 0초가 **아니다**

`code-executor.ts` 는 `reporter.runStarted()` 를 **Playwright 를 띄우기 전에** 부른다.
영상은 Playwright 가 BrowserContext 를 만드는 순간 시작한다. 그 사이에 프로세스 기동 ·
브라우저 런치 · 픽스처 준비가 들어간다.

**실측 — `run.startedAt` → 첫 스텝 시작 간격** (표본 4건):

```
7.892s · 6.966s · 6.797s · 6.399s
```

★ `run.startedAt` 을 영상 0초로 놓았다면 **7초쯤 통째로 밀린 매핑**이 됐을 것이다.
그래서 앵커는 run 시작이 아니라 **첫 스텝의 시작**이다.

```
videoTime(step) = (step.startedAt − firstStep.startedAt) / 1000 + VIDEO_LEAD_SEC
```

### 3.2 ★ 오차를 어떻게 쟀나 — **픽셀 정답**을 만들었다

계산끼리 비교하면 아무것도 검사하지 않는다. 그래서 **알려진 시점에 화면이 바뀌는 시나리오**를 만들었다.

```ts
await page.goto("/record-login.html");           // #1
await page.waitForTimeout(3000);                 // #2
await page.evaluate(() => { …배경을 rgb(255,0,0) 로… });   // #3  ← 빨강 마커
await page.waitForTimeout(4000);                 // #4
await page.evaluate(() => { …rgb(0,0,255)… });   // #5  ← 파랑 마커
await page.waitForTimeout(4000);                 // #6
await page.evaluate(() => { …rgb(0,255,0)… });   // #7  ← 초록 마커
await page.waitForTimeout(4000);                 // #8
```

그 실행의 영상을 **API 오리진 위에서** `<video>` 로 열어 0.05~0.1초 간격으로 `currentTime` 을
옮기며 `drawImage` → `getImageData` 로 **중앙 픽셀 색**을 읽었다. 색이 처음 바뀐 시각이 정답이다.

> ★ `about:blank` 에서는 video 가 아예 로드되지 않고(불투명 오리진), 다른 오리진이면
> canvas 가 taint 돼 `getImageData` 가 막힌다. **같은 오리진**이어야 한다.

### 3.3 ★★ 실측 오차 — `VIDEO_LEAD_SEC` 를 고른 과정

| 표본 | `LEAD` | red #3 | blue #5 | green #7 | 평균 | 최대 \|오차\| |
|---|---|---|---|---|---|---|
| 1 | **+0.35**(첫 추정) | +0.445 | +0.580 | +0.490 | +0.505 | **0.580** |
| 1(재계산) | −0.15 | −0.186 | −0.071 | −0.062 | −0.106 | 0.186 |
| 2 | −0.15 | −0.193 | −0.076 | −0.067 | −0.112 | 0.193 |
| 3 | **−0.10 (채택)** | −0.244 | −0.027 | −0.116 | −0.129 | **0.244** |

(단위 초. 양수 = 예측이 실제보다 **늦다**.)

**채택: `VIDEO_LEAD_SEC = -0.1`.** 음수인 이유는 영상의 첫 프레임이 첫 스텝(`page.goto`)보다
**약 0.1초 늦게** 찍히기 때문이다 — context 생성 직후에는 아직 그릴 것이 없다.

**보정했는가 →** 했다. 다만 **평행 이동만** 한다. `videoDuration / runSpan` 비로 전 구간을
늘리는 방식은 쓰지 않았다 — 머리(런치)·꼬리(정리) 여유는 **양 끝에만** 있는데 그 비는 여유를
가운데에도 뿌려서 가운데를 더 틀리게 만든다.

### 3.4 ★★ 스텝 클릭 → seek 오차 (사용자가 실제로 겪는 값)

화면에서 스텝 행을 **클릭**하고, 그때 `<video>` 가 실제로 간 `currentTime` 을 픽셀 정답과 뺐다.

```
  픽셀 정답(0.05초 간격): {"red":3.15,"blue":7.00,"green":11.05} · 영상 19.12s
  #3 (red)   클릭 → 영상  3.406s · 정답  3.150s · 오차 +0.256s · 강조 #3
  #5 (blue)  클릭 → 영상  7.423s · 정답  7.000s · 오차 +0.423s · 강조 #5
  #7 (green) 클릭 → 영상 11.434s · 정답 11.050s · 오차 +0.384s · 강조 #7
★ seek 오차: 최대 0.423s · 평균 +0.354s
```

★ 세 번 모두 **그 스텝의 구간 안에** 떨어졌다(빨강 구간 3.15~7.00 안의 3.406 등).
육안 증거 [`g12-seek.png`](./g12-seek.png) — `#7 Evaluate` 를 누르자 영상이 `0:11` 로 가고
**화면이 실제로 초록**이며, 목록의 `#7` 행이 강조돼 있다.

★ 클릭 오차(+0.35)가 §3.3 의 매핑 잔차(−0.13)보다 큰 이유는 **`<video>` 의 seek 입자**다.
webm 은 키프레임이 성겨서 지정한 시각보다 **앞으로 스냅**한다(예: 2.956 요청 → 3.406 착지).
이건 우리 계산이 아니라 브라우저·코덱의 성질이라 코드로 없앨 수 없다.

### 3.5 ★ 그래서 화면에 이렇게 말한다

목록 아래 한 줄로 **항상** 밝힌다(영상 모드일 때만 나온다):

> 스텝을 누르면 영상의 해당 지점으로 이동합니다. 영상 시작 시각과 실행 기록의 기준점이 달라
> 위치는 **대략적인 값**입니다(오차 약 ±1초).

**왜 실측(0.42초)보다 넓은 ±1초로 약속하나.** 재 보지 않은 조건이 있다 —
docker 격리 모드(CDP 중계가 한 홉 더 붙는다) · 부하가 걸린 머신 · 한 spec 에 `test()` 가
여럿인 실행(§3.6). 좁게 약속하고 넘기는 것보다 넓게 약속하고 지키는 편이 낫다.

### 3.6 ★ 알려진 한계 — 영상이 **여러 개**인 실행

Playwright 는 **context 당 영상 1개**를 남긴다. 한 spec 에 `test()` 가 여럿이면 영상도 여럿이고,
화면은 그중 **하나만** 튼다(`artifacts.find(type==="video")` — 라운드 4 그대로).
그때 2번째 테스트의 스텝들은 그 영상 안에 **존재하지 않는다.** 코드는 영상 길이를 넘는 구간을
마지막으로 clamp 하므로 화면이 깨지지는 않지만, **그 스텝들은 전부 영상 끝을 가리킨다.**
이번 범위에서 고치지 않았다(§10).

실제로 이 상황을 한 번 밟았다 — 첫 33스텝 시도가 Playwright 기본 타임아웃(30초)에 걸려
`failed 28/28` 로 잘렸고, 그 실행의 영상(37.72s)보다 스텝이 짧아 90%/100% 가 **둘 다 #28** 로 나왔다.
`test.setTimeout()` 을 넣어 33스텝이 온전히 도는 실행으로 다시 쟀다.

---

## 4. ★ 영상 재생 중 강조가 시간에 따라 바뀌는가

run `90aa8f86…`(33스텝 · `passed`)를 **새 탭에서 열면** 자동 영상 모드
(`data-step-sync-mode=video` · `video.readyState=4` · `duration=34.24`).

```
    0%  t= 0.00s → 강조 #1  "Navigate"                    (보임=true)
   10%  t= 3.42s → 강조 #4  "단계 3 — 계약서 항목 3 확인"   (보임=true)
   30%  t=10.27s → 강조 #11 "단계 10 — 계약서 항목 10 확인" (보임=true)
   50%  t=17.12s → 강조 #18 "단계 17 — 계약서 항목 17 확인" (보임=true)
   70%  t=23.97s → 강조 #24 "단계 23 — 계약서 항목 23 확인" (보임=true)
   90%  t=30.82s → 강조 #31 "단계 30 — 계약서 항목 30 확인" (보임=true)
  100%  t=34.23s → 강조 #33 "단계 32 — 계약서 항목 32 확인" (보임=true)
★ 서로 다른 값 7종 · 단조 = true · 모든 지점에서 강조 행이 보였다
```

수동 seek 뿐 아니라 **실제 재생**(`play()`)에서도 따라간다 — 4초 간격 관측:

```
5@4.0s → 9@8.0s → 12@12.0s → 16@16.0s
```

[`g12-video-50.png`](./g12-video-50.png)

구현 메모 — 구간은 `[startSec, endSec)` 이고 **끝은 다음 스텝의 시작**이다. `durationMs` 로
끝을 잡으면 스텝 사이의 빈 시간(Playwright 내부 대기·단정문 재시도)이 어느 구간에도 속하지 않아
**그 구간을 재생하는 동안 강조가 통째로 꺼진다.** 마지막 구간만 끝을 포함한다(끝까지 재생해도
강조가 남는다). 이 성질들은 `step-time.spec.ts` 18건으로 고정했다.

---

## 5. 확대 모드 — 확대해도 현재 스텝이 보인다

라운드 3의 진행 스트립을 **영상 모드까지** 확장했다(이전에는 `watching` 이면 감췄다).

| | 실측 |
|---|---|
| 라이브 확대 중 | `{"sequence":"33","text":"실행 성공33 / 33 단계 단계 32 — 계약서 항목 32 확인","visible":true}` |
| 영상 확대 중 | `stripOverVideo=true` · `stripText="실행 성공 1 / 33 단계 Navigate"` · 캔버스 폭 **1402px** |
| 재생 바와 겹치나 | 스트립 bottom **832** · video bottom **888** → **겹치지 않는다**(`bottom-[56px]`) |
| `Esc` 로 축소 | `true` |

★ 영상 모드에서는 좌변 `N` 을 `summary.currentStep`(= 끝난 시점의 값)이 아니라 **강조 중인 스텝
번호**로 바꿨다. 안 그러면 영상을 되감아도 숫자가 `33` 에 굳어 있다.

[`g12-expanded.png`](./g12-expanded.png)(라이브) · [`g12-expanded-video.png`](./g12-expanded-video.png)(영상)

---

## 6. 반응형 / `prefers-reduced-motion`

### 6.1 반응형 (영상 55% 지점에서 강조 확인)

| 폭 | 강조 | 보임 | 목록 높이 | 자체 스크롤 | 가로 넘침 | 오차 안내 |
|---|---|---|---|---|---|---|
| 1440px | #20 | true | 468px | true | **false** | true |
| **1050px** | #20 | true | 468px | true | **false** | true |
| **760px** | #20 | true | 468px | true | **false** | true |
| 390px | #20 | true | 468px | true | **false** | true |

[`g12-vw1050.png`](./g12-vw1050.png) · [`g12-vw760.png`](./g12-vw760.png)

### 6.2 `prefers-reduced-motion`

```
  기본   : mq=false behavior=smooth  0 → 1516 · scroll 이벤트 7회 · 이동에 157ms
  reduce : mq=true  behavior=auto    0 → 1516 · scroll 이벤트 2회 · 이동에  50ms
★ 선택한 behavior: 기본=smooth / reduce=auto · 최종 위치 동일 = true
  reduce 가로 넘침 = false
```

★ **CSS 에 맡길 수 없다.** `globals.css` 의 `scroll-behavior: auto !important` 는 CSS 끼리의
규칙이라 **JS 가 명시한 `behavior` 를 덮지 못한다.** 그래서 스크롤 직전에 `matchMedia` 를 읽어
직접 고른다. 분기 자체는 `useStepSync.spec.ts` 4건으로 고정했고, 브라우저에서는 목록에
**`data-follow-behavior`** 진단 속성으로 확인한다.

> ⚠️ 첫 측정은 판정이 불가능했다 — headless Chromium 은 기본적으로 부드러운 스크롤을
> 돌리지 않아 양쪽 모두 "이벤트 1회 / 즉시"로 나왔다. `--enable-smooth-scrolling` 을 켜고
> **페이지 안에서** `scroll` 이벤트를 세야(Node↔CDP 왕복은 수십~수백 ms 다) 대조가 산다.

[`g12-reduced-motion.png`](./g12-reduced-motion.png)

---

## 7. 회귀 확인

| 항목 | 결과 |
|---|---|
| **녹화 경로 실제 녹화 1회** | 캔버스 **1280×800** · 색 **105종** · 좌상단 `rgb(244,248,247)` · 캔버스 클릭 3회 → **스텝 카드 3개** → 중지 후 4개 ([`g12-record.png`](./g12-record.png)) |
| **`features/recorder/**`** | **`git diff` 0줄** → 클릭 좌표 역변환 경로 **무변경**. 배율 3종 재측정 **불필요**(공용 코드도 건드리지 않았다) |
| 코드 실행(라이브) | 33스텝 `passed 33/33` 외 8건 이상 정상 |
| 기존 steps 실행 | `G11-steps-pass` 재실행 → 화면 `{rows:2, mode:"video", stage:1, video:1, active:"2", scrollable:false}` · 콘솔 에러 0. 실행 자체는 `failed 1/2`(그 시나리오의 `assert_visible` 셀렉터가 `null` 이다 — **이 브랜치와 무관한 기존 데이터 문제**) |
| 라이브 전폭 / 확대 | 축소 캔버스 **1094px** → 확대 **1402px** · `Esc` 축소 정상 |
| 영상 자동 전환 | 끝난 run 을 새로 열면 `view=video` · 토글하면 `view=canvas` + `mode=live` 로 되돌아가고 행이 다시 `div`(클릭 불가) |
| 스텝 2개짜리 실행 | `scrollable=false` — 짧은 목록에 빈 상자가 생기지 않는다(`min-height` 를 두지 않았다) |
| **콘솔 에러** | **0건** (모든 시나리오 · 실행 15건 이상) |
| 손대지 말 것 (`docker-compose.yml` · `guard.ts` · `.gitattributes` · `.npmrc` · `apps/api/**` · `apps/runner/src/**` · `poc/**` · `packages/contracts/**`) | **`git diff` 0줄** |

---

## 8. 기준선 · 번들

| 항목 | 기준선 | 이번 | 판정 |
|---|---|---|---|
| `pnpm typecheck` | 7/7 | **7 successful, 7 total** | ✅ |
| `pnpm lint` | 0 problems | **7/7 · 0 problems** | ✅ |
| `pnpm build` | 5/5 · 500KB 경고 없음 | **5/5 · 경고 0건** | ✅ |
| `pnpm test` | 667건 이상 | **689건** (contracts 199 · api 145 · web **103** · runner 242) | ✅ **+22** |
| HEX 스타일 값 (`apps/web/src` ts/tsx) | 0건 | **0건** (문법상 31건은 전부 시안 참조 **주석** — main 과 동일 수치) | ✅ |
| `style={{` | 2건 | **2건** (신규 0) | ✅ |
| `globals.css` 새 **토큰** | — | **0개** (기존 토큰만 씀 · 유틸 1개 추가) | ✅ |

### 번들 (같은 머신 · 같은 명령)

| 청크 | before (main) | after | 델타 |
|---|---|---|---|
| `vendor-react` | 218.82 KB (gzip 68.24) | **218.82 KB** (68.24) | **0** |
| `index` (진입) | 304.73 KB (gzip 95.44) | **304.73 KB** (95.45) | **0** |
| **초기 로드 JS 합** | **523.55 KB** | **523.55 KB** | **0** |
| CSS | 43.94 KB (gzip 9.76) | **44.10 KB** (gzip 9.81) | +0.16 KB |
| `RunDetail` (lazy) | 28.52 KB (gzip 8.78) | **33.74 KB** (gzip 10.44) | +5.22 KB |

★ **초기 로드가 1바이트도 늘지 않았다.** 변경이 전부 lazy 청크(`RunDetail`) 안에 있다.

---

## 9. 생성 / 수정 파일

### 신규 (4)

| 파일 | 내용 |
|---|---|
| `apps/web/src/features/live/step-time.ts` | ★★ 시간축 매핑 **순수 함수** — `buildVideoTimeline` · `stepAtVideoTime` · `videoTimeForStep` · `liveActiveSequence` · `findStep` · `VIDEO_LEAD_SEC` · `VIDEO_TOLERANCE_SEC` |
| `apps/web/src/features/live/step-time.spec.ts` | 매핑 **18건** — 구간 빈틈 없음 · clamp · 경계 · seek 왕복 |
| `apps/web/src/features/live/useStepSync.ts` | ★ 자동 추적 · 제스처 감지 · `<video>` 시간축 구독 · seek |
| `apps/web/src/features/live/useStepSync.spec.ts` | `prefers-reduced-motion` 분기 **4건** |

### 수정 (5)

| 파일 | 변경 |
|---|---|
| `src/pages/runs/RunDetail.tsx` | `useStepSync(run)` 1회 · 무대/목록에 손잡이 전달 · `data-step-sync-mode` |
| `src/pages/runs/RunStepList.tsx` | ★ 스크롤 상자(`tf-step-scroll`) · `data-active`/`data-active-sequence`/`data-following` · **행이 버튼이 되어 seek** · "현재 스텝으로" 복귀 버튼 · **오차 안내 문구** |
| `src/pages/runs/RunScreen.tsx` | `videoRef` 전달 · `RunLiveProgress` 가 `sync.activeSequence` 를 읽는다(영상에서도 움직인다) · 죽은 `currentStep()` 제거 |
| `src/features/live/LiveCanvas.tsx` | `videoRef` prop · 진행 스트립을 **영상 모드에서도** 띄운다(`bottom-[56px]`) |
| `src/styles/globals.css` | `@utility tf-step-scroll` **1개 추가**(새 색 토큰 0개) |

### 손대지 않은 것 (확인)

`apps/web/src/features/recorder/**`(**0줄**) · `apps/api/**` · `apps/runner/src/**` ·
`packages/contracts/**` · `packages/db/**` · `docker-compose.yml` · `.gitattributes` · `.npmrc` ·
`apps/runner/poc/**` · 마이그레이션(**DB 변경 없음**).

---

## 10. 이번에 **검증하지 않은** 것 / 남는 것 (정직하게)

- **★ 한 spec 에 `test()` 가 여럿인 실행**(§3.6). 영상이 여러 개인데 화면은 하나만 튼다.
  2번째 테스트의 스텝은 전부 영상 끝을 가리킨다. 화면은 깨지지 않지만 **매핑이 사실과 다르다.**
  고치려면 `artifacts` 에 "어느 테스트의 영상인가"가 필요하다 — 계약 변경이라 이번 범위 밖이다.
- **docker 격리 모드**. 전부 `RUNNER_CODE_EXECUTION_MODE=local` 로 쟀다. CDP 중계가 한 홉 더
  붙으므로 `VIDEO_LEAD_SEC` 가 달라질 수 있다. `±1초` 안에 들 것으로 보지만 **재지 않았다.**
- **머신 부하 상태**의 `LEAD`. 한가한 머신 표본 4건이다. 런치가 느려지면 앵커(첫 스텝)와
  영상 시작의 간격이 벌어질 수 있다.
- **재시도(`retries`)가 있는 실행**. 같은 스텝이 두 번 돌면 `step_results` 가 어떻게 쌓이는지
  이번에 확인하지 않았다.
- **Firefox / Safari**. headless Chromium 만 썼다. `<video>` webm seek 입자(§3.4)는 브라우저마다 다르다.
- **전폭 무대 + 목록이 한 화면에 안 들어가는 문제**. 1440×900 에서 무대(76dvh)와 목록(52dvh)을
  더하면 뷰포트를 넘는다. **한 번 내리면** 영상 하단 397px + 목록 468px 이 같이 보이고
  (§1.3 실측) 그 뒤로는 페이지가 움직이지 않는다. 무대 높이 자체는 라운드 3의 결정이라 건드리지 않았다.
- **터치 기기 실제 단말**. `touchmove` 로 추적을 멈추는 경로는 코드로만 확인했다(에뮬레이션·실기기 미측정).
- **검증 하네스는 커밋하지 않았다**(`apps/runner/g12/`). 스크립트 7개 —
  `lib.mjs` · `scenarios.mjs` · `calibrate.mjs`(★ 픽셀 정답으로 `LEAD` 보정) ·
  `follow.mjs`(★ 33스텝 추적·정지·복귀) · `video.mjs`(★ 시간↔강조·seek 오차) ·
  `motion.mjs`(reduced-motion·반응형·점프) · `regress.mjs` · `shots.mjs` · `stepsrun.mjs`.
  스크린샷 원본은 `/tmp/g12/` 에 있다.
