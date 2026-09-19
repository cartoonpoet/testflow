# 라운드 12 — 가이드: 거짓이 된 문장을 고치고, 변수 선언 방법을 박는다

브랜치 `docs/guide-variables` (`fix/variable-prefill` `3e6e9b4` 에서 분기)

**코드 동작은 한 줄도 바꾸지 않았다.** 고친 파일은 `apps/web/src/pages/guide/content.ts` **하나**다.

---

## 0. 왜 이 라운드가 필요했나

라운드 9(#19)가 **임의 실행 변수 입력**을 넣었는데 가이드를 안 고쳤다.
그래서 **가이드가 사용자를 막고 있었다** — "이런 테스트는 UI에서 돌릴 수 없습니다" 라고
적힌 시나리오가 **사실은 그때부터 돌아가고 있었다.**

이번 작업은 "안 고친 문서가 거짓이 됐다"를 고치는 일이므로, **적는 문장마다 실제로 돌려서
확인했다.** 확인하지 못한 것은 §9 에 미검증으로 적는다.

---

## 1. ★ 거짓이던 문장 전수 목록

오케스트레이터가 2곳을 지목했고, **전수 조사에서 1곳을 더 찾았다**(#3). 총 3곳이다.

### ① `content.ts:592` — 5절 Q&A 「계정이 2개 이상 필요한 테스트」

> "실행 다이얼로그는 계정 1쌍(`TESTFLOW_VAR_username` / `TESTFLOW_VAR_password`)만 받습니다.
> **지금은 API로 실행해야 합니다.**"

| | |
|---|---|
| 언제부터 거짓 | **#19**(`7f2eb09`, 라운드 9). 그때 다이얼로그가 감지된 변수마다 칸을 만들게 바뀌었다 |
| 왜 거짓 | `RUN_SCOPE_VARIABLE_KEYS`(`baseUrl`·`envLabel`)를 뺀 **모든** `TESTFLOW_VAR_*` 가 칸이 된다. `username`/`password` 는 **라벨만** 특별하다 |
| 어떻게 고쳤나 | "→ **됩니다.**" 로 시작해 쌍마다 이름을 나누는 법(`TESTFLOW_VAR_lawyerUsername` …)을 적었다. 개수 제한 없음(화면 표시 상한 50개)도 같이 적었다 |

### ② `content.ts:593` — 같은 Q&A 의 실제 사례

> "실제 사례: … 변호사·일반 사용자·관리자 **계정 3쌍**을 필요로 했습니다.
> **이런 테스트는 UI에서 돌릴 수 없습니다.**"

- **사례는 살렸다** — 왜 여러 쌍이 필요한지 설명하는 좋은 예다.
- 마지막 문장만 뒤집었다: "6개를 각각 선언하고 **가드로 한 번에 묶어** 막으면 다이얼로그에
  **「꼭 입력할 것 6개」** 로 6칸이 뜹니다. 실측으로 확인했습니다."
- 하필 이것이 `project-security-check` — **아직 못 돌린 실제 시나리오**였다. §2 가 그 실측이다.

### ③ ★ `content.ts:294` — 2절 4번 「변수 이름 규칙」 (**오케스트레이터가 못 찾은 것**)

> "「계정」칸은 `TESTFLOW_VAR_username`, 「비밀번호」칸은 `TESTFLOW_VAR_password` 로 들어갑니다.
> **이 두 개는 이름을 맞춰야 UI에서 실행할 수 있습니다.**"

| | |
|---|---|
| 언제부터 거짓 | ①과 같은 **#19** |
| 왜 거짓 | 이름을 맞출 **의무가 없다.** 반대로 `username`/`password` 가 **감지되지 않으면 그 칸은 아예 안 생긴다**(19-run-variables §3.1) |
| 근거 | 검증 시나리오 A 는 `username`/`password` 를 **한 번도 쓰지 않고** 6칸으로 UI 실행에 성공했다(§2) |
| 어떻게 고쳤나 | "「계정」·「비밀번호」라는 **라벨**은 그 두 이름일 때만 붙고, 다른 이름을 쓰면 **그 이름이 그대로 칸 라벨**이 됩니다. 이름을 맞춰야 할 의무는 없습니다." |

> ★ 이것이 가장 해로운 축이었다. ①②는 "못 한다"고 **포기시키는** 거짓이지만,
> ③은 사용자가 **이름을 억지로 `username` 으로 맞추게** 만들어 계정 3쌍 시나리오를
> 원천적으로 못 쓰게 한다. 세 문장이 같은 사고의 세 얼굴이다.

### ④ `content.ts:614` — 6절 「지금 지원하지 않는 것」 표

> `계정 2쌍 이상을 UI에서 입력` → `API 실행`

→ **행을 삭제했다.** (표는 8행 → 7행)

### ⑤ (거짓은 아니나 전제가 무너진 것) `content.ts:584` — Q&A 「「계정」칸에 입력했는데 로그인이 안 됩니다」

> "코드가 읽는 변수 이름이 `TESTFLOW_VAR_username` 인지 확인하세요.
> `TESTFLOW_VAR_email` 처럼 다른 이름으로 읽고 있으면 값이 전달되지 않습니다."

**이 증상은 이제 일어날 수 없다.** 코드가 `TESTFLOW_VAR_email` 을 읽으면 다이얼로그에도
`email` 칸이 나오므로 **이름이 어긋날 길이 없다.** 질문을 「칸에 입력했는데…」로 바꾸고,
실제로 일어나는 두 경우(**이름 조립으로 감지 실패** / **접힌 선택 영역에 숨음**)로 답을 갈았다.

### 전수 조사 방법

`content.ts` 전체(639줄)를 읽고, 그 위에 다음 낱말을 훑었다:

```
1쌍 · API로 실행 · API 실행 · UI에서 돌릴 수 없 · UI에서 입력 ·
이름을 맞춰야 · 만 받습니다 · 계정 1 · 2개 이상 · 2쌍
```

위 5곳이 전부였다. 고친 뒤 같은 낱말로 다시 훑어 **0건**임을 확인했고,
화면 본문(렌더된 텍스트)에서도 사라진 것을 `g22-guide.mjs` 가 못 박는다(§6).

### ★ 다른 stale 도 같이 확인했다 — 대부분 **아직 사실**이었다

2절 제약 · 3절 · 6절 표의 남은 행 전부를 **실제 코드로** 대조했다(전담 조사).

| 주장 | 판정 | 근거 |
|---|---|---|
| 파일명 `[A-Za-z0-9._-]` + `.spec.ts` | TRUE | `contracts/scenario.ts:232` `SCENARIO_CODE_FILENAME_PATTERN` |
| 코드 본문 256KB | TRUE | `contracts/scenario.ts:225` `MAX_SCENARIO_CODE_BYTES = 256*1024` |
| 첨부 10MB / 20개 / 50MB | TRUE | `contracts/attachment.ts:70·79·88` |
| 브라우저는 Chrome 하나 | TRUE | `contracts/run.ts:39` `BROWSERS = ["chromium"]` |
| 동시 실행 한도 기본 2건 | TRUE | `runner/env.ts:154` `int("RUNNER_CONCURRENCY", 2)` |
| import 은 `@playwright/test` 하나 | TRUE | `contracts/code-validation.ts:41` `ALLOWED_IMPORTS` |
| `test()` 마다 영상이 따로 | TRUE | `runner/execute/code-artifacts.ts:215` · UI 는 첫 영상만 재생 |
| `projects` 여러 개 · `webServer` 미지원 | TRUE | `runner/execute/pw-config.ts:109·113` |
| 예약·반복 실행 없음 | TRUE | 스케줄 기능이 레포에 없다 |
| 휴지통 없음(하드 삭제) | TRUE | `scenarios.service.ts:210` · `runs.service.ts:358` — `deleted_at` 없음 |
| **성공한 실행에도 영상이 남습니다** | **TRUE** | ★ `.env.example`·`README` 만 보면 거짓처럼 보인다(`KEEP_ARTIFACTS_ON_SUCCESS=false`). 실제로는 `runner/execute/artifacts.ts:165-183` 이 **라운드 4 에서 영상만 따로 살려 둔다**. 가이드가 맞고 **README 쪽이 stale** 이다(§8) |

**덤으로 고친 부정확 2곳** (거짓까지는 아니나 틀린 서술):

1. 「`test()` 가 하나도 없으면 노란 경고」 → 실제 검사는 `test(` **또는** `test.describe(`
   이다(`code-validation.ts` `hasTestCall`). `test.describe()` 만 있으면 경고가 **안 뜬다.**
   → "`test()` 도 `test.describe()` 도 없으면" 으로 고쳤다.
2. 첨부 파일명 「따옴표를 쓸 수 없고」 → 실제로 막히는 것은 **큰따옴표뿐**이고
   작은따옴표는 통과한다. 대신 `node_modules`·`package.json` 같은 **예약 이름**이 막힌다
   (`attachment.ts:112-119`). → 정확히 다시 적었다.

---

## 2. ★ 계정 3쌍이 UI 에서 돈다 — 실측

`g22-seed.mjs` 시나리오 A (`TC-GUIDE-001`) — `project-security-check` 와 같은 형태.
`username`/`password` 를 **한 번도 쓰지 않고** 변호사·일반·관리자 6키를 가드 하나로 묶었다.

### ① API 판정

```
═══ A · 가이드검증 A · 계정 3쌍(project-security-check 형태)
  변수 6개 — 필수 6개 · 선택 0개
    필수  lawyerUsername    required=true  secret=false
    필수  lawyerPassword    required=true  secret=true
    필수  generalUsername   required=true  secret=false
    필수  generalPassword   required=true  secret=true
    필수  adminUsername     required=true  secret=false
    필수  adminPassword     required=true  secret=true
```

### ② 다이얼로그 — **칸이 6개 뜬다** (`22-a1-6fields.png`)

```
PASS · ★ 다이얼로그에 칸이 6개 뜬다 (계정 3쌍) — 6칸
PASS · 비밀 3키가 type=password
PASS · ★ 필수 칸은 채워지지 않는다(가드는 process.env 를 직접 본다)
PASS · 안내 문구가 「꼭 입력할 것 6개 · 선택 0개」
PASS · 선택이 0개면 접힘 토글 자체가 없다
```

화면 문구 그대로: **「이 시나리오가 쓰는 변수 6개를 찾았습니다 — 꼭 입력할 것 6개 · 선택 0개」**

### ③ ★ 실행까지 됐다 — `RUN-0303` **passed** (`22-a2-filled.png` · `22-a3-submitted.png`)

6칸을 채우고 「▶ 실행 시작」을 눌러 실제로 돌렸다. 스텝 12건 전부 passed:

```
passed   변호사계정=<lawyer@example.com>
passed   변호사비번길이=<18>
passed   일반계정=<general@example.com>
passed   일반비번길이=<19>
passed   관리자계정=<admin@example.com>
passed   관리자비번길이=<17>
passed   Expect "not toBe"  ×6        ← 6개 모두 "" 이 아님을 단언
```

```
PASS · ★ 계정 3쌍 시나리오가 UI 실행으로 통과했다 — passed
PASS · ★ 변호사 / 일반 사용자 / 관리자 계정이 각각 process.env 에 도달했다
PASS · 변호사·일반·관리자 비밀번호도 도달했다 (길이 18 / 19 / 17)
PASS · ★ 비밀 3키의 평문이 스텝 이력에 없다(마스킹)
```

**비밀번호 3개는 길이로 확인했다** — 값 자체는 스텝 이력에서 가려지므로
평문을 찍으면 증명이 안 된다. 길이가 각각 다르므로 서로 뒤바뀌지 않았음도 같이 증명된다.

→ **①②④ 를 고칠 근거가 이것이다.** 가이드에 적은 「꼭 입력할 것 6개」는 화면 실측 문구다.

---

## 3. ★ 표 4행이 적은 대로 동작한다 — 실측

가이드 2절 4번에 새로 박은 표:

| 코드에 이렇게 쓰면 | 실행 다이얼로그는 이렇게 됩니다 |
|---|---|
| **가드**로 검사 (`throw`·`test.skip`) | **꼭 입력할 것** — 접히지 않고 **항상 보이며**, 칸은 **비어 있습니다** |
| `\|\| '변호사'` | **선택** — 접히고, 펼치면 칸에 `변호사` 가 **미리 채워져** 있습니다 |
| `\|\|` 뒤에 `test-${Date.now()}` 같은 템플릿 | **선택** — 빈 칸 + 「비우면 자동 생성됩니다」 |
| `?? ''` **만** 쓰고 가드 없음 | **선택** — ⚠️ **접힙니다.** 꼭 필요한 값인데도 숨습니다 |

**4가지를 다 가진 한 시나리오**(`g22-seed.mjs` B / `TC-GUIDE-002`)로 실측했다.

### 다이얼로그 (`22-b1-collapsed.png` · `22-b2-expanded.png` · `22-b3-editable.png`)

```
PASS · 1행 · 가드로 검사 → 항상 보임(필수 칸이 guardedKey 하나)
PASS · 1행 · 가드 칸은 빈 칸이다 — value=""
PASS · 2·3·4행은 접혀 있다(기본 화면에 보이지 않는다)
PASS · 접힌 줄이 「선택 변수 3개」 — ▸선택 변수 3개 · 코드의 기본값 1개를 채워 두었습니다
PASS · 2행 · || '변호사' → 칸에 변호사가 채워진다 — value="변호사" prefill=code-default
PASS · 3행 · 템플릿 → 빈 칸 + 「비우면 자동 생성됩니다」
PASS · 4행 · ⚠️ ?? '' 만 → 접힌다 — ph="비우면 빈 값으로 실행됩니다"
PASS · ★ 채워진 기본값을 고칠 수 있다 — value="고친검색어"
```

칸별 `title`(툴팁) 원문까지 확인했다:

```
literalKey      "코드의 기본값을 채워 두었습니다: "변호사" — 그대로 고쳐 쓸 수 있고, 비우면 같은 값이 쓰입니다."
dynamicKey      "코드가 실행할 때 값을 만들어 냅니다(예: 타임스탬프). 무엇이 될지는 미리 알 수 없습니다."
nullishOnlyKey  "코드의 기본값이 빈 문자열입니다. 비워 두면 코드가 정한 기본 동작(예: 목록의 첫 항목)이 쓰입니다."
```

### 실행으로도 확인 — `RUN-0304` **passed**

```
passed  가드키=<가드값>          ← 1행 · 입력한 값이 도달
passed  리터럴키=<변호사>         ← 2행 · 채워진 기본값 그대로 실행
passed  동적키앞=<test->         ← 3행 · 실행 시점에 생성
passed  빈기본값키=<>            ← 4행 · 빈 값으로 돌았다
```

→ **「고치면 고친 값, 비우면 코드의 기본값 — 결과가 같습니다」** 가 실행으로 확인된다.

---

## 4. ★ 잡히는 가드 3형태 · 안 잡히는 4형태 — 실측

### ① `required` 플래그로 직접 (`g22-seed.mjs` C / `TC-GUIDE-003`)

7가지 형태를 한 파일에 넣고 API 의 `required` 를 읽었다.

```
  필수  forOfKey        required=true    ← ✅ for (const key of ['…']) { … throw … }
  필수  ifThrowKey      required=true    ← ✅ if (!process.env['…']) throw …
  필수  skipKey         required=true    ← ✅ test.skip(!process.env['…'], '…')
  필수  constArrayKey   required=false   ← ❌ 상수 배열 참조
  필수  forEachKey      required=false   ← ❌ .forEach 순회
  필수  aliasKey        required=false   ← ❌ 변수에 담았다 검사
  필수  expectKey       required=false   ← ❌ expect(...).toBeTruthy()
```

**적은 대로다.** `required=true` 가 정확히 3개이고 나머지 4개는 `false` 다.

> ★ C 에서는 7개 **전부** 화면에 「필수」로 보인다 — 기본값이 하나도 없어서
> **2차 판정**(`defaultValue === null`)이 받아 준 것이다. 그래서 C 만으로는
> "안 잡히면 사용자가 다친다"를 보일 수 없다. 그것이 D 다.

### ② ★ 사용자가 실제로 다치는 조합 — 안 잡히는 가드 **+ `?? ''`** (`TC-GUIDE-004`)

같은 4키를 **전부 `?? ''` 로 읽으면서** 가드 형태만 바꿨다.

```
  필수        forOfUser        required=true    ← ✅ 배열을 그 자리에 적음
  ★선택(접힘)  constArrayUser   required=false
  ★선택(접힘)  forEachUser      required=false
  ★선택(접힘)  aliasUser        required=false
```

**UI 실측** (`22-d1-trap.png` · `22-d2-trap-expanded.png`):

```
PASS · ★ 잡히는 가드(for-of) 하나만 「꼭 입력할 것」으로 올라온다 — forOfUser
PASS · ★ 안 잡히는 3형태는 ?? '' 때문에 접힌다 — ▸선택 변수 3개
PASS · 접힌 3칸이 constArrayUser · forEachUser · aliasUser
```

> **사람 눈에는 네 개가 전부 똑같은 가드인데, 화면에는 하나만 올라온다.**
> 이것이 가이드 2절 4번의 경고 박스에 실측으로 적은 내용이고,
> AI 프롬프트 4번이 "형태를 바꾸면 못 알아본다"고 못 박는 이유다.

---

## 5. `AI_PROMPT` before / after

### before (항목 4 끝줄이 막연했다)

```
4. 계정·비밀번호·조회 대상 이름 같은 값을 코드에 박지 마. 환경변수로 읽어.
   const username = process.env["TESTFLOW_VAR_username"] ?? "";
   const password = process.env["TESTFLOW_VAR_password"] ?? "";
   const projectName = process.env["TESTFLOW_VAR_projectName"] ?? "";
   변수가 비었으면 왜 실패했는지 알 수 있게 맨 앞에서 명확히 멈춰.
```

"명확히 멈춰"로는 AI 가 `.forEach` 나 `expect(...).toBeTruthy()` 를 쓴다 — §4 가 보인
**안 잡히는 형태**다. 그리고 `?? ""` 만 세 줄 보여 줘서 **함정을 오히려 권하고 있었다.**

### after

```
4. 계정·비밀번호·조회 대상 이름 같은 값을 코드에 박지 마. 환경변수로 읽어.
   const username = process.env["TESTFLOW_VAR_username"] ?? "";
   기본값이 있는 값은 || 로 써. const kw = process.env["TESTFLOW_VAR_kw"] || "변호사";
   꼭 있어야 하는 값은 test() 맨 앞에서 아래 형태 그대로 막아. 형태를 바꾸면 실행
   화면이 "꼭 입력할 것"으로 못 알아본다(forEach·expect(...).toBeTruthy() 금지).
   for (const key of ["TESTFLOW_VAR_username", "TESTFLOW_VAR_password"]) {
     if (!(process.env[key] ?? "")) throw new Error(`실행 변수 ${key} 가 필요합니다.`);
   }
```

바뀐 것 셋: ① **정확한 가드 코드**를 박았다 ② **안 잡히는 형태 2개를 이름으로 금지**했다
③ **기본값은 `||`** 라는 한 줄을 넣었다.

### 예산 — ★ **항목을 늘리지 않았다**

| | before | after | 예산 |
|---|---|---|---|
| 항목 수 | 9 | **9** | ≤ 10 |
| 글자 수 | 1434 | **1594** | ≤ 1800 |
| 번호 | 1…9 빠짐없음 | **1…9 빠짐없음** | 필수 |

**기존 항목을 묶지 않아도 4번 안에서 교체가 됐다.** `?? ""` 예시 두 줄(password·projectName)을
빼고 그 자리에 가드를 넣었으므로 순증은 +160자다. 남은 여유 206자.

> `content.spec.ts` 의 「AI 프롬프트가 길이 예산 안에 있다」 테스트가 이 셋을 강제한다.
> 통과했다.

### ★ 복사 버튼 실측 — 백틱 이스케이프가 깨지지 않았다

`AI_PROMPT` 는 템플릿 리터럴이라 안쪽 백틱이 `` \` `` 로, `${key}` 가 `\${key}` 로
이스케이프돼 있다. **사람이 틀리기 쉬운 자리**라 화면의 「복사」 버튼을 실제로 눌러
클립보드 내용을 읽었다:

```
PASS · ★ 복사된 프롬프트의 백틱 이스케이프가 온전하다 (`${key}` 가 살아 있다)
PASS · ★ 복사본에 역슬래시가 새지 않았다
PASS · 복사본에 안 잡히는 형태 경고가 있다
PASS · 복사본이 예산 안에 있다 — 1594자 / 1800
```

클립보드에 실제로 들어간 줄:

```
     if (!(process.env[key] ?? "")) throw new Error(`실행 변수 ${key} 가 필요합니다.`);
```

→ 그대로 AI 에 붙여넣으면 **동작하는 가드**다.

---

## 6. 가이드 화면 실측 (`g22-guide.mjs` — 25 PASS · 0 FAIL · 콘솔 에러 0건)

### ★ 백틱 / 링크 누수 — 코드 블록을 뺀 **산문 전량**을 훑었다

```
PASS · ★ 산문에 백틱이 한 글자도 새지 않았다 — 백틱 0개
PASS · ★ 링크 문법 원문이 노출되지 않았다
PASS · ★ `**` 원문이 노출되지 않았다
```

### ★ 이 검사가 실제로 버그를 잡았다 — 두 번

1. **`content.spec.ts` 가 잡음** — 내가 처음 쓴 세 문장이 `**굵게**` 안에 백틱을 넣었다
   (`**`.forEach`**` 등). 테스트가 3건을 정확히 집어냈고 코드 칩을 굵게 밖으로 뺐다.
2. ★ **`content.spec.ts` 가 못 잡는 구멍을 화면 실측이 잡음** — 코드 블록의
   **`caption` 은 `InlineMd` 를 지나지 않는다**(`CodeBlock.tsx:45` 가 `{caption}` 으로 그대로
   그린다). 그런데 `content.spec.ts` 의 `proseStrings()` 는 `case "code": break;` 로
   **caption 을 아예 보지 않는다.** 내가 caption 에 `` `||` `` 를 쓰자 화면에 백틱 2개가
   그대로 노출됐고, **`g22-guide.mjs` 의 DOM 검사만이 그것을 잡았다.**
   → caption 에서 코드 칩을 빼고, `content.ts` 에 그 이유를 주석으로 남겼다.
   (테스트 구멍 자체는 §8 에 남긴다 — 이번엔 문서만 고치는 라운드다.)

### 새로 쓴 문장이 화면에 실제로 있는가 / 거짓이 사라졌는가

```
PASS · 4절 표 1행 · 「꼭 입력할 것」 이 화면에 있다
PASS · 4절 `?? ''` 함정 경고 이 화면에 있다 — "네 번째 줄이 함정입니다"
PASS · 4절 안 잡히는 가드 이 화면에 있다 — "상수 배열을 참조"
PASS · 4절 120자 예외 이 화면에 있다 — "120자를 넘을 때"
PASS · 3절 다이얼로그 설명 이 화면에 있다 — "칸이 왜 그렇게 나오나"
PASS · 3절 안 열어도 되는 이유 이 화면에 있다 — "결과가 같습니다"
PASS · 3절 「비밀 아님」 토글 이 화면에 있다
PASS · 5절 계정 3쌍 — 된다 이 화면에 있다 — "꼭 입력할 것 6개"

PASS · ★ 5절 「지금은 API로 실행해야 합니다」 가 사라졌다
PASS · ★ 5절 「UI에서 돌릴 수 없습니다」 가 사라졌다
PASS · ★ 6절 표 「계정 2쌍 이상을 UI에서 입력」 가 사라졌다
PASS · ★ 4절 「이름을 맞춰야 UI에서 실행할 수 있습니다」 가 사라졌다
```

### 목차 이동

```
목차 링크 23개 · 앵커 23개
PASS · ★ 목차의 모든 링크가 실제 앵커를 가리킨다
PASS · 새 앵커 run-variables 가 있다
PASS · ★ 목차로 4절(env-vars)로 이동했다 — {"top":88,"text":"4. 값을 코드에 박지 마세요 — 선언하는 방법"}
```

새 h3 하나(`run-variables`)만 늘었고 나머지 앵커는 그대로다. 중복 없음(`content.spec.ts` 통과).

### 반응형

```
PASS · 반응형 1050 — 가로 넘침 없음 — overflow=0px
PASS · 반응형 760 — 가로 넘침 없음 — overflow=0px
```

### 회귀 — 다른 화면

| 경로 | `error-boundary` |
|---|---|
| `/` · `/runs` · `/scenarios` · `/suites` · `/guide` | **전부 없음** |

콘솔 에러 **0건**(가이드 검증 · 다이얼로그 검증 · 회귀 각각).

---

## 7. 기준선

전부 로컬(`docker compose` MySQL/Redis → `pnpm db:migrate` → API `:4000` → Runner `:4100`
`mode=local` → `vite preview :4222`). **배포 서버·운영(`live.law365ai.com`) 무접촉.**

| 항목 | 기준 | 결과 |
|---|---|---|
| `pnpm typecheck` | 7/7 | **7/7** |
| `pnpm lint` | 0 problems | **0 problems** |
| `pnpm build` | 5/5 · 500KB 경고 없음 | **5/5 · 경고 없음** |
| `pnpm test` | 874건 이상 | **874건** (contracts 282 · runner 253 · api 172 · web 167) |
| 초기 로드 JS | 529KB 수준 | **529.61 kB** (변동 0) |
| 인라인 CSS · HEX | 추가 금지 | **0건** (`content.ts` 만 고쳤다) |
| 새 런타임 의존성 | 금지 | **없음** |
| 새 컴포넌트·블록 종류 | 금지 | **없음** — `p`/`h3`/`code`/`note`/`table`/`ul`/`ol`/`qa` 만 씀 |
| 새 md 파일 | 금지 | **없음** — 화면이 단일 출처 |
| DB 스키마 | 변경 금지 | **변경 없음** |

### 번들 before / after

| 청크 | before | after | 차이 |
|---|---|---|---|
| `guide-*.js` (**지연 로드**) | 37.77 kB (gzip 14.27) | 46.25 kB (gzip 17.10) | +8.48 kB (gzip +2.83) |
| `index-*.js` | 310.79 kB | 310.79 kB | — |
| `vendor-react-*.js` | 218.82 kB | 218.82 kB | — |
| **초기 로드 JS** | **529.61 kB** | **529.61 kB** | **±0** |

가이드 청크는 `/guide` 에 들어갈 때만 받는 별도 청크라 **초기 로드에 영향이 없다.**
늘어난 8.5kB 는 전부 본문 문자열이다.

---

## 8. ★ 코드가 틀렸다고 본 것 (고치지 않고 남긴 것)

이번 라운드는 **문서만 고친다**는 지시라 아래는 손대지 않았다.

1. ★ **`content.spec.ts` 가 `caption` 을 검사하지 않는다.**
   `proseStrings()` 가 `case "code": break;` 로 코드 블록을 통째로 건너뛰는데,
   `caption` 은 코드가 아니라 **화면에 그려지는 산문**이고 `InlineMd` 를 지나지 않는다
   (`CodeBlock.tsx:45`). 그래서 caption 에 백틱·링크를 쓰면 **테스트가 통과한 채로
   화면에 원문이 노출된다.** §6 에서 실제로 내가 그 구멍에 빠졌다.
   → 고치려면 `proseStrings()` 에 `case "code": if (b.caption !== undefined) out.push(b.caption); break;`
   한 줄이면 된다. 다만 caption 은 `InlineMd` 를 안 지나므로 **백틱을 아예 금지**하는
   별도 규칙이 더 맞을 수 있다(굵게 검사와 기준이 다르다).

2. **`.env.example:33` · `README.md:196,302` 이 stale 이다.**
   "`KEEP_ARTIFACTS_ON_SUCCESS` — 성공 실행의 **영상**·trace 보관 여부(기본 false)" 라고
   적혀 있는데, 라운드 4 이후 **영상은 이 값과 무관하게 항상 남는다**
   (`runner/execute/artifacts.ts:165-183` — `keep` 이 false 여도 `findVideoFile()` 로
   영상만 따로 저장한다). 실제로 이 플래그가 가르는 것은 **trace·console·network** 뿐이다.
   가이드(「성공한 실행에도 영상이 남습니다」)가 맞고 README/.env.example 이 틀렸다.
   → 한 줄 수정이면 되지만 `.env.example`·`README.md` 는 이번 범위 밖이라 남긴다.

3. **`hasTestCall` 이 `test.describe(` 도 통과시킨다.**
   `test.describe()` 만 있고 `test()` 가 없는 파일은 **경고 없이** 저장되는데,
   실행하면 스텝이 하나도 생기지 않는다. 코드 쪽을 좁히는 게 맞을 수도 있으나
   (describe 안에 test 가 있는 정상 파일을 오탐하지 않으려는 의도로 보인다)
   판단이 갈리는 자리라 **가이드 문장만** 실제 동작에 맞췄다(§1 덤 1).

4. **`?? ''` 를 스캐너가 구분하지 못하는 것 자체는 고치지 않았다.**
   `21-variable-prefill.md` §0 이 "추출기는 틀리지 않았다"고 결론 내렸고
   (`|| ""` 와 구분할 방법이 없다), 이번 라운드의 해법은 **가드로 선언하게 가르치는 것**이다.
   가이드가 그 함정을 명시적으로 적었으므로 **문서로 막는 쪽**을 택했다.

---

## 9. 미검증 / 남은 위험

- **운영 `project-security-check` 시나리오 자체로는 실측하지 못했다**(운영 무접촉 지시).
  같은 형태(계정 3쌍 · 가드 하나로 묶음)를 로컬에 재현해 UI 실행까지 확인했다(§2).
  실제 시나리오의 코드가 이와 다른 형태로 변수를 읽는다면 칸 구성이 다를 수 있다.
- **120자 초과 · 제어문자 기본값이 채워지지 않는 것은 이번에 직접 재현하지 않았다.**
  가이드에 적은 근거는 `21-variable-prefill.md` §3 의 실측(`longMemo` 150자 ·
  `multilineMemo`)이다. 그 라운드에서 API·UI·실행 3단으로 확인된 사항이지만,
  **내가 이번에 다시 돌려 본 것은 아니다.**
- **`test.skip` 가드는 API 판정(`required=true`)까지만 확인했다.** 실제로 skip 이 걸린
  실행을 돌려 보지는 않았다(칸이 올라오는 것이 가이드의 주장이므로 판정까지면 충분하다고 봤다).
- **「비밀 아님」 토글을 눌러 보지 않았다.** 3절에 적은 설명은 `20-variable-defaults.md` §4 와
  `21-variable-prefill.md` §6 의 실측에 근거한다. 이번 검증 시나리오들은 토글이 나오는
  조건(선택 + 비밀 판정)을 만족하는 키가 없어 화면에 토글이 뜨지 않았다(`plainToggles: []`).
- **녹화(steps) 시나리오의 다이얼로그**는 이번에 열어 보지 않았다. 가이드 3절의 설명은
  코드 시나리오 기준이며, 녹화 쪽은 `{{키}}` 가 전부 필수가 된다(20 §1) — 그 문장은
  가이드에 새로 적지 않았다.
- **AI 가 새 프롬프트로 실제로 옳은 가드를 쓰는지는 검증하지 못했다.** 프롬프트가
  **정확한 코드 형태**를 담고 있고 그 형태가 스캐너에 잡힌다는 것(§4)까지만 확인했다.
- 로컬 검증 시나리오 4건(`TC-GUIDE-001`~`004`)과 run 2건(`RUN-0303`·`RUN-0304`)을
  **지우지 않고 남겼다**(증거가 그 run 에 붙어 있다).

---

## 10. 생성·수정 파일

**수정 (1개)**
- `apps/web/src/pages/guide/content.ts`
  - `AI_PROMPT` 4번 교체 (항목 수 유지 9 · 1434 → 1594자)
  - `CODE_ENV` 예제 — 가드의 **뜻**을 주석으로 달고, `?? ''` 가 타입용임을 명시,
    `projectName` 을 `||` 로 바꿔 표 2행과 맞춤. **돌아가던 코드는 그대로 돈다**
  - 2절 4번(`env-vars`) — 「박지 마라」 → **「선언하는 방법」**. 표 4행 · `?? ''` 함정 경고 ·
    잡히는/안 잡히는 가드 목록 · 실측 경고 · 채움 예외(120자·제어문자) · 이름 규칙 정정 ·
    비밀 기본값 경고 보강
  - 3절(`run`) — 실행 표의 「계정 / 비밀번호」 행을 「테스트 데이터」로 바꾸고,
    새 h3 `run-variables` 「「테스트 데이터」 — 칸이 왜 그렇게 나오나」 추가
  - 5절 Q&A — 「계정이 2개 이상」 뒤집음 · 「칸에 입력했는데」 다시 씀
  - 6절 표 — 「계정 2쌍 이상을 UI에서 입력」 행 **삭제**
  - 덤: `test.describe` 경고 조건 · 첨부 파일명 규칙 정정

**검증 스크립트 (신규 5개 — 라운드 10·11 과 같이 커밋 대상은 `.md`·`.png` 뿐이다)**
- `.pipeline/20260917-231945/g22-seed.mjs` — 시나리오 A/B/C 를 심고 API 판정을 찍는다
- `.pipeline/20260917-231945/g22-seed-d.mjs` — D(안 잡히는 가드 + `?? ''` 함정)
- `.pipeline/20260917-231945/g22-ui.mjs` — 다이얼로그 실측 (19 PASS · 콘솔 0)
- `.pipeline/20260917-231945/g22-runs.mjs` — UI 로 제출한 실행 2건의 스텝 검증 (13 PASS)
- `.pipeline/20260917-231945/g22-guide.mjs` — 가이드 화면 실측 (25 PASS · 콘솔 0)

**스크린샷 (신규 14장)**
`22-a1-6fields.png` · `22-a2-filled.png` · `22-a3-submitted.png` ·
`22-b1-collapsed.png` · `22-b2-expanded.png` · `22-b3-editable.png` ·
`22-d1-trap.png` · `22-d2-trap-expanded.png` ·
`22-guide-top.png` · `22-guide-env-vars.png` · `22-guide-s2-env-vars.png` ·
`22-guide-s3-run-variables.png` · `22-guide-s5-troubleshooting.png` ·
`22-guide-s6-unsupported.png` · `22-guide-vw1050.png` · `22-guide-vw760.png`

**손대지 않은 것**
`docker-compose.yml` · `packages/db/src/cli/guard.ts` · `.gitattributes` · `.npmrc` ·
`apps/runner/poc/**` · `features/recorder/**` · `packages/contracts/**` · `apps/api/**` ·
`apps/runner/src/**` · `SECRET_KEY_PATTERN` · `isSecretVariableKey()` ·
`apps/web/src/pages/guide/` 의 `GuidePage.tsx`·`InlineMd.tsx`·`CodeBlock.tsx`·`content.spec.ts`
