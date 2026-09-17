---
# Version Spike
pipeline_id: 20260917-114450
task: 1.1
date: 2026-09-17
---

# 버전 스파이크 결과

사용자 결정은 **"최신이고 안정된 것으로 간다"**(02-context ★ 최종 결정)이다.
임시 디렉토리(`/tmp/tf-spike`, `/tmp/tf-spike-web`, `/tmp/ts-sxs` — 모두 `PROJECT_DIR` 밖, 커밋 안 함)에서
실제로 설치·컴파일·실행해 검증했다. **막힌 항목은 TypeScript 1건뿐이고, 그 1건만 한 단계 내렸다.**

## 확정 버전표

| 패키지 | 계획(최신) | 실제 채택 | 판정 | 검증 방법 |
|---|---|---|---|---|
| TypeScript | 7.0.2 | **6.0.3** ⬇️ | **한 단계 하향** | 아래 "쟁점 1" 참조 |
| NestJS | 12.0.3 | **12.0.3** | 그대로 | 컨트롤러+2단 DI 컴파일 후 실제 기동, HTTP 200 응답 확인 |
| TypeORM | 1.1.1 | **1.1.1** | 그대로 | `@Entity`/`@Column` 메타데이터 등록 + `MigrationInterface` 컴파일 확인 |
| Playwright | 1.63.0 | **1.63.0** | 그대로 | `page.screencast` 타입 존재 확인 (Gen-Phase 3 전제) |
| React | 19.3.0 | **19.3.0** | 그대로 | Vite 프로덕션 빌드 성공 |
| Vite | 8.3.0 | **8.3.0** | 그대로 | 빌드 성공 (15 modules, 669ms) |
| Tailwind CSS | 4.3.3 | **4.3.3** | 그대로 | `@theme` 토큰 → `bg-brand`/`text-soft`/`rounded-card` 유틸리티 생성 확인 |
| vitest | 3.x(계획) | **5.0.1** ⬆️ | 상향 | 계획서의 3.x 는 옛 정보. 최신 안정 5.0.1 로 테스트 통과 |
| ESLint | 9(계획) | **10.10.0** ⬆️ | 상향 | 계획서의 9 는 옛 정보. flat config 로 0 problems |
| typescript-eslint | — | 8.70.0 | — | TS 6.0.3 과 조합해 통과 |
| turbo | 2.x | 2.10.13 | 그대로 | 5개 워크스페이스 태스크 그래프 동작 |
| zod | 4.6.5 | 4.6.5 | 그대로 | 설치만 (스키마는 Gen-Phase 2) |
| BullMQ / ioredis | 6.3.6 / 6.0.0 | 6.3.6 / 6.0.0 | 그대로 | 설치 성공. 아래 "쟁점 3" 경고 1건 있음 |
| mysql2 | 3.24.4 | 3.24.4 | 그대로 | 설치만 |
| @tanstack/react-query | 5.103.1 | **5.102.8** ⬇️ | 한 단계 하향 | 아래 "쟁점 4"(yarn 검역) |
| prettier | — | **3.9.6** ⬇️ | 한 단계 하향 | 아래 "쟁점 4"(yarn 검역) |
| Node.js | 22.x | **22.22.2** (실측) | 확인됨 | 개발 머신 실측. **배포 서버는 여전히 미확인** |

---

## 쟁점 1 — TypeScript 7.0.2 를 6.0.3 으로 내린 이유 ★

### 검증한 것 (TS 7.0.2 자체는 **통과**했다)

가장 걱정했던 두 항목은 **둘 다 정상 동작**했다.

- ✅ `experimentalDecorators` + `emitDecoratorMetadata` 가 TS 7.0.2 에서 정상 emit 된다.
  emit 결과에 `__metadata("design:paramtypes", [DepService])` 가 찍히는 것을 직접 확인했다.
- ✅ NestJS 12 생성자 DI 가 런타임에 실제로 해석된다.
  컨트롤러 → 서비스 → 하위 서비스 2단 주입을 기동해 `GET /api/spike/abc` 가
  `{"id":"abc","msg":"svc:dep-ok"}` 를 반환했다.
- ✅ TypeORM 1.1.1 엔티티 데코레이터가 정상 등록된다.
  `spike_users` 테이블명과 `id:char, name:varchar, payload:json, createdAt:datetime` 4컬럼이 메타데이터로 잡혔다.

**즉 원래 "미확인"으로 남아 있던 리스크 3건은 모두 해소됐다. TS 7 이 데코레이터 때문에 막힌 것이 아니다.**

### 그런데도 내린 이유 — 툴체인이 하드 블록

TypeScript 7.0.2 는 Go 네이티브 포트이고, **JS 컴파일러 API 를 더 이상 배포하지 않는다.**
`typescript` 패키지의 `exports` 진입점은 `./lib/version.cjs` 하나뿐이고
나머지는 전부 `./unstable/*` 이다. `ts.createProgram` 같은 API 가 없다.

그 결과 `typescript-eslint` 가 **경고가 아니라 하드 에러로 죽는다**:

