---
# Context Artifact
pipeline_id: 20260917-114450
phase: 02-context
---

## 프로젝트 현재 상태

| 항목 | 확인 결과 |
|---|---|
| `PROJECT_DIR` 내용 | `.pipeline/` 디렉토리 **하나뿐**. 소스 파일 0개 |
| `.pipeline/20260917-114450/` | `01-clarify.md` (23KB), `recording-options.html` (19KB) 2개 |
| git 초기화 | **안 됨** — `fatal: not a git repository` (상위 경로에도 없음) |
| `package.json` | 없음 |
| `.env.example` / `tsconfig.json` / 마이그레이션 | 없음 |
| 기존 API 라우터·서비스 레이어 | 없음 |

→ 완전한 그린필드다. "기존 코드 탐색" 대상이 없으므로 **사내 형제 레포의 확립된 컨벤션을 참조 기준으로 삼는다.**

`recording-options.html`(이전 Phase 산출물)도 읽었다. 요지: 1번(별도 창)과 3번(웹 UI 안 스트리밍)은 **수집 파이프라인 4단계(브라우저 기동 → 행동 감지 → Locator 생성 → 스텝 적재)가 완전히 동일**하고, 화면 전달 계층만 다르다. 문서 자체가 "사내 서버 한 대 배포면 처음부터 3번이 맞다"고 결론 내렸고 01-clarify가 그대로 채택했다. **이 문서의 "화면 전달 계층만 교체 가능" 주장은 설계상 반드시 지켜야 할 제약이다** — 스트리밍 PoC가 실패해도 1번으로 후퇴할 수 있는 탈출구이기 때문이다.

---

## 참고한 사내 기존 레포 패턴

### websystem-design-system

경로: `/mnt/c/Users/jhson1/Documents/GitHub/websystem-design-system` (읽기만 함, 수정 없음)

**구조**
```
src/
├─ tokens/      primitives.ts / colors.ts / layout.ts / typography.ts / effects.ts / index.ts
├─ theme/       theme.ts · typo.ts · GlobalStyle.ts · styled.d.ts · withAlpha.ts
├─ components/  Alert Avatar Badge Button Card Checkbox Input Label Radio Select Switch (각 폴더 1파일 + index)
└─ showcase/    ColorsSection / ComponentsSection / TypographySection / Section
```

**스택**: React 19.2 + Vite 8 + **styled-components 6.5** + oxlint. Tailwind 아님. 빌드는 `tsc -b && vite build`. 패키지 배포 설정 없음(`private: true`) — **npm 패키지로 publish되지 않으므로 외부 프로젝트가 의존성으로 끌어다 쓸 수 없다.**

**토큰 정의 방식** — 2계층이다. `primitives`(원시 팔레트) → `colors`(semantic 별칭) → `theme`(styled-components ThemeProvider 주입):

```ts
// src/tokens/colors.ts
import { primitives as p } from './primitives';
export const theme = { primary: p.blue[500], success: p.green[500], danger: p.red[500], ... } as const;
export const button = { primary: { default: p.blue[500], active: p.blue[700] }, ... } as const;
export const surface = { body: p.gray[50], card: p.base.white, tableHeader: p.gray[100], ... } as const;
```
```ts
// src/theme/theme.ts
export const websystemTheme = { colors, layout, typography, shadows } as const;
```

컴포넌트는 `styled.button` + `css` 블록 + `$`-prefix transient prop 패턴:
```tsx
const filledStyle = css<{ $color: ButtonColor }>`
  background-color: ${({ theme, $color }) => theme.colors.button[$color].default};
  &:active:not(:disabled) { background-color: ${({ theme, $color }) => theme.colors.button[$color].active}; }
`;
```

**TestFlow 재사용 판단: 코드는 재사용 불가, 방법론만 차용.** 근거 4가지 —
1. **팔레트가 완전히 다르다.** 이 레포는 Figma Starter 기반 **파랑(`blue[500]`) 브랜드 + Bootstrap 계열 8색 축**. TestFlow 시안은 **초록(`--brand:#087f5b`) 단일 브랜드 + 짙은 딥그린 사이드바(`#15211e`)**. `theme.colors.button.primary`를 그대로 쓰면 시안과 전혀 다른 화면이 나온다.
2. **스타일링 엔진이 상충한다.** 이 레포는 styled-components, 01-clarify는 **shadcn/ui + Tailwind 확정**. 섞으면 런타임 CSS-in-JS와 빌드타임 유틸리티가 이중으로 돌아 얻는 게 없다.
3. **배포 불가.** `private: true` + publish 설정 없음 + 워크스페이스 밖 별도 레포 → `yarn add` 대상이 아니다. 끌어 쓰려면 소스 복사뿐이고, 그건 재사용이 아니라 포크다.
4. **모드가 Light 하나뿐**이라고 코드 주석에 명시돼 있다(`colors.ts` 상단). TestFlow는 시안이 Light 전용이라 당장 문제는 없지만 확장 여지가 없다.

**단, 아래 3가지는 반드시 차용한다** — 이 레포에서 가장 값어치 있는 부분이다:
- `primitives → semantic → theme` **2계층 토큰 분리**. TestFlow 시안 토큰표(`--brand`, `--soft`, `--danger-soft`…)가 이미 semantic 이름이므로 그대로 상위 계층에 앉히고, 시안이 하드코딩한 보조색(사이드바 hover `#1f302b`, active `#29413a`, 다크 패널 `#18302a` 등 20여 개)을 primitives로 내린다.
- **컴포넌트 1폴더 1파일 + barrel `index.ts`** 배치.
- **한국어 주석으로 "왜 이 값인지"를 토큰 파일에 남기는 습관** (예: "`theme`과 값이 다른 항목이 있으니 버튼에서는 반드시 이쪽을 쓴다"). TestFlow도 시안 하드코딩 색이 많아 동일한 주석 규율이 필요하다.

### 백엔드 레포 — ERDify (주 참조) / law.ai-backend (대조군)

조사 결과 `law.ai-backend`·`eSign`은 **NestJS가 아니다**. `@nestjs`를 package.json에서 찾지 못했다.
- `law.ai-backend`: Express 4.17 + backpack 빌드 + 평면 구조(`server/{api,common,constant,helpers,queries,service}`) + 원시 SQL(`queries/`) + yarn. 레거시 CommonJS.
- `eSign`: `{apis, apps, classes, common, config, controllers, libs, routes.js}` — 역시 Express 계열 레거시.
- **`ERDify`가 유일한 NestJS + 모노레포 레포**이므로 이것을 주 참조로 삼는다.

**ERDify 레이아웃** (`/mnt/c/Users/jhson1/Documents/GitHub/ERDify`, 읽기만 함)
```
apps/      api(NestJS 11) · web(React19+Vite) · cli · landing(Astro) · mcp-server
packages/  contracts(zod) · db(TypeORM entity+migration) · domain(순수 로직) · erd-ui · config-eslint · config-typescript
루트        pnpm-workspace.yaml · turbo.json · docker-compose.yml
```

핵심 규율 — **DB 접근을 `packages/db`로 완전히 분리**했다. API는 엔티티를 `@erdify/db`에서 import하고, 마이그레이션 실행도 `pnpm --filter @erdify/db migration:run`으로 DB 패키지가 책임진다. `contracts`(zod)는 web·api·cli·mcp-server가 공유하는 단일 타입 소스다.

`apps/api/src`는 `main.ts` + `app.module.ts` + `common/{config,enums,services,utils}` + `modules/<도메인>/` 이고, 모듈 폴더는 `*.controller.ts` / `*.service.ts` / `*.service.spec.ts` / `dto/` 로 고정돼 있다.

**부트스트랩** (`apps/api/src/main.ts`, 실제 코드):
```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
app.use(compression()); app.use(cookieParser());
app.enableCors({ origin: process.env["NODE_ENV"] === "production"
  ? (process.env["CORS_ORIGINS"]?.split(",") ?? []) : true, credentials: true });
app.setGlobalPrefix("api");
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
const port = Number(process.env["API_PORT"] ?? 4000);
```
→ `setGlobalPrefix("api")` + 엄격 ValidationPipe(`forbidNonWhitelisted`) + env는 **bracket 접근**(`process.env["X"]`, `noPropertyAccessFromIndexSignature` 설정 때문). 이 3가지를 그대로 따른다.

**에러 처리**: 커스텀 exception filter가 **없다.** 서비스에서 Nest 기본 예외를 그대로 던지고(`NotFoundException` / `ForbiddenException` / `BadRequestException`) Nest 기본 필터가 응답을 만든다. 테스트도 `rejects.toThrow(NotFoundException)`으로 검증한다. → TestFlow도 MVP에서 커스텀 필터를 만들지 않는다. 다만 **Runner/녹화 실패는 HTTP 예외로 표현되지 않는 비동기 실패**라 별도 상태 필드(`runs.status`, `error_message`)로 다뤄야 한다.

**컨트롤러**: 경로를 `@Controller()`(빈 인자)에 두고 메서드마다 전체 경로를 적는 스타일 —
```ts
@Controller()
@UseGuards(FlexAuthGuard)
export class DiagramsController {
  @Post("projects/:projectId/diagrams") create(@Param("projectId") projectId: string, @Body() dto: CreateDiagramDto) {...}
  @Get("diagrams/:id") findOne(@Param("id") id: string) {...}
}
```
중첩 리소스와 평면 리소스를 한 컨트롤러에서 함께 노출하기 위한 선택이다. TestFlow도 `projects/:id/scenarios`와 `scenarios/:id`가 공존하므로 동일 패턴이 맞다. (TestFlow는 비회원제라 `@UseGuards` / `@CurrentUser`는 전부 제거된다.)

