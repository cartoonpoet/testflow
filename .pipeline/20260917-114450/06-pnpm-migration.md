# 06 — 패키지 매니저 yarn → pnpm 전환

작업일: 2026-09-17
브랜치: `chore/pnpm-migration`

---

## 1. 배경

이 레포는 yarn 4.18 workspaces + turbo 로 만들어졌다. 그러나 **사용자의 기존 모노레포 선례는
pnpm** 이다 (`ERDify` = `pnpm@10.32.1` + `pnpm-workspace.yaml` + `turbo.json`).
yarn 을 선택한 것은 오케스트레이터의 잘못된 판단이었고, 사용자 지시로 pnpm 으로 전환한다.
**turbo 는 유지한다.**

---

## 2. ERDify 에서 참고한 관례 (읽기 전용으로 확인)

| 항목 | ERDify | TestFlow 적용 |
|---|---|---|
| `packageManager` | `pnpm@10.32.1` | 동일하게 `pnpm@10.32.1` |
| 워크스페이스 정의 | `pnpm-workspace.yaml` 에 `packages: ["apps/*", "packages/*"]` | 동일 (따옴표 포함 형식까지 맞춤) |
| 워크스페이스 간 의존 프로토콜 | `workspace:*` | `workspace:^` → **`workspace:*` 로 전량 변경** |
| 스크립트에서 turbo 호출 | `"build": "turbo run build"` 등 루트 스크립트가 그대로 turbo 위임 | 이미 동일한 형태였음 — 변경 불필요 |
| 워크스페이스 지정 호출 | `pnpm --filter @erdify/db migration:run` | `pnpm --filter @testflow/db migration:run` |
| `.npmrc` | **없음** | 신규 생성 (아래 3절의 공급망 검역 때문) |

> ERDify 에는 `.npmrc` 가 없다. 즉 `.npmrc` 는 ERDify 관례를 **따른 것이 아니라**,
> yarn 시절의 보안 장치를 잃지 않기 위해 TestFlow 가 추가로 도입한 것이다.

---

## 3. ★ 공급망 검역(`npmMinimalAgeGate`) 대응 결과 — **방어는 유지됐다**

yarn 시절 `.yarnrc.yml` 에 `npmMinimalAgeGate: 1440` (배포 후 24시간 미만 버전 설치 거부)이
있었다. 04-gen-1 이슈 4번이 "보안 장치라 끄지 않았다"고 기록한 항목이다.

### 조사 (추측이 아니라 실제 검증)

1. pnpm 최신 안정 버전 확인 — `npm view pnpm version` → **12.4.2**
2. 설치 대상 버전(10.32.1) 바이너리에서 옵션 실재 확인 —
   `pnpm.cjs` 안에 CLI 파서 정의가 그대로 들어 있다:
   ```
   "minimum-release-age": Number,
   "minimum-release-age-exclude": [String, Array],
   ```
   구현부도 확인됨 — `maximumPublishedBy: opts.minimumReleaseAge ? new Date(Date.now() - opts.minimumReleaseAge * 60 * 1e3) : void 0`
   → **단위가 '분'** 으로 yarn 의 `npmMinimalAgeGate` 와 동일하다.
3. **실동작 검증** — 임시 프로젝트에서 `minimum-release-age=525600`(1년) 을 걸고 `pnpm add typescript`:
   ```
   + typescript 5.9.2 (7.0.2 is available)
   ```
   최신 7.0.2 를 피하고 1년 넘은 5.9.2 를 골랐다. **게이트가 실제로 동작한다.**

### 결론

**동등한 방어가 존재하며, 그대로 이식했다. 사라진 방어는 없다.**

`.npmrc`:
```
minimum-release-age=1440
```

- pnpm 10.16+ 에서 지원. 본 레포는 10.32.1 → 지원 범위 안.
- 예외가 필요하면 `minimum-release-age-exclude=<패키지명>`.
- README 의 "패키지 매니저 — pnpm (공급망 검역 포함)" 절에도 같은 내용을 적었다.

