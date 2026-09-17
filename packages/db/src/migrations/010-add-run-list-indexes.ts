import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 010 — `/runs` 목록 조회용 인덱스 2종 (Gen-Phase 12 Task 12.5 성능 측정 결과).
 *
 * ## 왜 필요했나 — 실측으로 드러났다
 * `runs` 13,241행에서 `EXPLAIN` 을 떠 보니 아래 두 쿼리가 **full scan + filesort** 였다.
 *
 * ```
 * SELECT … FROM runs WHERE status = 'failed' ORDER BY queued_at DESC LIMIT 20
 *   → key=NULL  rows=12987  Extra="Using where; Using filesort"
 * SELECT … FROM runs                         ORDER BY queued_at DESC LIMIT 20
 *   → key=NULL  rows=12987  Extra="Using filesort"
 * ```
 *
 * 둘 다 `/runs` 화면(상태 필터 있음/없음)이 매번 치는 쿼리다.
 * 기존 `ix_runs_project_queued (project_id, queued_at)` 는 **`project_id` 가 선행 컬럼**이라
 * `projectId` 를 안 넘기는 이 두 경로에서는 쓸 수 없다.
 *
 * ## 지금 당장 느린 건 아니다 (사실 기록)
 * 13k 행에서 p95 는 각각 **9.9ms / 12.6ms** 로 목표(500ms)를 한참 밑돈다.
 * 다만 **행 수에 선형으로 늘어나는 모양**이라 10만~100만 행에서 목표를 넘는다.
 * 지금 넣는 비용(인덱스 2개, 쓰기 경로에 미미한 부담)이 나중에 넣는 비용보다 싸다.
 *
 * ## 왜 인덱스가 2개인가
 * `(status, queued_at)` 하나로는 **필터 없는** `ORDER BY queued_at DESC` 를 못 탄다
 * (선행 컬럼이 상수로 고정되지 않으면 정렬에 쓸 수 없다). 두 경로는 서로 다른 인덱스가 필요하다.
 */
export class AddRunListIndexes1758000000010 implements MigrationInterface {
  name = "AddRunListIndexes1758000000010";

  async up(q: QueryRunner): Promise<void> {
    // `GET /api/runs?status=…` — 상태로 좁히고 최신순 20건.
    await q.query(`CREATE INDEX ix_runs_status_queued ON runs (status, queued_at)`);
    // `GET /api/runs` — 필터 없이 최신순 20건(대시보드 "최근 실행" 포함).
    await q.query(`CREATE INDEX ix_runs_queued ON runs (queued_at)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX ix_runs_queued ON runs`);
    await q.query(`DROP INDEX ix_runs_status_queued ON runs`);
  }
}
