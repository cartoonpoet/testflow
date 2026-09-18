/**
 * 가이드 화면의 **본문 데이터. 이 파일이 이 문서의 단일 출처다.**
 *
 * ## 왜 데이터로 빼는가
 *
 * 처음에는 `docs/` 의 md 가 원본이고 이 파일이 그 사본이었다
 * (`content.spec.ts` 가 md 를 `?raw` 로 읽어 글자 단위로 대조했다).
 * **그 md 를 지우고 이 화면을 단일 출처로 삼기로 결정**했으므로 사본이 아니라 원본이다.
 * 내용을 고칠 곳은 여기 한 곳이다.
 *
 * `react-markdown` 을 넣지 않은 이유는 그대로다 — 초기 로드 번들이 커져
 * 라운드 3 의 전제가 깨진다(08-code-editor 참고). 그래서 **문장은 마크다운 문법 그대로**
 * 문자열에 담고 블록 구조만 TSX 가 그린다.
 *   - 인라인 서식(`**굵게**` `*기울임*` `` `코드` ``)은 `InlineMd` 가 런타임에 해석한다.
 *     규칙 3개짜리라 파서라 부를 것도 없고 번들 영향이 사실상 0 이다.
 *   - `InlineMd` 가 모르는 문법(링크·이미지)을 쓰면 **화면에 원문이 그대로 노출된다.**
 *     `content.spec.ts` 가 그것을 막는다.
 *
 * 마크다운 문법을 그대로 두는 것이 핵심이다. `**` 를 떼고 `<strong>` 으로 바꿔 쓰면
 * 문장과 서식이 뒤섞여 이 파일을 글로 읽을 수 없게 된다.
 */

/** H1. */
export const GUIDE_TITLE = "AI로 TestFlow 테스트 코드 만들기";

