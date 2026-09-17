---
# PoC-2 결과 — 한글 IME 입력 정확도
pipeline_id: 20260917-114450
task: 12.1
---

# PoC-2 — 한글 IME 입력 정확도 (정식 측정)

측정일 2026-09-17 · Playwright 1.63.0 / Chromium (headless) · Node 22.22.2 (WSL2)
스크립트 `apps/runner/poc/poc2-ime.ts` · fixture `apps/runner/poc/fixtures/ime-test.html`
원시 결과 `/tmp/tf12/poc2.json`

재현:
```bash
yarn workspace @testflow/runner build:poc
node apps/runner/dist-poc/poc/poc2-ime.js          # JSON 을 stdout 으로
node apps/runner/dist-poc/poc/poc2-ime.js --headed # 눈으로 확인
```

---

## 합격 기준 대조 (04-gen-3)

| 기준 | 결과 | 근거 |
|---|---|---|
| 한글 문자열 **왕복 정확도 100%** | ✅ **PASS — 12/12** | 4개 주입 방식 **전부** 12/12. 한 케이스도 어긋나지 않았다 |
| **keydown 의존 위젯 1개 이상에서 동작 확인** | ✅ **PASS (수정 후)** | 수정 전 A안 원형은 3종 중 **0종** 동작. keydown(229) 선행 주입 추가 후 **자동완성·마스킹 핸들러 동작**, 단축키는 원래부터 동작 |

---

## 1) 왕복 정확도 — 12/12 (모든 방식)

| # | 케이스 | 문자열 | 결과 |
|---|---|---|---|
| 1 | 받침 없는 글자 | `가나다` | ✅ |
| 2 | 받침 있는 글자 | `한글 받침` | ✅ |
| 3 | 쌍자음·겹받침 | `깎다 빨갛다 있다` | ✅ |
| 4 | 복합모음 (ㅚ·ㅢ·ㅞ) | `왼쪽 의외로 웬만큼` | ✅ |
| 5 | 04-gen-10 재확인 | `안녕하세요` | ✅ |
| 6 | 법무 실문장 | `계약서를 검토합니다` | ✅ |
| 7 | 한글+영문 | `TestFlow 계약서 Review` | ✅ |
| 8 | 한글+숫자 | `계약서 3건 검토 2026년` | ✅ |
| 9 | 연속 공백 | `앞  뒤  공백  두칸` | ✅ |
| 10 | 이모지(서로게이트 페어) | `계약 완료 ✅ 검토 🔍` | ✅ |
| 11 | 전각 문장부호 | `제1조(목적) — “계약”의 정의` | ✅ |
| 12 | 장문 28자 | `계약서를 검토하고 전자서명을 요청한 뒤 결재 상신합니다` | ✅ |

**값 정확도는 문제가 아니었다.** `Input.insertText` 는 조합을 거치지 않고 완성 문자열을
그대로 넣으므로 자모 분리·중복 입력 같은 고전적 IME 사고가 원천적으로 없다.
이모지(서로게이트 페어)·전각 문장부호도 그대로 통과했다.

---

## 2) ★ A안의 알려진 한계가 **실제로 재현됐다**

fixture 는 `keydown` 에만 의존하는 위젯 3종을 일부러 만들었다
(② 실시간 자동완성 · ③ 숫자만 허용하는 마스킹 input · ④ Enter 단축키).

주입 문자열: 자동완성 `계약서` / 마스킹 `한글123` / 단축키 `제출할내용` + Enter

| 주입 방식 | 자동완성<br>keydown / 목록 | 마스킹 input<br>keydown / blocked / 최종값 | 단축키<br>submitted | composition<br>start/update/end | 일반 input<br>keydown/beforeinput/input |
|---|---|---|---|---|---|
| **A안 원형** — `Input.insertText` 단독 | **0 / 0** ❌ | **0 / 0** / `한글123` ❌ | 1 ✅ | 0/0/0 | 0 / 1 / 1 |
| **A안+ (현재 제품)** — keydown(229) + insertText | **1 / 2** ✅ | **1 / 1** / `한글123` ⚠️ | 1 ✅ | 0/0/0 | 1 / 1 / 1 |
| 대조군 — `page.keyboard.type` | **0 / 0** ❌ | 3 / **0** / `한글123` ❌ | 1 ✅ | 0/0/0 | 0 / 3 / 3 |
| **B안** — `imeSetComposition`+commit | **0 / 0** ❌ | **0 / 0** / `한글123` ❌ | 1 ✅ | **1/5/1** | 0 / 4 / 4 |

읽는 법:
- **자동완성 목록 `2`** = `계약서`, `계약서 검토` 2건이 실제로 떴다는 뜻이다. `0` 은 목록이
  **한 번도 뜨지 않았다**는 뜻 — 테스터가 화면에서 "검색어를 쳤는데 추천이 안 뜬다" 를 본다.
- **마스킹 `blocked`** = `preventDefault()` 가 실제로 호출된 횟수. `0` 이면 핸들러 자체가 안 돌았다.

### 재현된 것

