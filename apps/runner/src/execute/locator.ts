import { locatorChain } from "@testflow/contracts";
import type { LocatorBy, LocatorCandidate, LocatorTarget } from "@testflow/contracts";
import type { Frame, Locator, Page } from "playwright";

/**
 * `target_json` → Playwright `Locator` 복원 (03-phases Task 6.2).
 *
 * ## 왜 "단일 값"이 아니라 "순위 배열"인가
 * 녹화 시점에 만든 Locator 하나만 저장하면 화면이 조금만 바뀌어도 재생이 깨진다.
 * `injected.ts` 가 role → label → text → testid → css 순으로 **후보 배열**을 만들어 두고
 * (02-context "Locator 생성 로직"), 여기서 **순서대로 시도**한다.
 *
 * ## `resolvedBy` 를 기록하는 이유
 * primary 가 아니라 3번째 fallback 으로 풀렸다면 그 스텝은 **불안정하다**는 신호다.
 * 나중에 "이 스텝은 화면 변경에 취약하다"를 테스터에게 알려 주려면 지금 남겨야 한다.
 *
 * ## 타임아웃 예산을 후보 수로 나누지 않는다
 * 후보마다 `timeoutMs` 를 통째로 쓰면 5후보 × 10초 = 50초가 된다. 대신 **전체 예산 하나**를
 * 두고 후보 전체를 짧은 주기로 돌아가며 폴링한다(`count()` 는 대기 없이 즉답한다).
 * 요소가 늦게 나타나는 경우도, 첫 후보가 영영 안 맞는 경우도 같은 상한 안에서 끝난다.
 */

/** 후보 1개를 시도한 결과(진단용). */
export interface LocatorAttempt {
  /** 0 = primary, 1.. = `fallbacks[index-1]` */
  index: number;
  by: LocatorBy;
  /** 매칭된 요소 수. 조회 자체가 실패했으면 null. */
  matched: number | null;
  /** 조회가 예외로 끝난 경우의 사유(짧게). */
  error?: string;
}

export interface ResolvedLocator {
  locator: Locator;
  candidate: LocatorCandidate;
  /** 0 = primary. */
  index: number;
  /** ★ 어느 후보로 풀렸는가. `"primary"` 또는 `"fallback[0]"` … */
  resolvedBy: string;
  /** 후보의 종류(`role`/`label`/…). "불안정한 스텝" 판정의 주 신호. */
  by: LocatorBy;
  /** primary 가 아니면 true. */
  usedFallback: boolean;
  attempts: LocatorAttempt[];
  elapsedMs: number;
}

export class LocatorResolutionError extends Error {
  constructor(
    message: string,
    readonly attempts: LocatorAttempt[],
  ) {
    super(message);
    this.name = "LocatorResolutionError";
  }
}

/** 후보 전체를 한 바퀴 도는 간격. */
const POLL_INTERVAL_MS = 120;

/** 후보 1개의 `count()` 에 거는 상한(페이지가 멈춰 있어도 루프가 살아 있게). */
const COUNT_TIMEOUT_MS = 1500;

export function describeCandidate(candidate: LocatorCandidate): string {
  const nth = candidate.nth === undefined ? "" : `[nth=${String(candidate.nth)}]`;
  if (candidate.by === "role") {
    const name = candidate.name === undefined ? "" : ` name="${candidate.name}"`;
    return `role=${candidate.role}${name}${nth}`;
  }
  return `${candidate.by}="${candidate.value}"${nth}`;
}

/** `frameUrl` 이 있으면 그 frame, 없으면 page 자체가 탐색 뿌리다. */
export function resolveSearchRoot(page: Page, target: LocatorTarget): Page | Frame {
  const frameUrl = target.frameUrl ?? null;
  if (frameUrl === null || frameUrl === "") return page;

  const frame =
    page.frames().find((f) => f.url() === frameUrl) ??
    page.frames().find((f) => f.url().includes(frameUrl));
  // frame 을 못 찾으면 page 로 떨어뜨린다 — iframe 이 아직 안 붙었을 뿐일 수 있고,
  // 여기서 던지면 fallback 후보를 한 번도 못 써 본 채 실패한다.
  return frame ?? page;
}

