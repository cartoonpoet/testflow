# 19 — 실행 다이얼로그에서 실행 변수를 자유롭게 입력한다

브랜치 `feat/run-variables` (base `main` = `774245c`).

계정 1쌍만 받던 실행 다이얼로그를 **시나리오가 실제로 쓰는 변수만큼** 칸이 생기는 폼으로 바꿨다.
계정 3쌍(6키)을 쓰는 `project-security-check` 류 시나리오가 **UI 로 실행 가능해졌다** (§5 실측).

---

## 1. ★ 변수 추출 방식과 한계

`packages/contracts/src/run-variables.ts` — **순수 함수**. web·api 가 같은 함수를 본다.

### 1.1 이것은 정규식 스캐너다 (보안 경계가 아니다)

파일 머리 주석에 `code-validation.ts` 와 **같은 문구**를 남겼다. 이유도 같다 —
정규식은 우회되고, **정확도를 올려도 원리적으로 못 잡는 형태가 남는다**(키가 실행 시점에 정해진다).

> 이 함수는 실행 다이얼로그가 "무엇을 입력해야 하는지" 미리 알려 주는 **UX 장치**다.
> 못 잡은 변수는 사용자가 **직접 추가**할 수 있어야 하고, 잡힌 키가 실제로 안 쓰여도 **아무 해가 없다**.
> 실행의 진실은 언제나 Runner 가 넘기는 `TESTFLOW_VAR_*` / `{{키}}` 치환이다.

### 1.2 잡는 형태

**코드 시나리오** (접두사는 `CODEGEN_VAR_ENV_PREFIX = "TESTFLOW_VAR_"` — codegen 과 같은 상수)

| # | 형태 | 예 |
|---|---|---|
| 1 | 따옴표 리터럴 안의 접두사 | `process.env["TESTFLOW_VAR_a"]` · `process.env['TESTFLOW_VAR_a']` |
| 1' | 같은 패턴이라 `process.env[…]` 밖도 잡힌다 | `for (const k of ['TESTFLOW_VAR_username','TESTFLOW_VAR_password'])` ← **가이드가 권하는 형태** |
| 2 | 점 접근 | `process.env.TESTFLOW_VAR_a` |

주석은 `blankComments()`(code-validation.ts 에서 **export 만 추가**해 재사용)로 지운 사본을 스캔한다 —
가이드가 코드 맨 위에 적어 두는 `// 실행 변수: TESTFLOW_VAR_username, …` 이 칸을 만들면 안 되기 때문.

**녹화(steps) 시나리오** — 스텝의 `target`/`input`/`options` 세 칸을 통째로 `JSON.stringify` 한 뒤
`{{키}}`(= `variables.ts`·`codegen.ts` 와 같은 정규식)를 스캔한다. 필드를 하나씩 열거하지 않은 이유:
값이 들어갈 자리가 `input.value` 하나가 아니고(`target` 안의 locator 값도 `{{fieldLabel}}` 이 될 수 있다),
열거는 스키마가 늘 때마다 조용히 뒤처진다. JSON 이스케이프는 `{{ }}` 를 건드리지 않는다.

### 1.3 ★ 못 잡는 형태 (통과하는 테스트로 고정 — `run-variables.spec.ts`)

```ts
process.env["TESTFLOW_VAR_" + name]     // 문자열 조립      → 잡히지 않는다
process.env[`TESTFLOW_VAR_${name}`]     // 템플릿 리터럴    → 잡히지 않는다 (의도적)
const e = process.env; e.TESTFLOW_VAR_x // env 를 옮겨 담음 → 잡히지 않는다
```

백틱을 **일부러 뺐다.** 받아 주면 `TESTFLOW_VAR_` 까지만 읽고 **틀린 키**를 보여 주게 된다 —
잘못된 이름을 보여 주느니 "못 잡았다"고 하는 편이 낫다(사용자가 직접 추가할 수 있으므로).

### 1.4 제외·상한