1. **`Input.insertText` 는 `keydown`/`keypress`/`keyup` 을 전혀 만들지 않는다**(`beforeinput`/`input` 만).
   fixture 의 `plainKeydown=0`, `plainBeforeinput=1`, `plainInput=1` 이 그 직접 증거다.
2. 그래서 **입력 중 실시간 자동완성이 통째로 죽는다** — 목록 0건.
3. **keydown 에서 `preventDefault` 하는 마스킹 input 의 핸들러가 아예 돌지 않는다** — `blocked=0`.
4. **단축키(④)는 깨지지 않는다.** Enter 는 녹화 클라이언트가 `{t:"ime"}` 가 아니라
   **`{t:"key"}` 메시지**로 보내고, 그 경로는 `Input.dispatchKeyEvent` 를 그대로 탄다.
   즉 "keydown 의존 위젯이면 무조건 깨진다" 가 아니라 **문자 입력 경로만** 깨진다.

### 예상 밖의 발견 — Playwright 고수준 API 도 같은 한계를 갖는다

`page.keyboard.type("한글123")` 의 `numericKeydown=3` 은 **ASCII `1`,`2`,`3` 세 글자 몫**이다.
한글 두 글자에 대한 keydown 은 **0** 이고 자동완성 목록도 **0** 이다.
Playwright 도 비 ASCII 문자는 내부적으로 `insertText` 로 넣기 때문이다.
→ **"Playwright 고수준 API 로 바꾸면 해결된다" 는 선택지는 없다.**

---

## 3) ★ B안 승급 필요 여부 — **필요 없다. 승급해도 이 문제는 안 풀린다**

이번 측정의 가장 중요한 결론이다.

`Input.imeSetComposition` + `imeCommitComposition`(B안)을 PoC 안에서 직접 호출해 재 보니:

```
composition:  start=1  update=5  end=1     ← 조합 이벤트는 정확히 생긴다
autocomplete: keydown=0  suggestions=0     ← 그런데 keydown 은 여전히 0
numeric:      keydown=0  blocked=0         ← 마스킹 핸들러도 여전히 안 돈다
```

**B안은 `composition*` 이벤트를 만들 뿐 `keydown` 을 만들지 않는다.**
02-context 가 B안을 한계 1의 해법으로 적어 둔 것은 **틀린 전제**였다.
따라서 `input-bridge.ts` 의 `setComposition`/`commitComposition` 을 구현해도
자동완성·마스킹 위젯은 그대로 깨진 채 남는다.

### 그러면 무엇이 해법인가 — keydown(229) 선행 주입 ("A안+")

실제 한글 IME 는 조합 중 **매 키마다 `keydown` 을 보내되 `keyCode = 229`, `key = "Process"`** 로 보낸다.
웹 페이지들은 이미 그 동작을 전제로 짜여 있다. 그래서 `insertText` 앞뒤에 그 keydown/keyup 을
붙였더니 **위젯이 살아났다**:

| | 수정 전 | 수정 후 |
|---|---|---|
| 자동완성 keydown | 0 | **1** |
| 자동완성 목록 | 0건 | **2건** |
| 마스킹 keydown | 0 | **1** |
| 마스킹 `preventDefault` 호출 | 0 | **1** |
| 왕복 정확도 | 12/12 | **12/12** (손상 없음) |

→ **적용했다.** `apps/runner/src/record/input-bridge.ts` 의 `insertText()` 안, **8줄**.
   파일 1개 · 함수 1개만 바뀌었고 화면 전달 계층 분리 규약을 깨지 않는다.

### 남은 한계 (사실대로)

**`preventDefault()` 로 `insertText` 를 취소할 수는 없다.** 마스킹 input 의 핸들러는 돌지만
(`blocked=1`) 최종 값은 여전히 `한글123` 이다. 실제 한글 IME 조합 입력에서도 keyCode 229 keydown 에
대한 `preventDefault` 가 조합을 막지 못하는 것이 일반적이지만, **우리는 실제 IME 로 대조 측정을 하지
않았으므로 "실제 IME 와 동일하다" 고 단정하지 않는다.** 완전 해소가 필요하면 B안 조합 중계 +
keydown(229) 를 **함께** 구현해야 하며, 이는 별도 작업 권고로 남긴다.

---

## 4) 판정

| 항목 | 판정 |
|---|---|
| 한글 왕복 정확도 100% | ✅ **PASS** (12/12, 4개 방식 전부) |
| keydown 의존 위젯 동작 | ✅ **PASS** — 수정 후 3종 중 **자동완성·단축키 정상 / 마스킹은 핸들러만 동작** |
| **B안(`imeSetComposition`) 승급** | ❌ **불필요.** 승급해도 keydown 은 0 — 문제를 못 푼다 |
| **실제 필요했던 것** | keydown(229) 선행 주입 — **이번에 구현·검증 완료** |

`input-bridge.ts` 의 `setComposition`/`commitComposition` 은 **여전히 호출 시 에러를 던지는
미구현 상태로 남겨 둔다.** 구현할 이유가 측정으로 사라졌기 때문이다.
