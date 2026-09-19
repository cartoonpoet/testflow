# 라운드 10 — 실행 변수를 **필수와 선택**으로 가른다

> 브랜치 `feat/variable-defaults` (base `main` `7f2eb09`) · push 하지 않음

## 0. 무엇이 문제였나

라운드 9(#19)가 변수 자동 추출을 넣자 `project-save` 시나리오의 실행 다이얼로그가
**빈 칸 16개**가 됐다. 사용자 반응:

> *"테스트 데이터 입력하는거 작업하니까 너무 사용자가 입력해야할게 많아졌는데.. 이게 맞나 입력 꼭 안해도 되는거지?"*
> *"계정같이 필수로 입력해야하는거만 보이게하고 나머지 입력안해도 기본값같은게 지정되어 있는거면 숨기도록 하면 좋을거같아. 분간이 가야지"*

**기능은 맞고 표현이 틀렸다.** 16개 중 14개는 코드에 기본값이 있었고, 화면은
`{key, isSecret}` 만 받고 있어서 **기본값의 존재를 알 방법이 없었다.**
이번 라운드는 그 정보를 서버가 실어 주고, 화면이 그걸로 **필수 2개만 보여 준다.**

---

## 1. ★ 기본값 추출 — 잡는 형태 · 못 잡는 형태

`packages/contracts/src/run-variables.ts` 에 `extractCodeVariableDefaults()` 를 더했다.
**환경변수 접근 바로 뒤에 붙은 `??` · `||` 리터럴**만 읽는다.

### 잡는 형태

| 코드 | 결과 |
|---|---|
| `process.env["TESTFLOW_VAR_kw"] \|\| "변호사"` | `{kind:"literal", text:"변호사"}` |
| `process.env['TESTFLOW_VAR_a'] ?? 'qa-tester'` | `{kind:"literal", text:"qa-tester"}` |
| `process.env.TESTFLOW_VAR_b \|\| "x"` (점 접근) | `{kind:"literal", text:"x"}` |
| `process.env["TESTFLOW_VAR_row"] \|\| ""` | `{kind:"literal", text:""}` ← **기본값 있음** |
| `` process.env['TESTFLOW_VAR_n'] \|\| `test-${Date.now()}` `` | `{kind:"dynamic", text:""}` |
| `` process.env['TESTFLOW_VAR_t'] \|\| `고정값` `` (치환 없는 템플릿) | `{kind:"literal", text:"고정값"}` |

부가 처리: `\uAC00`(→`가`)·`\"` 같은 **이스케이프를 되돌리고**, 줄바꿈 등 제어문자는 공백으로 접고,
120자를 넘으면 자른 뒤 `truncatedText:true` 로 **잘렸다는 사실을 함께 싣는다**
(잘린 문자열을 정확한 기본값처럼 보여 주지 않기 위해서다).
같은 키가 여러 번 나오면 **처음 것**이 이긴다.

### 못 잡는 형태 — 전부 "기본값 없음" 으로 떨어진다

```ts
process.env["TESTFLOW_VAR_a"]?.trim() || "x"        // 접근과 || 사이에 다른 것이 끼었다
process.env["TESTFLOW_VAR_b"] || FALLBACK           // 상수 참조 — 값을 알 수 없다
const c = process.env["TESTFLOW_VAR_c"]; c || "x"   // 변수에 담았다가 나중에
process.env["TESTFLOW_VAR_e"] !== undefined ? … : "x"  // 삼항
```

이 네 가지는 `run-variables.spec.ts` 에 **통과하는 테스트로 고정**했다(라운드 9 의
"잡지 못하는 형태" 규율과 같은 방식). 한계는 숨기지 않고 못 박는다.

### ★ 빈 문자열과 템플릿을 **다르게** 다룬다

- **`|| ""` 는 "기본값 없음" 이 아니다.** `relatedDocLegalAdviceRow` 가 그렇고,
  그 빈 문자열은 *"이름을 안 주면 코드가 첫 행을 고른다"* 는 **의미 있는 기본값**이다.
  이것을 "없음" 으로 뭉개면 그 칸이 **필수로 올라와** 사용자가 채워야 할 것처럼 보인다 —
  실제로는 비워 두는 것이 정상 동작이다. 그래서 판정 기준은 `text` 의 길이가 아니라
  **`defaultValue === null` 인가** 하나이고, 그 판정은 `isOptionalVariable()` 한 함수에만 있다.
- **템플릿(`` `test-${Date.now()}` ``)은 리터럴 원문을 싣지 않는다.** 그대로 보여 주면
  사용자는 "저 글자가 들어가는구나" 로 읽는다 — 거짓말이다. `kind:"dynamic"` 으로만 알리고
  화면은 「비우면 자동 생성됩니다」로 표시한다. 치환(`${`)이 **없는** 템플릿은 값을 알 수
  있으므로 리터럴로 취급한다.

### ★ 녹화(steps) 의 `{{키}}` 는 **전부 "기본값 없음"** 이 맞다 — 근거

추측이 아니라 Runner 의 동작이다. `apps/runner/src/execute/variables.ts` 의 치환은
치환표에 없는 `{{키}}` 를 만나면 `VariableResolutionError` 를 던져 **그 자리에서 실패**한다
(스텝에는 `??` 같은 대체 문법 자체가 없다). 즉 비워 두면 **반드시 실패**하므로 필수로 올리는
것이 정확하다. 실측: 기존 녹화 시나리오 `TC-GEN-029` → `username`·`password` 둘 다
`defaultValue: null`, 선택 0개(§5 회귀 ①).

### ★ "못 잡으면 필수로 보인다" — 이 오류 방향이 안전한 이유

정규식 스캐너는 반드시 틀린다. 문제는 **어느 쪽으로 틀리느냐**다.

| 틀리는 방향 | 사용자가 겪는 일 | 회복 |
|---|---|---|
| 기본값이 **있는데 못 잡음** → 필수로 보임 | 안 채워도 되는 칸이 하나 더 보인다. 비워 두고 실행하면 **정상 동작한다**(빈 칸은 전달하지 않으므로 코드의 `??` 가 그대로 산다) | 그 자리에서 무시하면 끝 |
| 기본값이 **없는데 있다고 오판** → 접어 숨김 | **존재조차 모르는 칸** 때문에 실행이 실패한다. 접힌 줄을 펼쳐 볼 생각을 하기 전까지 원인을 알 수 없다 | 원인 추적이 필요 |

두 번째가 압도적으로 나쁘다. 그래서 패턴을 **좁게** 잡았다 — 확신할 수 있는 형태만
"선택" 으로 내리고, 조금이라도 애매하면(`?.trim() ||`, 상수 참조, 삼항) **필수로 남긴다.**
이 선택은 "기본값이 있는 칸이 몇 개 더 보인다" 는 비용으로 "모르는 칸 때문에 실패한다" 는
위험을 산 것이다.

---

## 2. API — 추가만, 기존 필드는 그대로

`GET /api/scenarios/:id/variables` 응답의 `variables[]` 에 **필드 하나**를 더했다.
`key`·`isSecret` 은 **한 글자도 바꾸지 않았다.**

```jsonc
{
  "key": "recipientSearchKeyword",
  "isSecret": false,
  "defaultValue": { "kind": "literal", "text": "변호사", "truncatedText": false }
}
{ "key": "username", "isSecret": false, "defaultValue": null }          // 필수
{ "key": "relatedDocLegalAdviceRow", "isSecret": false,
  "defaultValue": { "kind": "literal", "text": "", "truncatedText": false } }  // 선택(빈 문자열)
{ "key": "newProjectName", "isSecret": false,
  "defaultValue": { "kind": "dynamic", "text": "", "truncatedText": false } }  // 선택(동적)
```

- `defaultValue` 는 `.nullable().default(null)` 이라 **이 필드가 없는 옛 응답도 그대로 파싱**된다.
  그 경우 전부 "필수" 로 보인다 — §1 의 안전한 방향이다.
- 컨트롤러·서비스는 **한 줄도 고치지 않았다.** 순수 함수(`detectScenarioVariables`)가
  필드를 채우므로 서버 코드는 그대로 통과한다.
- **DB 스키마 변경 없음 · 마이그레이션 없음.** 변수는 여전히 서버에 저장되지 않는다.

---

## 3. UI 설계

### 접힘 기준
`isOptionalVariable(v)` = `v.defaultValue !== null` **하나**다. 화면이 "빈 문자열은 없는 셈
치자" 같은 판단을 새로 만들지 않도록 contracts 의 함수를 쓴다.

### 화면 구성 (실측 — `90-collapsed.png`)

```
테스트 데이터
  이 시나리오가 쓰는 변수 16개를 찾았습니다 — 꼭 입력할 것 2개 · 선택 14개. …
  ┌ 계정 ─────────┐ ┌ 비밀번호 ────────┐      ← 필수만 보인다
  │ qa-tester     │ │ ••••••••        │
  └───────────────┘ └─────────────────┘
  [▸ 선택 변수 14개 · 비우면 코드의 기본값을 씁니다]  [입력해 둔 값 2개]
  ┌ 변수 이름 ────┐ ┌ 값 ─────────────┐ [삭제]   ← 직접 추가분은 **항상** 보인다
  [+ 변수 추가]
```

| 결정 | 이유 |
|---|---|
| 선택은 **접힌 채로 시작** (값을 기억해 뒀어도) | 열어 두면 라운드 9 와 똑같이 빈 칸 16개가 된다. 기억해 둔 값이 있다는 사실은 **배지**가 말한다 |
| 접힌 줄 문구 `선택 변수 14개 · 비우면 코드의 기본값을 씁니다` | 개수와 **의미**를 같이 적는다. 개수만 적으면 "왜 접혀 있지"가 남는다 |
| `입력해 둔 값 N개` 배지 (`optional-variables-filled`) | 접힌 칸의 값이 **조용히 실려 나가면 안 된다**. "왜 이 값이 들어갔지"를 미리 막는다. 실측: 재방문 시 `입력해 둔 값 2개` (`93-reopened.png`) |
| placeholder 에 기본값 | `비우면 "변호사"` — 따옴표로 **문자열 그 자체**임을 보인다 |
| **빈 문자열 기본값**은 `비우면 빈 값으로 실행됩니다` | `""` 를 따옴표로만 보여 주면 **빈 칸과 구분이 안 된다**. 그래서 문장으로 적는다. 더 긴 설명(*"코드가 정한 기본 동작(예: 목록의 첫 항목)이 쓰입니다"*)은 `title` 툴팁이 맡는다 — 칸 폭에서 **잘리는 문구는 기본값을 잘못 읽게 만든다** |
| **동적**은 `비우면 자동 생성됩니다` | 리터럴 원문(`test-${Date.now()}`)을 보여 주지 않는다 |
| 필수 **0개**면 칸 대신 한 줄 안내 (`no-required-variables`) | 칸을 하나도 안 그리면 "테스트 데이터" 제목만 떠서 **로딩 실패처럼** 보인다. 「반드시 입력해야 하는 변수가 없습니다. 그대로 실행하면 코드에 적힌 기본값으로 돌아갑니다.」 |
| 직접 추가한 변수는 **접지 않는다** | 숨기면 자기가 넣은 것을 잃어버린다. 기존처럼 접힘 영역 **바깥**에 그대로 둔다 (실측 `93-reopened.png` — 재방문 시 `customVisible` 이 접힌 상태에서도 보인다) |
| 감지 0개면 **접힘 UI 자체가 없다** | 선택이 0개면 토글 줄을 그리지 않는다 → 라운드 9 이전과 **같은 화면** |

### 마크업
- `Field`(라벨이 칸 전체를 감싸는 `<label>`) 대신 `VariableField` 를 새로 썼다.
  「비밀 아님」 토글이 `<button>` 인데 **`<button>` 은 labelable 요소**라 `<label>` 안에
  넣으면 HTML 이 깨진다(`RunRow.tsx` 가 체크박스로 같은 판단을 했다). `htmlFor`/`id` 로 묶었고
  **보이는 결과는 같다**(같은 클래스·같은 `data-slot`).
- **인라인 CSS 0 · 새 HEX 0.** 기존 토큰(`line`·`soft`·`brand`·`brand-dark`·`muted`·
  `radius-btn`·`radius-badge`·`radius-tag`·`shadow-focus-ring`)만 썼다.
- `useEffect` 없음. 접힘 상태는 `useState` 하나(`optionalOpen`).

---

## 4. ★ 비밀 키 오탐 — 고친 방식과 "기준은 약해지지 않았다" 는 증명

### 무엇이 오탐인가
`SECRET_KEY_PATTERN = /(password|passwd|pwd|secret|token|apikey|api_key)/i` 가
`securitySecretKeyword`(검색어 `[보안]`)·`securityTopSecretProjectName`(`[극비]`) 을
비밀로 잡는다. 결과: 칸이 가려지고 **localStorage 에 안 남아 매 실행마다 다시 타이핑**.

### 하지 않은 것
- **패턴을 느슨하게 만들지 않았다.** `run.ts` 의 `SECRET_KEY_PATTERN` ·
  `isSecretVariableKey()` 는 **한 글자도 바뀌지 않았다**(`git diff` 에 없다).
  비밀값을 놓치는 쪽이 훨씬 나쁘다 — 마스킹·저장 제외가 전부 그 판정에 달려 있다.
- **"기본값이 있으면 비밀이 아니다" 로 자동 판정하지 않았다.** `|| "changeme"` 처럼
  **기본값이 있어도 진짜 비밀**일 수 있다. 기본값의 존재는 *"코드에 평문이 적혀 있다"* 는
  뜻이지 *"이 값이 비밀이 아니다"* 는 뜻이 **아니다.** 자동으로 풀면, 사용자가 그 칸에
  입력하는 **진짜 비밀번호**가 평문으로 보이고 브라우저에 남는다.

### 한 것 — 칸 단위 **사용자 지정**, 두 겹의 조건
1. **토글이 나타나는 조건**: `isSecret === true` **그리고** `defaultValue !== null`
   (= 코드에 평문 기본값이 적혀 있다 = 검색어일 가능성이 높다). 코드 앞단 가드로 막힌
   진짜 계정(`username`·`password`)은 기본값이 없어 **토글이 아예 없다.**
   실측: 16개 중 토글이 붙은 칸은 `securitySecretKeyword`·`securityTopSecretProjectName`
   **둘뿐**이고 `password` 에는 없다.
2. **실제로 푸는 것은 언제나 사람**이다. 기본값은 `false` 이고, 누르지 않으면
   **지금까지와 완전히 같다.**
3. 직접 추가한 변수에는 토글이 **없다**(코드에 기본값이 있다는 근거가 없다).
4. 토글하면 그때까지 친 값을 **버린다**(가린 채로 친 값이 갑자기 평문으로 드러나지 않게).

### ★ 증명 — 마스킹·저장 제외 기준은 약해지지 않았다

**(a) 서버는 이 토글을 알지도 못한다.** 실행 요청의 `secretKeys` 는 그대로 `[]` 이고,
`maskVariablesForStorage()`·`collectSecretValues()` 는 변함없이 `isSecretVariableKey()` 로
판정한다. 실측 — 「비밀 아님」으로 풀어 둔 `securitySecretKeyword` 에 `[보안]-수정` 을
넣고 UI 로 실행한 결과(run `e8f51385`):

```
# 7 passed  보안검색어=<••••••••>      ← 풀어 뒀는데도 서버가 스텝 이름에서 가렸다
#18 passed  비번평문=<••••••••>        ← 진짜 비밀번호도 그대로 가려진다
```

DB 직접 확인 — 평문이 한 건도 없다:
```sql
SELECT COUNT(*) FROM step_results
 WHERE name_snapshot LIKE '%PLAINTEXT-SECRET%' OR name_snapshot LIKE '%보안]-수정%';
-- 0
SHOW COLUMNS FROM runs;   -- variables 컬럼 자체가 없다(설계 그대로)
```

**(b) localStorage 는 딱 그 칸만 열린다.** 같은 제출 뒤 덤프:
```json
[{"key":"username","value":"qa-tester","custom":false,"plain":false},
 {"key":"password","value":"","custom":false,"plain":false},              ← ★ 진짜 비밀은 여전히 빈 값
 {"key":"securitySecretKeyword","value":"[보안]-수정","custom":false,"plain":true},  ← 사용자가 직접 푼 칸
 {"key":"clientName","value":"UI-의뢰인","custom":false,"plain":false},
 {"key":"customVisible","value":"언제나보임","custom":true,"plain":false}]
```
`password` 는 **가려진 채(`type=password`) 값도 저장되지 않는다.** 실측 `③ 토글 후` 덤프에서도
`password` 의 `type` 은 계속 `password` 였다.

**(c) 규칙은 여전히 한 곳에만 있다.** `toStorableVariables()` / `parseStoredVariables()` 의
조건이 `isSecretVariableKey(key)` → `isSecretVariableKey(key) && !plain` 으로 바뀐 것이 전부이고,
`plain` 은 이 파일이 직접 쓴 플래그다. `run-variable-memory.spec.ts` 에 두 가지를 못 박았다:
`plain` 을 주지 않으면 **지금까지와 정확히 같다**, `plain:true` 인 칸만 값이 남는다.

**(d) 바뀐 경계는 "그 브라우저의 표시와 기억" 뿐이다.** 서버로 가는 것도, DB 에 남는 것도,
로그에 찍히는 것도 **전혀 달라지지 않았다.**

---

## 5. ★ 실행으로 증명 — 비우면 기본값 / 넣으면 덮어씀

같은 시나리오(`TC-VAR-001`, 변수 16개)를 **변수만 바꿔** 두 번 돌렸다
(`g20-runs.mjs`, `RUNNER_CODE_EXECUTION_MODE=local`). 코드가 값을 **스텝 이름에 남긴다.**

### A · 선택 변수를 **전부 비움** (필수만 입력) — run `e3517134` · passed
```
# 3 검색어=<변호사>                    ← || "변호사"
# 4 관련문서행=<>                      ← || ""        (빈 문자열 기본값이 그대로 쓰였다)
# 5 계약서행=<>                        ← || ""
# 6 새프로젝트=<test-1789782713280>    ← || `test-${Date.now()}`  (동적 기본값)
# 7 보안검색어=<[보안]>
# 8 극비검색어=<[극비]>
# 9 의뢰인=<의뢰인>
#10 사건번호=<2026가합1234>
#11 법원=<서울중앙지방법원>
#12 변호사메일=<lawyer@example.com>
#13 기한=<7>      #14 문서제목=<소장>   #15 첨부=<>   #16 메모=<자동 생성 메모>
#17 계정=<qa-tester>                   #18 비번평문=<••••••••>
```

### B · 같은 키를 **전부 입력** — run `af6fd3ac` · passed
```
# 3 검색어=<덮어쓴검색어>       # 4 관련문서행=<두번째행>   # 5 계약서행=<계약행>
# 6 새프로젝트=<덮어쓴프로젝트>  # 7 보안검색어=<••••••••>   # 8 극비검색어=<••••••••>
# 9 의뢰인=<덮어쓴의뢰인>       #10 사건번호=<2099가합9999> #11 법원=<부산지방법원>
#12 변호사메일=<over@example.com> #13 기한=<99> #14 문서제목=<답변서>
#15 첨부=<첨부.pdf>            #16 메모=<덮어쓴메모>       #18 비번평문=<••••••••>
```

**A 의 14줄 전부가 코드의 기본값이고, B 의 14줄 전부가 입력값이다.** 화면이 아니라
실행 결과로 확인했다.

부가 관찰: A 의 `# 7 보안검색어=<[보안]>` 은 가려지지 않았고 B 는 가려졌다 — 값 기반
마스킹이라 **그 run 에 값을 넘긴 경우에만** 가릴 값이 존재하기 때문이다(정상).

### C · UI 로 섞어 실행 — run `e8f51385` · passed
다이얼로그에서 `clientName`·`securitySecretKeyword` 만 채우고 제출:
`# 9 의뢰인=<UI-의뢰인>`(입력값) · `# 3 검색어=<변호사>`(기본값) · `# 7 보안검색어=<••••••••>`(마스킹).

---

## 6. 회귀

| 항목 | 결과 |
|---|---|
| ① 녹화(steps) 시나리오 `TC-GEN-029` | `username`·`password` **둘 다 필수**, 선택 0개 → 토글 줄 없음 (`95-steps-scenario.png`) |
| ② **변수 0개** 코드 시나리오 `TC-VAR-002` | 라운드 9 이전 문구 그대로(「…스텝의 {{username}} · {{password}} 자리에 들어갑니다」) + 계정·비밀번호 2칸 (`96-zero-vars.png`) |
| ③ 다중 선택(병렬, #14) | 기본 2칸 + 「Runner 는 한 번에 최대 2건…」 안내 유지 (`97-batch.png`) |
| ④ 재실행(#14) | 감지 동작, 선택 14개 접힌 상태, 재실행 안내 문구 유지 (`98-rerun.png`) |
| ⑤ 삭제(#16) | 실행 이력 삭제 다이얼로그 정상 |
| ⑥ 단건 실행 | run A/B/C 모두 `passed` |
| ⑦ 라이브/영상 | run 상세에서 스텝 18줄 + `<video>` 렌더 (`99-run-detail.png`) |
| ⑧ 녹화 시작 화면 | `/scenarios/new` 정상 마운트 (`features/recorder/**` 는 **건드리지 않았다**) |
| ⑨ 에러 경계(#18) | `/` · `/runs` · `/suites` · `/guide` 전부 경계 미발동 |
| ⑩ 반응형 | 1050 / 760 정상(`94-responsive-*.png`) — 760 에서 1열, 배지 줄바꿈 정상 |
| ⑪ 콘솔 에러 | **0건** (UI·회귀 스크립트 전부) |

---

## 7. 기준선 · 번들

| 항목 | 기준선 | 결과 |
|---|---|---|
| `pnpm typecheck` | 7/7 | **7/7** |
| `pnpm lint` | 0 problems | **7/7 통과, 0 problems** |
| `pnpm test` | 825건 이상 | **846건** (contracts 261 · web 160 · runner 253 · api 172) — +21 |
| `pnpm build` | 5/5, 500KB 경고 없음 | **5/5, 경고 없음** |
| 초기 로드 JS | 529KB 수준 | `index 310.53` + `vendor-react 218.82` = **529.35 kB** (before 528.93 kB · **+0.42 kB**) |
| `RunDialog` 청크(지연 로드) | 16.93 kB | **21.22 kB** (+4.29 kB) |
| 인라인 CSS | `style={{` 2건 | **2건**(기존 그대로, 둘 다 CSS 변수 주입) |
| 스타일 HEX | 0건 | **0건** — 이번 diff 가 추가한 HEX **0** |
| 새 런타임 의존성 | 금지 | **없음** |
| DB 스키마 | 변경 금지 | **변경 없음 · 마이그레이션 없음** |

---

## 8. 생성 · 수정한 파일

### 수정
- `packages/contracts/src/run-variables.ts` — `RunVariableDefault` 계약,
  `extractCodeVariableDefaults()`, `isOptionalVariable()`, `RunVariable.defaultValue` 추가.
  머리 주석에 **기본값 스캐너의 한계와 "안전한 오류 방향"** 을 명시.
- `packages/contracts/src/run-variables.spec.ts` — 기본값 추출 **18건** 추가(빈 문자열·템플릿·
  이스케이프·잘림·주석·못 잡는 형태 4종·필수/선택 가르기·steps 전부 필수).
- `apps/web/src/pages/runs/RunDialog.tsx` — 필수/선택 분리, 접힘 UI, 배지,
  placeholder·툴팁, `VariableField`, 「비밀 아님」 토글.
- `apps/web/src/pages/runs/useRunVariableForm.ts` — `defaultValue` 보존,
  `isSecretField`/`isPlain`/`togglePlain`.
- `apps/web/src/pages/runs/run-variable-memory.ts` — `plain` 플래그(사용자가 직접 푼 칸만 예외).
- `apps/web/src/pages/runs/run-variable-memory.spec.ts` — `plain` 규칙 **3건** 추가.

**건드리지 않은 것**: `apps/api/**`(컨트롤러·서비스 무수정) · `packages/db/**` ·
`features/recorder/**` · `apps/web/src/pages/guide/**` · `docker-compose.yml` ·
`run.ts` 의 `SECRET_KEY_PATTERN`.

### 검증 산출물 (커밋 대상은 `.md`·`.png`)
`90-collapsed.png` `91-expanded.png` `92-filled.png` `93-reopened.png`
`94-responsive-1050.png` `94-responsive-760.png` `95-steps-scenario.png`
`96-zero-vars.png` `97-batch.png` `98-rerun.png` `99-run-detail.png`
스크립트(untracked): `g20-seed.mjs` `g20-ui.mjs` `g20-runs.mjs` `g20-regress.mjs`

---

## 9. 미검증 / 남은 것

- **녹화 세션 전 구간**(WS `/rec` 로 실제 조작을 받아 스텝을 만드는 흐름)은 돌리지 않았다.
  `features/recorder/**` 를 수정하지 않았고 화면 마운트만 확인했다.
- **라이브 스트리밍 중(`running`) 화면**은 확인하지 않았다(완료 run 의 영상·스텝만 확인).
- 잘린 기본값(`truncatedText: true`)의 **화면 표시**는 단위 테스트로만 확인했다
  (실제 120자 넘는 기본값을 쓰는 시나리오를 심지는 않았다).
- 「비밀 아님」을 푼 뒤 **다른 브라우저/기기**에서 열면 당연히 기본값(잠김)으로 돌아온다 —
  플래그는 그 브라우저에만 남는다. 의도한 동작이지만 문구로 설명하지는 않았다.
- 로컬 검증용 시나리오 2건(`TC-VAR-001`·`TC-VAR-002`)과 run 3건을 **지우지 않고 남겼다**
  (증거가 그 run 들에 붙어 있다).

## 10. 가이드에 반영이 필요한 항목 (직접 고치지 않았다)

`apps/web/src/pages/guide/**` 는 금지 구역이라 **목록만** 남긴다.

1. **"기본값을 주면 선택 변수가 된다"** — `process.env["TESTFLOW_VAR_x"] || "기본값"` 으로 쓰면
   실행 다이얼로그가 그 칸을 접어 준다는 것. 지금 가이드는 변수 읽는 법만 설명한다.
2. **기본값이 인식되는 형태와 안 되는 형태** — `?.trim() ||`, 상수 참조, 삼항, 변수에 담았다
   쓰기는 **필수로 보인다**는 것(§1 표를 그대로 옮기면 된다).
3. **꼭 받아야 하는 값은 기본값을 주지 말고 가드로 막아라** — `if (!username) throw …`
   패턴이 곧 "필수 칸" 이 된다는 것.
4. **빈 문자열 기본값(`|| ""`)의 뜻** — "비워 두는 것이 정상" 이라는 신호로 쓸 수 있다는 것.
5. **검색어처럼 이름에 `secret`·`token` 이 들어가는 비(非)비밀 값** — 다이얼로그에서
   「비밀 아님」으로 풀 수 있고, 서버 마스킹은 그대로라는 것.
