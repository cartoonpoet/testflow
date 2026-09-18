import { MAX_DETECTED_VARIABLES, isSecretVariableKey } from "@testflow/contracts";

/**
 * 실행 변수 입력값을 **시나리오별로 브라우저에 기억**한다.
 *
 * ════════════════════════════════════════════════════════════════════
 * ★★ **비밀값은 저장하지 않는다.** ★★
 *
 * `isSecretVariableKey(key)` 가 true 인 키는 **값을 언제나 빈 문자열로** 적는다.
 * 키 **이름**은 남긴다 — 직접 추가한 `admin_token` 같은 칸이 다음에도 뜨게 하기 위해서이고,
 * 이름 자체는 비밀이 아니다(이미 코드 본문·스텝에 평문으로 들어 있다).
 *
 * 이 규칙은 `toStorableVariables()` **한 곳**에만 있고 저장 경로는 그 함수를 반드시 지난다.
 * `run-variable-memory.spec.ts` 가 "평문이 결과에 없다"를 고정한다.
 * ════════════════════════════════════════════════════════════════════
 *
 * ## 왜 기억하나
 * 계정 3쌍(6칸)을 쓰는 시나리오를 매 실행마다 손으로 다시 치는 것은 실질적으로
 * "UI 로는 못 돌린다"와 같다(#19 의 출발점). 비밀이 아닌 값
 * (`projectName` · `lawyer_email` 같은 것)만 채워 두면 남는 것은 비밀번호뿐이다.
 *
 * ## 왜 localStorage 인가 (서버가 아니라)
 * `runs` 에 `variables` 컬럼을 두지 않은 결정(02-context (c))을 깨지 않기 위해서다.
 * 값은 여전히 **서버 어디에도 저장되지 않는다.** 여기 남는 것은 그 브라우저 안의
 * 비밀 아닌 편의값뿐이고, 사용자가 브라우저 데이터를 지우면 함께 사라진다.
 */

/** `localStorage` 키 접두사. 뒤에 `scenarioId` 가 붙는다. */
export const RUN_VARIABLE_MEMORY_PREFIX = "testflow.runVariables.v1.";

/** 저장 1건. `custom` 은 "감지된 것이 아니라 사용자가 직접 추가했다"는 뜻이다. */
export type StoredRunVariable = {
  key: string;
  /** ★ 비밀 키면 **언제나 빈 문자열**이다. */
  value: string;
  custom: boolean;
};

/** 값 길이 상한. `CreateRunRequestSchema.variables` 의 값 상한과 같은 값이다. */
const MAX_VALUE_LENGTH = 2000;

export function memoryKey(scenarioId: string): string {
  return `${RUN_VARIABLE_MEMORY_PREFIX}${scenarioId}`;
}

/**
 * 저장 직전 변환 — **순수 함수**. 저장 경로는 반드시 여기를 지난다.
 *
 * - 비밀 키의 값 → `""`
 * - 빈 키는 버린다(직접 추가하다 만 행)
 * - 같은 키가 겹치면 뒤엣것이 이긴다(직접 추가가 감지분을 덮어쓴다)
 * - 개수·길이 상한을 건다(localStorage 를 무한정 먹지 않게)
 */
export function toStorableVariables(
  entries: readonly { key: string; value: string; custom?: boolean }[],
): StoredRunVariable[] {
  const byKey = new Map<string, StoredRunVariable>();
  for (const entry of entries) {
    const key = entry.key.trim();
    if (key === "" || key.length > 100) continue;
    byKey.set(key, {
      key,
      value: isSecretVariableKey(key) ? "" : entry.value.slice(0, MAX_VALUE_LENGTH),
      custom: entry.custom === true,
    });
  }
  return [...byKey.values()].slice(0, MAX_DETECTED_VARIABLES);
}

/** 읽은 JSON 을 믿지 않는다 — 손으로 고친 값·구버전이 들어와도 빈 배열로 떨어진다. */
export function parseStoredVariables(raw: string | null): StoredRunVariable[] {
  if (raw === null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: StoredRunVariable[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const key = typeof record["key"] === "string" ? record["key"] : "";
    if (key === "") continue;
    out.push({
      key,
      // ★ 읽을 때도 비밀 키는 값을 버린다. 저장 시점 규칙이 바뀌었거나
      //   누군가 손으로 넣어 둔 평문이 화면에 되살아나지 않게 한다.
      value:
        isSecretVariableKey(key) || typeof record["value"] !== "string"
          ? ""
          : (record["value"] as string).slice(0, MAX_VALUE_LENGTH),
      custom: record["custom"] === true,
    });
  }
  return out.slice(0, MAX_DETECTED_VARIABLES);
}

/**
 * 읽기. **절대 던지지 않는다** — 시크릿 모드·저장소 차단에서 다이얼로그가 통째로
 * 깨지면 안 된다(기억은 편의 기능이고 실행의 전제가 아니다).
 */
export function loadRememberedVariables(scenarioId: string | undefined): StoredRunVariable[] {
  if (scenarioId === undefined || scenarioId === "") return [];
  try {
    return parseStoredVariables(window.localStorage.getItem(memoryKey(scenarioId)));
  } catch {
    return [];
  }
}

/** 쓰기. 역시 던지지 않는다(quota 초과 등). */
export function rememberVariables(
  scenarioId: string | undefined,
  entries: readonly { key: string; value: string; custom?: boolean }[],
): void {
  if (scenarioId === undefined || scenarioId === "") return;
  const storable = toStorableVariables(entries);
  try {
    if (storable.length === 0) {
      window.localStorage.removeItem(memoryKey(scenarioId));
      return;
    }
    window.localStorage.setItem(memoryKey(scenarioId), JSON.stringify(storable));
  } catch {
    /* 저장 실패는 조용히 넘어간다 — 실행 자체에는 영향이 없다. */
  }
}
