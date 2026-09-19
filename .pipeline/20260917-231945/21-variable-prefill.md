# 라운드 11 — 기본값 자동 바인딩 · 계정·비밀번호가 숨는 버그

브랜치 `fix/variable-prefill` (`main` `7e2ff89` 에서 분기)

---

## 0. 무엇이 잘못됐었나 (실측으로 재현)

배포본 증상: `project-save` 실행 다이얼로그가 **"반드시 입력해야 하는 변수가 없습니다"** 라고 하고
계정·비밀번호가 접힌 섹션으로 들어갔다.

로컬에 `project-save` 와 **같은 형태**(가드 + `?? ''` + 리터럴/템플릿/빈문자열/잘린 기본값)를 심고
**고치기 전 API** 로 조회한 결과 — 증상이 그대로 재현됐다:

```
변수 수: 16
필수 0개 · 선택 16개                 ← ★ 버그
  선택  username   secret=false  literal ""
  선택  password   secret=true   literal ""
  ...
```

원인은 `.fill(process.env['TESTFLOW_VAR_username'] ?? '')` 의 `?? ''` 다.
이것은 `string | undefined` → `string` **타입 안전 장치**인데, `extractCodeVariableDefaults()` 는
"빈 문자열 기본값이 있다"로 읽는다. 라운드 10 의 규칙(기본값이 있으면 선택)이 그 순간
계정·비밀번호를 접었다. **추출기는 틀리지 않았다** — 그 패턴만 보고는
`|| ""`(= 첫 행을 쓰는 **의미 있는** 빈 기본값, `relatedDoc*Row`)와 구분할 방법이 없다.

---

## 1. ★ 가드 패턴 인식 — 어디까지 잡고 왜

`packages/contracts/src/run-variables.ts` 에 `extractCodeRequiredKeys()` 를 새로 만들었다.
**가이드가 권하는 가드**를 읽어 그 키를 **필수**로 표시한다.

### 잡는 것 — 정확히 두 형태 + 하나의 호출

| # | 형태 | 예 |
|---|---|---|
| G1 | `for ( …키가 든 머리… ) { …멈춘다… }` | 가이드의 배열 리터럴 순회 |
| G2 | `if ( …키가 든 조건… ) …멈춘다…` | `if (!process.env['TESTFLOW_VAR_x']) throw …` (블록·한 줄 둘 다) |
| G3 | `test.skip( …키… )` | `test.skip(!process.env['TESTFLOW_VAR_x'], '…')` |

"멈춘다" = `throw` · `test.skip(` · `process.exit(`.

### ★ 키는 반드시 **머리(조건·순회 대상)** 에 있어야 한다

몸통에 있는 키는 세지 않는다. 그러지 않으면

```js
if (await dialogVisible()) {
  await page.fill('#name', process.env["TESTFLOW_VAR_name"] ?? '기본');
  if (bad) throw new Error('x');
}
```

같은 **평범한 블록**이 통째로 가드가 되어, 기본값이 멀쩡한 변수까지 필수로 올라온다.
테스트로 고정했다(`★ 몸통에만 있는 키는 세지 않는다`).

### 일부러 **안 잡는** 것과 근거

```js
const KEYS = ['TESTFLOW_VAR_username'];  for (const k of KEYS) { … }   // 상수 참조
['TESTFLOW_VAR_username'].forEach((k) => { … })                        // forEach 순회
const u = process.env['TESTFLOW_VAR_username']; if (!u) throw …        // 변수로 한 단계 건넘
expect(process.env['TESTFLOW_VAR_username']).toBeTruthy();             // 중단이 암묵적
```

쫓아가려면 **값 추적**(상수 전개·별칭 추적)이 필요한데 그것은 정규식이 아니라 인터프리터다
(파일 머리 주석의 "왜 AST 파서를 쓰지 않는가"와 같은 선). 그리고 **놓쳐도 라운드 10 의 판정이
그대로 남는다** — 새로 나빠지는 것이 없다. 넓게 잡으면 선택 변수가 필수로 올라와
"꼭 입력할 것 N개" 가 거짓이 된다.