### pnpm 버전 선택 — 10.32.1 (최신 12.4.2 아님)

최신은 12.4.2 지만 **ERDify 와 동일한 10.32.1** 을 택했다. 근거:
- 사용자의 기존 모노레포 관례를 따르라는 것이 이번 작업의 전제다.
- 10.32.1 에서 `minimum-release-age` 가 실동작 검증됐다(위 3번).
- 메이저 2단계 점프(10→12)는 패키지 매니저 전환과 별개의 리스크이고, 이번 작업 범위 밖이다.

---

## 4. ★ 드러난 phantom dependency — 1건 (pnpm 이 실제 버그를 잡아냈다)

pnpm 은 기본 isolated(symlink) 구조라, yarn 의 평면 `node_modules` 에서 **우연히 동작하던**
미선언 의존이 드러난다.

| 워크스페이스 | 패키지 | 증상 | 조치 |
|---|---|---|---|
| `@testflow/api` | **`zod`** | `pnpm build` 실패 — TS2307 `Cannot find module 'zod'` 외 5건 (`common/config/env.ts`, `common/pipes/zod-validation.pipe.ts`, `modules/dashboard/dashboard.controller.ts`) | `apps/api/package.json` 의 `dependencies` 에 **`"zod": "4.6.5"`** 명시 추가 (레포 내 다른 워크스페이스와 동일 버전) |

- yarn 에서는 `@testflow/contracts` 의 `zod` 가 루트로 hoist 돼 우연히 해석됐다.
  **api 는 `zod` 를 직접 import 하면서 선언하지 않은 실제 버그였다.**
- **`shamefully-hoist` 는 쓰지 않았다.** 설치 구조로 덮지 않고 선언을 고쳤다.

### phantom 아님으로 확인한 건

- `apps/api` 의 `import type { Response } from "express"` — 타입 전용이고 `@types/express` 가
  devDependencies 에 선언돼 있어 정상 해석된다. 런타임 import 가 아니므로 조치 불필요.
- 나머지 4개 워크스페이스(`runner` / `web` / `contracts` / `db`)는 전 외부 import 를
  선언 의존과 대조했고 **누락 없음**.

---

## 5. 변경 파일 목록

### 신규
- `pnpm-workspace.yaml` — `packages: ["apps/*", "packages/*"]`
- `.npmrc` — 공급망 검역(`minimum-release-age=1440`) + hoist 금지 근거 주석
- `pnpm-lock.yaml` — `pnpm install` 로 생성 (커밋함)

### 삭제
- `.yarnrc.yml`
- `yarn.lock`
- `.yarn/` 디렉터리(전부 gitignore 대상이라 추적 파일 없음)

### 수정
| 파일 | 내용 |
|---|---|
| `package.json` (루트) | `packageManager` → `pnpm@10.32.1` · `workspaces` 배열 제거 · `workspace:^`→`workspace:*` · `db:migrate`/`db:revert` 를 `pnpm --filter` 로 |
| `apps/api/package.json` | `workspace:*` · **`zod` 명시 추가(phantom 수정)** |
| `apps/runner/package.json` | `workspace:*` · `poc:serve`/`poc:measure` 의 `yarn build:poc` → `pnpm build:poc` |
| `apps/web/package.json` | `workspace:*` |
| `packages/contracts/package.json` | `workspace:*` |
| `packages/db/package.json` | `workspace:*` |
| `.gitignore` | yarn 항목(`.yarn/*`, `.pnp.*`, `yarn-*.log`) 제거 → pnpm 항목(`.pnpm-store/`, `.pnpm-debug.log*`) 추가. `pnpm-lock.yaml` 은 **커밋 대상**임을 주석으로 명시 |
| `README.md` | yarn 명령 전량 pnpm 으로 · 기술표의 패키지 매니저 행 갱신 · "패키지 매니저 — pnpm (공급망 검역 포함)" 절 신설 |
| 소스 주석/메시지 6개 파일 | `apps/api/src/common/config/env.ts`, `apps/runner/poc/{poc1,poc2-ime,poc3-roundtrip,measure}.ts`, `apps/runner/src/record/session.ts`, `packages/db/src/cli/migration-run.ts` 의 `yarn workspace @testflow/…` → `pnpm --filter @testflow/…` (주석·안내 문구만. **로직 변경 없음**) |

