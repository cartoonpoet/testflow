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
      const known = detail.steps.some((step) => step.sequence === event.sequence);
      const mapped = detail.steps.map((step) =>
        step.sequence === event.sequence && step.status === "pending"
          ? { ...step, status: "running" as const, startedAt: step.startedAt ?? event.at }
          : step,
      );
      /*
       * ★ 코드 실행(라운드 2)은 `step_results` 를 **미리 `pending` 으로 시딩하지 않는다**
       *   (03-phases 쟁점 2 — 실행해 봐야 스텝 수를 안다). 그래서 `step.started` 가
       *   상세 스냅샷에 **없는 sequence** 로 온다. map 만 하면 아무것도 늘지 않아
       *   화면이 끝까지 "표시할 단계가 없습니다" 로 남는다.
       *   녹화 실행은 시딩되어 있으므로 이 분기를 타지 않는다 —
       *   그래도 `sourceType` 으로 명시적으로 가둬 회귀 가능성을 0 으로 만든다.
       */
      const steps =
        known || detail.sourceType !== "code"
          ? mapped
          : sortBySequence([...mapped, placeholderStep(event)]);
      const totalSteps = monotonic(detail.totalSteps, event.totalSteps);
      return {
        ...detail,
        totalSteps,
        steps,
        summary: {
          ...detail.summary,
          totalSteps: monotonic(detail.summary.totalSteps, event.totalSteps),
          currentStep: Math.max(detail.summary.currentStep, event.sequence),
        },
      };
    }

    case "step.finished": {
      const known = detail.steps.some((step) => step.sequence === event.sequence);
      const mapped = detail.steps.map((step) =>
        step.sequence === event.sequence ? event.result : step,
      );
      /* 위와 같은 이유. `step.started` 를 놓친 채 `step.finished` 만 와도 행이 생겨야 한다. */
      const steps =
        known || detail.sourceType !== "code"
          ? mapped
          : sortBySequence([...mapped, event.result]);
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
        totalSteps: monotonic(detail.totalSteps, event.totalSteps),
        durationMs: event.durationMs,
        /** ★ 이미 마스킹된 값이다(04-gen-5·6). 화면에서 다시 가공하지 않는다. */
        errorMessage: event.errorMessage,
        finishedAt: event.at,
        summary: {
          ...detail.summary,
          totalSteps: monotonic(detail.summary.totalSteps, event.totalSteps),
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

/**
 * ★ 총 단계 수(`N / M 단계` 의 M)는 **단조 증가**다.
 *
 * 코드 실행은 실행 중에 스텝을 발견하면서 `totalSteps` 를 1→2→3… 으로 올린다
 * (03-phases 쟁점 2). 여기서 그냥 대입하면 재연결 재전송으로 **과거의 작은 값**이
 * 뒤늦게 들어와 M 이 되돌아가 보인다 — 사용자에게는 "단계가 줄었다"로 읽힌다.
 * 0 은 "아직 모른다"는 뜻이라 무시한다(라운드 1의 `> 0` 판정과 결과가 같다).
 */
function monotonic(current: number, incoming: number): number {
  return incoming > current ? incoming : current;
}

function sortBySequence(steps: readonly StepResult[]): StepResult[] {
  return [...steps].sort((a, b) => a.sequence - b.sequence);
}

/**
 * 코드 실행에서 `step.started` 만 도착한 단계의 **임시 행**.
 *
 * `step.finished` 가 오면 서버가 준 진짜 `StepResult` 로 통째 치환된다.
 *
 * - `id` 는 uuid 가 아니다. 이 값은 React key 로만 쓰이고 서버로 돌아가지 않는다.
 *   (`RunDetail` 캐시는 zod 로 다시 파싱되지 않는다 — `lib/api.ts` 는 **응답**만 파싱한다.)
 * - `actionType` 은 `step.started` 이벤트에 없다. `"wait"` 를 넣지만 **화면에 나오지 않는다** —
 *   코드 실행의 `running` 행은 `RunStepList` 가 동작 라벨 없이 "실행 중입니다" 로 그린다.
 *   (`step.finished` 가 오면 매퍼가 만든 진짜 `actionType` 으로 바뀐다.)
 */
function placeholderStep(event: {
  runId: string;
  sequence: number;
  name: string;
  at: string;
}): StepResult {
  return {
    id: `live-${event.runId}-${String(event.sequence)}`,
    runId: event.runId,
    stepId: null,
    sequence: event.sequence,
    nameSnapshot: event.name,
    actionType: "wait",
    status: "running",
    startedAt: event.at,
    durationMs: null,
    errorMessage: null,
  };
}

function exhaustive(value: never): never {
  throw new Error(`알 수 없는 실행 이벤트입니다: ${JSON.stringify(value)}`);
}