> ★ 여기서는 **좁게 잡는 쪽이 안전하다** — 기본값 스캐너와 방향이 **반대**다.
> 기본값 스캐너는 "칸을 **숨기는**" 판정이라 넘어질 때 "기본값 없음(=보이게)" 으로 떨어지는 것이
> 안전했다. 가드 스캐너는 "칸을 **올리는**" 판정이라 넘어질 때 "가드 아님" 으로 떨어지는 것이
> 안전하다. 두 방향 모두 **화면에서 칸이 사라지지 않는 쪽**이다.

### 판정 순서 — 가드가 1차, 기본값 없음이 2차

```ts
isRequiredVariable(v) = v.required || v.defaultValue === null
isOptionalVariable(v) = !isRequiredVariable(v)
```

`RunVariable.required` 를 계약에 **추가**했다(`.default(false)` — 구버전 응답은 라운드 10 과 같은 판정).
**`defaultValue` 는 지우지 않는다** — 지우면 "코드에 `?? ''` 가 있었다"는 사실이 응답에서 사라져
판정을 되짚을 수 없다. 가드가 없는 키의 판정은 **한 글자도 바뀌지 않는다**(기존 테스트 전부 통과).

### 실측 — 고친 뒤 같은 시나리오

```
변수 수: 16
필수 2개 · 선택 14개                 ← ★ 요구한 그대로
  필수  username   secret=false required=true  literal "" trunc=false exact=true
  필수  password   secret=true  required=true  literal "" trunc=false exact=true
  선택  projectName              literal "project-save-"      exact=true
  선택  recipientSearchKeyword   literal "변호사"              exact=true
  선택  assigneeName             literal "문채원 (cwmoon)"     exact=true
  선택  relatedDocLegalAdviceRow literal ""                   exact=true
  선택  relatedDocContractRow    literal ""                   exact=true
  선택  newProjectName           동적
  선택  longMemo                 literal "가가가…" trunc=true  exact=false
  선택  multilineMemo            literal "첫줄 둘째줄"         exact=false
  선택  securitySecretKeyword    literal "[보안]"              exact=true
  선택  clientName / caseNumber / courtName / lawyerEmail / deadlineDays … literal
```

스크린샷 `21-01-required-visible.png` — **계정·비밀번호가 기본 화면에 보인다.**

---

## 2. ★ 자동 바인딩 규칙

판정을 `variablePrefillValue(variable)` **한 함수**에 모았다(contracts).
화면은 그 결과가 `null` 이 아니면 `<input value>` 에 넣는다.

| 기본값 | 채우나 | 칸에 보이는 것 | 왜 |
|---|---|---|---|
| `literal` · 원문 그대로 | **채운다** | 그 값 (`변호사`, `문채원 (cwmoon)`) | 사용자가 보고 고칠 수 있는 진짜 값이다 |
| `literal` · 빈 문자열 (`\|\| ""`) | 채운다(= 빈 칸) | 빈 칸 + `비우면 빈 값으로 실행됩니다` | 비어 있는 게 **의도된 것**임을 문구가 말한다 |
| `literal` · **잘림**(`truncatedText`) | ★ **안 채운다** | 빈 칸 + `비우면 코드의 긴 기본값을 씁니다` | 원문과 다른 값이 **사용자 모르게 전송된다** |
| `literal` · **변형**(제어문자 접힘) | ★ **안 채운다** | 빈 칸 + `비우면 코드의 기본값을 씁니다` | 같은 이유 — 원문(`a\nb`)과 표시(`a b`)가 다르다 |
| `dynamic` (템플릿) | 안 채운다 | 빈 칸 + `비우면 자동 생성됩니다` | 실행 시점에 정해진다 — 채울 값이 없다 |
| **필수**(가드) | 안 채운다 | 빈 칸 + `qa-tester` / `••••••••` | 가드는 `process.env[key]` 를 **직접** 보므로 뒤의 `?? '…'` 는 **닿지 않는 코드**다 |

