import { AppDataSource } from "../data-source.js";
import { assertLocalDatabase } from "./guard.js";

/**
 * 마지막 마이그레이션 1건 되돌리기.
 * 전량 되돌리려면 마이그레이션 수만큼 반복 실행한다.
 */
assertLocalDatabase();

const ds = await AppDataSource.initialize();
try {
  await ds.undoLastMigration({ transaction: "each" });
  console.log("✔ 마지막 마이그레이션을 되돌렸습니다.");
} finally {
  await ds.destroy();
}
