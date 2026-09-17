import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import type {
  DashboardNotice,
  DashboardReadiness,
  DashboardSummary,
} from "@testflow/contracts";

/** `?range=` 선택지. 시안은 "오늘"만 쓰지만 7일·30일을 같은 쿼리로 받는다. */
export const DASHBOARD_RANGES = ["today", "7d", "30d"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

interface SummaryRow {
  total_runs: number | string;
  terminal_runs: number | string;
  passed_runs: number | string;
  avg_duration: number | string | null;
}

interface ReadinessRow {
  total_scenarios: number | string;
  passing: number | string;
  failing: number | string;
  never_run: number | string;
  empty_steps: number | string;
}

/**
 * 대시보드 지표.
 *
 * ## 실데이터 집계다 (더미 값 없음)
 * 지표 4종과 준비도 모두 `runs` · `scenarios` · `test_steps` 를 직접 집계한다.
 *
 * ## 집계 비용에 대한 사실 기록 (일정 압박 시 축소 후보 2번)
 * - `summary` 는 **쿼리 2개**다: ① `runs` 를 기간으로 좁혀 조건부 집계(`ix_runs_project_queued`
 *   를 탄다), ② `scenarios` COUNT.
 * - `readiness` 는 **쿼리 1개**다. `scenarios LEFT JOIN runs ON r.id = s.last_run_id` 로
 *   비정규화 컬럼을 타므로 실행 이력 전체를 훑지 않는다.
 * - 즉 지금은 전부 O(프로젝트의 시나리오 수 + 기간 내 run 수)이고 인덱스를 탄다.
 *   **`runs` 가 수십만 행이 되면** ①이 기간 인덱스 범위 스캔으로 무거워진다 —
 *   그때는 일자별 집계 테이블(`run_daily_stats`)을 배치로 채우는 쪽으로 옮겨야 한다.
 *   캐시(Redis, 30초 TTL)는 그보다 싸지만 "방금 돌린 실행이 대시보드에 안 보인다"는
 *   체감 문제가 생겨 MVP 에서는 넣지 않았다.
 */
@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * `GET /api/dashboard/summary?projectId&range`
   *
   * - `todayRuns` — 기간 내 **큐에 들어간** run 수(실행 요청 기준. 아직 대기 중이어도 센다).
   * - `successRate` — 기간 내 **종료된** run 중 `passed` 비율(0~1). 종료된 run 이 없으면 0.
   *   아직 돌고 있는 run 을 분모에 넣으면 성공률이 실행 중일 때마다 떨어져 보인다.
   * - `automatedScenarios` — `published` 시나리오 수. 발행 = "자동화됐다"의 정의다.
   * - `avgDurationMs` — 기간 내 `duration_ms` 가 채워진 run 의 평균.
   */
  async summary(projectId: string | undefined, range: DashboardRange): Promise<DashboardSummary> {
    const [runFilter, runParams] = this.buildRunFilter(projectId, range);
    const [scenarioFilter, scenarioParams] = this.buildScenarioFilter(projectId);

    const [runRows, scenarioRows] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*) AS total_runs,
                SUM(CASE WHEN status IN ('passed','failed','cancelled','timeout','error')
                         THEN 1 ELSE 0 END) AS terminal_runs,
                SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed_runs,
                AVG(duration_ms) AS avg_duration
           FROM runs
          WHERE ${runFilter}`,
        runParams,
      ) as Promise<SummaryRow[]>,
      this.dataSource.query(
        `SELECT COUNT(*) AS total_scenarios FROM scenarios
          WHERE status = 'published' AND ${scenarioFilter}`,
        scenarioParams,
      ) as Promise<{ total_scenarios: number | string }[]>,
    ]);

    const row = runRows[0];
    const terminal = Number(row?.terminal_runs ?? 0);
    const passed = Number(row?.passed_runs ?? 0);

    return {
      todayRuns: Number(row?.total_runs ?? 0),
      successRate: terminal === 0 ? 0 : round4(passed / terminal),
      automatedScenarios: Number(scenarioRows[0]?.total_scenarios ?? 0),
      avgDurationMs: Math.round(Number(row?.avg_duration ?? 0)),
    };
  }

  /**
   * `GET /api/dashboard/readiness?projectId`
   *
   * 진행바(`percent`) = 최근 실행이 `passed` 인 시나리오 / 전체 시나리오.
   * `notices` 는 규칙 기반이다(시안의 amber notice 대응) — 집계만 보여 주고 끝내면
   * 테스터가 "그래서 뭘 해야 하나"를 알 수 없다.
   */
  async readiness(projectId: string | undefined): Promise<DashboardReadiness> {
    const [filter, params] = this.buildScenarioFilter(projectId, "s");

    const rows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total_scenarios,
              SUM(CASE WHEN r.status = 'passed' THEN 1 ELSE 0 END) AS passing,
              SUM(CASE WHEN r.status IN ('failed','timeout','error') THEN 1 ELSE 0 END) AS failing,
              SUM(CASE WHEN s.last_run_id IS NULL THEN 1 ELSE 0 END) AS never_run,
              SUM(CASE WHEN (SELECT COUNT(*) FROM test_steps ts WHERE ts.scenario_id = s.id) = 0
                       THEN 1 ELSE 0 END) AS empty_steps
         FROM scenarios s
         LEFT JOIN runs r ON r.id = s.last_run_id
        WHERE ${filter}`,
      params,
    )) as ReadinessRow[];

    const row = rows[0];
    const total = Number(row?.total_scenarios ?? 0);
    const passing = Number(row?.passing ?? 0);
    const failing = Number(row?.failing ?? 0);
    const neverRun = Number(row?.never_run ?? 0);
    const emptySteps = Number(row?.empty_steps ?? 0);

    const notices: DashboardNotice[] = [];
    if (failing > 0) {
      notices.push({
        level: "danger",
        message: `최근 실행이 실패한 시나리오가 ${String(failing)}건 있습니다. 먼저 확인하세요.`,
      });
    }
    if (emptySteps > 0) {
      notices.push({
        level: "warn",
        message: `스텝이 하나도 없는 시나리오가 ${String(emptySteps)}건 있습니다. 녹화로 채우거나 삭제하세요.`,
      });
    }
    if (neverRun > 0) {
      notices.push({
        level: "info",
        message: `한 번도 실행하지 않은 시나리오가 ${String(neverRun)}건 있습니다.`,
      });
    }
    if (total === 0) {
      notices.push({ level: "info", message: "아직 시나리오가 없습니다. 녹화로 첫 시나리오를 만들어 보세요." });
    }

    return {
      percent: total === 0 ? 0 : round4((passing / total) * 100),
      totalScenarios: total,
      passing,
      notices,
    };
  }

  /* ── 내부 ─────────────────────────────────────────────── */

  private buildRunFilter(
    projectId: string | undefined,
    range: DashboardRange,
  ): [string, unknown[]] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (projectId !== undefined) {
      conditions.push("project_id = ?");
      params.push(projectId);
    }
    /**
     * ★ 기준 시각을 **앱에서 계산해 파라미터로 넘긴다.** `CURDATE()` 를 쓰면 MySQL 서버의
     * 타임존(컨테이너 TZ)이 기준이 되는데, `queued_at` 은 앱이 넣은 UTC 값이라
     * 자정 근처에서 "오늘"이 서로 다른 날을 가리킨다. Node 의 로컬 자정을 Date 로 만들어
     * 넘기면 드라이버(`timezone:"Z"`)가 UTC 로 직렬화하므로 양쪽이 항상 맞는다.
     *
     * `queued_at >= ?` 형태라 `ix_runs_project_queued` 의 범위 스캔을 그대로 탄다.
     */
    conditions.push("queued_at >= ?");
    params.push(startOfRange(range));

    return [conditions.join(" AND "), params];
  }

  private buildScenarioFilter(projectId: string | undefined, alias = ""): [string, unknown[]] {
    const prefix = alias === "" ? "" : `${alias}.`;
    if (projectId === undefined) return ["1 = 1", []];
    return [`${prefix}project_id = ?`, [projectId]];
  }
}

/**
 * 기간의 시작 시각. **서버 로컬 타임존의 자정**이 기준이다("오늘"은 테스터의 오늘이다).
 * 반환은 `Date` 이고 드라이버가 UTC 로 직렬화한다.
 */
export function startOfRange(range: DashboardRange, now: Date = new Date()): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return start;
}

/** 소수 4자리까지만. `successRate` 가 `0.6666666666666666` 로 나가면 화면에서 쓸모없다. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
