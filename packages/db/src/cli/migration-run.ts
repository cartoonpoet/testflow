import { AppDataSource } from "../data-source.js";
import { assertLocalDatabase } from "./guard.js";

/**
 * 마이그레이션 실행.
 *
 * ★ **컴파일된 JS 로 돌린다** (`typeorm-ts-node-esm` 아님).
 *   `pnpm build` 후 `pnpm --filter @testflow/db migration:run`.
 */
assertLocalDatabase();

const ds = await AppDataSource.initialize();
try {
  const applied = await ds.runMigrations({ transaction: "each" });
  if (applied.length === 0) {
    console.log("적용할 마이그레이션이 없습니다.");
  } else {
    for (const m of applied) console.log(`✔ ${m.name}`);
    console.log(`총 ${String(applied.length)}건 적용했습니다.`);
  }
} finally {
  await ds.destroy();
}
