import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assertLocalDatabase } from "@testflow/db";
import type { ConfigModuleOptions } from "@nestjs/config";

/**
 * ★★ 환경변수 로딩 규약 — 이 파일이 단일 지점이다. ★★
 *
 * ## 배경 (04-gen-1 이슈 5번 → 04-gen-2 전달사항 4번)
 * 개발 머신 셸에 회사 공용 `DB_HOST`/`DB_USER`/`DB_PW`/`DB_SECRET`/`JWT_SECRET` 이
 * export 돼 있는 경우가 있다. Node 의 `--env-file` 도, `@nestjs/config` 의 기본 동작도
 * **이미 설정된 환경변수를 `.env` 값으로 덮어쓰지 않는다**(둘 다 실측 확인).
 * 즉 `.env` 를 아무리 잘 써도 API 가 회사 DB 에 붙을 수 있다.
 *
 * ## 확정한 우선순위 (높은 쪽이 이긴다)
 *   1. 앰비언트 프로세스 환경변수 (`DB_HOST=... node dist/main.js`, 컨테이너 env, CI)
 *   2. 레포 루트 `.env`
 *   3. 이 파일의 zod 기본값 (= `.env.example` 과 같은 로컬 개발 값)
 *
 * `ConfigModule.forRoot({ override: false })` 로 **명시 고정**한다. 기본값도 false 지만
 * "우연히 그렇게 동작하는 것"과 "그렇게 하기로 정한 것"은 다르므로 옵션을 직접 적는다.
 *
 * ## 왜 `override: true` 가 아닌가 (기각 사유)
 * `override: true` 로 두면 `.env` 가 앰비언트를 이겨 회사 DB 문제가 구조적으로 사라진다.
 * 그런데 `packages/db` 의 마이그레이션 CLI 는 `node --env-file-if-exists` 를 쓰고 있어
 * **앰비언트가 이기는 반대 규약**이다. 두 진입점의 우선순위가 갈리면
 * "마이그레이션은 회사 DB, API 는 로컬 DB" 같은 최악의 상태가 조용히 만들어진다.
 * → 우선순위는 레포 전체에서 하나로 통일하고, 안전장치는 **가드 하나**로 일원화한다.
 *
 * ## 안전장치
 * `validateEnv()` 안에서 `@testflow/db` 의 `assertLocalDatabase()` 를 호출한다.
 * `DB_HOST` 가 `127.0.0.1`/`::1`/`localhost`/`host.docker.internal`/`mysql` 이 아니면
 * **DB 에 연결하기 전에 프로세스를 종료**한다. 의도적 원격 접속은
 * `TESTFLOW_DB_ALLOW_REMOTE=true`. 가드 코드는 `packages/db/src/cli/guard.ts` 하나뿐이고
 * 마이그레이션 CLI 와 API 가 그것을 공유한다(복사본을 만들지 않는다).
 */

/**
 * 레포 루트 `.env` 의 절대 경로.
 *
 * ★ `process.cwd()` 를 쓰지 않는다 — `pnpm --filter @testflow/api dev` 와
 *   `node apps/api/dist/main.js` 의 cwd 가 서로 달라 `.env` 를 놓친다.
 *   컴파일 후 위치(`apps/api/dist/common/config/env.js`)와 소스 위치
 *   (`apps/api/src/common/config/env.ts`) 의 깊이가 같아 같은 상대 경로가 성립한다.
 */
export const REPO_ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

export const REPO_ROOT_ENV_FILE = resolve(REPO_ROOT_DIR, ".env");

/** 빈 문자열은 "설정 안 됨"으로 본다 (`FOO=` 만 적힌 줄 대응). */
function blankToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const portField = (fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().positive().max(65535).default(fallback));

const textField = (fallback: string) =>
  z.preprocess(blankToUndefined, z.string().default(fallback));

/**
 * API 가 실제로 읽는 키만 검증한다. `looseObject` 라 나머지 환경변수는 그대로 통과한다
 * (ConfigModule 이 validate 반환값을 process.env 에 반영하므로 잘라내면 안 된다).
 */
