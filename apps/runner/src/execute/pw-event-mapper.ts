/**
 * Playwright reporter 원본 이벤트 → TestFlow SSE/DB 규약 변환 (03-phases Task 3.3).
 *
 * `poc/r2/map-events.ts` 승격판. PoC 와 다른 점 3가지 —
 *  1. 매핑·마스킹·필터 규칙을 **복사하지 않고** `@testflow/contracts/pw-step-title` 을 쓴다
 *     (04-gen-1 §2.4: "매핑 규칙을 복사하지 마라"). 그래서 규칙은 한 곳에서만 움직인다.
 *  2. step begin ↔ end 짝짓기를 reporter 가 붙인 **숫자 `stepId`** 로 한다
 *     (PoC 의 `testId|title` 은 같은 테스트 안에서 제목이 겹치면 어긋난다).
 *  3. SSE 봉투를 여기서 만들지 않는다. **"무엇을 해야 하는가"만 돌려주고**
 *     DB 기록·`publish`·`seq` 부여는 `RunReporter` 가 한다(쟁점 2 — 공통 출구 유지).
 *
 * ## 이 모듈은 순수하다
 * I/O 도 시계도 없다(시각은 이벤트가 실어 온 `atMs` 를 쓴다). 그래서 `pw-event-mapper.spec.ts`
 * 가 **실제 reporter 출력 NDJSON** 을 그대로 먹여 회귀를 고정할 수 있다 — 03-phases 리스크 4번
 * ("Playwright 버전업 때 조용히 전부 `wait` 로 떨어진다")을 막는 유일한 장치다.
 */
import { isUserVisiblePwStep, stripStepValue, toActionType } from "@testflow/contracts";
import type { ActionType, RunStatus, StepResultStatus } from "@testflow/contracts";

/** reporter 가 NDJSON 으로 보내는 원본 이벤트. 키 집합은 `pw-reporter.ts` 가 정한다. */
export interface PwReporterEvent {
  readonly kind: string;
  readonly atMs: number;
  readonly [key: string]: unknown;
}

/**
 * Playwright `FullResult.status` → `runs.status`.
 *
 * `interrupted`(SIGTERM 으로 끊김) 와 `skipped`(실행할 테스트가 없었다) 는 둘 다
 * "시나리오가 틀렸다"가 아니므로 `cancelled` 다 — `failed` 로 기록하면 성공률 통계가 왜곡된다.
 */
export const PW_RESULT_TO_RUN_STATUS: Readonly<Record<string, RunStatus>> = {
  passed: "passed",
  failed: "failed",
  timedout: "timeout",
  timedOut: "timeout",
  interrupted: "cancelled",
  skipped: "cancelled",
};

/**
 * ★ 실행 환경 오류의 표식 — "시나리오 실패"가 아니라 `run.status = error` 다
 *   (04-gen-6 결정 6번의 구분을 코드 경로에서도 유지한다).
 *
 * Playwright 는 spec 파일 **로드 실패**(허용 목록 밖 import 가 저장 검증을 우회해 들어온 경우)도
 * `onError` + `FullResult.status = "failed"` 로 보고한다. 그대로 믿으면 "테스트가 실패했다"가 되어
 * 사용자는 자기 단정문을 의심하게 된다. 실제 원인은 **모듈을 못 찾은 것**이다.
 */
const ENV_ERROR_PATTERNS: readonly RegExp[] = [
  /ERR_MODULE_NOT_FOUND/,
  /Cannot find module/i,
  /Cannot find package/i,
  /ERR_REQUIRE_ESM/,
  /ERR_UNSUPPORTED_DIR_IMPORT/,
  /no tests found/i,
];

