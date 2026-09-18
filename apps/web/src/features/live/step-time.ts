import type { RunDetail, StepResult } from "@testflow/contracts";

/**
 * 스텝 목록 ↔ 영상 시간축 매핑 — **순수 함수**. (라운드 5)
 *
 * ════════════════════════════════════════════════════════════════════
 * ★★ 이 매핑은 **정확하지 않다.** 정확한 척하지 않는 것이 이 파일의 목적이다. ★★
 *
 * 가진 것은 `run.startedAt` 과 각 `step_results.startedAt`·`durationMs` 뿐이다.
 * 그런데 **영상의 0초는 `run.startedAt` 이 아니다** —
 *
 *   `runStarted()` 는 Playwright 를 띄우기 **전에** 호출된다
 *   (`code-executor.ts` — `reporter.runStarted()` 가 `spawn` 보다 위에 있다).
 *   영상은 Playwright 가 **BrowserContext 를 만드는 순간** 시작한다.
 *   그 사이에는 프로세스 기동 · 브라우저 런치 · 픽스처 준비가 들어간다.
 *
 * 그래서 `run.startedAt` 을 0초로 놓으면 **그 기동 시간만큼 통째로 밀린다.**
 * 실측값은 `.pipeline/20260917-231945/12-step-sync.md` §3 에 있다(초 단위 오차 포함).
 *
 * ## 그래서 무엇을 앵커로 쓰는가 — **첫 스텝**이다
 * 영상 시작(context 생성)과 가장 가까운 사건은 run 시작이 아니라 **첫 스텝의 시작**이다.
 * 코드 실행의 첫 스텝은 대개 `page.goto` 이고, 그 직전에 context 가 만들어진다.
 * 즉 `videoTime(step) = (step.startedAt - firstStep.startedAt)/1000 + LEAD`.
 *
 * `LEAD` 는 "context 생성 → 첫 스텝 시작" 사이의 간격이다. 실행마다 다르지만
 * 실측 범위가 좁아(§3) **상수 하나**로 둔다. 이것이 이 매핑의 유일한 추정값이다.
 *
 * ## 왜 영상 길이로 비례 보정하지 않는가
 * `videoDuration / runSpan` 로 전 구간을 늘리면 "정확해 보이는" 값이 나오지만,
 * 그 비는 **머리(런치)와 꼬리(정리) 여유를 스텝 구간에 골고루 뿌리는 짓**이다.
 * 여유는 양 끝에만 있고 가운데에는 없다 — 늘리면 가운데가 오히려 더 틀린다.
 * 그래서 **평행 이동만** 한다. 대신 `toleranceSec` 를 화면에 그대로 밝힌다.
 *
 * ## ★ 영상이 여러 개면 이 매핑은 첫 번째 영상의 것이다
 * Playwright 는 **context 당 영상 1개**를 남긴다. 한 spec 에 `test()` 가 여럿이면
 * 영상도 여럿이고, 화면은 그중 하나만 튼다(`artifacts.find(type==="video")`).
 * 그때 2번째 테스트의 스텝들은 이 영상 안에 **존재하지 않는다** — 그래서
 * 영상 길이를 넘는 스텝은 마지막 구간으로 clamp 되고, 그 사실도 §3 에 적었다.
 * ════════════════════════════════════════════════════════════════════
 */

/**
 * 영상 0초 ↔ 첫 스텝 시작 사이의 실측 간격(초).
 *
 * **음수다** — 영상의 첫 프레임이 첫 스텝(`page.goto`)보다 약 0.1초 **늦게** 찍힌다.
 * BrowserContext 생성 직후에는 아직 그릴 것이 없어 첫 프레임이 곧바로 나오지 않기 때문이다.
 *
 * ★ 지어낸 값이 아니다. 알려진 시점에 화면을 단색으로 칠하는 시나리오를 돌리고
 *   **영상 픽셀에서 그 색이 나타난 시각**을 0.1초 간격으로 찾아 맞춘 값이다
 *   (표본 3건 · 잔차 최대 0.19초). 측정 방법과 원본 수치는 12-step-sync.md §3.
 */
export const VIDEO_LEAD_SEC = -0.1;

/**
 * 화면에 밝히는 **오차 범위(초)**.
 *
 * 로컬 실측 잔차는 0.2초 이내였지만 **1초로 넓혀 말한다.** 재 보지 않은 조건이 있기
 * 때문이다 — docker 격리 모드(CDP 중계가 한 홉 더 붙는다) · 부하가 걸린 머신 ·
 * 한 spec 에 `test()` 가 여럿인 실행(위 주석의 "영상이 여러 개면"). 좁게 약속했다가
 * 넘기는 것보다 넓게 약속하고 지키는 편이 낫다.
 *
 * 이 숫자는 장식이 아니라 **사용자에게 하는 약속의 폭**이다. 스텝을 눌렀을 때
 * 영상이 이만큼은 어긋날 수 있다고 미리 말해 둔다 — 엉뚱한 데로 가는 것보다
 * "대략 이 근처"라고 말해 주는 편이 낫다.
 */
export const VIDEO_TOLERANCE_SEC = 1;

