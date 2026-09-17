---
# PoC-3 결과 — 녹화 → 재생 왕복
pipeline_id: 20260917-114450
task: 12.2
---

# PoC-3 — 녹화 → 재생 왕복 (정식 측정)

측정일 2026-09-17 · MySQL 8.4(3307) + Redis 7 + API(4000) + **Runner**(local 모드) 전부 기동
스크립트 `apps/runner/poc/poc3-roundtrip.ts` · 원시 결과 `/tmp/tf12/poc3-clean.json`

재현:
```bash
docker compose up -d
yarn build && yarn db:migrate
yarn workspace @testflow/api start &     # 4000
yarn workspace @testflow/runner start &  # WS 4100
yarn workspace @testflow/runner build:poc
node apps/runner/dist-poc/poc/poc3-roundtrip.js              # 로컬 + 공개 사이트
node apps/runner/dist-poc/poc/poc3-roundtrip.js --local-only # 네트워크 차단 환경
```

**녹화는 진짜 녹화다.** 캔버스 클라이언트(`poc/client/index.html`)를 실제 headless Chromium 으로
띄워 Runner WS 에 붙이고, **캔버스에 진짜 마우스·키보드 이벤트를 쏘아** 원격 페이지를 조작했다.
재생은 그 결과 시나리오를 **`POST /api/runs` → BullMQ → Runner** 정규 경로로 돌렸다.

---

## ★ 왕복 성공률

| 대상 | 녹화 스텝 | 재생 결과 | **왕복 성공률** |
|---|---|---|---|
| **A. 로컬 SPA fixture** (iframe · SPA 라우팅 · 전체 이동 · 동적 리스트 · 비밀번호) | 14 | `passed` | **14 / 14 (100%)** |
| **B. 공개 사이트 `https://playwright.dev`** (Docusaurus SPA) | 3 | `passed` | **3 / 3 (100%)** |
| 합계 | 17 | — | **17 / 17 (100%)** |

**실패 케이스 0건.** 네트워크는 열려 있었다(`playwright.dev` 200, 0.24s) — 대체 fixture 는 쓰지 않았다.

---

## 1) 04-gen-7 이 못 덮은 3가지 — 이번에 전부 덮었다

### ① iframe 안의 요소 — ✅

`poc3-frame.html` 을 `<iframe>` 으로 붙이고 그 안의 입력란·버튼을 조작했다.

```
#8  [fill]  '담당자' 입력란에 값 입력   frame=http://127.0.0.1:5311/fixtures/poc3-frame.html  input="김담당"
#9  [click] '프레임 확인' 버튼 클릭     frame=http://127.0.0.1:5311/fixtures/poc3-frame.html
```

`target_json.frameUrl` 이 **정확히 iframe 의 URL 로 채워졌고**, 재생 시
`locator.ts` 가 `page.frames()` 에서 그 frame 을 찾아 두 스텝 모두 `passed` 했다.
(`injected.ts` 의 `window.top === window ? null : location.href` 판정이 실제로 동작한다.)

### ② SPA 라우팅 — ✅ (두 종류를 나눠서 봤다)

| 종류 | 무엇이 걸리는가 | 결과 |
|---|---|---|
| **pushState 라우팅**(같은 문서) | 문서가 안 바뀌니 리스너는 당연히 산다. 값 검증용 | ✅ `#5 '계약' 클릭` → `#6 '계약명' 입력` → `#7 '계약 저장'` 전부 기록·재생 |
| **전체 이동**(새 문서) | ★ `addInitScript` 가 **새 문서마다 재주입**되지 않으면 여기서 녹화가 조용히 끊긴다 | ✅ `#11 '다음 페이지' 링크` 이후 **#12·#13·#14 가 계속 기록됐다** |
| **실제 공개 SPA**(Docusaurus) | 우리가 만들지 않은 라우터 | ✅ `Docs` 클릭 후 라우팅된 화면에서 `Writing tests` 를 **이어서 기록** |

전체 이동 이후에도 스텝이 계속 쌓였다는 것이
`session.ts` 의 `context.addInitScript()`(page 가 아니라 **context** 에 건 것)가
새 문서에 재주입된다는 직접 증거다. page 단위로 걸었다면 #12 부터 사라졌을 것이다.

또한 **링크 클릭 직후의 이동에 `goto` 스텝을 겹쳐 만들지 않았다** — 스텝 #11 다음이 바로 #12 다
(`session.ts` 의 "클릭 결과 이동" 억제 로직이 동작).

### ③ 동적 리스트 + Locator 고유성 — ✅

fixture 는 로드 300ms 뒤에 `삭제` 버튼이 붙은 행 3개를 넣고, `항목 추가` 로 하나 더 늘린다.
**문서 안에 이름이 똑같은 버튼이 4개인 상태**에서 2번째 줄의 `삭제` 를 눌렀다.

```json
"primary":   { "by": "role", "role": "button", "name": "삭제", "exact": true, "nth": 1 },
"fallbacks": [ { "by": "text", "value": "삭제", "exact": true, "nth": 1 },
               { "by": "css",  "value": "#rows > li:nth-of-type(2) > button" } ]
```

`nth: 1`(0-based = 2번째)이 붙었다. **고유성 검증이 실제로 돌았다**는 뜻이다.
이게 없으면 재생 시 Playwright 가 strict mode violation 으로 죽는다 — 재생은 `passed` 했다.

---

## 2) 검증 포인트 4가지

### ① role / label 우선순위가 실제로 뽑히는가 — ✅

우리가 만들지 않은 마크업(`playwright.dev`)에서도 `role=link` + 접근 가능한 이름이 뽑혔다.