- **`baseUrl` · `envLabel` 제외** (`RUN_SCOPE_VARIABLE_KEYS`). 둘 다 실행 요청의 **자기 필드**에서 오고
  Runner 의 `buildVariableTable()` 이 사용자 변수 **뒤에** 덮어쓴다. 코드에서도 `baseUrl` 은
  `TESTFLOW_BASE_URL` 로 간다. 칸을 만들면 "입력해도 무시되는 칸"이 되어 거짓말이 된다.
  (`codegen.ts` 의 `RUN_SCOPE_KEYS` 와 같은 목록)
- 키 상한 100자 · `=`/NUL 포함 키 제외 — `CreateRunRequestSchema` 와 Runner `buildVariableEnv()` 가
  실제로 막는 경계와 **같은 값**. 여기서 보여 줘 봐야 서버가 400 을 준다.
- `MAX_DETECTED_VARIABLES = 50` — **화면 보호값**이고 계약 상한이 아니다. 잘리면 `truncated:true` 로
  **반드시 알린다**(조용히 자르지 않는다).
- `isSecret` 은 `isSecretVariableKey(key)` 를 그대로 실어 준다 — 웹이 규칙을 두 벌 갖지 않게.

---

## 2. API 엔드포인트 형태 결정 근거

**`GET /api/scenarios/:id/variables`** (신규 `ScenarioVariablesController` + `ScenarioVariablesService`).

### 왜 시나리오 상세(`GET /api/scenarios/:id`)에 얹지 않았나

1. 답을 만들려면 **코드 본문(`scenario_codes.content`, 최대 256KiB `MEDIUMTEXT`)을 읽어야 한다.**
   상세에 얹으면 `ScenariosService` 가 `ScenarioCodeEntity` 를 주입받게 되고,
   "목록·상세가 코드 본문을 한 바이트도 읽지 않는다"는 **구조적 방어**(03-phases 쟁점 1)가 무너진다.
2. 빌더는 스텝을 저장할 때마다 상세를 다시 읽는다 — 그때마다 본문을 끌고 온다.
   변수 목록이 필요한 곳은 **실행 다이얼로그 하나**다.
3. 웹 캐시에서도 `scenario` 와 `scenarioCode`/`scenarioAttachments` 를 분리해 둔 규율과 어긋난다.

### 왜 `ScenarioCodeService` 에 메서드를 더하지 않았나

그 서비스는 **코드 본문만** 보는 것이 규율인데, 이 답에는 `test_steps` 도 필요하다.
스텝 리포지토리를 거기 주입하면 "코드 전용"이라는 성질이 사라진다.
→ `scenarioAttachments`·`scenarioCode` 가 이미 같은 규율로 분리돼 있어 **새 패턴이 아니다.**

### 부수 결정

- **쓰기 경로 없다.** 변수 목록은 원본에서 매번 계산하는 파생값이고 저장하지 않는다 —
  `runs` 에 `variables` 컬럼을 두지 않은 결정(02-context (c))과 같은 선. **마이그레이션 0건.**
- 서버는 `sourceType` 으로 **읽을 것만 읽는다**(code → 본문만 `select`, steps → 스텝 3칸만 `select`).
  순수 함수 쪽은 둘 다 받아 합친다(과도기 데이터에서 한쪽을 놓치지 않기 위해).
- 경로가 `scenarios/:id` 보다 한 segment 길어 **선언 순서 문제가 없다**(`scenarios/bulk-delete` 와 다르다).

---

## 3. UI 설계

`RunDialog.tsx` + 신규 `useRunVariableForm.ts` · `run-variable-memory.ts` · `hooks/useScenarioVariables.ts`.

### 3.1 기존 「계정」·「비밀번호」 칸과의 관계 — **한 벌의 반복문**

칸 목록 = `감지분이 1개 이상이면 감지분, 아니면 [username, password]`.
그리고 **하나의 `map` 으로 렌더한다.** 갈래를 두면 감지 0개일 때의 마크업이 두 벌이 되어 회귀가 생긴다.

- `username`/`password` 가 감지되면 **그 칸이 곧 그 변수**다 — 라벨은 「계정」·「비밀번호」로,
  `data-slot` 은 `field-account`/`field-password` 그대로. **중복 칸을 만들지 않는다.**