### 의도적으로 손대지 않은 것
- `packages/db/src/cli/guard.ts` — **지시상 수정 금지.** 42행 안내 문구가 여전히
  `… yarn db:migrate` 를 출력한다. **알려진 잔존 불일치**로 남긴다(기능 영향 없음).
- `.gitattributes`, `docker-compose.yml`, `turbo.json`, `packages/contracts` 스키마 — 무변경.

---

## 6. 검증 로그 — 전환 전/후 비교

### 정적 검증

| 항목 | 전환 전 (yarn 기준선) | 전환 후 (pnpm) | 판정 |
|---|---|---|---|
| install | 성공 (YN0060 ioredis peer 경고 1건) | 성공 (동일한 ioredis peer 경고 1건) | ✅ 동일 |
| `typecheck` | 7/7 | **7/7 successful** | ✅ 동일 |
| `lint` | 0 problems | **7/7 successful, 0 problems** | ✅ 동일 |
| `build` | 5/5 | **5/5 successful** | ✅ 동일 |
| `test` 합계 | **242** | **242** | ✅ 동일 |
| ├ api | 93 | **93 passed** | ✅ |
| ├ runner | 75 | **75 passed** | ✅ |
| ├ web | 52 | **52 passed** | ✅ |
| └ contracts | 22 | **22 passed** | ✅ |
| 추적 파일 수 | 299 | **300** | ✅ 정상 (−`yarn.lock` −`.yarnrc.yml` +`.npmrc` +`pnpm-workspace.yaml` +`pnpm-lock.yaml` = +1) |

> **peer 경고는 전환 전후가 같다.** `typeorm 1.1.1` 이 `ioredis@^5.0.4` 를 요구하는데 6.0.0 이
> 설치돼 있다는 것 — yarn 의 YN0060 과 동일한 내용이고, 04-gen-1 이 이미 양성(benign)으로 판정했다.
> (TypeORM 의 Redis 쿼리 캐시 전용 optional peer 이고 우리는 쓰지 않는다.)

### 실기동 검증 (인프라 연결)

| 단계 | 결과 |
|---|---|
| `docker compose up -d` | mysql · redis 둘 다 `healthy` |
| `pnpm db:migrate` | `대상 DB: root@127.0.0.1:3307/testflow` → `적용할 마이그레이션이 없습니다.` (기적용 상태). **`pnpm --filter` 스크립트 체인 + TypeORM DataSource 로딩 정상** |
| API 기동 | NestJS 전 라우트 매핑 성공. 모듈이 `node_modules/.pnpm/@nestjs+core@…/…` 에서 해석됨 = **symlink 구조에서 DI·reflect-metadata·TypeORM 엔티티 해석 모두 정상** |
| `GET /api/health` (runner 미기동) | `{"status":"ok","db":"ok","redis":"ok","runner":"down"}` |
| Runner 기동 | `DB 연결 완료` · `heartbeat 등록` · `녹화 WS 서버 기동` · `Worker 기동 queue="run" concurrency=2` |
| `GET /api/health` (runner 기동 후) | `{"status":"ok","db":"ok","redis":"ok","runner":"ok"}` ✅ |

### ★ 실제 시나리오 실행 — Playwright 정상 (가장 중요한 검증)

신규 시나리오 `TC-INFRA-001` "pnpm 전환 검증" 생성 → 스텝 2건(`goto` + `assert_text`) →
`POST /api/runs` (baseUrl `https://example.com`, chromium).