```
Error: typescript-eslint does not support TS 7.0.
  at node_modules/typescript-eslint/dist/index.js:52:11
```

- 안정 버전 중 TS 7 을 지원하는 typescript-eslint 는 **없다**(latest 8.70.0, canary 8.70.1-alpha.22).
  peer 범위가 `typescript: >=4.8.4 <6.1.0` 으로 명시돼 있다.
- 업스트림 추적 이슈: [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940) — "support for TS >=7.1".
- 02-context 는 **oxlint 를 명시적으로 기각**했다(NestJS 룰셋 생태계가 ESLint 에만 있음).
  따라서 "린트를 포기한다"는 선택지는 없다.

같은 이유로 JS 컴파일러 API 를 요구하는 다른 도구들도 전부 막힌다 — `ts-node`
(TypeORM 의 `typeorm-ts-node-esm` CLI 가 사용), `vitest --typecheck`, shadcn/ui CLI 등.

### 왜 하필 6.0.3 인가

`typescript@6.0.3` 은 **JS 컴파일러 API 를 가진 마지막 릴리스**다(`dist-tags`: 6.0.x 는 정식 배포됨).
한 단계만 내리면 되고, 5.9 까지 내려갈 이유가 없다.

TS 6.0.3 으로 **위 스파이크 전체를 다시 돌려 동일하게 통과**시켰다:
데코레이터 emit ✅ / Nest DI 런타임 ✅ / TypeORM 메타데이터 ✅ / **ESLint exit 0** ✅.

### TS 7 병행 설치도 검토했으나 채택하지 않았다

`typescript@6.0.3`(JS API) + `tsgo@npm:typescript@7.0.2`(별칭) 병행 설치가
기술적으로 **동작하는 것은 확인**했다(`/tmp/ts-sxs`). 그러나 채택하지 않았다:
컴파일러가 둘이면 타입 에러의 판정 주체가 둘이 되고, IDE(`tsserver`)는 6 을 쓰는데
CI 는 7 로 검사하는 불일치가 생긴다. 스캐폴딩 단계에서 감수할 복잡도가 아니다.

### 재승급 조건