export function isEnvironmentErrorMessage(message: string): boolean {
  return ENV_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * ★ ANSI 색상 escape 를 벗긴다.
 *
 * 실측 발견: `FORCE_COLOR=0` · `CI=1` 을 줘도 **Playwright 의 `expect` 실패 메시지에는
 * 색상 코드가 그대로 실려 온다** (`Error: [2mexpect([22m…`). 그대로 DB 에 넣으면
 * 웹 화면에 `[2m` 이 글자로 보인다(터미널이 아니므로 해석되지 않는다).
 * 그래서 **DB 쓰기 전에** 벗긴다 — 마스킹과 같은 위치·같은 이유다.
 */
/**
 * `\u001b[` + 숫자/세미콜론 + `m`.
 *
 * ★ ESC(`\u001b`)를 반드시 포함한다. 빼면 `items[12]meta` 같은 **평범한 텍스트**까지 지운다
 *   (spec 이 그 대조군을 고정한다). `no-control-regex` 는 "제어문자를 실수로 넣었다"를
 *   잡는 규칙인데 여기서는 **의도**다 — ANSI escape 를 지우는 것이 목적이다.
 */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/* ── 변환 결과 ────────────────────────────────────────────── */

export interface MappedRunBegin {
  readonly kind: "run-begin";
  readonly totalTests: number;
  readonly workers: number;
}

export interface MappedStepStarted {
  readonly kind: "step-started";
  readonly sequence: number;
  /** **이미 마스킹된** 제목(`stripStepValue`). 값 기반 마스킹은 `RunReporter` 가 한 번 더 한다. */
  readonly name: string;
  readonly actionType: ActionType;
  /** 지금까지 발견한 스텝 수. **실행 중에 증가한다**(쟁점 2 — 계약은 안 바꾼다). */
  readonly totalSteps: number;
  readonly atMs: number;
}

export interface MappedStepFinished {
  readonly kind: "step-finished";
  readonly sequence: number;
  readonly name: string;
  readonly actionType: ActionType;
  readonly status: StepResultStatus;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly errorMessage: string | null;
  readonly atMs: number;
}

export interface MappedRunError {
  readonly kind: "run-error";
  readonly message: string;
  /** `true` 면 최종 status 를 `error` 로 확정한다(시나리오 실패가 아니다). */
  readonly environmental: boolean;
}

export interface MappedRunEnd {
  readonly kind: "run-end";
  readonly status: RunStatus;
  readonly durationMs: number | null;
  readonly atMs: number;
}

export type MappedAction =
  | MappedRunBegin
  | MappedStepStarted
  | MappedStepFinished
  | MappedRunError
  | MappedRunEnd;

/* ── 매퍼 ─────────────────────────────────────────────────── */

interface PendingStep {
  readonly sequence: number;
  readonly name: string;
  readonly actionType: ActionType;
  readonly startedAtMs: number;
}

/**
 * reporter 이벤트 스트림을 먹여 가며 "해야 할 일"을 뽑아내는 상태 기계.
 *
 * `sequence` 는 **사용자에게 보이는 스텝**에만 1부터 증가 부여한다 — Playwright 의
 * hook/fixture 스텝을 세면 화면의 번호가 건너뛴다.
 */
export class PwEventMapper {
  private sequence = 0;
  private readonly pending = new Map<number, PendingStep>();

  /** 발견한 사용자 스텝 총수 = `runs.total_steps` 의 현재값. */
  get totalSteps(): number {
    return this.sequence;
  }

  /** 필터에 걸러진 건수. 필터가 실제로 일하고 있는지 로그로 확인하기 위한 계수기. */
  private filteredOut = 0;

  get filteredStepCount(): number {
    return this.filteredOut;
  }

  /** 아직 끝나지 않은(= 실행 중인) 스텝의 sequence 목록. 중단 시 `skipped` 로 접는다. */
  get openSequences(): readonly number[] {
    return [...this.pending.values()].map((step) => step.sequence);
  }

  /** 이벤트 1건 → 액션 0~1건. 걸러진 이벤트는 `null` 이다. */
  accept(event: PwReporterEvent): MappedAction | null {
    switch (event.kind) {
      case "run.begin":
        return {
          kind: "run-begin",
          totalTests: numberOf(event["totalTests"]),
          workers: numberOf(event["workers"]),
        };

      case "step.begin": {
        if (!this.isVisible(event)) return null;
        const stepId = numberOf(event["stepId"]);
        // ★ 마스킹은 **DB/SSE 로 나가기 전** 여기서 한다(라운드 1 규약).
        //   `Fill "s3cr3t-pw"` → `Fill "***"`. `Expect "toHaveText"` 는 변형되지 않는다.
        const name = stripStepValue(stringOf(event["title"]));
        const actionType = toActionType(name);
        this.sequence += 1;
        this.pending.set(stepId, {
          sequence: this.sequence,
          name,
          actionType,
          startedAtMs: event.atMs,
        });
        return {
          kind: "step-started",
          sequence: this.sequence,
          name,
          actionType,
          totalSteps: this.sequence,
          atMs: event.atMs,
        };
      }

      case "step.end": {
        if (!this.isVisible(event)) return null;
        const stepId = numberOf(event["stepId"]);
        const started = this.pending.get(stepId);
        // begin 을 못 본 end 는 버린다(필터 규칙이 바뀌어도 짝이 어긋나지 않는다).
        if (started === undefined) return null;
        this.pending.delete(stepId);
        const raw = event["error"];
        // ANSI 를 먼저 벗긴다 — 뒤의 마스킹·슬라이스가 escape 를 반 토막 내지 않게.
        const errorMessage = raw === null || raw === undefined ? null : stripAnsi(stringOf(raw));
        return {
          kind: "step-finished",
          sequence: started.sequence,
          name: started.name,
          actionType: started.actionType,
          status: errorMessage === null ? "passed" : "failed",
          startedAtMs: started.startedAtMs,
          durationMs: Math.max(0, Math.trunc(numberOf(event["durationMs"]))),
          errorMessage,
          atMs: event.atMs,
        };
      }

      case "run.error": {
        const message = stripAnsi(stringOf(event["message"]));
        return {
          kind: "run-error",
          message,
          environmental: isEnvironmentErrorMessage(message),
        };
      }

      case "run.end": {
        const raw = stringOf(event["status"]);
        return {
          kind: "run-end",
          // 모르는 status 는 `error` 다 — 지어내지 않는다.
          status: PW_RESULT_TO_RUN_STATUS[raw] ?? "error",
          durationMs: Math.max(0, Math.trunc(numberOf(event["durationMs"]))),
          atMs: event.atMs,
        };
      }

      // test.begin / test.end 는 **발행하지 않는다** (r2-poc 변환표).
      default:
        return null;
    }
  }

  /**
   * ★ 필터 — `depth === 0` **AND** `category ∈ {pw:api, expect, test.step}`.
   *
   * 이걸 빼면 사용자 화면이 `Before Hooks` · `Fixture "browser"` · `Worker Cleanup` 로 도배된다
   * (PoC 실측 `step.begin` 51건 → 사용자 스텝 22건). 판정 함수는 contracts 에 있다.
   */
  private isVisible(event: PwReporterEvent): boolean {
    const visible = isUserVisiblePwStep(stringOf(event["category"]), numberOf(event["depth"]));
    if (!visible && event.kind === "step.begin") this.filteredOut += 1;
    return visible;
  }
}

/** NDJSON 한 덩어리를 이벤트 배열로. 깨진 줄은 버리고 나머지를 살린다. */
export function parseReporterNdjson(chunk: string): PwReporterEvent[] {
  const out: PwReporterEvent[] = [];
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "object" && parsed !== null && "kind" in parsed) {
        out.push(parsed as PwReporterEvent);
      }
    } catch {
      // 한 줄이 깨졌다고 나머지 진행 표시를 버리지 않는다.
    }
  }
  return out;
}

function stringOf(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function numberOf(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