```
[runner] run 9637705d-… 시작 — 스텝 2개 / https://example.com
[runner]   #1 메인 페이지 이동 — PASS (goto https://example.com/)
[runner]   #2 제목 문구 확인 — PASS (assert_text "Example Domain" (primary/css))
[runner] run 9637705d-… 종료 — passed (2/2), 증적 0건
```

`GET /api/runs/9637705d-…`:
- `runCode: "RUN-0066"`, `status: "passed"`, `totalSteps: 2`, `passedSteps: 2`, `durationMs: 937`
- `steps[]` 에 **step_results 2건이 실제로 적재됨** (각각 `passed`, durationMs 420 / 34)

→ **pnpm 전환이 Runner 의 Playwright 해석을 깨뜨리지 않았다.** 브라우저 바이너리
(`~/.cache/ms-playwright`)도 그대로 재사용됐고 재설치가 필요 없었다.

### 웹

- `pnpm --filter @testflow/web build` → `✓ built in 5.33s`, code splitting 청크 유지
- `pnpm --filter @testflow/web preview` → `GET /` 가 TestFlow HTML 반환,
  `/assets/index-*.js` **200 OK**

---

## 7. 이슈 / 결정사항

1. **`msgpackr-extract@3.0.4` 빌드 스크립트가 차단됨** — pnpm 10 은 기본적으로 의존성의
   postinstall 을 실행하지 않는다(`Ignored build scripts` 경고).
   `msgpackr-extract` 는 msgpackr(BullMQ 의존)의 **선택적 네이티브 가속기**이고 JS fallback 이 있다.
   **승인하지 않기로 결정했다** — 실제 시나리오 실행(BullMQ 큐 왕복 포함)이 정상 통과했으므로
   기능 영향이 없고, 불필요한 네이티브 빌드 실행을 허용하지 않는 쪽이 공급망 관점에서 안전하다.
   필요해지면 `pnpm approve-builds` 로 선별 승인하면 된다.

2. **`@testflow/api` 에 `start` 스크립트가 없다 (전환 전부터 존재한 문서 오류)** —
   README 는 `yarn workspace @testflow/api start` 를 안내했지만 `apps/api/package.json` 에는
   `dev` 만 있고 `start` 가 없다. `git show HEAD:apps/api/package.json` 으로 전환 전에도
   없었음을 확인했다. **pnpm 전환이 만든 문제가 아니다.**
   이번에 README 를 고치면서 실제로 동작하는 명령으로 바꾸고 각주를 달았다.
   `package.json` 에 `start` 를 새로 추가하는 것은 범위 밖(기능 변경)이라 하지 않았다.

3. **`packages/db/src/cli/guard.ts` 의 yarn 안내 문구 잔존** — 수정 금지 파일이라 손대지 않았다.
   DB 오염 시 출력되는 안내에 `yarn db:migrate` 가 남아 있다. 별도 작업으로 처리 필요.

4. **`workspace:^` → `workspace:*`** — ERDify 관례를 따랐다. 전 워크스페이스가 `private: true` 에
   버전 고정(0.1.0)이라 의미 차이가 실질적으로 없고, 레포 간 관례를 맞추는 편이 낫다고 판단했다.

5. **`shamefully-hoist` 미사용** — phantom dependency 1건(`zod`)을 설치 구조로 덮지 않고
   선언으로 고쳤다. pnpm 의 격리 구조를 그대로 유지한다.

6. **`/mnt/c` 경로 설치 속도** — 최초 `pnpm install` 1분 27초(444 패키지). 이후 재설치는 14초.
   yarn 대비 특별히 느리지 않다.

---

## 8. PR

- 브랜치: `chore/pnpm-migration` → `main`
- 제목: `[chore] 패키지 매니저 yarn → pnpm 전환`
- URL: https://github.com/cartoonpoet/testflow/pull/16