export const EnvSchema = z.looseObject({
  NODE_ENV: textField("development"),

  API_PORT: portField(4000),
  CORS_ORIGINS: z.preprocess(blankToUndefined, z.string().default("")),

  DB_HOST: textField("127.0.0.1"),
  DB_PORT: portField(3307),
  DB_USER: textField("root"),
  DB_PW: textField("testflow_local"),
  DB_NAME: textField("testflow"),

  REDIS_HOST: textField("127.0.0.1"),
  REDIS_PORT: portField(6379),

  /**
   * 증적 파일 루트. 상대 경로면 **레포 루트 기준**으로 해석한다(cwd 기준이 아니다).
   * API 와 Runner 가 같은 호스트에서 이 디렉토리를 공유한다 (02-context "(b) 부가 제약").
   */
  ARTIFACT_ROOT: textField("./artifacts"),

  /**
   * 녹화 WS 는 **Runner 직결**이다. API 는 이 값으로 `wsUrl` 문자열만 만든다
   * (프레임을 중계하면 홉이 늘어 지연이 배가된다 — 02-context "구조상 쟁점").
   */
  RUNNER_WS_PORT: portField(4100),
  RUNNER_WS_HOST: textField("127.0.0.1"),
  /**
   * nginx 뒤에 둘 때 쓰는 공개 베이스 URL(예: `wss://testflow.internal/rec`).
   * 비어 있으면 `ws://RUNNER_WS_HOST:RUNNER_WS_PORT/rec` 를 쓴다.
   */
  RUNNER_WS_PUBLIC_URL: z.preprocess(blankToUndefined, z.string().default("")),
  /**
   * 라운드 2 — 실행 라이브 스트림(`/live/:runId`)의 공개 베이스 URL
   * (예: `wss://testflow.internal/live`). 비어 있으면 `ws://RUNNER_WS_HOST:RUNNER_WS_PORT/live`.
   *
   * ★ `RUNNER_WS_PUBLIC_URL` 을 재사용하지 않는다 — 그 값은 `/rec` 경로까지 포함한 베이스라
   *   그대로 쓰면 실행 스트림이 녹화 경로로 간다. nginx location 도 따로 잡아야 한다.
   */
  RUNNER_WS_LIVE_PUBLIC_URL: z.preprocess(blankToUndefined, z.string().default("")),
});
export type Env = z.infer<typeof EnvSchema>;

/**
 * `ConfigModule.forRoot({ validate })` 훅.
 *
 * `@nestjs/config` 는 `validate(config)` 에 **`.env` + process.env 를 병합한 결과**를 넘기고,
 * 반환값을 그 직후 `process.env` 에 반영한다(소스 확인함). 즉 여기가
 * "최종 확정된 환경변수"를 볼 수 있는 가장 이른 지점이다.
 *
 * 다만 가드(`assertLocalDatabase`)와 `createDataSourceOptions()` 는 `process.env` 를
 * **직접** 읽으므로, ConfigModule 이 반영하기 전에 우리가 먼저 반영해 준다.
 * `override:false` 와 같은 규칙(이미 있으면 건드리지 않는다)으로 쓴다.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`환경변수 검증에 실패했습니다.\n${detail}`);
  }

  applyToProcessEnv(parsed.data);

  // ★ 회사 DB 가드. 로컬 호스트가 아니면 여기서 프로세스가 죽는다(exit 1).
  assertLocalDatabase();

  return parsed.data;
}

/** `override:false` 규칙 — 이미 process.env 에 있는 키는 덮어쓰지 않는다. */
function applyToProcessEnv(config: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(config)) {
    if (key in process.env) continue;
    if (typeof value === "string") {
      process.env[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      process.env[key] = String(value);
    }
  }
}

/** `app.module.ts` 가 그대로 넘기는 옵션. 우선순위 결정이 이 객체에 전부 드러나 있다. */
export const CONFIG_MODULE_OPTIONS = {
  isGlobal: true,
  cache: true,
  ignoreEnvFile: false,
  envFilePath: [REPO_ROOT_ENV_FILE],
  // ★ 명시 고정: 앰비언트 환경변수가 .env 를 이긴다 (위 "확정한 우선순위" 참조).
  override: false,
  validate: validateEnv,
} satisfies ConfigModuleOptions;
