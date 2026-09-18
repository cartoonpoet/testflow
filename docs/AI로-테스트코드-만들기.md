# AI로 TestFlow 테스트 코드 만들기

AI(ChatGPT, Claude 등)에게 Playwright 테스트 코드를 만들게 해서 TestFlow에 넣는 방법입니다.

TestFlow는 **표준 Playwright 코드**를 실행합니다. 특별한 문법은 없습니다. 다만 **지켜야 하는 제약 6가지**가 있고, 그걸 AI에게 미리 알려주지 않으면 거의 항상 거부되는 코드가 나옵니다.

---

## 1. AI에게 그대로 붙여넣을 프롬프트

아래 블록을 복사해서 AI 대화 맨 앞에 붙이고, 그 뒤에 만들고 싶은 테스트를 설명하세요.

````
Playwright 테스트 코드를 만들어 줘. 아래 제약을 반드시 지켜.

1. import는 `@playwright/test` 하나만. Node 내장 모듈(fs, path 등), 다른 npm 패키지,
   상대 경로 import(`./helper`)는 쓰지 마. 전부 거부된다.
2. 파일 1개로 완결. helper 파일이나 fixture 파일을 나누지 마. `test()` 는 1개만.
3. URL은 상대 경로로. `page.goto('/#/signin')` 처럼. 절대 URL(https://...)을 쓰지 마.
   기준 주소는 실행할 때 주입된다.
4. 계정·비밀번호·조회 대상 이름 같은 값을 코드에 박지 마. 환경변수로 읽어.
   const username = process.env["TESTFLOW_VAR_username"] ?? "";
   const password = process.env["TESTFLOW_VAR_password"] ?? "";
   const projectName = process.env["TESTFLOW_VAR_projectName"] ?? "";
   변수가 비었으면 왜 실패했는지 알 수 있게 맨 앞에서 명확히 멈춰.
5. 요소를 찾을 때 getByRole → getByLabel → getByText → getByTestId 순으로 우선 써.
   CSS 선택자(page.locator('#id'))는 다른 방법이 없을 때만.
6. 파일 업로드는 파일명만 써. `setInputFiles('테스트용 파일-1.docx')`
   경로를 붙이지 마(`path.resolve` 같은 것 금지). 파일은 TestFlow에 따로 올린다.

TypeScript로 작성하고, 파일명은 `<이름>.spec.ts` 형식으로 알려줘.
````

---

## 2. 제약 6가지 — 왜 그런지

| # | 제약 | 안 지키면 |
|---|---|---|
| 1 | import은 **`@playwright/test`만** | 저장할 때 **거부**(에디터에 빨간 밑줄) |
| 2 | **파일 1개 · `test()` 1개** | 여러 파일은 올릴 곳이 없음 |
| 3 | **상대 경로 URL** | 실행할 때 지정한 주소가 무시되고 항상 같은 서버로 감 |
| 4 | **값을 코드에 박지 않기** | 대상 데이터가 바뀌면 깨짐. 비밀번호는 로그에 남음 |
| 5 | **접근성 기반 Locator** | 화면이 조금 바뀌면 깨짐 |
| 6 | **첨부는 파일명만** | 파일을 못 찾아 실패 |

### 1. import은 `@playwright/test`만

허용되는 건 이 하나뿐입니다. `fs`·`path` 같은 Node 내장 모듈, `lodash` 같은 패키지, `./helper` 같은 상대 경로는 전부 막힙니다.

```ts
import { test, expect } from '@playwright/test';   // ✅

import path from 'node:path';                       // ❌ Node 내장 모듈
import { login } from './helpers/auth';             // ❌ 상대 경로
import dayjs from 'dayjs';                          // ❌ 다른 패키지
```

> **AI가 특히 자주 틀리는 부분입니다.** "파일 업로드 테스트 만들어 줘"라고 하면 대부분 `path.resolve()`를 씁니다. 그게 더 올바른 코드이기 때문인데, TestFlow에서는 거부됩니다.

### 2. 파일 1개, `test()` 1개

**TestFlow의 시나리오 1개 = 파일 1개**입니다. `test.describe`·`beforeEach`를 쓸 수는 있지만, 시나리오를 여러 개 담으면 실행 결과가 하나로 섞여 보기 어렵습니다. 테스트를 나누고 싶으면 **시나리오를 따로 만드세요.**

파일명은 `[A-Za-z0-9._-]` 와 **`.spec.ts` 확장자**만 허용됩니다. 한글 파일명, `.spec.js`는 안 됩니다. (내용이 자바스크립트여도 확장자는 `.spec.ts`로 하면 그대로 동작합니다.)

코드 본문은 **256KB**까지입니다. 일반적인 테스트는 수 KB라 문제되지 않습니다.

### 3. URL은 상대 경로로

```ts
await page.goto('/#/signin');                          // ✅
await page.goto('https://myservice.com/#/signin');     // ❌
```

기준 주소는 **실행할 때 「대상 주소(baseUrl)」칸에 입력한 값**이 들어갑니다. 상대 경로로 써야 **같은 테스트를 스테이징과 운영에 골라 돌릴 수 있습니다.** 절대 URL을 쓰면 그 주소로 고정됩니다.

### 4. 값을 코드에 박지 마세요

계정, 비밀번호, 조회할 프로젝트 이름, 검색어처럼 **바뀔 수 있는 값**은 환경변수로 받으세요.

```ts
import { test, expect } from '@playwright/test';

// 실행 변수: TESTFLOW_VAR_username, TESTFLOW_VAR_password, TESTFLOW_VAR_projectName

test('법무 프로젝트 조회', async ({ page }) => {
  // 변수가 비면 빈 문자열로 로그인해 '원인 불명 실패'가 된다. 여기서 먼저 멈춘다.
  for (const key of ['TESTFLOW_VAR_username', 'TESTFLOW_VAR_password']) {
    if (!(process.env[key] ?? '')) {
      throw new Error(`실행 변수 ${key} 가 필요합니다. 실행 다이얼로그에서 입력해 주세요.`);
    }
  }
  const projectName = process.env['TESTFLOW_VAR_projectName'] ?? 'project-save-';

  await page.goto('/#/signin');
  await page.getByRole('textbox', { name: '이메일' }).fill(process.env['TESTFLOW_VAR_username'] ?? '');
  await page.getByRole('textbox', { name: '비밀번호' }).fill(process.env['TESTFLOW_VAR_password'] ?? '');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.getByRole('link', { name: projectName }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
});
```

**변수 이름 규칙**: 실행 다이얼로그의 「계정」칸은 **`TESTFLOW_VAR_username`**, 「비밀번호」칸은 **`TESTFLOW_VAR_password`** 로 들어갑니다. 이 두 개는 이름을 맞춰야 UI에서 실행할 수 있습니다. 나머지는 자유롭게 정하세요(`TESTFLOW_VAR_projectName` 등).

> ⚠️ **비밀번호를 코드에 직접 적지 마세요.** 코드 본문은 DB에 그대로 저장되고 에디터에도 보입니다. 테스트가 실패하면 Playwright가 실패한 줄의 소스를 로그에 출력하기 때문에 **로그에도 남습니다.** 환경변수로 넘긴 값은 스텝 이력에 `Fill "***"` 로 가려집니다.

### 5. 요소를 찾는 방법

우선순위대로 쓰세요. 위쪽이 화면 변경에 강합니다.

```ts
page.getByRole('button', { name: '로그인' })     // 1순위 — 역할 + 이름
page.getByLabel('아이디')                        // 2순위 — 라벨
page.getByText('저장되었습니다')                  // 3순위 — 표시 텍스트
page.getByTestId('confirm-btn')                  // 4순위 — data-testid
page.locator('#username')                        // 마지막 수단
```

같은 이름의 요소가 여러 개면 `.nth(0)` 으로 좁히거나, 더 구체적인 조건을 주세요.

```ts
page.getByRole('button', { name: '삭제' }).nth(1)
```

### 6. 파일 업로드

파일을 코드에 담을 수 없으니, **TestFlow에 따로 올려두고 코드에서는 파일명만** 씁니다.

```ts
await page.locator('input[type="file"]').setInputFiles('테스트용 파일-1.docx');            // ✅
await page.locator('input[type="file"]').setInputFiles(['파일-1.docx', '파일-2.docx']);     // ✅ 여러 개

await page.locator('input[type="file"]').setInputFiles(path.resolve('test-data', f));      // ❌
await page.locator('input[type="file"]').setInputFiles('/home/qa/파일-1.docx');             // ❌
```

올리는 방법: 코드 시나리오 화면의 **「테스트 데이터 (첨부파일)」** 영역에서 업로드. 한글 파일명을 그대로 쓸 수 있습니다.

상한: **개당 10MB · 시나리오당 20개 · 합계 50MB**. 파일명에 `/` `\` 따옴표를 쓸 수 없고, `.` 으로 시작할 수 없습니다.

---

## 3. 만든 코드를 넣고 실행하기

1. **시나리오 만들기** — 시나리오 목록에서 새로 만들 때 **「코드」** 유형을 선택
2. **코드 붙여넣기** — 에디터에 붙여넣거나 `.spec.ts` 파일 업로드
   - 문제가 있으면 **해당 줄에 빨간 밑줄**이 뜨고 저장이 잠깁니다. 밑줄에 마우스를 올리면 이유가 나옵니다
   - 노란 밑줄(경고)은 저장을 막지 않습니다
3. **첨부파일 업로드** — `setInputFiles` 를 쓰는 경우, **「테스트 데이터 (첨부파일)」** 영역에서
4. **발행**
5. **실행** — 실행 버튼 → 다이얼로그에 입력
   | 칸 | 넣을 값 |
   |---|---|
   | 대상 주소 (baseUrl) | `https://내서비스주소` |
   | 환경 라벨 | `운영` / `스테이징` 등 (기록용) |
   | 계정 / 비밀번호 | 테스트 계정 |
6. **진행 확인** — 실행 현황 화면에서 스텝이 하나씩 진행되고, **브라우저 화면이 실시간으로** 보입니다
7. **실패하면** — 스크린샷·실행 영상·Playwright Trace·콘솔 로그가 자동으로 남습니다

---

## 4. 자주 겪는 문제

**저장이 안 되고 빨간 밑줄이 뜹니다**
→ import 제약(1번) 위반이 대부분입니다. 밑줄 툴팁에 어떤 모듈이 문제인지 나옵니다. AI에게 *"import는 @playwright/test만 쓰고 Node 내장 모듈과 상대 경로 import를 없애 줘"* 라고 다시 요청하세요.

**로그인은 되는데 그 다음에 멈춥니다**
→ 코드가 **특정 데이터가 있다고 전제**하고 있습니다. 예를 들어 `getByRole('link', { name: 'project-2024-05' })` 는 그 프로젝트가 목록에 보여야 통과합니다. 데이터가 지워졌거나 상태가 바뀌면 깨집니다.
→ 그 이름을 `TESTFLOW_VAR_*` 로 빼서 실행할 때 지정하세요. 또는 테스트가 **자기가 쓸 데이터를 스스로 만들게** 고치는 것이 가장 튼튼합니다.

**파일 업로드 스텝에서 실패합니다**
→ ① 첨부파일을 올렸는지 ② 코드의 파일명과 올린 파일명이 **정확히 같은지**(공백·괄호 포함) 확인하세요.

**「계정」칸에 입력했는데 로그인이 안 됩니다**
→ 코드가 읽는 변수 이름이 **`TESTFLOW_VAR_username`** 인지 확인하세요. `TESTFLOW_VAR_email` 처럼 다른 이름으로 읽고 있으면 값이 전달되지 않습니다.

**계정이 2개 이상 필요한 테스트**
→ 실행 다이얼로그는 계정 1쌍만 받습니다. 권한별 검증처럼 여러 계정이 필요하면 지금은 API로 실행해야 합니다.

---

## 5. 지금 지원하지 않는 것

| | 대안 |
|---|---|
| 여러 파일 / helper 분리 | 한 파일로 합치기 |
| `playwright.config.ts` 의 `projects` 여러 개 | 브라우저별로 시나리오 분리 |
| `webServer` 설정 | 대상 서버를 미리 띄워두고 주소만 지정 |
| Chromium 외 브라우저 | — |
| 예약·반복 실행 | 수동 실행 |
| 계정 2쌍 이상을 UI에서 입력 | API 실행 |

---

## 6. 좋은 테스트를 만드는 요령

- **하나의 시나리오는 하나를 검증하세요.** "로그인하고 프로젝트 만들고 수정하고 삭제" 를 한 파일에 넣으면, 중간에 실패했을 때 무엇이 문제인지 알기 어렵습니다.
- **확인(assert)을 넣으세요.** 클릭만 하고 끝나면 "눌렀다"만 알 수 있습니다. `expect(...).toBeVisible()` 로 결과를 확인하세요.
- **`waitForTimeout` 대신 조건을 기다리세요.** `await expect(...).toBeVisible()` 은 나타날 때까지 기다립니다. 고정 시간 대기는 느리면서 불안정합니다.
- **테스트가 스스로 데이터를 만들면 가장 튼튼합니다.** 기존 데이터를 찾는 테스트는 그 데이터가 사라지면 깨집니다.
- **녹화 기능도 있습니다.** 코드를 쓰기 어려우면 화면을 조작해서 녹화한 뒤, 「코드로 내보내기」로 Playwright 코드를 받아 AI에게 다듬게 할 수 있습니다.
