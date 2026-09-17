import { AppDataSource } from "../data-source.js";

/** 적용 여부 확인용. 미적용 마이그레이션이 있으면 exit code 1 로 끝난다(CI 용). */
const ds = await AppDataSource.initialize();
try {
  const hasPending = await ds.showMigrations();
  console.log(hasPending ? "미적용 마이그레이션이 있습니다." : "모든 마이그레이션이 적용됐습니다.");
  process.exitCode = hasPending ? 1 : 0;
} finally {
  await ds.destroy();
}