| 스텝 | primary | fallbacks |
|---|---|---|
| `'항목 추가' 버튼` | `role=button name="항목 추가" exact` | `text="항목 추가"`, `css=#add-row` |
| `'계약명' 입력란` | `role=textbox name="계약명"` | `label="계약명"` |
| `'승인 비밀번호' 입력란` | **`label=승인 비밀번호`** | (없음) |
| `'Docs' 링크` (공개 사이트) | `role=link name="Docs"` | `text="Docs"` |
| `'Writing tests' 링크` (공개 사이트) | `role=link name="Writing tests"` | (없음) |

**CSS 는 언제나 마지막 fallback 이고 `?advanced=1` 없이는 응답에 나오지 않는다**(확인함).

### ② 고유성 검증이 동작하는가 — ✅ (위 ③ 참조. `nth: 1` 부여)

### ③ `input` 디바운스가 입력을 1스텝으로 합치는가 — ✅

`계약서`(3자) · `2026 유지보수 계약`(12자) · `김담당`(3자) · `검토 완료`(5자) 를 각각
**55ms 간격으로 한 글자씩** 쳤다. 결과는 각각 **`fill` 스텝 1개**다(총 23자 → 4스텝).
디바운스가 없으면 23스텝이 됐다.

값도 **한 글자도 어긋나지 않았다**: `"2026 유지보수 계약"`, `"김담당"`, `"검토 완료"`.

### ④ 비밀번호 승격 + 평문 미잔류 — ✅

```
#13 [fill] '승인 비밀번호' 입력란에 값 입력   input={"value":"{{password}}","isSecret":true}
```

`type="password"` 필드에 `Tf!SecretPw#2026` 을 실제로 쳤지만 **스텝에는 `{{password}}` 참조만** 남았다.
녹화 응답 + 저장된 시나리오 **13,054 바이트 전수 검색 결과 평문 0건**.

**추가로 실패를 일부러 유발해 마스킹 경로를 전부 확인했다** (Task 12.4 와 공유하는 측정) —
`assert_text` 의 기대값을 `{{password}}` 로 두어 Playwright 에러에 값이 실리게 만들었다.
결과 메시지: `텍스트가 기대값과 다릅니다. 기대(포함): "••••••••" / 실제: "completed=0 memo="""`

| 검사 위치 | 평문 건수 |
|---|---|
| `GET /api/runs/:id` 응답 | **0** |
| 서버 로그 (`api.log` + `runner.log`) | **0** |
| DB (`step_results.error_message` / `runs.error_message`, `LIKE '%Tf!SecretPw%'`) | **0** |
| SSE 스트림 실수신 5,455 바이트 | **0** (`••••••••` 검출됨) |
| 증적 파일 (`artifacts/` 전체 재귀) | **0** |
| **대조군** — 같은 검사를 평문이 든 파일에 | **1건 검출** (검사가 동작함을 증명) |

---

## 3) 이번 측정 중에 고친 것 — PoC 캔버스 클라이언트의 IME 경로 누락

**첫 실행에서 한글이 통째로 유실됐다.** `검색어` 입력 스텝 자체가 안 생겼고,
`2026 유지보수 계약` 은 `"2026  "` 로, `검토 완료` 는 `" "` 로 들어갔다 — **ASCII 와 공백만 남았다.**

원인: `poc/client/index.html` 은 PoC-1 시절 산출물이라 `window` 레벨 `keydown` 만 듣고
**IME 경로가 없었다.** 한글이 `{t:"key"}` 로 나가 원격에서 버려졌다.
제품 웹 클라이언트(`apps/web/src/features/recorder/useImeBridge.ts`)에는 그 경로가 있다.

→ **PoC 클라이언트에 제품과 같은 구조의 숨은 IME 버퍼를 넣었다**
(`compositionend` → `{t:"ime",kind:"commit"}`, 조합 없는 삽입은 `input` 에서 받기, 직후 값 비우기).
수정 후 재측정에서 한글이 **전부 정확히** 들어갔고 왕복이 14/14 가 됐다.

**이건 제품 버그가 아니라 하네스 버그였다.** 다만 고치지 않았으면
"한글 녹화가 안 된다" 는 **잘못된 결론**을 보고할 뻔했다. 사실대로 기록한다.

---

## 4) 판정

| 완료 기준 (03-phases Task 12.2) | 판정 |
|---|---|
| 왕복 통과 | ✅ **17/17 (로컬 14/14 · 공개 사이트 3/3)** |
| ① role/label 우선순위 | ✅ PASS |
| ② 고유성 검증 | ✅ PASS (`nth` 부여 확인) |
| ③ `input` 디바운스 1스텝 병합 | ✅ PASS (23자 → 4스텝) |
| ④ 비밀번호 `{{변수}}` 승격 + DB·로그·SSE 평문 0건 | ✅ PASS (대조군으로 검사 유효성까지 확인) |
| iframe (오케스트레이터 추가 지시) | ✅ PASS |
| SPA 라우팅 · `addInitScript` 재주입 | ✅ PASS |
| 동적 리스트 | ✅ PASS |

## 5) 남는 한계 (사실대로)

- **단일 머신 loopback 측정이다.** 사내망 지연·프록시·인증 게이트는 겪지 않았다.
- 공개 사이트 검증은 **클릭 2회**뿐이다(입력·폼 제출 없음). `playwright.dev` 에는
  로그인 폼이 없어 `fill` 경로를 실사이트에서 재현하지 못했다.
- 공개 사이트 좌표는 **같은 뷰포트의 참조 페이지에서 `boundingBox()` 로 구했다.**
  사이트 레이아웃이 바뀌면 이 스크립트는 `skipped` 로 떨어진다(그 처리를 넣어 뒀다).
- `RUNNER_EXECUTION_MODE=local` 로 측정했다. docker 모드 재생은 04-gen-6 이 별도로 실측했다.
