import { createDataSourceOptions } from "../data-source.js";

/**
 * ★ 보안 가드 — 회사 공용 DB 로 DDL 을 쏘는 사고를 막는다.
 *
 * 배경: 개발자 셸에 회사 공용 `DB_HOST` / `DB_PW` 가 export 돼 있는 경우가 있다
 * (04-gen-1 이슈 5번에서 docker-compose 가 실제로 회사 비밀번호를 빨아들이는 것을 확인했다).
 * 그리고 Node 의 `--env-file` 은 **이미 설정된 환경변수를 덮어쓰지 않는다**(실측 확인).
 * 즉 `.env` 에 로컬 값을 적어 둬도 앰비언트 값이 이긴다.
 *
 * 마이그레이션 CLI 는 CREATE/DROP TABLE 을 실행하므로, 로컬이 아닌 호스트를 가리키면
 * 명시적 옵트인(`TESTFLOW_DB_ALLOW_REMOTE=true`) 없이는 즉시 중단한다.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "host.docker.internal", "mysql"]);

interface MysqlTarget {
  host: string;
  port: number;
  username: string;
  database: string;
}

export function assertLocalDatabase(): MysqlTarget {
  const options = createDataSourceOptions() as unknown as MysqlTarget;
  const target: MysqlTarget = {
    host: options.host,
    port: options.port,
    username: options.username,
    database: options.database,
  };

  console.log(`대상 DB: ${target.username}@${target.host}:${String(target.port)}/${target.database}`);

  const allowRemote = process.env["TESTFLOW_DB_ALLOW_REMOTE"] === "true";
  if (!LOCAL_HOSTS.has(target.host) && !allowRemote) {
    console.error(
      [
        "",
        `중단: DB_HOST 가 로컬이 아닙니다 (${target.host}).`,
        "셸에 회사 공용 DB_* 환경변수가 export 돼 있을 가능성이 높습니다.",
        "  확인: node -e 'console.log(process.env.DB_HOST, process.env.DB_NAME)'",
        "  해결: env -u DB_HOST -u DB_USER -u DB_PW -u DB_PORT -u DB_NAME yarn db:migrate",
        "의도적으로 원격 DB 에 실행하려면 TESTFLOW_DB_ALLOW_REMOTE=true 를 붙이십시오.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  return target;
}