### 계약에 `exactText` 를 더한 이유

`truncatedText` 만으로는 부족했다. `toDisplayText()` 는 **제어문자도 공백으로 접는다** —
그때 `text` 는 잘리지 않았지만 **원문과 다르다**. 그 값을 채우면 잘린 값을 채우는 것과
같은 사고가 난다. 그래서 `exactText`(원문과 글자 그대로 같은가)를 **따로** 실어 준다.
`truncatedText` 는 문구용("…줄임")으로 남기고, **채울지 말지는 `exactText`** 가 가른다.
구버전 응답은 `.default(true)` 로 떨어지고, 그 경우에도 `truncatedText` 가 잘림을 막는다.

### `useEffect` 없이 채우는 방법

감지 결과는 다이얼로그가 열린 **뒤에** 도착한다. state 에 밀어 넣으려면 effect 가 필요하고
사용자가 친 글자와 경합한다. 대신 **읽을 때 겹쳐 본다**:

```
valueOf(key) = values[key] ?? prefill(key) ?? ""
```

`values[key]` 는 **사람이 만진 흔적**(기억한 값 · 이번에 친 글자), `prefill` 은 **코드가 말한 값**.
`??` 는 빈 문자열을 통과시키므로 **사용자가 지운 칸**(`""`)과 **만진 적 없는 칸**(`undefined`)이
구분된다. 지운 칸은 빈 채로 남는다. `useEffect` 는 한 줄도 늘지 않았다.

---

## 3. ★ 잘린 기본값을 채우지 않음 — 실측

길이 상한(`MAX_DEFAULT_TEXT_LENGTH` = 120)을 넘는 기본값(`"가" × 150`)과
제어문자가 든 기본값(`"첫줄\n둘째줄"`)을 가진 시나리오를 만들어 실측했다.

**API**

```
선택  longMemo       literal "가가가가가가가가가가…" trunc=true  exact=false
선택  multilineMemo  literal "첫줄 둘째줄"           trunc=false exact=false
```

**UI** (`g21-ui.mjs`)

```
PASS · ★ 잘린 기본값을 채우지 않는다          longMemo      value=""  prefill=none
PASS · ★ 제어문자가 접힌 기본값도 채우지 않는다  multilineMemo value=""  prefill=none

longMemo title: 코드의 기본값이 너무 길어 칸에 채우지 않았습니다. 앞부분: "가가가…" —
                비워 두면 코드의 값이 그대로 쓰입니다. 원문과 다른 값을 채워 두면 그 값이 그대로 전송됩니다.
```

**실행으로 증명** (`g21-runs.mjs`) — 코드가 `longMemo.length` 를 스텝 이름에 찍는다:

```
PASS · ★ 잘린 기본값(120자)이 전송되지 않았다 — 코드의 원문 150자가 쓰였다: 긴메모길이=<150>
```

칸이 비어 있으므로 `collect()` 가 그 키를 **전송하지 않고**, 코드의 `||` 가 살아나 **원문 150자**가 쓰인다.
잘린 120자가 전송될 경로는 **존재하지 않는다**.

---

## 4. ★ 채움 vs 비움 — 같은 결과임을 실행으로 증명

같은 시나리오를 두 번 실행했다(둘 다 `passed`).

- **A** — 선택 칸을 전부 비우고 필수만 보냄 (라운드 10 까지의 동작)
- **B** — 다이얼로그가 **채워 준 값 그대로** 보냄 (라운드 11 의 동작)