export type StepSpan = {
  readonly sequence: number;
  /** 영상 기준 이 스텝이 시작하는 시각(초). */
  readonly startSec: number;
  /** 영상 기준 이 스텝이 끝나는 시각(초). 다음 스텝의 `startSec` 와 맞닿는다. */
  readonly endSec: number;
};

export type VideoTimeline = {
  readonly spans: readonly StepSpan[];
  /** 영상 길이(초). */
  readonly durationSec: number;
  /** 화면에 밝힐 오차(초). */
  readonly toleranceSec: number;
};

/**
 * 지금 **실행 중인**(또는 마지막으로 실행된) 스텝의 `sequence`.
 *
 * `running` 이 여러 개일 수 있다(테스트 경계에서 이전 스텝의 `finished` 가 늦게 올 때).
 * 그때는 **뒤에서부터** 찾는다 — 사용자가 보고 싶은 것은 언제나 가장 최근이다.
 */
export function liveActiveSequence(run: RunDetail): number | null {
  const running = [...run.steps].reverse().find((step) => step.status === "running");
  return (running ?? run.steps.at(-1))?.sequence ?? null;
}

/** `sequence` 로 스텝을 찾는다. 목록은 정렬을 보장하지 않으므로 선형 탐색이다. */
export function findStep(
  steps: readonly StepResult[],
  sequence: number | null,
): StepResult | undefined {
  if (sequence === null) return undefined;
  return steps.find((step) => step.sequence === sequence);
}

/**
 * 스텝 목록 + 영상 길이 → 구간표.
 *
 * `videoDurationSec` 가 아직 없으면(메타데이터 로드 전) `null` 이다 — **길이를 모르는
 * 채로 구간을 만들지 않는다.** 마지막 스텝의 끝을 어디로 둘지 정할 수 없고,
 * 모르는 값을 0 으로 채우면 전 구간이 0초로 무너진다.
 */
export function buildVideoTimeline(
  steps: readonly StepResult[],
  videoDurationSec: number | undefined,
): VideoTimeline | null {
  if (videoDurationSec === undefined) return null;
  if (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0) return null;

  const timed = [...steps]
    .filter((step) => step.startedAt !== null)
    .sort((a, b) => a.sequence - b.sequence);
  if (timed.length === 0) return null;

  const first = timed[0];
  if (first === undefined) return null;
  const originMs = Date.parse(first.startedAt ?? "");
  if (Number.isNaN(originMs)) return null;

  const raw = timed.map((step) => {
    const atMs = Date.parse(step.startedAt ?? "");
    return {
      sequence: step.sequence,
      startSec: Number.isNaN(atMs) ? 0 : (atMs - originMs) / 1000 + VIDEO_LEAD_SEC,
    };
  });

  const spans: StepSpan[] = raw.map((entry, index) => {
    /*
     * 끝은 **다음 스텝의 시작**이다 — `durationMs` 를 쓰면 스텝 사이의 빈 시간
     * (Playwright 내부 대기 · 단정문 재시도)이 어느 구간에도 속하지 않아,
     * 그 구간을 재생하는 동안 강조가 통째로 꺼진다.
     */
    const next = raw[index + 1];
    const endSec = next === undefined ? videoDurationSec : next.startSec;
    return {
      sequence: entry.sequence,
      startSec: clamp(index === 0 ? 0 : entry.startSec, 0, videoDurationSec),
      endSec: clamp(endSec, 0, videoDurationSec),
    };
  });

  return { spans, durationSec: videoDurationSec, toleranceSec: VIDEO_TOLERANCE_SEC };
}

/**
 * 영상의 어느 시각에 해당하는 스텝 `sequence`.
 *
 * 구간은 `[startSec, endSec)` 이고 **마지막 구간만 끝을 포함한다**(영상 끝까지 재생하면
 * 마지막 스텝이 강조된 채로 멈춘다 — 강조가 사라지면 "고장났다"로 읽힌다).
 */
export function stepAtVideoTime(
  timeline: VideoTimeline | null,
  atSec: number,
): number | null {
  if (timeline === null || timeline.spans.length === 0) return null;

  const spans = timeline.spans;
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first === undefined || last === undefined) return null;
  if (atSec < first.startSec) return first.sequence;

  for (const [index, span] of spans.entries()) {
    const isLast = index === spans.length - 1;
    if (atSec >= span.startSec && (isLast ? atSec <= span.endSec : atSec < span.endSec)) {
      return span.sequence;
    }
  }
  return last.sequence;
}

/**
 * 스텝을 눌렀을 때 영상을 어디로 보낼 것인가.
 *
 * 구간의 **시작**으로 보낸다. 가운데로 보내면 "그 스텝이 시작하는 장면"을 놓치는데,
 * 사용자가 스텝을 누르는 이유는 대개 그 장면을 보려는 것이다.
 */
export function videoTimeForStep(
  timeline: VideoTimeline | null,
  sequence: number,
): number | null {
  if (timeline === null) return null;
  const span = timeline.spans.find((entry) => entry.sequence === sequence);
  return span === undefined ? null : span.startSec;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
