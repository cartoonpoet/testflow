import { RUN_ORPHAN_ERROR_MESSAGE } from "@testflow/contracts";
import type { RunJobData } from "@testflow/contracts";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { DataSource } from "typeorm";
import { RunEntity, StepResultEntity } from "@testflow/db";
import { RunReporter } from "./execute/reporter.js";

/**
 * ★ 기동 시 **자기 이름의 고아 run** 정리 — API 회수 장치의 사각지대를 덮는다.
 *
 * ## 왜 API 쪽 회수만으로 부족한가
 * API 의 `StaleRunReaper` 는 **heartbeat 부재**로 판정한다. 그런데 `RUNNER_ID` 를 env 로
 * 고정해 둔 Runner 가 유예(60초) 안에 재기동하면 **같은 이름의 heartbeat 키가 되살아나므로**
 * 그 run 은 영원히 회수되지 않는다. 컨테이너·systemd 의 자동 재시작이 정확히 그 속도다.
 *
 * 이 함수는 그 경우만 본다 — **`runner_id` 가 나 자신이고 아직 `running` 인 run.**
 * 내가 방금 떴다는 것은 그 run 을 돌리던 나의 이전 생이 끝났다는 뜻이고,
 * 그것을 이어서 할 방법은 없다. 그러므로 회수 대상이다.
 * (`RUNNER_ID` 를 주지 않으면 기본값이 `hostname-pid` 라 재기동마다 이름이 달라진다.
 *  그때는 이 함수가 0건이고 API 쪽 회수가 잡는다 — 두 경로가 그렇게 맞물린다.)
 *
 * ## 반드시 Worker 를 만들기 **전에** 부른다
 * Worker 가 먼저 돌면 그 사이에 재배달된 job 을 집어 들어 같은 run 이 다시 `running` 이 된다.
 *
 * ## 중복 방지
 * API 회수와 **같은 근거**를 쓴다 — 조건부 UPDATE(`WHERE status = 'running'`) 의
 * `affected` 가 0 이면 다른 쪽이 이미 확정한 것이므로 이벤트를 쏘지 않는다.
 * 따라서 두 경로가 동시에 돌아도 상태·SSE 가 두 번 나가지 않는다.
 */
export async function reclaimOwnOrphanRuns(params: {
  dataSource: DataSource;
  redis: Redis;
  queue: Queue<RunJobData>;
  runnerId: string;
  log: (message: string) => void;
}): Promise<number> {
  const { dataSource, redis, queue, runnerId, log } = params;
  const runs = dataSource.getRepository(RunEntity);

  const orphans = await runs.find({ where: { status: "running", runnerId } });
  if (orphans.length === 0) return 0;

  let reclaimed = 0;
  for (const run of orphans) {
    const finishedAt = new Date();
    const durationMs =
      run.startedAt === null ? null : Math.max(0, finishedAt.getTime() - run.startedAt.getTime());

    const updated = await runs.update(
      { id: run.id, status: "running" },
      {
        status: "error",
        errorMessage: RUN_ORPHAN_ERROR_MESSAGE,
        finishedAt,
        ...(durationMs === null ? {} : { durationMs }),
      },
    );
    if ((updated.affected ?? 0) === 0) continue;

    // 끝나지 않은 스텝은 `skipped` — 끝난 실행에 "대기 중" 스텝이 남지 않게 한다.
    await dataSource
      .getRepository(StepResultEntity)
      .createQueryBuilder()
      .update()
      .set({ status: "skipped" })
      .where("run_id = :runId AND status IN (:...open)", {
        runId: run.id,
        open: ["pending", "running"],
      })
      .execute()
      .catch(() => undefined);

    // 시나리오 목록의 `last_run_id` 비정규화 컬럼 — 정상 종료 경로(`runFinished`)와 같다.
    await dataSource
      .query(
        `UPDATE scenarios s JOIN runs r ON r.id = ?
            SET s.last_run_id = r.id
          WHERE s.id = r.scenario_id`,
        [run.id],
      )
      .catch(() => undefined);

    /*
     * 재배달 차단 **시도**. Worker 가 죽으면 그 job 은 lock 만료 뒤 stalled 로 재배달된다.
     *
     * ★ 이것만으로는 **못 막는다.** BullMQ 는 lock 이 걸린 active job 의 삭제를 거부한다 —
     *   실측으로 확인했다(회수된 run 2건을 재기동한 Runner 가 그대로 집어 들었다).
     *   진짜 방어선은 `main.ts` Worker 앞단의 **"이미 끝난 run 이면 job 을 버린다"** 검사다.
     *   여기서 지우는 것은 아직 `waiting`/`delayed` 인 job 을 일찍 치우기 위한 것이다.
     */
    const job = await queue.getJob(run.id).catch(() => undefined);
    if (job) await job.remove().catch(() => undefined);

    /*
     * ★ 이벤트 발행은 `RunReporter.publish()` 를 그대로 쓴다 — 발행 절차(INCR seq →
     *   버퍼 RPUSH/LTRIM/EXPIRE → PUBLISH)를 **복사하지 않기 위해서다.** 복사하면
     *   `seq` 규약이 언젠가 반드시 어긋난다. 비밀값 목록은 빈 배열이다(job 페이로드가
     *   이미 사라졌고, 우리가 싣는 메시지는 고정 문구라 마스킹할 값이 없다).
     */
    const reporter = new RunReporter(redis, dataSource, run.id, runnerId, []);
    const at = finishedAt.toISOString();
    await reporter.publish({
      event: "run.status",
      runId: run.id,
      status: "error",
      runnerId,
      at,
    });
    await reporter.publish({
      event: "run.finished",
      runId: run.id,
      status: "error",
      passedSteps: run.passedSteps,
      totalSteps: run.totalSteps,
      durationMs,
      errorMessage: RUN_ORPHAN_ERROR_MESSAGE,
      at,
    });

    reclaimed += 1;
    log(`고아 실행 회수 — ${run.runCode} (이전 생이 남긴 실행) → error`);
  }

  return reclaimed;
}