export type GuideTable = {
  /** 빈 문자열이면 시각적으로 비어 있는 머리칸. */
  readonly head: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

export type OrderedItem = {
  readonly text: string;
  readonly sub?: readonly string[];
  readonly table?: GuideTable;
};

export type QaItem = {
  readonly q: string;
  readonly a: readonly string[];
};

export type GuideBlock =
  | { readonly kind: "p"; readonly text: string }
  /** 인용문(`>`) 성격의 강조. amber notice 로 그린다. */
  | { readonly kind: "note"; readonly text: string }
  | {
      readonly kind: "code";
      readonly code: string;
      /** `ts` 만 구문 강조한다. 프롬프트는 코드가 아니라 평문이다. */
      readonly lang: "ts" | "text";
      /** 코드 블록 머리에 붙는 설명. UI 크롬이다. */
      readonly caption?: string;
      /** 복사 버튼을 붙일지. 붙이는 기준은 `GuidePage` 주석 참고. */
      readonly copy?: boolean;
    }
  | { readonly kind: "table"; readonly table: GuideTable }
  | { readonly kind: "ul"; readonly items: readonly string[] }
  | { readonly kind: "ol"; readonly items: readonly OrderedItem[] }
  | { readonly kind: "qa"; readonly items: readonly QaItem[] }
  | { readonly kind: "h3"; readonly id: string; readonly text: string };

export type GuideSection = {
  /** 앵커 id. 목차가 `#<id>` 로 이동한다. */
  readonly id: string;
  /** `##` 수준의 절 제목. */
  readonly title: string;
  readonly blocks: readonly GuideBlock[];
};

/**
 * ★ AI 에게 붙여넣을 프롬프트 — 이 문서의 **핵심 산출물**이다.
 *
 * 템플릿 리터럴 안의 백틱은 `\`` 로 이스케이프돼 있다(런타임 값에는 영향이 없다).
 * 사람이 이스케이프를 틀리기 쉬운 자리다. 복사 버튼이 이 문자열을 그대로 클립보드에 넣으므로
 * 여기가 틀어지면 사용자가 잘못된 프롬프트를 AI 에 붙여넣는다.
 */
export const AI_PROMPT = `Playwright 테스트 코드를 만들어 줘. 아래 제약을 반드시 지켜.

1. import는 \`@playwright/test\` 하나만. Node 내장 모듈(fs, path 등), 다른 npm 패키지,
   상대 경로 import(\`./helper\`)는 쓰지 마. 전부 거부된다.
2. 파일 1개로 완결. helper 파일이나 fixture 파일을 나누지 마. \`test()\` 는 1개만.
3. URL은 상대 경로로. \`page.goto('/#/signin')\` 처럼. 절대 URL(https://...)을 쓰지 마.
   기준 주소는 실행할 때 주입된다.
4. 계정·비밀번호·조회 대상 이름 같은 값을 코드에 박지 마. 환경변수로 읽어.
   const username = process.env["TESTFLOW_VAR_username"] ?? "";
   const password = process.env["TESTFLOW_VAR_password"] ?? "";
   const projectName = process.env["TESTFLOW_VAR_projectName"] ?? "";
   변수가 비었으면 왜 실패했는지 알 수 있게 맨 앞에서 명확히 멈춰.
5. 요소를 찾을 때 getByRole → getByLabel → getByText → getByTestId 순으로 우선 써.
   CSS 선택자(page.locator('#id'))는 다른 방법이 없을 때만.
6. 파일 업로드는 파일명만 써. \`setInputFiles('테스트용 파일-1.docx')\`
   경로를 붙이지 마(\`path.resolve\` 같은 것 금지). 파일은 TestFlow에 따로 올린다.

아래 3개는 저장은 통과하지만 실제 웹앱에서 자주 깨지는 것들이야. 같이 지켜.

7. 리치 텍스트 에디터(CKEditor 등)에는 fill()을 쓰지 마. 에디터 본문을 클릭하고
   ControlOrMeta+A → Delete → keyboard.type() 으로 실제 키를 입력해.
   fill()은 화면에 글자가 보여도 앱 상태가 비어 있어 저장이 거부된다.
8. .nth(N)·.first()·.last() 같은 순서 의존과 iframe[title="..."] 을 쓰지 마.
   제목은 언어가, 번호는 실행마다 값이 바뀐다. 어느 섹션·카드·다이얼로그 안인지로 좁혀.
   예: page.locator('.card-header').filter({ hasText: '진행사항' })
         .getByRole('button', { name: '코멘트 추가' })
9. 클릭만 하고 넘어가지 마. 저장·전송·이동 뒤에 expect로 결과를 확인해.
   waitForTimeout 대신 expect(...).toBeVisible() 로 조건을 기다려.

TypeScript로 작성하고, 파일명은 \`<이름>.spec.ts\` 형식으로 알려줘.`;

/* ── ```ts 코드 블록 ───────────────────────────────────────── */

const CODE_IMPORTS = `import { test, expect } from '@playwright/test';   // ✅

import path from 'node:path';                       // ❌ Node 내장 모듈
import { login } from './helpers/auth';             // ❌ 상대 경로
import dayjs from 'dayjs';                          // ❌ 다른 패키지`;

const CODE_URL = `await page.goto('/#/signin');                          // ✅
await page.goto('https://myservice.com/#/signin');     // ❌`;

const CODE_ENV = `import { test, expect } from '@playwright/test';

// 실행 변수: TESTFLOW_VAR_username, TESTFLOW_VAR_password, TESTFLOW_VAR_projectName

test('법무 프로젝트 조회', async ({ page }) => {
  // 변수가 비면 빈 문자열로 로그인해 '원인 불명 실패'가 된다. 여기서 먼저 멈춘다.
  for (const key of ['TESTFLOW_VAR_username', 'TESTFLOW_VAR_password']) {
    if (!(process.env[key] ?? '')) {
      throw new Error(\`실행 변수 \${key} 가 필요합니다. 실행 다이얼로그에서 입력해 주세요.\`);
    }
  }
  const projectName = process.env['TESTFLOW_VAR_projectName'] ?? 'project-save-';

  await page.goto('/#/signin');
  await page.getByRole('textbox', { name: '이메일' }).fill(process.env['TESTFLOW_VAR_username'] ?? '');
  await page.getByRole('textbox', { name: '비밀번호' }).fill(process.env['TESTFLOW_VAR_password'] ?? '');
  await page.getByRole('button', { name: '로그인' }).click();

  await page.getByRole('link', { name: projectName }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
});`;

const CODE_LOCATORS = `page.getByRole('button', { name: '로그인' })     // 1순위 — 역할 + 이름
page.getByLabel('아이디')                        // 2순위 — 라벨
page.getByText('저장되었습니다')                  // 3순위 — 표시 텍스트
page.getByTestId('confirm-btn')                  // 4순위 — data-testid
page.locator('#username')                        // 마지막 수단`;

const CODE_NTH = `page.getByRole('button', { name: '코멘트 추가' }).nth(1)   // ❌ 순서에 의존

page.locator('.card-header')                                 // ✅ 맥락으로 좁힌다
  .filter({ hasText: '법무 프로젝트 진행사항' })
  .getByRole('button', { name: '코멘트 추가' })`;

/* ── 4절(실전 함정)이 쓰는 블록 ────────────────────────────── */

const CODE_EDITOR_TYPE = `// ❌ 화면에는 글자가 보이는데 앱 상태는 비어 있다 → 저장이 거부된다
await frame.getByRole('textbox').fill('담당자 할당');

// ✅ 실제 키 입력
await frame.locator('body.cke_editable').click();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.press('Delete');
await page.keyboard.type('담당자 할당');`;

const CODE_IFRAME = `// ❌ 제목은 언어가, 번호는 실행마다 값이 바뀐다
page.locator('iframe[title="리치 텍스트 편집기, editor2"]')
page.getByRole('textbox', { name: '리치 텍스트 편집기, editor2' })

// ✅ 클래스로 찾고, '지금 입력할 수 있는 것'만 고른다
const frames = page.locator('iframe.cke_wysiwyg_frame');
// 프레임 안의 본문: body.cke_editable — 읽기 전용은 contenteditable="false" 다`;

const CODE_UPLOAD = `await page.locator('input[type="file"]').setInputFiles('테스트용 파일-1.docx');            // ✅
await page.locator('input[type="file"]').setInputFiles(['파일-1.docx', '파일-2.docx']);     // ✅ 여러 개

await page.locator('input[type="file"]').setInputFiles(path.resolve('test-data', f));      // ❌
await page.locator('input[type="file"]').setInputFiles('/home/qa/파일-1.docx');             // ❌`;

/** 화면이 그리는 모든 ```ts 블록. */
export const TS_CODE_BLOCKS: readonly string[] = [
  CODE_IMPORTS,
  CODE_URL,
  CODE_ENV,
  CODE_LOCATORS,
  CODE_NTH,
  CODE_UPLOAD,
  CODE_EDITOR_TYPE,
  CODE_IFRAME,
];

/** 도입부(제목과 첫 절 사이). */
export const GUIDE_INTRO: readonly GuideBlock[] = [
  {
    kind: "p",
    text: "AI(ChatGPT, Claude 등)에게 Playwright 테스트 코드를 만들게 해서 TestFlow에 넣는 방법입니다.",
  },
  {
    kind: "p",
    text: "TestFlow는 **표준 Playwright 코드**를 실행합니다. 특별한 문법은 없습니다. 다만 **지켜야 하는 제약 6가지**가 있고, 그걸 AI에게 미리 알려주지 않으면 거의 항상 거부되는 코드가 나옵니다.",
  },
  {
    kind: "p",
    text: "그리고 제약을 다 지켜도 **실제 서비스에서는 안 도는** 코드가 따로 있습니다. 운영 서비스에 테스트 10건을 돌리면서 찾은 것들을 **4절 「제약은 지켰는데 안 도는 이유」** 에 모았습니다. 녹화로 받은 코드를 쓰고 있다면 그 절을 먼저 보세요.",
  },
];

export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    id: "prompt",
    title: "1. AI에게 그대로 붙여넣을 프롬프트",
    blocks: [
      {
        kind: "p",
        text: "아래 블록을 복사해서 AI 대화 맨 앞에 붙이고, 그 뒤에 만들고 싶은 테스트를 설명하세요.",
      },
      {
        kind: "code",
        lang: "text",
        code: AI_PROMPT,
        caption: "AI 대화 맨 앞에 붙여넣을 프롬프트",
        copy: true,
      },
    ],
  },
  {
    id: "constraints",
    title: "2. 제약 6가지 — 왜 그런지",
    blocks: [
      {
        kind: "table",
        table: {
          head: ["#", "제약", "안 지키면"],
          rows: [
            ["1", "import은 `@playwright/test` **하나만**", "저장할 때 **거부**(에디터에 빨간 밑줄)"],
            ["2", "**파일 1개** · `test()` **1개**", "여러 파일은 올릴 곳이 없음"],
            ["3", "**상대 경로 URL**", "실행할 때 지정한 주소가 무시되고 항상 같은 서버로 감"],
            ["4", "**값을 코드에 박지 않기**", "대상 데이터가 바뀌면 깨짐. 비밀번호는 로그에 남음"],
            ["5", "**접근성 기반 Locator**", "화면이 조금 바뀌면 깨짐"],
            ["6", "**첨부는 파일명만**", "파일을 못 찾아 실패"],
          ],
        },
      },

      { kind: "h3", id: "import-only", text: "1. import은 `@playwright/test`만" },
      {
        kind: "p",
        text: "허용되는 건 이 하나뿐입니다. `fs`·`path` 같은 Node 내장 모듈, `lodash` 같은 패키지, `./helper` 같은 상대 경로는 전부 막힙니다.",
      },
      { kind: "code", lang: "ts", code: CODE_IMPORTS },
      {
        kind: "note",
        text: '**AI가 특히 자주 틀리는 부분입니다.** "파일 업로드 테스트 만들어 줘"라고 하면 대부분 `path.resolve()`를 씁니다. 그게 더 올바른 코드이기 때문인데, TestFlow에서는 거부됩니다.',
      },

      { kind: "h3", id: "single-file", text: "2. 파일 1개, `test()` 1개" },
      {
        kind: "p",
        text: "**TestFlow의 시나리오 1개 = 파일 1개**입니다. `test.describe`·`beforeEach`를 쓸 수는 있지만, 시나리오를 여러 개 담으면 실행 결과가 하나로 섞여 보기 어렵습니다. 테스트를 나누고 싶으면 **시나리오를 따로 만드세요.**",
      },
      {
        kind: "p",
        text: "`test()` 를 여러 개 두면 `test()` **마다 영상이 따로 만들어집니다.** 화면에는 그중 하나만 재생되므로, 두 번째 이후 `test()` 의 스텝을 눌러도 영상이 엉뚱한 곳으로 갑니다. (`test()` 가 하나도 없으면 저장은 되지만 노란 경고가 뜹니다 — 실행해도 스텝이 하나도 생기지 않습니다.)",
      },
      {
        kind: "p",
        text: "파일명은 `[A-Za-z0-9._-]` 와 `.spec.ts` **확장자**만 허용됩니다. 한글 파일명, `.spec.js`는 안 됩니다. (내용이 자바스크립트여도 확장자는 `.spec.ts`로 하면 그대로 동작합니다.)",
      },
      {
        kind: "p",
        text: "코드 본문은 **256KB**까지입니다. 일반적인 테스트는 수 KB라 문제되지 않습니다.",
      },

      { kind: "h3", id: "relative-url", text: "3. URL은 상대 경로로" },
      { kind: "code", lang: "ts", code: CODE_URL },
      {
        kind: "p",
        text: "기준 주소는 **실행할 때 「대상 주소(baseUrl)」칸에 입력한 값**이 들어갑니다. 상대 경로로 써야 **같은 테스트를 스테이징과 운영에 골라 돌릴 수 있습니다.** 절대 URL을 쓰면 그 주소로 고정됩니다.",
      },

      { kind: "h3", id: "env-vars", text: "4. 값을 코드에 박지 마세요" },
      {
        kind: "p",
        text: "계정, 비밀번호, 조회할 프로젝트 이름, 검색어처럼 **바뀔 수 있는 값**은 환경변수로 받으세요.",
      },
      {
        kind: "code",
        lang: "ts",
        code: CODE_ENV,
        caption: "환경변수로 받는 전체 예시",
        copy: true,
      },
      {
        kind: "p",
        text: "**변수 이름 규칙**: 실행 다이얼로그의 「계정」칸은 `TESTFLOW_VAR_username`, 「비밀번호」칸은 `TESTFLOW_VAR_password` 로 들어갑니다. 이 두 개는 이름을 맞춰야 UI에서 실행할 수 있습니다. 나머지는 자유롭게 정하세요(`TESTFLOW_VAR_projectName` 등).",
      },
      {
        kind: "note",
        text: '⚠️ **비밀번호를 코드에 직접 적지 마세요.** 코드 본문은 DB에 그대로 저장되고 에디터에도 보입니다. 테스트가 실패하면 Playwright가 실패한 줄의 소스를 로그에 출력하기 때문에 **로그에도 남습니다.** 환경변수로 넘긴 값은 스텝 이력에 `Fill "***"` 로 가려집니다.',
      },

      { kind: "h3", id: "locators", text: "5. 요소를 찾는 방법" },
      { kind: "p", text: "우선순위대로 쓰세요. 위쪽이 화면 변경에 강합니다." },
      { kind: "code", lang: "ts", code: CODE_LOCATORS },
      {
        kind: "note",
        text: "⚠️ **같은 이름의 요소가 여러 개여도 순서로 좁히지 마세요.** `.nth(N)` 이 전제하는 개수와 순서는 스크롤·모달·화면에 따라 변합니다. 실측에서 `코멘트 추가` 버튼이 스크롤 상태에 따라 2개 ↔ 3개로 변했고, `.nth(1)` 때문에 300초 하드 타임아웃이 실제로 났습니다. 어느 섹션·카드·다이얼로그 안인지로 좁히세요.",
      },
      { kind: "code", lang: "ts", code: CODE_NTH },
      {
        kind: "p",
        text: "왜 그런지와 다른 함정들은 **4절**에 있습니다.",
      },

      { kind: "h3", id: "file-upload", text: "6. 파일 업로드" },
      {
        kind: "p",
        text: "파일을 코드에 담을 수 없으니, **TestFlow에 따로 올려두고 코드에서는 파일명만** 씁니다.",
      },
      { kind: "code", lang: "ts", code: CODE_UPLOAD },
      {
        kind: "p",
        text: "올리는 방법: 코드 시나리오 화면의 **「테스트 데이터 (첨부파일)」** 영역에서 업로드. 한글 파일명을 그대로 쓸 수 있습니다.",
      },
      {
        kind: "p",
        text: "상한: **개당 10MB · 시나리오당 20개 · 합계 50MB**. 파일명에 `/` `\\` 따옴표를 쓸 수 없고, `.` 으로 시작할 수 없습니다.",
      },
    ],
  },
  {
    id: "run",
    title: "3. 만든 코드를 넣고 실행하기",
    blocks: [
      {
        kind: "ol",
        items: [
          {
            text: "**시나리오 만들기** — 시나리오 목록에서 새로 만들 때 **「코드」** 유형을 선택",
          },
          {
            text: "**코드 붙여넣기** — 에디터에 붙여넣거나 `.spec.ts` 파일 업로드",
            sub: [
              "문제가 있으면 **해당 줄에 빨간 밑줄**이 뜨고 저장이 잠깁니다. 밑줄에 마우스를 올리면 이유가 나옵니다",
              "노란 밑줄(경고)은 저장을 막지 않습니다",
            ],
          },
          {
            text: "**첨부파일 업로드** — `setInputFiles` 를 쓰는 경우, **「테스트 데이터 (첨부파일)」** 영역에서",
          },
          { text: "**발행**" },
          {
            text: "**실행** — **「▶ 실행」** → 「실행 요청」 다이얼로그에 입력",
            table: {
              head: ["칸", "넣을 값"],
              rows: [
                ["대상 주소 (baseUrl)", "`https://내서비스주소`"],
                ["환경 라벨", "`운영` / `스테이징` 등 (기록용)"],
                ["브라우저", "지금은 `Chrome` 하나뿐입니다"],
                ["계정 / 비밀번호", "테스트 계정. **이번 실행에만 쓰이고 저장되지 않습니다**"],
              ],
            },
          },
          {
            text: "**진행 확인** — 실행 현황 화면에서 **브라우저 화면이 실시간으로** 보이고, 옆의 **스텝 레일**이 현재 스텝을 따라 내려갑니다",
            sub: [
              "레일은 `✕` 로 닫고 **「스텝 보기」** 로 다시 엽니다. 화면이 좁으면(1050px 이하) 감춰지고 아래 전체 목록으로 이어집니다",
            ],
          },
        ],
      },

      { kind: "h3", id: "run-artifacts", text: "실행이 끝나면 무엇이 남나" },
      {
        kind: "p",
        text: "**성공한 실행에도 영상이 남습니다.** 예전에는 실패했을 때만 남겼지만, 그러면 \"통과했는데 무슨 화면이었는지\" 를 볼 방법이 아예 없었습니다. 영상은 실측 **약 6.7KB/초** 라 전량 보관이 실패 1건의 Trace(328KB)보다 쌉니다.",
      },
      {
        kind: "table",
        table: {
          head: ["실행 결과", "남는 증적"],
          rows: [
            ["성공", "**실행 영상**"],
            [
              "실패",
              "실행 영상 + **스크린샷** + **Playwright Trace** (녹화 시나리오는 콘솔·네트워크 로그까지)",
            ],
            ["타임아웃 · 취소", "실패와 같습니다 — **죽은 실행에서도 증적이 남습니다**"],
          ],
        },
      },
      {
        kind: "p",
        text: "타임아웃·취소는 컨테이너를 곧바로 죽이지 않고 **10초의 유예**를 줘서 영상을 끝까지 기록하게 합니다. 그래도 영상이 온전하지 않으면 재생은 되지만 **구간 이동이 안 될 수** 있고, 그때는 스텝 이동 버튼이 나오지 않습니다.",
      },
      {
        kind: "p",
        text: "끝난 실행을 다시 열면 **영상이 기본으로 재생**됩니다. **스텝을 누르면 영상이 그 지점으로 이동**합니다 — 영상 시작 시각과 실행 기록의 기준점이 달라 위치는 대략적인 값입니다(**오차 약 ±1초**).",
      },

      { kind: "h3", id: "run-batch", text: "여러 개 한 번에 · 재실행 · 삭제" },
      {
        kind: "ul",
        items: [
          "**여러 시나리오를 한 번에** — 시나리오 목록에서 체크박스로 고르고 **「▶ 선택 실행」**. 한 묶음(batch)으로 요청되고 **Runner 의 동시 실행 한도(기본 2건)** 만큼 병렬로 돕니다. 나머지는 큐에서 기다리며 `큐 대기 N번째` 로 순번이 보입니다.",
          "**재실행** — 끝난 실행의 상세 화면에서 **「↻ 재실행」**. 대상 주소·환경 라벨·브라우저는 **그 실행에 쓰인 값 그대로** 채워집니다. **계정·비밀번호는 저장하지 않으므로 다시 입력**해야 합니다.",
          "**삭제** — 시나리오는 목록의 **「선택 삭제」** 나 편집 화면의 **「시나리오 삭제」**, 실행 이력은 목록의 **「선택 삭제」** 나 상세의 **「이력 삭제」**. 실행 이력을 지우면 **영상·Trace·스크린샷이 디스크에서 함께 사라집니다.**",
        ],
      },
      {
        kind: "note",
        text: "⚠️ **휴지통이 없습니다.** 삭제하면 그 자리에서 사라지고 복구할 방법이 없습니다. 시나리오를 지워도 실행 이력은 남습니다(증적이라 지우지 않습니다). 진행 중인 실행은 지울 수 없으니 먼저 중단하세요.",
      },
    ],
  },
  {
    id: "pitfalls",
    title: "4. 제약은 지켰는데 안 도는 이유",
    blocks: [
      {
        kind: "p",
        text: "앞의 제약 6가지는 **TestFlow가 코드를 받아주느냐**의 문제입니다. 여기부터는 **받아준 코드가 실제 웹앱에서 통과하느냐**의 문제입니다. 아래는 운영 서비스에 테스트 10건을 돌리면서 실제로 겪은 것들입니다.",
      },
      {
        kind: "note",
        text: "⚠️ **①과 ③은 눈으로 보면 멀쩡합니다.** 글자가 보이고 버튼이 보이는데 실패합니다. 그래서 원인을 찾는 데 가장 오래 걸립니다. 증상이 이상하면 이 두 개를 먼저 의심하세요.",
      },

      { kind: "h3", id: "editor-fill", text: "① `fill()` 이 리치 텍스트 편집기에 먹지 않습니다" },
      {
        kind: "p",
        text: "**증상** — 저장을 누르면 `필수 항목을 입력해주세요` 모달이 뜹니다. 그런데 **에디터에는 글자가 그대로 보입니다.**",
      },
      {
        kind: "p",
        text: "**원인** — 이벤트를 직접 계측해 보면 `fill()` 은 `focus` 하나만 띄웁니다. `keyboard.type()` 은 `key`·`change` 를 번갈아 띄웁니다. `fill()` 은 DOM 을 바꾸고 `CKEDITOR.getData()` 도 값을 돌려주지만, CKEditor 의 `change` 가 안 떠서 **앱(React) 상태는 빈 채로 남습니다.** 저장하면 필수값 누락으로 막힙니다.",
      },
      { kind: "code", lang: "ts", code: CODE_EDITOR_TYPE },
      {
        kind: "p",
        text: "**고치는 법** — 에디터 본문을 클릭하고 전체 선택·삭제한 뒤 `keyboard.type()` 으로 실제 키를 입력하세요. 실측: 이렇게 바꾸자 272초를 매달리던 마지막 `저장` 이 423ms 에 끝나고 시나리오가 **142/142 통과**했습니다.",
      },
      {
        kind: "note",
        text: "⚠️ **녹화 산출물은 이 문제를 그대로 안고 있습니다.** 레코더는 사람이 **타이핑**한 것을 `fill()` 로 적어 둡니다. 「코드로 내보내기」로 받은 코드에서 에디터 입력은 손으로 고쳐야 합니다.",
      },

      { kind: "h3", id: "iframe-title", text: "② iframe을 `title` 로 찾지 마세요" },
      {
        kind: "p",
        text: "**증상** — 녹화할 때는 멀쩡하던 `iframe[title=\"리치 텍스트 편집기, editor2\"]` 가 실행하면 아무것도 못 찾고 타임아웃까지 매달립니다.",
      },
      {
        kind: "p",
        text: "**원인 하나 — 언어.** 실행 시점의 실제 값은 `title=\"Editor, editor2\"` — **영어**였습니다. Runner 브라우저에 로케일이 지정돼 있지 않아 `navigator.language` 가 `en-US` 이고, CKEditor 는 UI 언어를 거기서 정합니다. **앱 자체는 한국어**(`lang=\"ko\"`)라 다른 한국어 선택자는 전부 멀쩡히 동작하고 에디터만 영어가 됩니다. `getByRole('textbox', { name: '리치 텍스트 편집기, editor2' })` 도 같은 곳에서 이름을 가져오므로 똑같이 깨집니다.",
      },
      {
        kind: "p",
        text: "**원인 둘 — 번호.** `editorN` 의 N 은 페이지가 살아 있는 동안 에디터를 만들 때마다 1씩 오르는 **전역 카운터**입니다. 같은 화면에서 `editor1`~`editor6` 이 관측됐습니다. 에디터가 하나뿐인 등록 화면이 `editor2` 인 것도 그래서입니다.",
      },
      { kind: "code", lang: "ts", code: CODE_IFRAME },
      {
        kind: "p",
        text: "**고치는 법** — 변하지 않는 것은 iframe의 `cke_wysiwyg_frame` 클래스와 프레임 안의 `body.cke_editable` 입니다. 편집 가능한 것만 고르려면 `contenteditable=\"true\"` **속성**으로 거르세요 — 배경에 깔린 본문 에디터는 읽기 전용입니다. 여러 개가 남으면 순서가 아니라 맥락으로 좁히세요. **실측에서 DOM 순서가 화면에 따라 뒤집혔습니다**(코멘트 폼은 `[배경, 새 에디터]`, 완료 모달은 `[새 에디터, 배경]`).",
      },

      { kind: "h3", id: "aria-hidden", text: "③ 모달이 뜨면 `getByRole` 이 아무것도 못 찾습니다" },
      {
        kind: "p",
        text: "**증상** — 버튼이 화면에 **보이는데도** 클릭이 타임아웃까지 매달립니다. 에러 메시지는 마지막 조건(`.nth(1)` 등)을 가리켜 \"요소 개수가 모자란다\"처럼 보입니다.",
      },
      {
        kind: "p",
        text: "**원인** — 경고 모달(SweetAlert)이 뜨면 앱 최상위에 `aria-hidden=\"true\"` 가 붙습니다. `getByRole` 은 **접근성 트리**를 보므로, 버튼 3개가 화면에 멀쩡히 떠 있어도 **locator 는 0개**가 됩니다.",
      },
      {
        kind: "note",
        text: "⚠️ **진짜 원인은 그 앞 단계입니다.** 저장이 필수값 검증에 막혀 모달이 떴는데, **그 저장 클릭 자체는 「통과」로 기록**돼 있었습니다. 그래서 한참 뒤의 엉뚱한 줄에서 죽은 것처럼 보입니다.",
      },
      {
        kind: "p",
        text: "**고치는 법** — 저장·전송 뒤에 결과를 `expect` 로 확인해 거부를 그 자리에서 잡으세요. 모달이 떴으면 문구를 읽어 실패 사유로 남기고 닫은 뒤 진행하면, 300초를 매달리는 대신 **왜 막혔는지가 바로 나옵니다.**",
      },

      { kind: "h3", id: "data-names", text: "④ 데이터 이름을 코드에 박으면 반드시 깨집니다" },
      {
        kind: "p",
        text: "**증상** — 로그인은 되는데 목록에서 특정 항목을 클릭하는 데서 멈춥니다.",
      },
      {
        kind: "p",
        text: "**원인** — `getByRole('row', { name: '등록 테스트 0709 주식양수도 관리자' })` 처럼 **운영 데이터의 이름**을 코드에 박았습니다. 누가 고치거나 상태가 바뀌면 그 행이 사라집니다. 실측: 행 이름에 들어 있던 날짜가 `2026-09-07` → `2026-09-15` 로 바뀌어 있었고, 확인(assert)이 없어 **300초 하드 타임아웃까지 매달렸습니다.** 다른 사례에서는 `project-save-` 로 시작하는 프로젝트들이 **「배정 중」 필터에서 빠져** 목록에 아예 없었습니다.",
      },
      {
        kind: "ol",
        items: [
          { text: "값을 `TESTFLOW_VAR_*` 로 빼서 **실행할 때 지정**하세요" },
          { text: "이름 대신 **위치·맥락**으로 고르세요 (목록의 첫 행 등)" },
          { text: "**테스트가 쓸 데이터를 스스로 만들게** 하세요 — 가장 튼튼합니다" },
        ],
      },
      {
        kind: "note",
        text: "⚠️ **위치로 고를 때는 헤더 행과 전체 선택 체크박스를 조심하세요.** 실측한 표는 `getByRole('row')` 가 **11개**(헤더 1 + 데이터 10)였습니다. 그 표는 헤더 행에 체크박스가 없어서 `filter({ has: page.getByRole('checkbox') })` 로 헤더가 자연히 걸러졌지만, **먼저 확인하고 쓰세요.**",
      },

      { kind: "h3", id: "nth-count", text: "⑤ `.nth(N)` 은 개수가 안 변한다는 전제입니다" },
      {
        kind: "p",
        text: "**실측** — `코멘트 추가` 버튼이 **3개** 있었습니다. ⓐ 상단 페이지 헤더 바 ⓑ 「법무 프로젝트 진행사항」 카드 헤더 ⓒ 스크롤하면 떠오르는 헤더 바(ⓐ의 복제).",
      },
      {
        kind: "p",
        text: "즉 **개수가 스크롤 상태에 따라 2 ↔ 3 으로 변합니다.** 화면에 막 들어갔을 때는 2개, 아래로 내리면 3개입니다. 화면 위아래에 고정돼 나타나는 버튼은 **DOM에는 있지만 그 순간 클릭할 수 있는 상태가 아닐 수도** 있습니다.",
      },
      {
        kind: "p",
        text: "**고치는 법** — 어느 섹션·카드·다이얼로그 안인지로 좁히세요(**2절 5번**의 예시). 순서에 의존하지 마세요.",
      },

      { kind: "h3", id: "first-click", text: "⑥ 첫 클릭이 씹힙니다" },
      {
        kind: "p",
        text: "**증상** — 목록이 막 그려진 직후의 첫 클릭이 효과가 없습니다. 실측: 첫 행이 보인 직후(≈1.3초) 바로 체크박스를 누르면 `Clicking the checkbox did not change its state` 로 **22~32ms 만에 즉사**하고, 1초 뒤 같은 자리를 다시 누르면 성공합니다. 표가 한 번 더 그려지면서 `<input>` 노드가 교체돼 클릭이 유실된 것입니다.",
      },
      {
        kind: "p",
        text: "**고치는 법** — 시간을 재지 말고(`waitForTimeout` 은 느리면서 불안정합니다) **상태를 확인하고 필요하면 다시 누르세요.** `.check()` 대신 `click()` 후 `isChecked()` 로 확인하고 재시도하면, 실패한 첫 시도가 스텝 이력에 실패로 남아 **성공한 실행이 실패처럼 보이는 일**도 없어집니다.",
      },

      { kind: "h3", id: "no-assert", text: "⑦ 녹화로 받은 코드에는 확인(assert)이 없습니다" },
      {
        kind: "p",
        text: "**실측** — 사용자가 만든 테스트 10건을 훑었더니 `expect(` 가 **0건**이었습니다. 레코더는 \"무엇을 눌렀는지\"만 적고 \"그래서 어떻게 됐는지\"는 적지 않습니다.",
      },
      {
        kind: "p",
        text: "그래서 ③처럼 **저장이 거부됐는데도 그 스텝은 통과로 기록**됩니다. 더 고약한 경우도 있었습니다 — 마지막 `저장` 클릭이 423ms 에 통과하고 **142/142 로 끝났는데, 운영에는 프로젝트가 만들어지지 않았습니다.** 클릭 직후 테스트가 끝나 브라우저가 닫히면서 저장 요청이 완료되기 전에 끊긴 것입니다.",
      },
      {
        kind: "p",
        text: "**고치는 법** — 각 저장·전송 뒤에 **결과를 확인하는 한 줄**을 넣으세요. 모달이 닫히는 것, 목록으로 이동하는 것, 방금 만든 항목이 보이는 것 — 무엇이든 하나면 됩니다.",
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "5. 자주 겪는 문제",
    blocks: [
      {
        kind: "qa",
        items: [
          {
            q: "**저장이 안 되고 빨간 밑줄이 뜹니다**",
            a: [
              '→ import 제약(1번) 위반이 대부분입니다. 밑줄 툴팁에 어떤 모듈이 문제인지 나옵니다. AI에게 *"import는 @playwright/test만 쓰고 Node 내장 모듈과 상대 경로 import를 없애 줘"* 라고 다시 요청하세요.',
            ],
          },
          {
            q: "**로그인은 되는데 그 다음에 멈춥니다**",
            a: [
              "→ 코드가 **특정 데이터가 있다고 전제**하고 있습니다. 예를 들어 `getByRole('link', { name: 'project-2024-05' })` 는 그 프로젝트가 목록에 보여야 통과합니다. 데이터가 지워졌거나 상태가 바뀌면 깨집니다.",
              "→ 그 이름을 `TESTFLOW_VAR_*` 로 빼서 실행할 때 지정하세요. 또는 테스트가 **자기가 쓸 데이터를 스스로 만들게** 고치는 것이 가장 튼튼합니다. **4절 ④** 참고.",
            ],
          },
          {
            q: "**버튼이 화면에 보이는데 클릭이 타임아웃까지 매달립니다**",
            a: [
              "→ 앞 단계에서 경고 모달이 떠 있을 가능성이 큽니다. 모달이 뜨면 앱 전체가 접근성 트리에서 빠져 `getByRole` 이 0개를 반환합니다. **4절 ③** 참고.",
            ],
          },
          {
            q: "**에디터에 글자는 보이는데 저장이 거부됩니다**",
            a: [
              "→ `fill()` 로 넣었다면 화면만 바뀌고 앱 상태는 비어 있습니다. `keyboard.type()` 으로 실제 키를 입력하세요. **4절 ①** 참고.",
            ],
          },
          {
            q: "**파일 업로드 스텝에서 실패합니다**",
            a: [
              "→ ① 첨부파일을 올렸는지 ② 코드의 파일명과 올린 파일명이 **정확히 같은지**(공백·괄호 포함) 확인하세요.",
            ],
          },
          {
            q: "**「계정」칸에 입력했는데 로그인이 안 됩니다**",
            a: [
              "→ 코드가 읽는 변수 이름이 `TESTFLOW_VAR_username` 인지 확인하세요. `TESTFLOW_VAR_email` 처럼 다른 이름으로 읽고 있으면 값이 전달되지 않습니다.",
            ],
          },
          {
            q: "**계정이 2개 이상 필요한 테스트**",
            a: [
              "→ 실행 다이얼로그는 계정 1쌍(`TESTFLOW_VAR_username` / `TESTFLOW_VAR_password`)만 받습니다. 지금은 API로 실행해야 합니다.",
              "→ 실제 사례: 보안등급별로 **누구에게 무엇이 보이는지**를 검증하는 시나리오가 변호사·일반 사용자·관리자 **계정 3쌍**을 필요로 했습니다. 이런 테스트는 UI에서 돌릴 수 없습니다.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "unsupported",
    title: "6. 지금 지원하지 않는 것",
    blocks: [
      {
        kind: "table",
        table: {
          head: ["", "대안"],
          rows: [
            ["여러 파일 / helper 분리", "한 파일로 합치기"],
            ["`playwright.config.ts` 의 `projects` 여러 개", "브라우저별로 시나리오 분리"],
            ["`webServer` 설정", "대상 서버를 미리 띄워두고 주소만 지정"],
            ["Chrome 외 브라우저", "—"],
            ["예약·반복 실행", "수동 실행 / 「▶ 선택 실행」 으로 묶어서"],
            ["계정 2쌍 이상을 UI에서 입력", "API 실행"],
            ["재실행할 때 계정 자동 채우기", "**보안상 저장하지 않습니다.** 다시 입력"],
            ["삭제 취소(휴지통)", "—"],
          ],
        },
      },
    ],
  },
  {
    id: "tips",
    title: "7. 좋은 테스트를 만드는 요령",
    blocks: [
      {
        kind: "ul",
        items: [
          '**하나의 시나리오는 하나를 검증하세요.** "로그인하고 프로젝트 만들고 수정하고 삭제" 를 한 파일에 넣으면, 중간에 실패했을 때 무엇이 문제인지 알기 어렵습니다.',
          '**확인(assert)을 넣으세요.** 클릭만 하고 끝나면 "눌렀다"만 알 수 있습니다. `expect(...).toBeVisible()` 로 결과를 확인하세요.',
          "`waitForTimeout` **대신 조건을 기다리세요.** `await expect(...).toBeVisible()` 은 나타날 때까지 기다립니다. 고정 시간 대기는 느리면서 불안정합니다.",
          "**테스트가 스스로 데이터를 만들면 가장 튼튼합니다.** 기존 데이터를 찾는 테스트는 그 데이터가 사라지면 깨집니다.",
          "**녹화 기능도 있습니다.** 코드를 쓰기 어려우면 화면을 조작해서 녹화한 뒤, 「코드로 내보내기」로 Playwright 코드를 받아 AI에게 다듬게 할 수 있습니다.",
          "**다만 녹화 산출물을 그대로 쓰지 마세요.** 레코더는 타이핑을 `fill()` 로, 버튼을 `.nth(N)` 으로, 데이터를 이름 그대로 적고 확인(assert)은 하나도 넣지 않습니다. **4절**의 함정을 그대로 안고 있으니 1절 프롬프트와 함께 AI에게 넘겨 다듬으세요.",
        ],
      },
    ],
  },
];