**typescript-eslint 가 TS 7 지원을 정식 배포하면(#10940) 즉시 7.x 로 올린다.**
그때 바꿔야 할 파일은 `package.json` 4곳의 `typescript` 핀과
`packages/config-typescript/*.json` 뿐이다 — 애플리케이션 코드는 수정 불필요.
데코레이터 동작은 이미 검증돼 있으므로 위험은 낮다.

---

## 쟁점 2 — NestJS 12 는 **순수 ESM** 이다 ★ (설계에 영향)

이건 버전 하향 문제가 아니라 **구조 제약**이라 별도로 기록한다.

`@nestjs/common` / `@nestjs/core` / `@nestjs/platform-express` 12.0.3 의 package.json 은
`"type": "module"` 이고 `exports` 에 **CJS 조건이 아예 없다**. Nest 11 의 dual 패키지 구성과 다르다.

CommonJS 로 두면 전 파일이 이렇게 깨진다:

```
TS1479: The current file is a CommonJS module whose imports will produce 'require' calls;
        however, the referenced file is an ECMAScript module and cannot be imported with 'require'.
```

### 귀결 (Gen-Phase 2·4·6 이 반드시 따라야 함)

1. `apps/api` · `apps/runner` · `packages/db` 는 `package.json` 에 `"type": "module"` 을 둔다.
2. tsconfig 는 `module: nodenext` + `moduleResolution: nodenext`.
3. **상대 경로 import 에 `.js` 확장자를 반드시 붙인다** (`./app.module.js`).
   붙이지 않으면 런타임에 `ERR_MODULE_NOT_FOUND` 가 난다.
4. TS 7 이 **`moduleResolution: node10` 을 제거**했다(TS5108). 6.0.3 에서는 아직 동작하지만
   7 승급을 염두에 두고 처음부터 `nodenext` 로 간다.
5. `emitDecoratorMetadata` 를 쓰므로 `verbatimModuleSyntax` 는 **끈다**.
   켜면 `import type` 으로 지워진 타입이 `design:paramtypes` 에서 `undefined` 가 되어 DI 가 깨진다.
   같은 이유로 nest/runner ESLint 설정에서 `consistent-type-imports` 룰을 off 했다.

TypeORM 1.1.1 은 dual 패키지(CJS+ESM 둘 다)라 문제 없다.

---

## 쟁점 3 — ioredis 6 vs TypeORM peer (수용, 하향 안 함)

`yarn install` 이 경고 1건을 남긴다:

```
YN0060: ioredis is listed by your project with version 6.0.0,
        which doesn't satisfy what typeorm and other dependencies request (^5.0.4).
```

**하향하지 않고 ioredis 6.0.0 을 유지한다.** 근거:
- TypeORM 의 ioredis peer 는 `peerOptional` 이고 **TypeORM 의 Redis 쿼리 캐시 전용**이다.
  우리는 그 기능을 쓰지 않는다(캐시는 BullMQ/SSE 경로에서 직접 ioredis 를 쓴다).
- **BullMQ 6.3.6 은 `ioredis: >=5.0.0` 을 명시적으로 peer 지원**한다. 즉 6 은 정식 지원 범위다.
- `logFilters` 로 지우는 것도 검토했으나, 패턴을 좁혀도 다른 peer 경고까지 가릴 위험이 있어
  **경고를 그대로 두고 `.yarnrc.yml` 에 주석으로 설명**하는 쪽을 택했다.

---

## 쟁점 4 — yarn 4.18 의 24시간 공급망 검역 (`npmMinimalAgeGate`)

Yarn 4.18 은 `npmMinimalAgeGate: 1440`(분, = 24시간) 이 기본값이라
**배포된 지 24시간이 안 된 패키지를 설치 거부**한다.

```
YN0016: prettier@npm:3.9.7: All versions satisfying "3.9.7" are quarantined
YN0016: @tanstack/react-query@npm:5.103.1: All versions satisfying "5.103.1" are quarantined
```

두 패키지 모두 2026-09-16 배포분이었다.
**검역 설정을 끄지 않았다** — 공급망 공격 방어 장치이고 CLAUDE.md 보안 수칙에 부합한다.
대신 바로 아래 안정 버전으로 핀했다: `prettier 3.9.6`, `@tanstack/react-query 5.102.8`.
24시간이 지나면 언제든 올릴 수 있다(기능 차이 없음).

---

## 쟁점 5 — TypeORM 1.1.1 마이그레이션 실측 (0.3.x 대비 breaking 없음)

MySQL 8.4 컨테이너를 띄운 뒤 실제 마이그레이션을 왕복 실행했다.

```
initialize: OK
runMigrations: CreateSpikeUsers1746000000001
SHOW TABLES: [{"Tables_in_testflow":"migrations"},{"Tables_in_testflow":"spike_users"}]
COLUMNS: id:char(36) | name:varchar(100) | payload:json | created_at:datetime(3)
undoLastMigration: OK
SHOW TABLES after revert: [{"Tables_in_testflow":"migrations"}]
```

**ERDify(0.3.x)에서 쓰던 규약이 그대로 통한다.** 확인된 항목:
- `implements MigrationInterface` + `up(q: QueryRunner)` / `down(q: QueryRunner)` 시그니처 동일
- `queryRunner.query()` 원시 DDL 방식 동일
- `migrations: [클래스, ...]` **명시 배열 등록** 동작(glob 불필요)
- `synchronize:false` + `migrationsRun:false` 동작
- 이력 테이블 이름이 `migrations` 로 동일
- **MySQL 타입 치환 검증**: `CHAR(36)` / `JSON` / `DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)` 모두 의도대로 생성됨
  (02-context 의 Postgres `JSONB`/`TIMESTAMPTZ`/`now()` → MySQL 치환이 유효)

→ **Gen-Phase 2 Task 2.7 은 계획대로 진행하면 된다.**

한 가지 부수 확인: ESM 환경이라 마이그레이션 스크립트에서 **top-level `await` 가 그대로 쓰인다.**

---

## 검증하지 못한 항목 (미검증으로 남김)

| 항목 | 상태 | 사유 |
|---|---|---|
| ~~TypeORM `migration:run` 실제 실행~~ | ✅ **검증 완료** | 아래 "쟁점 5" 참조 — 실제 MySQL 8.4 컨테이너에 `runMigrations()` + `undoLastMigration()` 왕복 성공 |
| NestJS 11→12 세부 breaking (`ValidationPipe` 옵션 등) | **부분 검증** | `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` + `setGlobalPrefix` 는 기동 확인. `@nestjs/config`·`@nestjs/bullmq` 는 **설치·버전 호환만** 확인하고 런타임 미검증(Gen-Phase 4에서) |
| shadcn/ui CLI + Tailwind 4.3 조합 | **미검증** | Tailwind `@theme` 동작은 확인했으나 shadcn CLI 는 Gen-Phase 8 대상이라 스캐폴딩 범위 밖 |
| 배포 서버 Node 버전 | **미확인** | 개발 머신은 22.22.2. 서버 확인 필요 — 02-context 에서 이월된 미결 항목 |
| Playwright 브라우저 바이너리 다운로드 | **미검증** | 패키지 설치와 `page.screencast` 타입만 확인. `playwright install` 은 Gen-Phase 3에서 |

---

## 결론

- 사용자 결정("최신 안정")을 **거의 그대로 지켰다.** 7개 핵심 패키지 중 **하향은 TypeScript 1건**이다.
- TypeScript 하향은 데코레이터 문제가 **아니라** 린터 툴체인 미지원 때문이며, 재승급 경로가 명확하다.
- 대신 계획서보다 **올린 것이 2건** 있다(vitest 3→5, ESLint 9→10). 계획서 수치가 옛 정보였다.
- 새로 발견된 설계 제약 1건(**NestJS 12 ESM 전용**)은 Gen-Phase 2 이후에 직접 영향을 준다.