- 감지분에 `username`/`password` 가 **없으면** 그 칸도 없다 — 쓰지도 않는 값을 묻지 않는다.
- 나머지 키는 **키 이름이 곧 라벨**이다(`lawyer_email`). 번역하지 않는다 — 코드에 적힌 이름과 화면이
  같아야 사용자가 대응시킬 수 있다.
- `isSecretVariableKey(key)` 가 true → `type="password"` · `autoComplete="new-password"`.

### 3.2 감지 0개일 때 (회귀 금지)

「계정」·「비밀번호」 두 칸 + **기존 안내 문구 한 글자 그대로**. 실측 §6 에서 확인.
추가되는 것은 두 줄뿐이다:

1. `+ 변수 추가` 버튼 — **이것이 없으면 §1.3 의 한계가 곧 "못 돌리는 시나리오"가 된다.**
   감지 0개는 동적 조립·스캔 실패와 구분되지 않으므로 그때야말로 이 버튼이 필요하다.
2. 「비밀값은 저장하지 않습니다」 한 줄(§3.4) — 기억 기능이 도는 화면에서는 사실을 말해야 한다.

### 3.3 감지를 **단건 실행일 때만** 한다

- **스위트**: 이 폼은 담긴 시나리오를 모른다(서버가 편다). 물어볼 id 가 없다.
- **다중 선택(#14)**: id 는 있지만 최대 50건 — 다이얼로그를 여는 것만으로 요청 50건 + 코드 본문 50벌 읽기.
- 두 경우 모두 **라운드 9 이전과 똑같은 폼**이 나오고, 변수가 필요하면 「변수 추가」로 넣는다.

### 3.4 재입력 부담 — `localStorage`, ★ 비밀값은 저장하지 않는다

`testflow.runVariables.v1.<scenarioId>` 에 `[{key, value, custom}]`.

- **비밀 키의 값은 언제나 `""`.** 규칙은 `toStorableVariables()` **한 곳**에만 있고 저장 경로는 반드시 지난다.
- **읽을 때도 한 번 더 버린다** — 저장소를 손으로 고쳐 평문을 넣어 둬도 화면에 되살아나지 않는다.
- 키 **이름**은 남긴다(직접 추가한 `admin_token` 칸이 다음에도 뜨게). 이름은 이미 코드에 평문으로 있다.
- 서버에는 여전히 아무것도 저장되지 않는다 — `runs.variables` 컬럼 없음 결정을 깨지 않았다.
- 읽기·쓰기 모두 **던지지 않는다**(시크릿 모드·quota). 기억은 편의 기능이지 실행의 전제가 아니다.

### 3.5 `useEffect` 없이

감지 결과는 다이얼로그가 열린 뒤 늦게 온다. **값과 칸 목록을 분리**해 해결했다 —
`values` 는 마운트 시 localStorage 로 한 번 동기 초기화(`useState` 초기화 함수),
**무엇을 그릴지**만 감지가 정한다. 칸이 뜨는 순간 기억해 둔 값이 이미 들어 있다. effect 가 필요 없다.

### 3.6 빈 칸

**키째로 빼고 보낸다**(기존 계정·비밀번호 동작 그대로). 코드 시나리오는 `?? "기본값"` 이 살아나고,
녹화 시나리오는 `VariableResolutionError` 로 **어느 키가 없는지** 분명하게 실패한다.
빈 문자열을 보내면 녹화 쪽이 조용히 빈 값을 입력하고 엉뚱한 곳에서 실패한다. 그 사실을 화면에 적었다.

### 3.7 `secretKeys` 는 계속 `[]`

`isSecretVariableKey()` 가 **키 이름으로 자동 판정**하고 web·api·runner 가 전부 그 **같은 함수**를 쓴다.
여기서 목록을 또 만들면 규칙이 두 벌이 되어 어긋나는 순간 한쪽이 평문을 흘린다. 계약은 열려 있다.

---

## 4. ★ 비밀값이 `localStorage` 에 없음 — 실측

실행 후 **`localStorage` 전량 덤프**(같은 브라우저 컨텍스트, 실 UI 조작):

```
{"testflow.runVariables.v1.b0258d76-…":
 "[{\"key\":\"lawyer_email\",\"value\":\"UI_il_1@test.com\",\"custom\":false},
   {\"key\":\"lawyer_password\",\"value\":\"\",\"custom\":false},
   {\"key\":\"general_email\",\"value\":\"UI_general@test.com\",\"custom\":false},
   {\"key\":\"general_password\",\"value\":\"\",\"custom\":false},
   {\"key\":\"username\",\"value\":\"cwmoon@humaxit.com\",\"custom\":false},
   {\"key\":\"password\",\"value\":\"\",\"custom\":false},
   {\"key\":\"extra_note\",\"value\":\"메모-1\",\"custom\":true}]"}
```

| 검사 | 결과 |
|---|---|
| 비밀값 평문(`LAWYER-SECRET-9911` · `GENERAL-SECRET-9922` · `ADMIN-SECRET-9933`) 검색 | **0건 ✅** |
| 비밀 아닌 값 기억 | **3 / 3 ✅** (`lawyer_email` · `general_email` · `username`) |
| 직접 추가한 비밀 아닌 변수(`extra_note`) 기억 | **✅** (키·값 모두 복원) |
| `sessionStorage` | `{}` (비어 있음) |
| 다이얼로그 2회차 열었을 때 | 비밀 3칸만 비어 있고 나머지 3칸 + 직접 추가 1행 자동 복원 ✅ |

단위 테스트로도 고정: `run-variable-memory.spec.ts` 10건
(`lawyer_password`·`admin_token`·`API_KEY`·`client_secret`·`PWD` 전부 값이 `""`,
저장소에 주입된 평문도 읽을 때 버림).

---

## 5. ★ 변수 6개 시나리오 UI 실행 실측 (입력값이 `process.env` 로 도달하는 증거)

로컬 인프라(`docker compose` MySQL/Redis) + API(:4000) + Runner(`mode=local`) + `vite preview`(:4173).
**배포 서버·운영은 건드리지 않았다.**

검증용 코드 시나리오 `TC-GEN-098` — `process.env["TESTFLOW_VAR_*"]` 6개를 읽어
**값을 `test.step()` 이름에 그대로 쓰고**, 하나라도 없으면(`"(없음)"`) `expect` 로 실패하게 못 박았다.

### ① 다이얼로그 (스크린샷 `70-dialog-6vars.png` · `71-dialog-filled.png`)

```
감지된 입력칸: 6 개
[{"key":"lawyer_email","type":"text","slot":"field-variable"},
 {"key":"lawyer_password","type":"password","slot":"field-variable"},
 {"key":"general_email","type":"text","slot":"field-variable"},
 {"key":"general_password","type":"password","slot":"field-variable"},
 {"key":"username","type":"text","slot":"field-account"},
 {"key":"password","type":"password","slot":"field-password"}]
```

→ 6개 전부 감지 · **비밀 3키가 `type="password"`** · `username`/`password` 는 기존 계정·비밀번호 칸이 담당.

### ② 실행 결과 — 값이 실제로 도달했다

`run.status = passed` · 스텝 12건. 스텝 이름 스냅샷:

```
lawyer_email=UI_il_1@test.com          passed
lawyer_password=••••••••               passed
general_email=UI_general@test.com      passed
general_password=••••••••              passed
username=cwmoon@humaxit.com            passed
password=••••••••                      passed
Expect "not toBe" ×6                   passed   ← 6개 모두 "(없음)" 이 아님을 단언
```

- **비밀 아닌 값 3개가 화면에 평문 그대로** → `process.env["TESTFLOW_VAR_lawyer_email"]` 등이 실제로 채워졌다.
- **`expect(value).not.toBe("(없음)")` 6건이 모두 passed** → 6개 전부 도달했다(하나라도 빠지면 run 이 failed).

### ③ 비밀 키 마스킹

스텝 이력에서 비밀 3키의 값은 **`••••••••`** 로 가려졌다(평문 검색 0건).
⚠️ 미션 문구의 `***` 는 `STORED_SECRET_PLACEHOLDER`(= `maskVariablesForStorage` 용)이고,
**실제 스텝 이력에 쓰이는 마스크는 `SECRET_MASK = "••••••••"`** 다(`reporter.ts` → `maskSecretText`).
실행 상세 화면 본문에서도 평문 비밀값 검색 0건.

---

## 6. 그 밖의 실측

| 항목 | 결과 |
|---|---|
| **녹화(steps) `{{키}}` 감지** | `testUser.email`(text) · `testUser.password`(**password**) · `fieldLabel`(target 안쪽) · `projectName` → **4개**, `{{baseUrl}}` 는 제외됨 ✅ |
| **변수 0개 시나리오** | 칸 = `username`·`password` 2개, `field-account`/`field-password` 존재, **기존 안내문 그대로**("…스텝의 {{username}} · {{password}} 자리에 들어갑니다"), 감지 안내문 없음 ✅ |
| **변수 직접 추가/삭제** | 추가 → 행 1, 키를 `dyn_token` 으로 치자 값 칸이 **자동으로 `type=password`** 로 바뀜 · 삭제 → 행 0 ✅ |
| **다중 선택 병렬 실행(#14)** | 감지 없음(설계) → 계정·비밀번호 2칸 + 묶음 동시성 안내 정상 ✅ |
| **재실행(#14)** | 원본 run 의 시나리오를 다시 감지해 **6칸** · `baseUrl` 이 원본 값으로 채워짐 ✅ |
| **삭제(#16)** | 시나리오 3건 삭제 204 · 목록에서 사라짐 ✅ |
| **에러 경계(#18)** | 삭제된 시나리오 URL 진입 → 흰 화면 아님 · 사이드바 유지 ✅ |
| **실행 상세(라이브·스텝)** | 정상 렌더 · 스텝 행 표시 · 평문 비밀값 0건 ✅ |
| **반응형** | 1050px · 760px 모두 **가로 넘침 없음**(760px 은 1열로 접힘) ✅ |
| **콘솔 에러** | 변수 시나리오 0건 / 0건 / 0건. 삭제 회귀 시나리오의 3건은 **일부러 지운 리소스의 404**(에러 경계 검증 자체) |

## 7. 기준선 / 번들

| | before (`774245c`) | after |
|---|---|---|
| `pnpm typecheck` | 7/7 | **7/7 ✅** |
| `pnpm lint` | 0 problems | **0 problems ✅** |
| `pnpm build` | 5/5 · 500KB 경고 없음 | **5/5 · 경고 없음 ✅** |
| `pnpm test` | 793 (contracts 221 · web 147 · api 172 · runner 253) | **825** (contracts **243** · web **157** · api 172 · runner 253) |
| `index-*.js` | 309.70 kB | 310.11 kB (+0.41) |
| `vendor-react` | 218.82 kB | 218.82 kB (동일) |
| **초기 로드 JS 합** | 528.52 kB | **528.93 kB** (+0.41) |
| `RunDialog-*.js` (지연 청크) | 12.18 kB / gzip 4.97 | 16.93 kB / gzip 6.48 |
| 스타일 HEX / `style={{` | 31 / 3 | **31 / 3 (동일 — 새 색 토큰 0개, 인라인 CSS 0개 추가)** |

새 런타임 의존성 **0개** · 마이그레이션 **0건** · `features/recorder/**` **무수정**.

## 8. 생성·수정 파일

**생성**
- `packages/contracts/src/run-variables.ts` · `run-variables.spec.ts` (22건)
- `apps/api/src/modules/scenarios/scenario-variables.service.ts` · `scenario-variables.controller.ts`
- `apps/web/src/hooks/useScenarioVariables.ts`
- `apps/web/src/pages/runs/run-variable-memory.ts` · `run-variable-memory.spec.ts` (10건)
- `apps/web/src/pages/runs/useRunVariableForm.ts`

**수정**
- `packages/contracts/src/index.ts` (barrel 1줄)
- `packages/contracts/src/code-validation.ts` (`blankComments` 를 **export 로만** 바꿈 — 로직 무변경)
- `apps/api/src/modules/scenarios/scenarios.module.ts` (신규 컨트롤러·서비스 등록)
- `apps/web/src/lib/queryClient.ts` (`scenarioVariables` 키 추가)
- `apps/web/src/pages/runs/RunDialog.tsx` (본 작업)

기존 계약 스키마의 **필드명·구조 변경 0건** (추가만).

## 9. ★ 가이드에 반영이 필요한 항목 (직접 고치지 않았다 — `pages/guide/**` 무수정)

`apps/web/src/pages/guide/content.ts` 에서 **지금은 사실이 아니게 된** 문장들:

1. **L294** — "실행 다이얼로그의 「계정」칸은 `TESTFLOW_VAR_username`, 「비밀번호」칸은
   `TESTFLOW_VAR_password` 로 들어갑니다. **이 두 개는 이름을 맞춰야 UI에서 실행할 수 있습니다.**"
   → 이제 **아무 이름이나 된다.** 시나리오에서 자동 감지해 칸이 생긴다.
   두 이름은 "익숙한 라벨(계정·비밀번호)이 붙는 특별 취급"일 뿐이다.
2. **L592** — "실행 다이얼로그는 계정 1쌍(`TESTFLOW_VAR_username` / `TESTFLOW_VAR_password`)만 받습니다.
   **지금은 API로 실행해야 합니다.**"
   → **해소됐다.** 이 문장(과 그 트러블슈팅 항목)은 통째로 바뀌어야 한다.
3. **L496 · L562** — "값을 `TESTFLOW_VAR_*` 로 빼서 실행할 때 지정하세요"
   → 여전히 맞지만, **"빼 두면 실행 다이얼로그에 칸이 자동으로 생긴다"**는 보상을 적으면 설득력이 커진다.
4. **새로 적을 만한 것**
   - 감지되는 형태 3종과 **감지되지 않는 형태**(동적 조립·템플릿 리터럴) → 그때는 「변수 추가」를 쓴다.
   - `baseUrl`·`envLabel` 은 변수가 아니다(윗칸에서 온다).
   - **비밀 키 이름 규칙**(`password|passwd|pwd|secret|token|apikey|api_key`)에 맞추면
     자동으로 `type=password` + 이력 마스킹 + **브라우저 기억에서 제외**된다.
   - 비밀이 아닌 값은 시나리오별로 브라우저에 기억된다(비밀값은 저장하지 않는다).

## 10. 미검증 / 남은 것

- **스위트 실행에서의 변수 감지** — 하지 않는다(§3.3). 스위트에 담긴 시나리오를 서버가 펴는 구조라
  이 폼이 대상 목록을 모른다. 필요해지면 `GET /api/suites/:id/variables` 로 **합집합**을 주는 편이 맞다.
- **다중 선택(#14) 변수 감지** — 하지 않는다(§3.3, 요청 N건 비용). 「변수 추가」가 우회로다.
- **동적 조립 변수** — 원리적으로 못 잡는다(§1.3). 「변수 추가」로만 넣을 수 있다.
- **`localStorage` 정리 UI 없음** — 시나리오를 지워도 그 브라우저의 기억 항목은 남는다
  (비밀값이 없고 키 하나가 수백 바이트라 방치 비용이 작다고 판단). 필요하면 삭제 훅에 붙이면 된다.
- **Runner `mode=docker` 경로** — 검증은 `mode=local` 로 했다. 변수 전달 경로(`buildVariableEnv`)는
  두 모드가 같은 함수를 쓰고 이번 작업이 Runner 를 **한 줄도 고치지 않았으므로** 영향이 없다고 본다.
- **녹화(steps) 시나리오를 실제로 실행**해 `{{키}}` 치환까지 확인하지는 않았다(감지만 확인).
  치환 엔진(`variables.ts`)은 무수정이고 기존 테스트 14건이 그대로 통과한다.