**마이그레이션**: 수기 `queryRunner.query()` **원시 DDL**. `synchronize: false`, `migrationsRun: false`, 마이그레이션 클래스를 `data-source.ts`에 **명시적으로 import 배열 등록**(glob 아님):
```ts
export class CreateDiagramsTable1746000000004 implements MigrationInterface {
  async up(q: QueryRunner) { await q.query(`
    CREATE TABLE "diagrams" (
      "id" VARCHAR(36) NOT NULL, "project_id" VARCHAR(36) NOT NULL,
      "content" JSONB NOT NULL DEFAULT '{}',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "pk_diagrams" PRIMARY KEY ("id"),
      CONSTRAINT "fk_diagrams_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE)`); }
  async down(q: QueryRunner) { await q.query(`DROP TABLE "diagrams"`); }
}
```
**주의: ERDify는 PostgreSQL이다** (`type: "postgres"`, `JSONB`, `TIMESTAMPTZ`, `now()`). TestFlow는 **MySQL 8**이므로 타입을 `JSON` / `DATETIME(3)` / `CURRENT_TIMESTAMP(3)`으로 치환해야 한다. 컨벤션(snake_case 컬럼, `pk_`/`fk_` 제약 이름, VARCHAR(36) UUID PK, 명시적 등록)만 가져온다.

**패키지 매니저 불일치 (사실 기록)**: ERDify = pnpm 10 + turbo, law.ai-backend = yarn, websystem-design-system = npm·pnpm lock 혼재. 오케스트레이터 지시는 yarn이므로 **yarn workspaces**로 간다. 다만 ERDify의 `workspace:*` 프로토콜과 `--filter` 스크립트는 yarn 문법(`workspace:^`, `yarn workspace <name> <cmd>`)으로 바꿔야 하며, turbo는 패키지 매니저 중립이라 그대로 쓸 수 있다.

### 재사용 판단

| 항목 | 재사용 / 신규 | 근거 |
|---|---|---|
| 디자인 토큰 **값** (색·반경·타이포) | **신규** | 시안은 초록 브랜드, DS 레포는 파랑. 값 자체가 충돌 |
| 토큰 **계층 구조** (primitives→semantic→theme) | **재사용(방법론)** | 시안 하드코딩 보조색 20여 개를 담을 자리가 필요 |
| DS 컴포넌트 소스 (Button/Input/…) | **신규** | styled-components ↔ Tailwind 엔진 충돌 + private 미배포 |
| DS 폴더 배치 (1폴더 1컴포넌트 + barrel) | **재사용** | 비용 0, 팀 내 일관성 |
| 모노레포 골격 (apps/* + packages/*) | **재사용(ERDify)** | web·api·runner 3-런타임 구조에 그대로 맞음 |
| `packages/db` DB 격리 | **재사용(ERDify)** | Runner도 결과를 써야 해서 API와 엔티티 공유 필수 |
| `packages/contracts` zod 공유 타입 | **재사용(ERDify)** | web·api·runner 3자가 같은 Step JSON을 읽음 — 단일 소스 필수 |
| NestJS main.ts 부트스트랩 규약 | **재사용(ERDify)** | 검증된 설정 그대로 |
| Nest 기본 예외 기반 에러 처리 | **재사용(ERDify)** | 커스텀 필터 불필요, 단 비동기 실행 실패는 별도 상태로 |
| 원시 SQL 마이그레이션 + 명시 등록 | **재사용(ERDify)** | 단 Postgres→MySQL 타입 치환 |
| 인증/권한 (Guard, JwtPayload, CurrentUser) | **제거** | 01-clarify 비회원제 결정 |
| 패키지 매니저 | **신규(yarn)** | 지시사항. ERDify pnpm 문법은 변환 필요 |
| law.ai-backend / eSign 구조 | **참조 안 함** | Express 레거시 평면 구조 — NestJS와 무관 |

---

## 신규 프로젝트 구조

```
testflow/
├─ package.json                  # yarn workspaces 루트 (workspaces: ["apps/*", "packages/*"])
├─ yarn.lock  .yarnrc.yml
├─ turbo.json                    # build/dev/lint/typecheck/test 태스크 그래프
├─ docker-compose.yml            # mysql:8 + redis:7 (+ 선택 minio)
├─ .env.example
├─ .gitignore  .gitattributes    # ★ CRLF 사고 방지: * text=auto eol=lf 명시
├─ README.md
│
├─ apps/
│  ├─ web/                       # React 19 + Vite 8 + TS + Tailwind 4 + shadcn/ui
│  │  ├─ index.html  vite.config.ts  tsconfig.json  components.json
│  │  └─ src/
│  │     ├─ main.tsx  App.tsx  router.tsx
│  │     ├─ styles/globals.css           # 시안 토큰 → Tailwind4 @theme 블록
│  │     ├─ components/ui/               # shadcn 생성물 (button, input, select, dialog, table…)
│  │     ├─ components/layout/           # Sidebar(232px) Topbar(68px) Breadcrumb Toaster
│  │     ├─ components/                  # MetricCard RunRow StepCard StatusDot RecordBadge …
│  │     ├─ pages/dashboard/             # 대시보드
│  │     ├─ pages/scenarios/             # 목록 + 빌더(Inspector 포함)
│  │     ├─ pages/runs/                  # 실행 현황(SSE)
│  │     ├─ pages/suites/                # 시안 미제공 — 토큰·패턴 재사용해 신규 설계
│  │     ├─ features/recorder/           # 스트리밍 캔버스 + 입력 캡처/전송 + IME 브리지
│  │     ├─ hooks/                       # react-query 훅 (.ts, useEffect 자제)
│  │     └─ lib/api.ts  lib/sse.ts  lib/mask.ts
│  │
│  ├─ api/                       # NestJS 12
│  │  └─ src/
│  │     ├─ main.ts  app.module.ts
│  │     ├─ common/{config,enums,filters,utils}/
│  │     └─ modules/
│  │        ├─ projects/         # baseUrl·환경 라벨·변수 제공 (화면 없음, API만)
│  │        ├─ scenarios/        # CRUD + 스텝 + 발행           FR-003/004/009(일부)
│  │        ├─ recordings/       # 녹화 세션 수명주기 + 스텝 초안 수신  FR-002
│  │        ├─ runs/             # 실행 요청·큐 등록·SSE·취소    FR-006/007
│  │        ├─ artifacts/        # 증적 스트리밍/다운로드        FR-008
│  │        ├─ suites/           # 스위트 CRUD·묶음 실행         FR-010
│  │        ├─ dashboard/        # 지표 집계
│  │        └─ health/
│  │
│  ├─ runner/                    # Playwright 실행 + 녹화 호스트 (NestJS 아님, 얇은 Node 프로세스)
│  │  └─ src/
│  │     ├─ main.ts              # BullMQ Worker 기동 + 녹화 WS 서버 기동
│  │     ├─ execute/             # JSON 시나리오 해석기
│  │     │  ├─ interpreter.ts    # action_type → Playwright 호출 디스패치
│  │     │  ├─ locator.ts        # target JSON → Playwright Locator 복원 (fallback 체인)
│  │     │  ├─ reporter.ts       # 스텝 이벤트 → Redis pub/sub → API SSE
│  │     │  └─ artifacts.ts      # 스크린샷·video·trace·console 수집 후 storage 위임
│  │     ├─ record/
│  │     │  ├─ session.ts        # 브라우저 1개 = 세션 1개, 유휴 타임아웃
│  │     │  ├─ screencast.ts     # 프레임 송출 (page.screencast 또는 CDP startScreencast)
│  │     │  ├─ input-bridge.ts   # 좌표/키/휠/IME 역주입
│  │     │  ├─ injected.ts       # ★ 페이지에 주입되는 행동 감지 + Locator 후보 생성 스크립트
│  │     │  └─ step-mapper.ts    # 원시 행동 → 업무 문장 스텝 초안
│  │     └─ storage/             # StorageAdapter 인터페이스 + local/s3 구현
│  │
├─ packages/
│  ├─ contracts/                 # zod 스키마 + 추론 타입 (web·api·runner 공유 단일 소스)
│  │  └─ src/{step,scenario,run,recording,events,storage}.ts
│  ├─ db/                        # TypeORM DataSource + entities + migrations (MySQL 8)
│  │  └─ src/{data-source.ts,entities/,migrations/,seed/}
│  ├─ config-typescript/         # base.json / react.json / nest.json / node.json
│  └─ config-eslint/
└─ .pipeline/                    # 파이프라인 artifact (이미 존재)
```

| 경로 | 역할 |
|---|---|
| `apps/web` | 4개 화면 + 녹화 클라이언트. 서버 상태는 전부 react-query, 로컬 상태는 편집 중 임시값만 |
| `apps/web/src/styles/globals.css` | 시안 `:root` 토큰을 Tailwind 4 `@theme` 로 1:1 이식하는 **단일 지점** |
| `apps/web/src/features/recorder` | 캔버스 렌더 + 마우스/키/휠/IME 이벤트를 원격 좌표계로 변환해 WS 송신 |
| `apps/api` | 업무 로직·영속화·큐 등록·SSE 중계. **Playwright를 직접 실행하지 않는다** |
| `apps/api/modules/projects` | MVP에 화면은 없지만 `baseUrl`·환경라벨·변수를 공급하는 API는 필요 (미결항목 (a)(c) 해소) |
| `apps/runner` | 유일하게 Playwright에 의존하는 런타임. 실행(큐 소비)과 녹화(WS) 두 역할 |
| `apps/runner/src/record/injected.ts` | 원격 페이지 안에서 도는 유일한 코드. DOM 접근이 필요한 Locator 생성이 여기서 일어난다 |
| `packages/contracts` | `TestStep` JSON 스키마가 web(편집)·api(검증)·runner(해석) 3곳에서 동일해야 하므로 필수 |
| `packages/db` | API와 Runner 양쪽이 DB에 쓴다(runner가 step_results·artifacts 기록). 엔티티 공유 필수 |
| `packages/config-typescript` | nest용(decorator metadata on)과 react용 설정이 달라 분리 |
| `docker-compose.yml` | MySQL·Redis 로컬 구동. **배포 서버 Docker 가용 여부와 무관하게 개발용으로는 필요** |
| `.gitattributes` | 사용자 메모리에 기록된 websystem CRLF 사고 반복 방지. 신규 레포이므로 처음부터 넣는다 |

**구조상 쟁점 1건 — 녹화 세션을 누가 호스팅하는가.**
01-clarify는 "NestJS가 Playwright를 직접 실행하지 않고 Queue로 Runner에 위임"을 원칙으로 확정했다. 그런데 **녹화는 큐에 넣을 수 없다** — 대화형이고 수 분간 살아 있으며 양방향 저지연 채널이 필요하다. 위 구조는 녹화 브라우저도 `apps/runner`가 소유하되 **BullMQ가 아니라 WebSocket으로 직결**하는 방식이다. 원칙("Playwright는 Runner에만 있다")은 지키고, 전달 수단만 큐 대신 WS를 쓴다.
- 권고: 웹 → **Runner WS 직결**(nginx에서 `/rec/` 경로만 Runner로 프록시). API는 세션 생성/종료와 단명 세션 토큰 발급만 담당.
- 근거: API를 WS 중계로 끼우면 프레임마다 홉이 하나 더 늘어 지연이 배가된다. 프레임 왕복 지연이 이 기능의 유일한 성패 요인이다.
- 트레이드오프: Runner를 여러 대로 늘리면 세션-노드 어피니티가 필요해진다. MVP는 단일 서버 전제이므로 문제되지 않으나 **Runner 수평 확장 시 재설계 지점**으로 기록해 둔다.

---

## 기술 스택 확정안

버전은 2026-09-17 기준 `npm view <pkg> version` 실측값이다.

| 레이어 | 선택 | 버전(실측) | 근거 |
|---|---|---|---|
| 런타임 | Node.js LTS | 22.x (**미확인** — 서버 설치본 확인 필요) | CLAUDE.md "v20+". Playwright·Nest 12 모두 22 지원 |
| 언어 | TypeScript | **5.9 계열 고정 권고** (최신은 7.0.2) | TS 7은 Go 네이티브 포트. NestJS의 `emitDecoratorMetadata`/`experimentalDecorators` 완전 지원 여부 **미확인** → 신규 프로젝트를 여기에 걸지 않는다. 프론트만 선행 도입 가능 |
| 모노레포 | yarn workspaces + turbo | turbo 2.x | 지시사항이 yarn. turbo는 PM 중립이라 ERDify 태스크 그래프 그대로 차용 |
| 프론트 | React + Vite | 19.3.0 / 8.3.0 | 01-clarify 확정. SEO·SSR 불필요 |
| UI | shadcn/ui + Tailwind CSS | Tailwind **4.3.3** | 01-clarify 확정. **Tailwind 4의 CSS-first `@theme`가 시안 `:root` 변수와 구조가 같아 이식 비용이 거의 0** — v3의 JS config보다 명백히 유리 |
| 서버 상태 | @tanstack/react-query | 5.103.1 | CLAUDE.md 기본 스택. (메모리상 vuexy는 v3지만 신규 프로젝트는 v5) |
| 폼 | react-hook-form + zod | zod **4.6.5** | CLAUDE.md 기본 스택. zod는 `packages/contracts`와 공유 |
| API | NestJS | **12.0.3** | 01-clarify 확정. ERDify는 11 — 12로 올릴 때 breaking 여부 **미확인**, 착수 시 릴리스 노트 확인 필요 |
| ORM | TypeORM + mysql2 | **1.1.1** / 3.24.4 | ERDify와 동일 계열. **단 TypeORM이 0.3.x → 1.x로 메이저 점프**했다. ERDify는 `^0.3.22`를 쓰므로 1.x 마이그레이션 가이드 확인 필요 (**미확인**) |
| DB | MySQL 8 | 8.4 LTS 권고 | 01-clarify 확정. JSON 컬럼·CTE·`ON DELETE CASCADE` 모두 지원 |
| 큐 | BullMQ + ioredis | 6.3.6 / 6.0.0 | 01-clarify 확정 |
| 실행 엔진 | Playwright | **1.63.0** | 01-clarify 확정. **1.59(2026-04)에서 `page.screencast` 공식 API 추가** — 녹화 난이도를 크게 낮추는 변화 |
| 스토리지 | 로컬 디스크 + `StorageAdapter` 추상화 | — | 아래 미결 권고 (b) |
| 실시간(실행) | SSE (`text/event-stream`) | — | 01-clarify 확정. 단방향이라 SSE가 WS보다 단순 |
| 실시간(녹화) | WebSocket (binary) | `ws` 8.x | 양방향 + 바이너리 프레임 필요 → SSE 불가 |
| 린트 | ESLint 9 + prettier | — | ERDify와 동일 (DS 레포의 oxlint는 채택 안 함 — Nest 룰셋 생태계가 ESLint에 있음) |
| 테스트 | vitest | 3.x | ERDify 전 패키지 공통. **WSL에서 jest는 win32 네이티브 바인딩 문제가 있다는 사용자 메모리 기록 → vitest 선택이 안전** |

---

## 미결 항목 권고안

| 항목 | 권고안 | 근거 | 대안 |
|---|---|---|---|
| **(a) baseUrl·환경 구분값** | **`projects` 테이블에 `base_url` + `default_env_label` 컬럼을 두고 마이그레이션에서 시드 1건 INSERT. 실행 요청 body에서 선택적 override 허용** | ① 신규 **화면 개발량 0** — 관리 UI 없이 시드로 값이 들어간다. ② 스키마는 어차피 필요하다(나중에 환경 관리 화면을 붙일 때 컬럼을 그대로 승격). ③ 시안 실행 현황의 "환경: 스테이징" 표시를 실데이터로 채울 수 있다. ④ 실행 다이얼로그의 override 한 줄이면 "다른 서버에 한 번 돌려보기"도 된다. ⑤ 시드 INSERT 시 CreateUserID/UpdateUserID 개념은 이 프로젝트에 없음 | **시드 없이 실행 요청 때만 입력** — 매번 URL을 치게 돼 비개발자 테스터 UX가 나쁘고, 시나리오 저장 시점의 `{{baseUrl}}`이 무엇을 가리키는지 알 수 없다. **환경 테이블 + 관리 화면** — MVP 범위 초과 |
| **(b) Artifact 저장소** | **로컬 디스크(`ARTIFACT_ROOT`) + `StorageAdapter` 인터페이스(`put/get/getStream/delete/exists`). S3/MinIO 구현체는 인터페이스만 남기고 미구현** | ① 사내 단일 서버 배포 전제 → MinIO는 컨테이너 1개·버킷 정책·자격증명을 더 얹는데 **단일 노드에서 로컬 디스크 대비 얻는 게 없다.** ② 보존 정책 자동 만료가 MVP 제외라 객체 수명주기 기능도 불필요. ③ Playwright가 video/trace를 **파일로 떨어뜨리므로** 로컬이 가장 짧은 경로(업로드 왕복 없음). ④ 어댑터만 있으면 나중 교체 비용이 파일 1개 |  **MinIO** — Runner를 다른 호스트로 분리하는 순간 필요해진다(그때 어댑터 교체). **S3** — 사내망 전용이면 외부 egress·비용·망분리 심사가 생겨 부적합 |
| **(b) 부가 제약** | **Runner와 API는 같은 호스트에 두고 `ARTIFACT_ROOT` 볼륨을 공유한다** | 로컬 디스크 선택의 직접적 귀결. API가 증적을 서빙(`GET /api/artifacts/:id`)하려면 Runner가 쓴 파일을 읽을 수 있어야 한다 | 분리해야 하면 Runner→API 업로드 엔드포인트 추가 또는 MinIO 전환 |
| **(c) 변수·Secret 입력 경로** | **`project_variables` 테이블에 저장하되 관리 화면은 안 만든다. 값 주입은 ① 시드/직접 INSERT, ② 실행 요청 다이얼로그의 "이번 실행 값" 인라인 override 2경로. Secret은 AES-256-GCM 앱키 암호화 + API 응답 항상 마스킹** | ① "시나리오 인라인만"으로 가면 **비밀번호가 스텝 JSON에 평문으로 박혀** FR-005(암호화·마스킹 MUST)를 정면으로 위반한다. ② 테이블만 만드는 비용은 마이그레이션 1개고, 화면은 여전히 0개. ③ 시안이 이미 `{{testUser.email}}`·`••••••••`를 그리고 있어 **치환 엔진과 마스킹은 어차피 구현 대상**이다 — 저장소만 어디냐의 문제. ④ 복호화 키는 `.env`(`SECRET_ENC_KEY`), 절대 커밋 금지 | **시나리오 JSON 인라인** — FR-005 위반. **환경변수만으로 주입** — 테스터가 값을 바꿀 수 없음 |
| **(d) Docker 가용 여부** | **사용자 확인 필요 항목으로 남긴다** (개발용 compose는 무조건 사용) | 배포 서버 정책을 알 수 없음 | — |
| **(d) Docker 불가 시 Runner 격리 대안** | **실행마다 새 `BrowserContext` + 고유 임시 `userDataDir`/다운로드 디렉토리를 발급하고, 프로세스 단위로 동시 실행 수(`RUNNER_CONCURRENCY`)와 하드 타임아웃(초과 시 강제 kill + 임시 디렉토리 삭제)을 강제한다** — 커널 수준 격리는 포기하고 **상태 격리 + 자원 상한**으로 대체한다 | 문서의 "실행별 컨테이너 격리"는 신뢰 경계가 필요한 멀티테넌트 전제. TestFlow는 사내망·단일 워크스페이스라 신뢰 경계보다 **실행 간 쿠키/캐시 오염 방지와 좀비 프로세스 방지**가 실질 요구사항이다 | Docker 가능 시: 실행당 컨테이너 1개 + `--memory`/`--cpus` 제한 |

---

## API 스펙 초안

전역 prefix `/api` (ERDify 관례). **비회원제이므로 `Authorization` 헤더·쿠키 없음.** 모든 요청/응답 스키마는 `packages/contracts`의 zod에서 파생한다.

| 메서드 | 경로 | 요청 | 응답 | FR |
|---|---|---|---|---|
| GET | `/api/health` | — | `{status, db, redis, runner}` | — |
| **대시보드** |
| GET | `/api/dashboard/summary` | `?projectId&range=today` | `{todayRuns, successRate, automatedScenarios, avgDurationMs}` (지표 4종) | 시안 |
| GET | `/api/dashboard/readiness` | `?projectId` | `{percent, totalScenarios, passing, notices:[{level,message}]}` (진행바 + amber notice) | 시안 |
| **프로젝트** (화면 없음, 값 공급용) |
| GET | `/api/projects` | — | `[{id, name, baseUrl, defaultEnvLabel}]` | FR-001(축소) |
| GET | `/api/projects/:id` | — | `{id, name, baseUrl, defaultEnvLabel, variables:[{key, isSecret, value?}]}` (Secret은 `value` 생략) | FR-001/005 |
| PATCH | `/api/projects/:id` | `{name?, baseUrl?, defaultEnvLabel?}` | 갱신된 프로젝트 | FR-001 |
| **시나리오** |
| GET | `/api/projects/:projectId/scenarios` | `?q&status&feature&page&size` | `{items:[{id, code, name, feature, status, stepCount, lastResult, updatedAt, authorName}], total}` (목록 6열) | 시안 |
| POST | `/api/projects/:projectId/scenarios` | `{name, feature?, authorName?}` | 생성된 시나리오 | FR-003 |
| GET | `/api/scenarios/:id` | — | `{...scenario, steps:[TestStep]}` | FR-003 |
| PATCH | `/api/scenarios/:id` | `{name?, feature?, authorName?}` | 갱신 | FR-003 |
| DELETE | `/api/scenarios/:id` | — | 204 | — |
| POST | `/api/scenarios/:id/publish` | — | `{status:'published', version}` | FR-009(일부) |
| PUT | `/api/scenarios/:id/steps` | `{steps:[TestStep]}` (전량 치환 = 순서변경·삭제 동시 처리) | `{steps:[TestStep]}` | FR-003/004 |
| POST | `/api/scenarios/:id/steps` | `{afterSequence?, step}` (＋다음 스텝 추가) | 생성된 스텝 | FR-003 |
| PATCH | `/api/steps/:stepId` | `{name?, actionType?, target?, input?, options?}` (인스펙터 "적용") | 갱신된 스텝 | FR-003/004 |
| DELETE | `/api/steps/:stepId` | — | 204 (인스펙터 "삭제") | FR-003 |
| **녹화** |
| POST | `/api/scenarios/:id/recordings` | `{startUrl?, viewport?:{w,h}}` | `{sessionId, wsUrl, expiresAt, viewport}` — `wsUrl`은 Runner 직결 주소 + 단명 토큰 | FR-002 |
| GET | `/api/recordings/:sessionId` | — | `{status:'live'\|'stopped'\|'expired', draftStepCount, startedAt}` | FR-002 |
| POST | `/api/recordings/:sessionId/stop` | — | `{steps:[TestStep]}` (초안 확정 후 시나리오에 반영) | FR-002/004 |
| DELETE | `/api/recordings/:sessionId` | — | 204 (브라우저 폐기, 초안 버림) | FR-002 |
| — | `WS /rec/:sessionId?token=…` | (REST 아님) C→S `{t:'mouse'\|'key'\|'wheel'\|'ime'\|'resize', …}` / S→C `{t:'frame', jpeg}` `{t:'step', step}` `{t:'nav', url}` | — | FR-002 |
| **실행** |
| POST | `/api/runs` | `{scenarioId?, suiteId?, baseUrl?, envLabel?, browser:'chromium', variables?:{}}` (둘 중 하나 필수) | **202** `{runId, status:'queued', position}` (1초 내 큐 등록 목표) | FR-006/010 |
| GET | `/api/runs` | `?projectId&scenarioId&status&limit` | `[{id, runCode, scenarioName, browser, status, durationMs, startedAt}]` (대시보드 최근 실행) | FR-006 |
| GET | `/api/runs/:id` | — | `{...run, summary:{envLabel, baseUrl, runnerId, startedAt, totalSteps, currentStep}, steps:[StepResult]}` (다크 요약바) | FR-006/007 |
| **GET** | `/api/runs/:id/events` | `Accept: text/event-stream` | **SSE**. `event: run.status` / `step.started` / `step.finished` / `run.finished` / `artifact.ready`. 재연결은 `Last-Event-ID` | **FR-007** |
| POST | `/api/runs/:id/cancel` | — | `{status:'cancelled'}` | FR-006 |
| GET | `/api/runs/:id/artifacts` | — | `[{id, type:'screenshot'\|'video'\|'trace'\|'console', stepSequence?, sizeBytes, url}]` | FR-008 |
| GET | `/api/artifacts/:id` | `?download=1` | 파일 스트림 (`Content-Type`·`Content-Disposition`) | FR-008 |
| **스위트** |
| GET | `/api/projects/:projectId/suites` | — | `[{id, name, scenarioCount, lastRun}]` | FR-010 |
| POST | `/api/projects/:projectId/suites` | `{name, scenarioIds:[]}` | 생성된 스위트 | FR-010 |
| GET | `/api/suites/:id` | — | `{...suite, scenarios:[{id,name,sequence}]}` | FR-010 |
| PATCH | `/api/suites/:id` | `{name?, scenarioIds?}` | 갱신 | FR-010 |
| DELETE | `/api/suites/:id` | — | 204 | FR-010 |

**규약 메모**
- `POST /api/runs`는 **202 Accepted**를 돌려주고 즉시 반환한다(큐 등록만). 실행 진행은 SSE로만 관찰한다.
- 스위트 실행은 `run` 1건(부모) + 자식 run N건이 아니라, **`runs.suite_id`를 가진 run 여러 건 + `runs.batch_id` 묶음**으로 모델링한다(스키마 참조). 이유: 스텝 결과 테이블 구조를 시나리오 실행과 동일하게 유지할 수 있다.
- 전 응답에서 `isSecret` 변수 값은 **서버에서 마스킹된 문자열로 치환**되어 나간다. 로그·에러 메시지에도 동일 필터를 적용한다(CLAUDE.md 보안 수칙).
- 에러 응답은 Nest 기본 포맷(`{statusCode, message, error}`)을 그대로 쓴다. 커스텀 필터 없음.

---

## DB 스키마 초안

MySQL 8 / `utf8mb4_0900_ai_ci` / 엔진 InnoDB. PK는 `CHAR(36)` UUID(ERDify VARCHAR(36) 관례 + 분산 생성 용이).
**회원제 전환 지점은 `-- [AUTHZ]` 주석으로 표시**했다.

```sql
-- ─────────────────────────────────────────────
-- 001_create_projects
-- ─────────────────────────────────────────────
CREATE TABLE projects (
  id                 CHAR(36)     NOT NULL,
  name               VARCHAR(100) NOT NULL,
  base_url           VARCHAR(500) NOT NULL,            -- 미결(a) 권고: 프로젝트 단일 설정
  default_env_label  VARCHAR(50)  NOT NULL DEFAULT '스테이징',
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_projects PRIMARY KEY (id)
  -- [AUTHZ] 회원제 전환 시: owner_user_id CHAR(36) NULL, organization_id CHAR(36) NULL 추가
  --         + project_members(project_id, user_id, role) 테이블 신설
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 변수·Secret (미결(c) 권고: 테이블은 두되 관리 화면은 MVP 제외)
CREATE TABLE project_variables (
  id           CHAR(36)     NOT NULL,
  project_id   CHAR(36)     NOT NULL,
  var_key      VARCHAR(100) NOT NULL,                  -- 예: baseUrl, testUser.email, testUser.password
  var_value    TEXT         NULL,                      -- 평문 (is_secret=0)
  value_enc    VARBINARY(1024) NULL,                   -- AES-256-GCM 암호문 (is_secret=1). 평문 저장 금지
  value_iv     VARBINARY(16)   NULL,
  value_tag    VARBINARY(16)   NULL,
  is_secret    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_project_variables PRIMARY KEY (id),
  CONSTRAINT uq_project_variables_key UNIQUE (project_id, var_key),
  CONSTRAINT fk_project_variables_project FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- 002_create_scenarios
-- ─────────────────────────────────────────────
CREATE TABLE scenarios (
  id           CHAR(36)     NOT NULL,
  project_id   CHAR(36)     NOT NULL,
  code         VARCHAR(40)  NOT NULL,                  -- 시안 'TC-AUTH-001'
  name         VARCHAR(200) NOT NULL,
  feature      VARCHAR(80)  NULL,                      -- 목록 '기능' 필터
  status       ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  version      INT UNSIGNED NOT NULL DEFAULT 1,
  author_name  VARCHAR(50)  NULL,                      -- [AUTHZ] created_by(FK) 대체 자유 텍스트.
                                                       --   회원제 전환 시 created_by CHAR(36) 추가 후
                                                       --   author_name은 표시용으로 남기거나 백필 후 제거
  last_run_id  CHAR(36)     NULL,                      -- 목록 '최근 결과' 비정규화 (조회 성능)
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_scenarios PRIMARY KEY (id),
  CONSTRAINT uq_scenarios_code UNIQUE (project_id, code),
  CONSTRAINT fk_scenarios_project FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE CASCADE,
  INDEX ix_scenarios_project_status (project_id, status),
  INDEX ix_scenarios_feature (project_id, feature)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- 003_create_test_steps
-- ─────────────────────────────────────────────
CREATE TABLE test_steps (
  id            CHAR(36)     NOT NULL,
  scenario_id   CHAR(36)     NOT NULL,
  sequence      INT UNSIGNED NOT NULL,                 -- 1부터. 재정렬 시 전량 재기입
  name          VARCHAR(200) NOT NULL,                 -- 업무 단계 이름 '아이디 입력'
  action_type   ENUM('goto','click','fill','select','check','uncheck',
                     'press','hover','assert_visible','assert_text','assert_url','wait')
                NOT NULL,
  target_json   JSON         NULL,                     -- FR-004 Locator (아래 형태 주석 참조)
  input_json    JSON         NULL,                     -- {"value":"{{testUser.email}}","isSecret":false}
  options_json  JSON         NULL,                     -- {"timeoutMs":10000,"optional":false}
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_test_steps PRIMARY KEY (id),
  CONSTRAINT uq_test_steps_seq UNIQUE (scenario_id, sequence),
  CONSTRAINT fk_test_steps_scenario FOREIGN KEY (scenario_id)
    REFERENCES scenarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- target_json 형태 (FR-004: role → label → text → test-id 우선순위를 '순위 배열'로 저장)
-- {
--   "primary":   {"by":"role",  "role":"button", "name":"로그인", "exact":true},
--   "fallbacks":[{"by":"label", "value":"로그인"},
--                {"by":"text",  "value":"로그인"},
--                {"by":"testid","value":"login-submit"},
--                {"by":"css",   "value":"form > button.submit"}],   -- 고급 설정에서만 노출
--   "frameUrl": null,
--   "snapshot": {"tag":"button","attrs":{...}}                       -- 실패 진단용
-- }

-- ─────────────────────────────────────────────
-- 004_create_suites
-- ─────────────────────────────────────────────
CREATE TABLE suites (
  id          CHAR(36)     NOT NULL,
  project_id  CHAR(36)     NOT NULL,
  name        VARCHAR(200) NOT NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_suites PRIMARY KEY (id),
  CONSTRAINT fk_suites_project FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE suite_scenarios (
  suite_id     CHAR(36)     NOT NULL,
  scenario_id  CHAR(36)     NOT NULL,
  sequence     INT UNSIGNED NOT NULL,
  CONSTRAINT pk_suite_scenarios PRIMARY KEY (suite_id, scenario_id),
  CONSTRAINT fk_suite_scenarios_suite FOREIGN KEY (suite_id)
    REFERENCES suites(id) ON DELETE CASCADE,
  CONSTRAINT fk_suite_scenarios_scenario FOREIGN KEY (scenario_id)
    REFERENCES scenarios(id) ON DELETE CASCADE,
  INDEX ix_suite_scenarios_seq (suite_id, sequence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- 005_create_runs
-- ─────────────────────────────────────────────
CREATE TABLE runs (
  id             CHAR(36)     NOT NULL,
  run_code       VARCHAR(30)  NOT NULL,                -- 시안 'RUN-2431' 표시용
  project_id     CHAR(36)     NOT NULL,
  scenario_id    CHAR(36)     NULL,                    -- 시나리오 삭제돼도 이력은 남김 → SET NULL
  suite_id       CHAR(36)     NULL,
  batch_id       CHAR(36)     NULL,                    -- 스위트 1회 실행 = 같은 batch_id를 가진 run N건
  scenario_name  VARCHAR(200) NOT NULL,                -- 실행 시점 이름 스냅샷 (삭제 대비)
  env_label      VARCHAR(50)  NOT NULL,
  base_url       VARCHAR(500) NOT NULL,                -- 실행 시점 값 고정 (재현성)
  browser        VARCHAR(20)  NOT NULL DEFAULT 'chromium',
  status         ENUM('queued','running','passed','failed','cancelled','timeout','error')
                 NOT NULL DEFAULT 'queued',
  runner_id      VARCHAR(60)  NULL,
  total_steps    INT UNSIGNED NOT NULL DEFAULT 0,
  passed_steps   INT UNSIGNED NOT NULL DEFAULT 0,
  failed_seq     INT UNSIGNED NULL,
  error_message  TEXT         NULL,                    -- Secret 마스킹 후 저장
  queued_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at     DATETIME(3)  NULL,
  finished_at    DATETIME(3)  NULL,
  duration_ms    INT UNSIGNED NULL,
  CONSTRAINT pk_runs PRIMARY KEY (id),
  CONSTRAINT uq_runs_code UNIQUE (run_code),
  CONSTRAINT fk_runs_project  FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE CASCADE,
  CONSTRAINT fk_runs_scenario FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_runs_suite    FOREIGN KEY (suite_id)    REFERENCES suites(id)    ON DELETE SET NULL,
  INDEX ix_runs_project_queued (project_id, queued_at DESC),   -- 대시보드 '최근 실행'
  INDEX ix_runs_scenario (scenario_id, queued_at DESC),        -- 목록 '최근 결과'
  INDEX ix_runs_batch (batch_id)
  -- [AUTHZ] 회원제 전환 시: triggered_by CHAR(36) NULL 추가 (누가 실행했는가)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- 006_create_step_results
-- ─────────────────────────────────────────────
CREATE TABLE step_results (
  id             CHAR(36)     NOT NULL,
  run_id         CHAR(36)     NOT NULL,
  step_id        CHAR(36)     NULL,                    -- 스텝 편집/삭제돼도 이력 유지 → SET NULL
  sequence       INT UNSIGNED NOT NULL,
  name_snapshot  VARCHAR(200) NOT NULL,                -- 실행 시점 스텝 이름
  action_type    VARCHAR(30)  NOT NULL,
  status         ENUM('pending','running','passed','failed','skipped') NOT NULL DEFAULT 'pending',
  started_at     DATETIME(3)  NULL,
  duration_ms    INT UNSIGNED NULL,
  error_message  TEXT         NULL,                    -- Secret 마스킹 후 저장
  CONSTRAINT pk_step_results PRIMARY KEY (id),
  CONSTRAINT uq_step_results_seq UNIQUE (run_id, sequence),
  CONSTRAINT fk_step_results_run  FOREIGN KEY (run_id)  REFERENCES runs(id)       ON DELETE CASCADE,
  CONSTRAINT fk_step_results_step FOREIGN KEY (step_id) REFERENCES test_steps(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- 007_create_artifacts  (FR-008)
-- ─────────────────────────────────────────────
CREATE TABLE artifacts (
  id              CHAR(36)     NOT NULL,
  run_id          CHAR(36)     NOT NULL,
  step_result_id  CHAR(36)     NULL,                   -- 영상·trace는 run 단위(NULL), 스크린샷은 step 단위
  artifact_type   ENUM('screenshot','video','trace','console_log','network_log') NOT NULL,
  storage_key     VARCHAR(500) NOT NULL,               -- 'runs/<run_id>/step-03.png' — 어댑터 무관 논리 키
  content_type    VARCHAR(100) NOT NULL,
  size_bytes      BIGINT UNSIGNED NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT pk_artifacts PRIMARY KEY (id),
  CONSTRAINT fk_artifacts_run  FOREIGN KEY (run_id)         REFERENCES runs(id)         ON DELETE CASCADE,
  CONSTRAINT fk_artifacts_step FOREIGN KEY (step_result_id) REFERENCES step_results(id) ON DELETE CASCADE,
  INDEX ix_artifacts_run_type (run_id, artifact_type)
  -- 보존 정책 자동 만료는 MVP 제외. 도입 시 expires_at DATETIME(3) 추가 + 배치 삭제
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- 008_create_recording_sessions  (FR-002)
-- ─────────────────────────────────────────────
-- Redis에 둘 수도 있으나, 세션 중단 시 스텝 초안이 사라지면 테스터 작업이 통째로 날아간다.
-- 초안 보존이 목적이므로 DB에 둔다.
CREATE TABLE recording_sessions (
  id            CHAR(36)     NOT NULL,
  scenario_id   CHAR(36)     NOT NULL,
  status        ENUM('live','stopped','expired','error') NOT NULL DEFAULT 'live',
  start_url     VARCHAR(500) NOT NULL,
  viewport_w    INT UNSIGNED NOT NULL DEFAULT 1280,
  viewport_h    INT UNSIGNED NOT NULL DEFAULT 800,
  runner_id     VARCHAR(60)  NULL,
  draft_steps   JSON         NULL,                     -- 확정 전 스텝 초안 배열
  started_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  stopped_at    DATETIME(3)  NULL,
  CONSTRAINT pk_recording_sessions PRIMARY KEY (id),
  CONSTRAINT fk_recording_sessions_scenario FOREIGN KEY (scenario_id)
    REFERENCES scenarios(id) ON DELETE CASCADE,
  INDEX ix_recording_sessions_status (status, last_seen_at)   -- 유휴 세션 청소 배치용
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
-- 009_seed  (미결(a) 권고 반영 — 환경 관리 화면 없이 baseUrl 조달)
-- ─────────────────────────────────────────────
-- INSERT INTO projects (id, name, base_url, default_env_label)
-- VALUES ('<uuid>', '기본 프로젝트', 'https://staging.example.com', '스테이징');
```

**설계 메모**
- `runs`/`step_results`에 `scenario_name`·`name_snapshot`·`base_url`을 **스냅샷으로 중복 저장**한다. 시나리오를 편집·삭제해도 과거 실행 이력이 "그때 무엇을 실행했는지" 그대로 보여야 하기 때문이다. 정규화보다 재현성이 우선이다.
- 스위트 실행은 부모 run을 만들지 않고 `batch_id`로 묶는다 → `step_results` 구조를 단일 시나리오 실행과 동일하게 유지할 수 있다.
- **`[AUTHZ]` 주석 4곳**(projects / scenarios / runs / 그리고 신설될 project_members)이 회원제 전환 시의 정확한 마이그레이션 지점이다. 모두 **NULL 허용 컬럼 추가 + 신규 테이블**이라 기존 데이터 파괴 없이 전환된다.

---

## 원격 브라우저 녹화 기술 조사

**가장 중요한 발견: Playwright 1.59(2026-04-01)에서 `page.screencast` 공식 API가 추가됐다.** 01-clarify와 `recording-options.html`이 작성된 시점의 전제(= CDP를 직접 다뤄야 한다)가 **더 이상 유일한 선택지가 아니다.** 현재 최신은 1.63.0.

### 화면 스트리밍

**1안(권고) — `page.screencast` 공식 API**
```ts
const dispose = await page.screencast.start({
  onFrame: async ({ data, timestamp, viewportWidth, viewportHeight }) => { /* data: JPEG Buffer */ },
  quality: 60,
  size: { width: 1280, height: 800 },
});
```
- `onFrame` 콜백이 **JPEG 버퍼 + 타임스탬프 + 뷰포트 크기**를 준다. Promise 반환 가능(백프레셔 제어 여지).
- `path` 옵션과 **동시 사용 가능** → 같은 API로 녹화 세션 영상 파일도 얻는다.
- 기본 프레임 크기는 뷰포트를 800×800에 맞춰 축소(명시 안 할 경우) → **반드시 `size`를 명시**해야 좌표 변환이 단순해진다.
- 프레임 ack(`Page.screencastFrameAck`)를 직접 관리할 필요가 없다 — 이게 CDP 직접 사용 대비 가장 큰 이득이다.
- **미확인**: 브라우저 제한(Chromium 전용 여부)이 문서에 명시돼 있지 않았다. MVP는 Chromium 전용이라 실질 위험은 없다.

**2안(대안) — CDP 직접**
```ts
const cdp = await context.newCDPSession(page);
await cdp.send('Page.startScreencast', { format:'jpeg', quality:60, maxWidth:1280, maxHeight:800, everyNthFrame:1 });
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  await cdp.send('Page.screencastFrameAck', { sessionId });   // ★ ack 안 보내면 프레임이 멈춘다
});
```
- `metadata`에 `offsetTop / pageScaleFactor / deviceWidth / deviceHeight / scrollOffsetX / scrollOffsetY / timestamp`가 들어온다. **`pageScaleFactor`와 `scrollOffset`은 좌표 역주입 정확도에 직결**되므로, 1안을 쓰더라도 이 값이 필요하면 CDP 세션을 병행해야 한다.
- `everyNthFrame`으로 대역폭을 낮출 수 있다.

**권고**: **1안으로 시작하고, 좌표 변환에 `pageScaleFactor`가 필요하면 CDP 세션을 보조로 붙인다.** 1안이 실패하면 2안으로 내려가되 인터페이스(`screencast.ts`의 `onFrame` 시그니처)는 동일하게 유지한다.

**전송**: JPEG 바이너리를 WebSocket으로 그대로 보낸다(base64 금지 — 33% 오버헤드). 클라이언트는 `createImageBitmap(blob)` → `canvas.drawImage`. **프레임 드롭 정책 필수**: 클라이언트가 렌더 중이면 최신 프레임만 남기고 버린다(`ws.bufferedAmount` 감시).

### 입력 역주입 (한글 IME 포함)

전부 CDP `Input` 도메인이다. Playwright의 `page.mouse`/`page.keyboard`는 **"어떤 요소"를 대상으로 하는 고수준 API**라 좌표 그대로 쏘는 원격 조작에는 CDP가 더 직접적이다(단 `page.mouse.move/down/up`은 좌표 기반이라 대체 가능 — PoC에서 비교할 것).

| 행동 | CDP 명령 | 주요 인자 |
|---|---|---|
| 마우스 이동/클릭 | `Input.dispatchMouseEvent` | `type: mouseMoved\|mousePressed\|mouseReleased`, `x`, `y`, `button`, `clickCount`, `modifiers`, `buttons` |
| 스크롤 | `Input.dispatchMouseEvent` | `type: mouseWheel`, `x`, `y`, `deltaX`, `deltaY` |
| 일반 키 | `Input.dispatchKeyEvent` | `type: keyDown\|keyUp\|rawKeyDown\|char`, `key`, `code`, `windowsVirtualKeyCode`, `text` |
| **텍스트 삽입** | `Input.insertText` | `text` — "키 입력이 아닌 삽입(이모지 키보드, IME)"을 에뮬레이트하는 용도로 스펙에 명시 |
| **IME 조합 중** | `Input.imeSetComposition` | `text`, `selectionStart`, `selectionEnd`, `replacementStart`, `replacementEnd` — **현재 후보 텍스트 설정** |
| **IME 확정** | `Input.imeCommitComposition` | 조합 확정. 빈 문자열로 `imeSetComposition` 호출 시 조합 취소 |

**한글 IME 처리 — 이 기능의 핵심 난제이자 권고안**

브라우저는 한글을 조합 단위로 만든다("ㅎ" → "하" → "한"). 테스터 PC의 IME는 **로컬 브라우저**에서 동작하므로, 원격 페이지는 조합 과정을 전혀 알 수 없다. 두 갈래가 있다:

- **A안(권고, 단순) — `compositionend`에서 `Input.insertText` 1회**
  - 클라이언트에 보이지 않는 `<input>`(또는 `contenteditable`)를 두고 포커스를 잡아 로컬 IME가 거기서 조합하게 한다. `compositionend` 이벤트에서 최종 문자열만 꺼내 `Input.insertText`로 원격에 넣는다.
  - 장점: 구현이 압도적으로 짧다. 조합 중계 왕복 지연이 없다.
  - **한계 1**: `insertText`는 **`keydown`/`keypress`/`keyup`을 전혀 발생시키지 않는다**(`beforeinput`/`input`만 발생). `keydown`에 의존하는 대상 웹앱(자동완성, 키보드 단축키, 일부 마스킹 입력기)에서는 동작이 달라질 수 있다.
  - **한계 2**: 조합 중에는 원격 화면에 아무것도 안 보이다가 확정 순간 한 번에 나타난다 → 테스터 체감이 어색하다.
  - **한계 3**: 대상 페이지의 `compositionstart/update/end` 리스너는 발화하지 않는다.
- **B안(고품질, 비쌈) — `compositionupdate`마다 `imeSetComposition`, `compositionend`에 `imeCommitComposition`**
  - 조합 중간 상태가 원격 화면에 그대로 미러링되고, 대상 페이지의 composition 이벤트도 정상 발화한다.
  - 대신 **타이핑 한 글자마다 네트워크 왕복**이 생겨 지연에 극히 민감하다.

**권고**: **A안으로 MVP를 만들고, PoC에서 "keydown 의존 앱" 실패 사례가 실제로 나오면 B안으로 승급**한다. 두 안 모두 `input-bridge.ts` 한 파일 안에 갇히도록 인터페이스를 설계한다.
**추가 권고**: 영문·숫자 등 **조합이 없는 입력은 `dispatchKeyEvent`로 보낸다**(키 이벤트가 정상 발생). 즉 `isComposing` 여부로 경로를 가른다. 한글만 `insertText` 경로를 탄다.

**좌표 변환 주의**: 웹 캔버스 표시 크기 ≠ 원격 뷰포트 크기다. `(clientX - canvasRect.left) * (remoteViewportW / canvasRect.width)`로 환산해야 하고, `pageScaleFactor`가 1이 아니면 한 번 더 나눠야 한다. **이 계산이 틀리면 클릭이 엉뚱한 요소에 꽂혀 녹화 스텝이 전부 오염된다** — PoC 1순위 검증 대상이다.

### 행동 → 스텝 변환

**권고: 주입 리스너(init script) 방식. CDP 이벤트 방식은 채택하지 않는다.**

근거 — CDP `Input` 이벤트는 **우리가 보낸 좌표와 키**를 알려줄 뿐 **어떤 DOM 요소가 눌렸는지 모른다.** 좌표만으로 스텝을 만들면 FR-004(role/label/text/test-id Locator)를 만족시킬 수 없고, 해상도가 바뀌면 재생이 깨진다. 반면 주입 리스너는 `event.target`에서 요소를 직접 얻는다. `recording-options.html`도 "페이지에 주입한 리스너가 클릭·입력·선택·이동을 잡아낸다"로 이미 이 방식을 전제했고, Playwright 자체 codegen도 InjectedScript 기반이다.

**구현 경로**
```ts
await context.addInitScript({ path: 'dist/injected.js' });   // 모든 프레임·모든 네비게이션에 자동 주입
await context.exposeBinding('__tfEmit', (_src, payload) => stepMapper.push(payload));
```
- `addInitScript`는 **새 문서마다 자동 재주입**되므로 페이지 이동 후에도 리스너가 살아남는다. 수동 재주입 로직이 필요 없다.
- `exposeBinding`으로 페이지 → Node 단방향 채널을 연다.
- 리스너는 **캡처 단계(`{capture:true}`)**에 건다. 대상 페이지가 `stopPropagation()`을 해도 우리가 먼저 본다.
- 잡을 이벤트: `click`(→click) / `input`·`change`(→fill·select·check) / `submit` / `keydown`의 Enter·Tab / `Page.frameNavigated`(CDP, →goto).
- **디바운스 필수**: `input` 이벤트는 글자마다 발생한다. 같은 요소 연속 입력은 **마지막 값 하나의 `fill` 스텝으로 합친다.** 안 하면 "아이디 입력" 하나가 스텝 20개가 된다.
- **비밀번호 필드**(`type="password"`)는 값을 수집하지 않고 **변수 참조로 승격 제안**한다(`{{testUser.password}}`, `isSecret: true`). FR-005 + 시안 `••••••••` 표기가 여기서 나온다.
- **역주입 이벤트도 리스너에 잡힌다** — 그게 목적이다. 다만 `imeSetComposition` 중간 상태가 `input`으로 새어 나오지 않도록 `isComposing` 필터가 필요하다.

**업무 문장 변환**(`step-mapper.ts`): `{action, role, accessibleName}` → `"'로그인' 버튼 클릭"`, `"'아이디' 입력란에 값 입력"`. 시안의 `<code>` 칩(이동/입력/클릭/확인)과 1:1 대응한다. 테스터가 이름을 덮어쓸 수 있으므로 자동 생성 문장은 초안일 뿐이다.

### Locator 생성 로직

**어디서 도는가: 주입 스크립트 안(= 원격 브라우저 페이지 컨텍스트).** DOM·접근성 트리 접근이 필요하므로 서버(Node) 쪽에서는 불가능하다. 생성된 **후보 배열만** 서버로 넘어온다.

**우선순위 (FR-004, Playwright codegen과 동일 철학)**
1. `role` — `element.role`(또는 암시적 role 계산) + accessible name → `getByRole('button', { name: '로그인' })`
2. `label` — `<label for>` / `aria-label` / `aria-labelledby` → `getByLabel('아이디')`
3. `text` — 가시 텍스트 → `getByText('로그인')`
4. `test-id` — `data-testid` (설정 가능한 속성명)
5. *(fallback)* CSS/nth 구조 선택자 — **테스터 화면에 노출 금지**, 고급 설정에서만

**핵심 규칙 — 고유성 검증.** 후보를 만들면 그 자리에서 `document.querySelectorAll` 상당의 매칭을 돌려 **1개만 맞는지 확인**한다. 여러 개면 조상 컨테이너로 범위를 좁히거나(`within`) 다음 순위로 내려간다. Playwright codegen도 "여러 요소가 매칭되면 locator를 개선해 유일하게 만든다"고 문서화돼 있다. 이 검증을 빼먹으면 **녹화는 되는데 재생이 깨지는** 최악의 실패 모드가 나온다.

**저장은 단일 값이 아니라 순위 배열**(`target_json.primary` + `fallbacks`). Runner의 `locator.ts`가 primary 실패 시 fallback을 순서대로 시도하고, **어느 단계에서 성공했는지 기록**한다 → 나중에 "이 스텝은 불안정하다"는 신호로 쓸 수 있다.

**참고**: 직접 구현이 부담되면 `playwright-selector-generator`(Playwright 내부 selector generator를 추출한 라이브러리)가 존재한다. 다만 **내부 포맷 문자열을 반환**하고 `selectorToLocator()` 변환이 필요하다. **미확인 — 유지보수 상태와 Playwright 1.63 호환 여부를 착수 시 검증할 것.** 자체 구현이면 위 5단계 + 고유성 검증으로 충분하다.

### PoC 우선 검증 3가지

**PoC-1. 프레임 왕복 지연과 클릭 좌표 정확도 (가장 먼저)**
- `page.screencast.start({onFrame, size:{1280,800}, quality:60})` → WS → 캔버스 렌더까지의 **체감 지연(ms)과 실효 fps**를 측정하고, **캔버스 클릭 좌표를 역변환해 `Input.dispatchMouseEvent`로 쏜 클릭이 의도한 요소에 정확히 꽂히는지** 확인.
- 합격 기준(제안): 사내망에서 지연 **200ms 이하**, 10fps 이상, 클릭 오차 0px(요소 적중률 100%).
- **왜 1순위**: 여기서 실패하면 녹화 방식 자체를 1번(별도 창)으로 되돌려야 한다. `recording-options.html`이 남겨둔 탈출구를 쓸지 말지가 이 측정으로 결정된다. 나머지 두 항목은 이게 성립한 다음의 문제다.

**PoC-2. 한글 IME 입력 정확도**
- 로컬 숨은 input에서 "안녕하세요 테스트"를 조합 → `compositionend`에 `Input.insertText` 1회(A안). 원격 페이지 입력란에 **자모 분리·중복·누락 없이** 정확히 들어가는지 확인.
- 동시에 **`keydown`에 의존하는 대상**(예: 입력 중 실시간 검색 자동완성, 숫자만 허용하는 마스킹 input)에서 A안이 깨지는지 확인 → 깨지면 B안(`imeSetComposition`) 필요성 확정.
- 합격 기준: 한글 문자열 왕복 정확도 100%, keydown 의존 위젯 1개 이상에서 동작 확인.

**PoC-3. 녹화 → 재생 왕복 성공률**
- 실제 사내 스테이징 로그인 화면에서 **이동→입력→입력→클릭→확인 5스텝을 녹화**하고, 그대로 저장한 뒤 **headless Runner로 재생해 5/5 통과**하는지 확인.
- 검증 포인트: ① role/label 우선순위가 실제로 뽑히는가, ② 고유성 검증이 동작하는가, ③ `input` 디바운스가 "아이디 입력"을 스텝 1개로 합치는가, ④ 비밀번호가 `{{변수}}`로 승격되고 평문이 어디에도 안 남는가.
- **왜 필요**: 녹화와 실행은 별개 코드 경로다. 각각 되는데 **왕복이 안 되는** 경우가 실제로 가장 흔한 실패다. 이 PoC가 통과하면 MVP 핵심 리스크는 사실상 해소된다.

---

## 새로 생성할 파일 (Phase 3 계획 입력용)

MVP 착수에 필요한 **골격 파일**만 나열한다(화면별 컴포넌트 전량은 Phase 3에서 분해).

| 파일 경로 | 역할 |
|---|---|
| `package.json` | yarn workspaces 루트, `workspaces: ["apps/*","packages/*"]`, turbo 스크립트 |
| `turbo.json` | build/dev/lint/typecheck/test 의존 그래프 |
| `.gitattributes` | `* text=auto eol=lf` — CRLF 사고 선제 차단 |
| `.env.example` | `DB_*`, `REDIS_*`, `API_PORT`, `RUNNER_WS_PORT`, `ARTIFACT_ROOT`, `SECRET_ENC_KEY`, `RUNNER_CONCURRENCY` |
| `docker-compose.yml` | mysql:8.4 + redis:7 (개발용) |
| `packages/config-typescript/{base,react,nest,node}.json` | tsconfig 프리셋. nest는 decorator 옵션 on |
| `packages/config-eslint/{base,react,nest}.js` | ESLint 9 flat config |
| `packages/contracts/src/step.ts` | `TestStepSchema`, `LocatorTargetSchema`, `ActionType` — **가장 먼저 확정해야 할 파일** |
| `packages/contracts/src/{scenario,run,recording,events}.ts` | API 요청/응답 + SSE·WS 이벤트 스키마 |
| `packages/db/src/data-source.ts` | MySQL DataSource, `synchronize:false`, 마이그레이션 명시 등록 |
| `packages/db/src/entities/*.entity.ts` | project, project-variable, scenario, test-step, suite, suite-scenario, run, step-result, artifact, recording-session (10개) |
| `packages/db/src/migrations/001~009*.ts` | 위 DDL 9개 (원시 SQL) |
| `apps/api/src/main.ts` | ERDify 부트스트랩 규약 이식 (`setGlobalPrefix('api')`, 엄격 ValidationPipe, CORS) |
| `apps/api/src/app.module.ts` | TypeORM·BullMQ·ConfigModule + 8개 도메인 모듈 |
| `apps/api/src/modules/*/` | projects, scenarios, recordings, runs, artifacts, suites, dashboard, health |
| `apps/api/src/modules/runs/runs.sse.ts` | Redis pub/sub 구독 → SSE 스트림 (FR-007) |
| `apps/api/src/common/utils/mask.ts` | Secret 마스킹 — **API 응답·로그 양쪽에서 호출** |
| `apps/api/src/common/utils/crypto.ts` | AES-256-GCM 암/복호 |
| `apps/runner/src/main.ts` | BullMQ Worker + 녹화 WS 서버 동시 기동 |
| `apps/runner/src/execute/{interpreter,locator,reporter,artifacts}.ts` | JSON 시나리오 해석·Locator 복원·이벤트 발행·증적 수집 |
| `apps/runner/src/record/{session,screencast,input-bridge,step-mapper}.ts` | 녹화 세션 수명주기·프레임 송출·입력 역주입·스텝 변환 |
| `apps/runner/src/record/injected.ts` | **원격 페이지 주입 스크립트** — 행동 감지 + Locator 후보 생성 + 고유성 검증 |
| `apps/runner/src/storage/{adapter,local}.ts` | `StorageAdapter` 인터페이스 + 로컬 디스크 구현 (미결(b) 권고) |
| `apps/web/src/styles/globals.css` | **시안 토큰 → Tailwind 4 `@theme` 이식 단일 지점** |
| `apps/web/components.json` | shadcn/ui 설정 (`baseColor` 커스텀, css variables 모드) |
| `apps/web/src/components/layout/{Sidebar,Topbar,Breadcrumb,Toaster}.tsx` | 232px/68px 고정 레이아웃 + 우하단 toast(2.2초) |
| `apps/web/src/pages/{dashboard,scenarios,runs,suites}/` | 화면 4종 + 시안 미제공 스위트 화면 |
| `apps/web/src/features/recorder/{StreamCanvas,useInputBridge,useImeBridge}.tsx` | 프레임 렌더 + 좌표 변환 + IME 브리지 |
| `apps/web/src/hooks/*.ts` | react-query 훅 (`.ts` 커스텀 훅, useEffect 자제 — CLAUDE.md/메모리 규율) |
| `apps/web/src/lib/sse.ts` | `EventSource` 래퍼, `Last-Event-ID` 재연결 |

---

## ★ 사용자 최종 결정 (2026-09-17, 권고안 대체 — 이 절이 위 권고안 표보다 우선한다)

| 항목 | 최종 결정 | 권고안과의 차이 |
|---|---|---|
| **(a) baseUrl·환경** | **실행 요청 다이얼로그에서 직접 입력받는 것을 기본 경로로 한다.** `projects.base_url`은 **기본값(placeholder)** 으로만 쓰고 시드 1건은 유지. 관리 화면은 여전히 만들지 않는다 | 권고안은 "시드가 주 경로 + override 보조"였으나, **직접 입력이 주 경로**로 승격 |
| **(b) Artifact 저장소** | **로컬 디스크 + `StorageAdapter` 추상화 — 권고안 그대로 승인** | 없음 |
| **(c) 변수·Secret** | **실행 요청 시 계정·비밀번호를 직접 입력받아 run 요청 body로 전달한다. DB에 영구 저장하지 않는다. AES-256-GCM 암호화는 구현하지 않는다** (사용자: "무조건 지금 암호화할 필요는 없어") | 권고안의 `project_variables` 테이블 + 암호화를 **채택하지 않음** |
| **(d) Docker** | **사용 가능.** 실행당 컨테이너 1개 + `--memory`/`--cpus` 제한으로 문서 원안대로 간다 | 대안 격리 방식 불필요 |
| **버전 정책** | **최신 안정 버전으로 간다** (사용자: "최신버전이고 안정된거로 그냥 가면돼"). TS 7.0.2 / TypeORM 1.1.1 / NestJS 12.0.3 / Playwright 1.63 / React 19.3 / Vite 8.3 / Tailwind 4.3 | 권고안의 "5.9/0.3/11 안전 조합 고정"을 채택하지 않음. 단 착수 직후 스파이크로 decorator metadata·breaking change를 검증하고, **막히는 항목만** 개별적으로 한 단계 내린다 |
| **작업 순서** | **PoC-1 먼저** (스캐폴딩 + contracts/DB + 녹화 스트리밍 PoC) → 결과 확인 → 나머지 전량 | 권고안 그대로 |

### (c) 결정의 파생 영향 — Phase 3 계획에 반드시 반영할 것

- `project_variables` 테이블과 `common/utils/crypto.ts`(AES-256-GCM)를 **생성 파일 목록에서 제거**한다.
- `POST /api/runs` 의 `variables?: Record<string,string>` 는 **필수 경로**가 된다. 실행 다이얼로그에 baseUrl·계정·비밀번호 입력 필드를 둔다.
- **`runs` 테이블에 `variables`를 평문으로 저장하지 않는다.** 저장이 필요하면 `isSecret`으로 표시된 키는 값을 `'***'`로 치환해 저장하거나 아예 컬럼에서 제외한다. 실행 중 실제 값은 **Redis 큐 페이로드에만** 존재하고 완료 후 만료된다.
- `common/utils/mask.ts`(마스킹)는 **그대로 유지한다.** 서버 로그·`step_results.error_message`·SSE 이벤트 3경로에서 호출한다. Playwright 에러 메시지에 입력값이 그대로 실려 나오는 경우가 있어 이 필터가 없으면 비밀번호가 로그에 남는다 (CLAUDE.md 보안 수칙).
- 녹화 시 `type="password"` 필드는 **값을 수집하지 않고** `{{password}}` 변수 참조로만 스텝에 남긴다 (기존 결정 유지 — 이건 암호화와 무관하게 필요).
- 시안의 `••••••••` 표기는 유지한다(화면 표시용 마스킹).

### 회원제 전환 시 부채로 남는 지점
- 실행 시 입력 방식은 **매번 계정을 다시 입력해야 한다.** 반복 회귀 실행이 잦아지면 저장 필요성이 생기고, 그때 `project_variables` + 암호화를 추가하게 된다. 지금은 의도적으로 미루는 것이며 FR-005(MUST)는 **미충족 상태로 기록**한다.

---

## 주의사항 및 의존성

**착수 전 확인이 필요한 사항 (사용자/오케스트레이터 결정 대기)**
- **배포 서버 Docker 가용 여부** — 불가 시 Runner 격리를 위 대안(컨텍스트+임시 디렉토리+동시성 상한+하드 타임아웃)으로 대체. 개발용 compose는 무관하게 사용.
- **서버 Node 버전** (미확인) — Playwright 1.63 + NestJS 12가 요구하는 최소 버전 충족 여부.
- 미결 3건 (a)(b)(c)의 권고안 승인 여부.

**버전 관련 (착수 시 검증 필요)**
- **TypeScript 7.0.2가 최신**이지만 Go 네이티브 포트다. NestJS의 `emitDecoratorMetadata` 지원 **미확인** → **5.9 계열로 고정 착수**를 권고. 확인 후 승급.
- **TypeORM이 0.3.x → 1.1.1로 메이저 점프**했다. ERDify는 `^0.3.22` 사용 중이라 사내 선례가 없다. 1.x breaking change **미확인**.
- **NestJS 12** (ERDify는 11). 11→12 breaking **미확인**.
- 세 항목 모두 **Phase 3 착수 직후 스파이크로 30분 안에 확정**하고, 막히면 ERDify가 실제로 돌리는 조합(Nest 11 / TypeORM 0.3 / TS 5.x)으로 내려가면 된다 — 사내에 동작이 검증된 조합이 있다는 게 안전망이다.

**설계상 반드시 지켜야 할 제약**
- **녹화 화면 전달 계층을 반드시 분리**한다(`screencast.ts` / `input-bridge.ts`). PoC-1이 실패하면 1번 방식으로 후퇴해야 하는데, 수집 4단계(감지·Locator·변환·적재)를 건드리지 않고 이 두 파일만 교체할 수 있어야 한다.
- **Runner와 API는 같은 호스트 + `ARTIFACT_ROOT` 볼륨 공유** (로컬 디스크 스토리지 선택의 귀결).
- **녹화 WS는 Runner 직결**(nginx `/rec/` 프록시). API 경유 시 지연이 배가된다. 단 **Runner 수평 확장 시 세션 어피니티 재설계 필요**.
- **`packages/contracts`의 `TestStepSchema`를 가장 먼저 확정**한다. web(편집 폼)·api(검증)·runner(해석) 3자가 동시에 의존하므로 나중에 바꾸면 3곳이 함께 깨진다.
- **Secret 마스킹은 단일 함수(`mask.ts`)로 만들고 API 응답·서버 로그·`error_message` 저장 3경로 모두에서 호출**한다. 한 곳이라도 빠지면 비밀번호가 새어 나간다 (CLAUDE.md 보안 수칙).
- **CSS Selector를 테스터 화면에 노출하지 않는다**(문서 핵심 원칙 + 시안 인스펙터 힌트박스). `target_json.fallbacks`의 `css` 항목은 API 응답에서 기본 제외하고, "고급 설정" 플래그가 있을 때만 포함한다.

**일정 리스크 (01-clarify에서 이월)**
- "빠르게"와 선택된 구성이 상충한다는 지적은 유효하다. 다만 **Playwright 1.59의 `page.screencast`가 스트리밍 난이도를 낮췄으므로**, `recording-options.html`이 추정한 "녹화 개발량 2~3배"는 다소 과대평가일 가능성이 있다(CDP ack·프레임 관리 코드가 통째로 사라진다). **PoC-1 결과로 재추정할 것.**
- 압박 시 축소 후보 순서는 01-clarify 그대로: ① 스위트 묶음 실행, ② 대시보드 지표 실데이터 집계(→ 고정값/단순 카운트로 대체).

**기타**
- 다른 레포(`websystem-design-system`, `ERDify`, `law.ai-backend`, `eSign`)는 **읽기만 했고 수정하지 않았다.**
- `PROJECT_DIR`은 git 초기화가 안 돼 있다. Phase 3 착수 시 `git init` + 초기 커밋이 첫 작업이며, **`.gitattributes`를 초기 커밋에 반드시 포함**한다(사용자 메모리에 websystem CRLF 사고가 반복 기록돼 있음).
- 브랜치 컨벤션: 사용자의 websystem 규칙(`<type>/<고객사>/JunHo/<티켓>`)은 **고객사 프로젝트용**이다. TestFlow는 사내 신규 레포이므로 CLAUDE.md 기본 규칙(`feat/`, `fix/`, `refactor/`)을 따른다.

**출처 (웹 조사)**
- [Playwright v1.59.0 릴리스](https://github.com/microsoft/playwright/releases/tag/v1.59.0) — `page.screencast` 도입
- [Screencast | Playwright](https://playwright.dev/docs/api/class-screencast) — `start()` 옵션·`onFrame` 시그니처
- [CDPSession | Playwright](https://playwright.dev/docs/api/class-cdpsession) — `newCDPSession`
- [Chrome DevTools Protocol — Input domain](https://chromedevtools.github.io/devtools-protocol/tot/Input/) — `insertText` / `imeSetComposition` / `imeCommitComposition` / `dispatchMouseEvent` / `dispatchKeyEvent`
- [CDP Input.insertText 예제](https://gist.github.com/tai2/ac2e8a321c66ded8fd5e7f3064ac671c) — `insertText`가 keydown을 발생시키지 않음
- [Test generator | Playwright](https://playwright.dev/docs/codegen) — 고유성 확보를 위한 locator 개선
- [playwright-selector-generator](https://github.com/kolodny/playwright-selector-generator) — 내부 selector generator 추출본