```
A · runId=35df013d…      B · runId=828e2f66…
   계정=<qa-tester>            계정=<qa-tester>
   프로젝트=<project-save->    프로젝트=<project-save->
   검색어=<변호사>              검색어=<변호사>
   담당자=<문채원 (cwmoon)>     담당자=<문채원 (cwmoon)>
   법률자문행=<>               법률자문행=<>
   긴메모길이=<150>            긴메모길이=<150>
   여러줄메모길이=<6>           여러줄메모길이=<6>
   의뢰인=<의뢰인>              의뢰인=<의뢰인>
   사건번호=<2026가합1234>      사건번호=<2026가합1234>
   법원=<서울중앙지방법원>       법원=<서울중앙지방법원>
   기한=<7>                    기한=<7>

PASS · 동적 기본값·마스킹 줄을 뺀 모든 스텝 이름이 **같다**
```

다른 줄은 둘뿐이고, **둘 다 차이가 아니다**:

1. `새프로젝트앞=` — **동적 기본값**(`test-${Date.now()}`). 양쪽 다 코드가 만들고 시각이 다르다.
   접두사(`test-`)는 같다.
2. `보안검색어=` — A 는 `[보안]`, B 는 `••••••••`. ★ **차이가 아니라 마스킹이다.**
   `securitySecretKeyword` 는 `isSecretVariableKey()` 가 비밀로 판정하는 키라, 값을
   **명시적으로 보내면** 서버의 `collectSecretValues()` 가 실행 기록에서 지운다.
   A 는 보낸 값이 없어 지울 것이 없었을 뿐이다.
   **테스트가 받은 값이 같다는 것은 길이 스텝이 증명한다**:

   ```
   PASS · ★ 마스킹된 비밀 키도 테스트가 받은 값은 같다 — A:보안검색어길이=<4> B:보안검색어길이=<4>
   ```

   즉 자동 바인딩으로 **마스킹은 강해졌을 뿐**(기록에서 더 지워진다) 약해지지 않았고,
   실행에 쓰인 값은 같다. 이 성질은 자동 바인딩의 부수효과이므로 여기 기록해 둔다.

---

## 5. 기억(localStorage)과 코드 기본값이 어긋날 때

### 규칙 — **코드의 기본값과 같은 값은 기억하지 않는다** (쓰는 쪽에서 거른다)

거르는 곳은 `toStorableVariables()` 하나다 — 비밀값 제외 규칙이 이미 사는 곳이고,
저장 경로는 반드시 그 함수를 지난다. 훅은 **코드가 말한 값**(`codeDefault`)을 같이 실어 줄 뿐이다.

### 왜 읽는 쪽 비교가 아닌가

"기억한 값이 현재 코드 기본값과 **다를 때만** 기억을 쓴다"는 규칙은 **막으려던 경우를 못 막는다**:
기본값이 A→B 로 바뀌면 기억한 A 는 B 와 "다르므로" 그대로 이긴다. 그게 바로 사고다.
**쓸 때 거르면** 기억에는 *사용자가 기본값과 다르게 고른 값만* 남으므로,
고른 적이 없는 값이 새 기본값을 덮는 일이 원천적으로 없다.

### 예외 — `plain`

「비밀 아님」으로 풀어 둔 칸은 값이 기본값과 같아도 남긴다. 값을 빼면 그 플래그까지 사라져
매 실행마다 다시 눌러야 한다(라운드 10 이 없애려던 바로 그 불편).

### 실측

```
④ 필수만 채우고 제출 → localStorage:
[{"key":"username","value":"qa-tester",...},{"key":"password","value":"",...},
 {"key":"newProjectName","value":"",...},{"key":"longMemo","value":"",...},
 {"key":"multilineMemo","value":"",...}]
PASS · ★ 기본값과 같은 값은 기억하지 않는다 (변호사·의뢰인 등이 하나도 없다)

⑥ clientName 을 "UI-의뢰인" 으로 고치고 recipientSearchKeyword 를 **비우고** 제출:
PASS · 고친 값(UI-의뢰인)은 기억한다
PASS · 사용자가 **비운** 칸도 기억한다   ← 비운 것도 사용자의 선택이다

⑦ 손으로 옛 값을 심고 열었을 때:
PASS · 기억한 값이 있으면 그것이 이긴다        clientName  = "옛날에기억한값"
PASS · 기억이 없으면 코드에서 다시 읽는다      caseNumber = "2026가합1234"
```

