/**
 * `playwright test` 커스텀 reporter — **사용자 테스트 프로세스 안에서 돈다** (03-phases Task 3.2).
 *
 * ## ★★ 이 파일에는 의존성을 추가하지 마라
 * 이 모듈은 우리 Runner 프로세스가 아니라 **`playwright test` 프로세스가 직접 로드**한다.
 * 여기서 `@testflow/contracts` · `ioredis` · `typeorm` 을 import 하면 사용자 테스트의
 * 의존성 그래프가 오염되고(모듈 인스턴스 중복·초기화 부작용), 최악의 경우 Redis 연결이
 * 사용자 프로세스에서 열린다. (r2-poc-live-stream.md 전달사항 4번 / 03-phases Task 3.2)
 *
 * 그래서 이 파일이 하는 일은 **원본 이벤트를 NDJSON 으로 내보내는 것 하나**다.
 * SSE 규약(`step.started` 등)으로의 변환·시퀀스 부여·마스킹·DB 기록은 전부
 * Runner 쪽(`pw-event-mapper.ts` · `code-executor.ts`)의 책임이다.
 *
 * 허용된 import 는 **타입 전용**(`import type`)뿐이다 — 컴파일 후 사라지므로 런타임 그래프에
 * 아무것도 남지 않는다. `grep` 으로 확인할 수 있어야 한다(Task 3.2 완료 기준 ②).
 *
 * ## 전송 경로 — loopback HTTP POST. **stdout 을 쓰지 않는다**
 * stdout 으로 내보내면 사용자 테스트의 `console.log` 와 같은 스트림에 섞인다. 사용자가
 * JSON 처럼 보이는 문자열을 찍는 순간 우리 파서가 오염된다. 그래서 별 채널(HTTP)로 보낸다.
 *
 * ## 전송 실패는 삼킨다
 * Runner 가 먼저 죽거나 포트가 닫혀도 **사용자 테스트는 계속돼야 한다.** 진행 표시가
 * 끊기는 것과 테스트가 죽는 것은 심각도가 다르다.
 */
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

/** Runner 가 띄운 loopback 이벤트 수집 서버 URL. 없으면 아무것도 보내지 않는다. */
const EVENTS_URL = process.env["TESTFLOW_PW_EVENTS_URL"] ?? "";

/**
 * step begin ↔ end 짝짓기용 식별자.
 *
 * ★ PoC 는 `testId|title` 로 짝을 지었는데 **같은 테스트 안에서 제목이 겹치면
 *   (예: `Fill "***"` 두 번) 짝이 어긋난다.** Playwright 는 `onStepBegin` 과
 *   `onStepEnd` 에 **같은 `TestStep` 객체**를 준다 — 그 객체 정체성으로 번호를 붙이는 것이
 *   문자열 조합보다 정확하다. `WeakMap` 이라 누수도 없다.
 */
const stepIds = new WeakMap<TestStep, number>();

function depthOf(step: TestStep): number {
  let depth = 0;
  let cursor = step.parent;
  while (cursor !== undefined) {
    depth += 1;
    cursor = cursor.parent;
  }
  return depth;
}

function errorText(error: TestError | undefined): string | null {
  if (error === undefined) return null;
  const message = error.message ?? error.value ?? "";
  return message === "" ? null : message;
}

export default class TestFlowPwReporter implements Reporter {
  /** 전송 직렬화. 이벤트 순서가 뒤바뀌면 Runner 의 시퀀스 부여가 깨진다. */
  private queue: Promise<void> = Promise.resolve();
  private seq = 0;
  private nextStepId = 0;

  /**
   * 우리는 stdout 에 아무것도 쓰지 않는다. `true` 를 돌려주면 Playwright 가
   * "이 reporter 가 화면을 담당한다"고 보고 기본 출력을 접는다 — 그러면 사용자가
   * 터미널에서 실행했을 때 아무것도 안 보인다.
   */
  printsToStdio(): boolean {
    return false;
  }

  private emit(kind: string, data: Record<string, unknown>): void {
    if (EVENTS_URL === "") return;
    this.seq += 1;
    const body = `${JSON.stringify({ kind, seq: this.seq, atMs: Date.now(), ...data })}\n`;
    this.queue = this.queue.then(async () => {
      try {
        await fetch(EVENTS_URL, {
          method: "POST",
          headers: { "content-type": "application/x-ndjson" },
          body,
        });
      } catch {
        // ★ 삼킨다. Runner 가 안 받아도 사용자 테스트는 끝까지 돌아야 한다.
      }
    });
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.emit("run.begin", {
      workers: config.workers,
      totalTests: suite.allTests().length,
    });
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    // Runner 는 이것으로 SSE 를 발행하지 않는다(여러 test 를 하나의 run 으로 본다).
    // 진단용으로만 보낸다 — 어느 테스트를 돌다 멈췄는지 로그에 남아야 한다.
    this.emit("test.begin", {
      testId: test.id,
      title: test.titlePath().slice(1).join(" › "),
      workerIndex: result.workerIndex,
      retry: result.retry,
    });
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    this.nextStepId += 1;
    stepIds.set(step, this.nextStepId);
    this.emit("step.begin", {
      stepId: this.nextStepId,
      testId: test.id,
      workerIndex: result.workerIndex,
      // "pw:api" | "expect" | "test.step" | "hook" | "fixture" … — 필터는 Runner 가 한다.
      category: step.category,
      title: step.title,
      depth: depthOf(step),
    });
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep): void {
    this.emit("step.end", {
      stepId: stepIds.get(step) ?? null,
      testId: test.id,
      category: step.category,
      title: step.title,
      depth: depthOf(step),
      durationMs: step.duration,
      error: errorText(step.error),
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Runner 는 이것으로도 SSE 를 발행하지 않는다. 최종 status 는 `run.end` 집계로 간다.
    this.emit("test.end", {
      testId: test.id,
      status: result.status,
      expectedStatus: test.expectedStatus,
      durationMs: result.duration,
      error: errorText(result.error),
    });
  }

  onError(error: TestError): void {
    // 파일 로드 실패(`ERR_MODULE_NOT_FOUND` 등)가 여기로 온다. Runner 가 이 메시지로
    // "실행 환경 오류(error)" 와 "시나리오 실패(failed)" 를 가른다 — 04-gen-6 결정 6번.
    this.emit("run.error", { message: errorText(error) ?? "unknown" });
  }

  /** ★ 큐를 반환해 마지막 이벤트까지 전송이 끝난 뒤 프로세스가 내려가게 한다. */
  onEnd(result: FullResult): Promise<void> {
    this.emit("run.end", { status: result.status, durationMs: result.duration });
    return this.queue;
  }
}