/** 후보 1개 → Locator. 매칭 여부는 보지 않는다(만들기만 한다). */
export function buildLocator(root: Page | Frame, candidate: LocatorCandidate): Locator {
  const base = ((): Locator => {
    switch (candidate.by) {
      case "role":
        return root.getByRole(candidate.role as Parameters<Page["getByRole"]>[0], {
          ...(candidate.name === undefined ? {} : { name: candidate.name }),
          ...(candidate.exact === undefined ? {} : { exact: candidate.exact }),
        });
      case "label":
        return root.getByLabel(candidate.value, {
          ...(candidate.exact === undefined ? {} : { exact: candidate.exact }),
        });
      case "text":
        return root.getByText(candidate.value, {
          ...(candidate.exact === undefined ? {} : { exact: candidate.exact }),
        });
      case "testid":
        return root.getByTestId(candidate.value);
      case "css":
        return root.locator(candidate.value);
      default: {
        // 계약(`LocatorCandidateSchema`)에 종류가 늘면 여기서 컴파일 에러가 난다.
        const exhaustive: never = candidate;
        throw new Error(`알 수 없는 Locator 후보입니다: ${JSON.stringify(exhaustive)}`);
      }
    }
  })();

  return candidate.nth === undefined ? base : base.nth(candidate.nth);
}

/**
 * 후보를 순서대로 시도해 **유일하게 매칭되는** Locator 를 돌려준다.
 *
 * - `nth` 가 지정된 후보는 "여러 개 중 n 번째"가 의도이므로 매칭 1개 규칙을 적용하지 않는다.
 * - `nth` 가 없으면 **정확히 1개**여야 한다. 0개면 아직 안 나타난 것, 2개 이상이면
 *   후보가 충분히 구체적이지 않은 것 — 둘 다 다음 후보로 넘어간다.
 */
export async function resolveLocator(
  page: Page,
  target: LocatorTarget,
  timeoutMs: number,
): Promise<ResolvedLocator> {
  const chain = locatorChain(target);
  const startedAt = Date.now();
  const deadline = startedAt + Math.max(timeoutMs, POLL_INTERVAL_MS);
  let attempts: LocatorAttempt[] = [];

  for (;;) {
    const root = resolveSearchRoot(page, target);
    const pass: LocatorAttempt[] = [];

    for (const [index, candidate] of chain.entries()) {
      const attempt: LocatorAttempt = { index, by: candidate.by, matched: null };
      try {
        const locator = buildLocator(root, candidate);
        if (candidate.nth !== undefined) {
          // nth 는 "여러 개 중 하나를 고른다"는 의도다. 존재만 확인한다.
          const exists = (await locator.count()) > 0;
          attempt.matched = exists ? 1 : 0;
          if (exists) return success(locator, candidate, index, [...attempts, ...pass], startedAt);
        } else {
          const count = await withTimeout(locator.count(), COUNT_TIMEOUT_MS);
          attempt.matched = count;
          if (count === 1) return success(locator, candidate, index, [...attempts, ...pass], startedAt);
        }
      } catch (error) {
        attempt.error = shortMessage(error);
      }
      pass.push(attempt);
    }

    attempts = pass;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }

  throw new LocatorResolutionError(
    `대상 요소를 찾지 못했습니다(${String(timeoutMs)}ms). 시도한 후보: ${chain
      .map((candidate, index) => {
        const matched = attempts[index]?.matched;
        const suffix = matched === null || matched === undefined ? "조회 실패" : `${String(matched)}개 매칭`;
        return `${describeCandidate(candidate)} → ${suffix}`;
      })
      .join(" / ")}`,
    attempts,
  );
}

function success(
  locator: Locator,
  candidate: LocatorCandidate,
  index: number,
  attempts: LocatorAttempt[],
  startedAt: number,
): ResolvedLocator {
  return {
    locator,
    candidate,
    index,
    resolvedBy: index === 0 ? "primary" : `fallback[${String(index - 1)}]`,
    by: candidate.by,
    usedFallback: index > 0,
    attempts,
    elapsedMs: Date.now() - startedAt,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("count timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 진단용 한 줄 요약. Playwright 에러는 수십 줄이라 그대로 담으면 로그가 읽히지 않는다. */
function shortMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split("\n")[0]?.slice(0, 200) ?? "unknown";
}