`newProjectName`·`longMemo`·`multilineMemo` 가 `""` 로 남은 것은 **채울 수 없는 기본값**이라
`codeDefault` 가 없기 때문이다(비교 대상이 없다 → 라운드 10 과 같은 동작). 빈 값이므로 해가 없다.

### 접힌 줄의 숫자가 바뀌었다

자동 바인딩 뒤에는 "값이 들어 있다" 가 "사용자가 넣었다" 를 뜻하지 않는다. 그래서
- 배지 「입력해 둔 값 N개」 → **「직접 입력한 값 N개」**(기본값과 다른 칸만 센다)
- 토글 부제 → **「· 코드의 기본값 9개를 채워 두었습니다」**(채운 칸이 없으면 종전 문구 유지)

---

## 6. 비밀값 localStorage 부재 — 재확인

- `SECRET_KEY_PATTERN` · `isSecretVariableKey()` **한 글자도 안 건드렸다**(`git diff` 로 확인).
- `run.ts` 의 비밀 판정도 그대로다.
- 덤프 재확인 — 두 번의 제출 모두:

```
PASS · ★ localStorage 에 비밀값(PLAINTEXT-SECRET-1234)이 없다
PASS · ★ 비밀값은 여전히 없다 (두 번째 제출 후)
{"key":"password","value":"", …}      ← 이름만 남고 값은 언제나 빈 문자열
```

- 단위 테스트로도 고정: `★ 비밀값은 codeDefault 가 있어도 저장되지 않는다(규칙이 약해지지 않는다)`.
- 비밀 키의 **기본값을 칸에 채우는 것**(`securitySecretKeyword` = `[보안]`)은 코드에 이미
  평문으로 있는 값이라 새 노출이 아니다. 그 값이 `localStorage` 에 남는 것은 여전히
  **사용자가 「비밀 아님」을 직접 누른 경우뿐**이다(라운드 10 규칙 유지).
- 가드로 막힌 진짜 계정(`username`/`password`)에는 「비밀 아님」 토글이 **나타나지 않는다** —
  `canMarkPlain()` 이 `isOptionalVariable()` 을 보게 바꿔, `?? ''` 때문에 "기본값이 있는" 것으로
  읽히던 그 칸들이 계속 제외된다. 실측에서 토글은 `securitySecretKeyword` **하나만** 나온다.

---

## 7. 회귀

전부 로컬 실행(`docker compose` → `db:migrate` → API → Runner → web preview). **운영(`live.law365ai.com`) 무접촉.**

