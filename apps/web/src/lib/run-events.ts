import type { Artifact, RunDetail, RunEvent, StepResult } from "@testflow/contracts";

/**
 * SSE 이벤트 → `RunDetail` 캐시 반영 (순수 함수).
 *
 * 훅(`useRunEvents`)이 아니라 여기 둔 이유는 두 가지다.
 *  1. **단위 테스트가 가능하다.** 연결·타이머 없이 "이 이벤트가 오면 캐시가 이렇게 된다"만 검사한다.
 *  2. **멱등성을 한 곳에서 보장한다.** `Last-Event-ID` 재연결은 서버가 `seq` 로 걸러 주지만,
 *     경계에서 같은 이벤트가 두 번 들어와도 결과가 같아야 화면이 흔들리지 않는다.
 *     (훅은 `seq` 중복도 따로 거른다 — 두 겹이다.)
 *
 * 이벤트 순서는 04-gen-6 이 실측으로 확정했다:
 *   `run.status(running)` → (`step.started`/`step.finished`)×N → `artifact.ready`×M → `run.finished`
 */
export function applyRunEvent(detail: RunDetail, event: RunEvent): RunDetail {
  switch (event.event) {
    case "run.status": {
      const startedAt = detail.startedAt ?? (event.status === "running" ? event.at : null);
      const runnerId = event.runnerId ?? detail.runnerId;
      return {
        ...detail,
        status: event.status,
        runnerId,
        startedAt,
        summary: { ...detail.summary, runnerId, startedAt },
      };
    }

    case "step.started": {
      /*
       * `status === "pending"` 일 때만 running 으로 올린다.
       * 이미 끝난 스텝을 재연결 재전송이 다시 "실행 중" 으로 되돌리면
       * 완료 표시가 스피너로 후퇴하는 최악의 화면이 나온다.
       */
      const steps = detail.steps.map((step) =>
        step.sequence === event.sequence && step.status === "pending"
          ? { ...step, status: "running" as const, startedAt: step.startedAt ?? event.at }
          : step,
      );
      const totalSteps = event.totalSteps > 0 ? event.totalSteps : detail.totalSteps;
      return {
        ...detail,
        totalSteps,
        steps,
        summary: {
          ...detail.summary,
          totalSteps,
          currentStep: Math.max(detail.summary.currentStep, event.sequence),
        },
      };
    }

    case "step.finished": {
      const steps = detail.steps.map((step) =>
        step.sequence === event.sequence ? event.result : step,
      );
      return {
        ...detail,
        steps,
        passedSteps: countPassed(steps),
        failedSeq: event.result.status === "failed" ? event.result.sequence : detail.failedSeq,
        summary: {
          ...detail.summary,
          currentStep: Math.max(detail.summary.currentStep, event.sequence),
        },
      };
    }

    case "run.finished": {
      return {
        ...detail,
        status: event.status,
        passedSteps: event.passedSteps,
        totalSteps: event.totalSteps > 0 ? event.totalSteps : detail.totalSteps,
        durationMs: event.durationMs,
        /** ★ 이미 마스킹된 값이다(04-gen-5·6). 화면에서 다시 가공하지 않는다. */
        errorMessage: event.errorMessage,
        finishedAt: event.at,
        summary: {
          ...detail.summary,
          totalSteps: event.totalSteps > 0 ? event.totalSteps : detail.summary.totalSteps,
        },
      };
    }

    case "artifact.ready":
      // 증적은 별도 쿼리(`/runs/:id/artifacts`)가 들고 있다. 상세 캐시는 건드리지 않는다.
      return detail;

    default:
      return exhaustive(event);
  }
}

/**
 * `artifact.ready` → 증적 목록 캐시에 **추가**한다.
 *
 * 04-gen-6 실측상 `artifact.ready` 는 `run.finished` **보다 먼저** 온다.
 * 그래서 실행이 끝난 뒤 목록을 다시 조회할 필요가 없고, 도착 즉시 목록에 꽂으면 된다.
 * 다만 재연결 재전송으로 같은 증적이 두 번 올 수 있으므로 `id` 로 중복을 막는다.
 */
export function appendArtifact(
  artifacts: readonly Artifact[],
  artifact: Artifact,
): Artifact[] {
  if (artifacts.some((item) => item.id === artifact.id)) return [...artifacts];
  return [...artifacts, artifact];
}

function countPassed(steps: readonly StepResult[]): number {
  return steps.filter((step) => step.status === "passed").length;
}

function exhaustive(value: never): never {
  throw new Error(`알 수 없는 실행 이벤트입니다: ${JSON.stringify(value)}`);
}