| 항목 | 결과 |
|---|---|
| 변수 0개 시나리오 | 라운드 9 이전 폼 그대로 — 「계정」·「비밀번호」 2칸, 종전 문구 |
| 녹화(steps) 시나리오 | `{{키}}` 2개 전부 **필수**, 선택 0개 · 채울 것이 없으므로 안내 문구도 종전 형태 |
| 병렬(#14, 다중 선택) | 감지 안 함 → 기본 2칸 · `Runner 는 한 번에 최대 2건…` 안내 그대로 |
| 재실행(#14) | 원본 run 의 주소·환경 채워짐 · 계정만 빈 칸 · `rerun-secret-notice` 그대로 |
| 삭제(#16) | `이 실행 이력을 삭제할까요? RUN-0298 …` 정상 |
| 에러 경계(#18) | `/` · `/runs` · `/suites` · `/guide` 모두 `error-boundary` 없음 |
| 직접 추가 변수 | 언제나 보임(접히지 않음) · 제출 후에도 기억됨(`customVisible`) |
| 반응형 1050 / 760 | `21-06-responsive-*.png` — 2열 → 1열, 넘침 없음 |
| 콘솔 에러 | **0건** (UI 검증 · 회귀 검증 각각) |

---

## 8. 기준선

| 항목 | 기준 | 결과 |
|---|---|---|
| `pnpm typecheck` | 7/7 | **7/7** |
| `pnpm lint` | 0 problems | **0 problems** |
| `pnpm build` | 5/5 · 500KB 경고 없음 | **5/5 · 경고 없음** |
| `pnpm test` | 846건 이상 | **874건** (contracts 261→282, web 160→167) |
| HEX · 인라인 CSS | 0건 추가 | 내 diff 에 HEX **0건** · `style={{` **0건** (레포 전체는 기존 2건 그대로) |
| DB 스키마 | 변경 금지 | **변경 없음**(마이그레이션 0건) |
| 새 런타임 의존성 | 금지 | **없음** |
| `useEffect` | 자제 | **0개 추가** |

### 번들 before / after

| 청크 | before | after | 차이 |
|---|---|---|---|
| `RunDialog-*.js` | 21.22 kB (gzip 7.83) | 22.61 kB (gzip 8.22) | +1.39 kB |
| `index-*.js` | 310.62 kB | 310.79 kB | +0.17 kB |
| `vendor-react-*.js` | 218.82 kB | 218.82 kB | — |
| **초기 로드 JS** | **529.44 kB** | **529.61 kB** | **+0.17 kB** (529KB 수준 유지) |

---

## 9. 생성·수정 파일

**수정**
- `packages/contracts/src/run-variables.ts` — `RunVariable.required` · `RunVariableDefault.exactText`
  추가, `extractCodeRequiredKeys()`(가드 스캐너 + 괄호/문자열 스캐너) 신설,
  `isRequiredVariable()` · `effectiveVariableDefault()` · `variablePrefillValue()` 신설,
  `isOptionalVariable()` 이 가드를 먼저 보도록 변경
- `packages/contracts/src/run-variables.spec.ts` — 라운드 11 테스트 21건 추가
- `apps/web/src/pages/runs/useRunVariableForm.ts` — `valueOf` 가 prefill 을 겹쳐 봄,
  `collect()`·`remember()` 가 같은 값을 봄, `isCodeDefault()` 노출
- `apps/web/src/pages/runs/run-variable-memory.ts` — `codeDefault` 로 기본값과 같은 값 제외
- `apps/web/src/pages/runs/run-variable-memory.spec.ts` — 라운드 11 테스트 7건 추가
- `apps/web/src/pages/runs/RunDialog.tsx` — placeholder·툴팁·안내 문구, `canMarkPlain`,
  배지/토글 숫자, `data-prefill` 표시

**검증 스크립트(신규)**
- `.pipeline/20260917-231945/g21-seed.mjs` — `project-save` 형태 시나리오를 심고 API 판정을 찍는다
- `.pipeline/20260917-231945/g21-ui.mjs` — 다이얼로그 실측(15 PASS · 콘솔 에러 0)
- `.pipeline/20260917-231945/g21-runs.mjs` — 채움/비움 2회 실행 비교
- `.pipeline/20260917-231945/g21-regress.mjs` — 회귀(g20 스크립트 재사용, 산출물 이름만 분리)

**스크린샷**
`21-01-required-visible.png` · `21-02-prefilled.png` · `21-03-filled-form.png` ·
`21-04-reopened.png` · `21-05-stale-memory.png` · `21-06-responsive-{1050,760}.png` ·
`21-95-steps-scenario.png` · `21-96-zero-vars.png` · `21-97-batch.png` · `21-98-rerun.png`

**손대지 않은 것**
`SECRET_KEY_PATTERN` · `isSecretVariableKey()` · `run.ts` 의 비밀 판정 · `docker-compose.yml` ·
`packages/db/**` · `.gitattributes` · `.npmrc` · `apps/runner/poc/**` · `features/recorder/**` ·
`apps/web/src/pages/guide/**` · `packages/contracts` 기존 필드명·구조(추가만 했다)

---

## 10. 미검증 / 남은 위험

- **`.forEach` · 상수 배열 · 별칭을 거치는 가드는 못 잡는다.** 의도한 선이고(§1) 못 잡아도
  라운드 10 판정이 남지만, 그런 코드를 쓰는 시나리오에서는 이번 버그가 **그대로 남는다.**
  가이드가 for-of 를 권하므로 실사용에서는 드물 것으로 본다 — 운영 시나리오 표본으로 확인하지 못했다.
- **정규식 스캐너의 한계는 그대로다.** 문자열 속 괄호는 건너뛰지만 **정규식 리터럴**(`/["']/`)이
  섞이면 괄호 짝 맞추기가 어긋날 수 있다. 어긋나면 "가드 아님"으로 떨어져 라운드 10 판정이 남는다
  (안전한 방향). 실제 시나리오에서 재현해 보지는 않았다.
- **운영 `project-save` 시나리오로는 실측하지 못했다**(운영 무접촉 지시). 로컬에 같은 형태를
  재현해 검증했고, 고치기 전 상태에서 **같은 증상이 재현되는 것**까지 확인했다.
- **채운 값이 명시적으로 전송되면서 비밀 키 값이 실행 기록에서 마스킹된다**(§4-2).
  기록이 더 가려지는 방향이라 위험은 아니지만, 스텝 이름으로 값을 확인하던 사용자에게는
  보이는 것이 달라진다.
- 브라우저 자동완성이 채워진 칸을 덮어쓰는지는 확인하지 않았다(`autoComplete="off"` 유지).

---

## 11. ★ 가이드 반영이 필요한 항목 (직접 고치지 않았다 — `apps/web/src/pages/guide/**` 금지)

1. **★ `?? ''` 가 필수 판정을 흐린다는 사실을 적어야 한다.**
   가이드의 `CODE_ENV` 예제가 `.fill(process.env['TESTFLOW_VAR_username'] ?? '')` 를 권하는데,
   이 패턴 하나만 있으면 스캐너가 **"빈 문자열 기본값 = 선택"** 으로 읽는다.
   이번 사고의 직접 원인이고, **우리 문서가 만든 함정**이다.
2. **가드를 "있으면 좋은 것" 이 아니라 "필수 변수를 선언하는 방법" 으로 승격해야 한다.**
   이제 가드가 있어야 실행 다이얼로그가 그 칸을 **꼭 입력할 것**으로 올린다.
   가드가 없고 `?? ''` 만 있으면 그 칸은 접힌 섹션으로 들어간다.
3. **가드의 "잡히는 모양"을 명시해야 한다.** `for (const key of ['…','…'])` / `if (!process.env['…'])` /
   `test.skip(!process.env['…'], '…')` 는 잡히고, **상수 배열·`forEach`·변수에 담았다 검사하는 형태는
   잡히지 않는다.**
4. **기본값이 칸에 채워진다는 것을 알려야 한다.** `|| "변호사"` 를 쓰면 그 값이 실행 다이얼로그에
   **미리 들어간다.** 반대로 기본값을 **너무 길게**(120자 초과) 쓰거나 **줄바꿈을 넣으면**
   채워지지 않는다(원문과 다른 값을 전송하지 않기 위해서다).
5. **비밀로 판정되는 이름**(`*password*`·`*secret*`·`*token*` 등)에 평문 기본값을 두면,
   그 값이 칸에 채워지고 **실행 기록에서는 마스킹**된다. 기본값에 진짜 비밀을 적지 말라는
   기존 경고를 이 맥락으로 한 번 더 적는 편이 좋다.
