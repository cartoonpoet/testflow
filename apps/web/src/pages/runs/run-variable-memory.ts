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
 *
 * ★ 라운드 10 — **딱 하나의 예외: 사용자가 그 칸을 직접 "비밀 아님"으로 지정했을 때**
 * (`plain: true`). 자동 판정이 느슨해지는 것이 **아니다** — `SECRET_KEY_PATTERN` 도
 * `isSecretVariableKey()` 도 그대로이고, 기본값은 여전히 "저장 안 함" 이다.
 * 사람이 그 칸을 보고 명시적으로 누를 때만 열린다(다이얼로그의 「비밀 아님」).
 *
 * 왜 필요한가: `securitySecretKeyword`(검색어 `[보안]`) 같은 **오탐**이 있다.
 * 그런 칸은 가려질 이유가 없는데 매 실행마다 다시 타이핑해야 했다.
 * 왜 이것이 위험하지 않은가:
 *  - **서버 쪽 마스킹은 이 플래그를 아예 모른다.** `maskVariablesForStorage()` ·
 *    `collectSecretValues()` 는 그대로 `isSecretVariableKey()` 로 판정한다.
 *    즉 `runs.variables` 에는 계속 `***` 가 저장되고 로그에서도 계속 지워진다.
 *  - 다이얼로그는 이 토글을 **코드에 평문 기본값이 있는 칸에만** 내놓는다
 *    (`RunDialog.tsx` 의 `canMarkPlain`). 가드로 막힌 진짜 계정
 *    (`username`/`password`)에는 토글 자체가 **나타나지 않는다.**
 *  - 여기 남는 것은 그 브라우저 안의 값 하나뿐이고 서버로는 가지 않는다.
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
  /** ★ 비밀 키면 **언제나 빈 문자열**이다(`plain` 으로 직접 푼 칸만 예외). */
  value: string;
  custom: boolean;
  /** ★ 사용자가 "이 칸은 비밀이 아니다"라고 **직접** 지정했는가. 기본 `false`. */
  plain: boolean;
};

/** 값 길이 상한. `CreateRunRequestSchema.variables` 의 값 상한과 같은 값이다. */
const MAX_VALUE_LENGTH = 2000;

export function memoryKey(scenarioId: string): string {
  return `${RUN_VARIABLE_MEMORY_PREFIX}${scenarioId}`;
}

/**
 * 저장 직전 변환 — **순수 함수**. 저장 경로는 반드시 여기를 지난다.
 *
 * - 비밀 키의 값 → `""` (**사용자가 `plain` 으로 직접 푼 칸만 예외** — 머리 주석)
 * - 빈 키는 버린다(직접 추가하다 만 행)
 * - ★ 라운드 11 — **코드의 기본값과 같은 값은 버린다**(`codeDefault`)
 * - 같은 키가 겹치면 뒤엣것이 이긴다(직접 추가가 감지분을 덮어쓴다)
 * - 개수·길이 상한을 건다(localStorage 를 무한정 먹지 않게)
 *
 * ════════════════════════════════════════════════════════════════════
 * ## ★ 라운드 11 — 왜 **기본값과 같은 값은 기억하지 않나**
 *
 * 라운드 11 부터 다이얼로그는 코드의 리터럴 기본값을 **칸에 채운다.** 그러면
 * 사용자가 아무것도 안 해도 그 값이 "입력값" 으로 보이고, 그대로 저장하면
 * **코드의 기본값이 나중에 바뀌었을 때 브라우저에 남은 옛 값이 새 기본값을 조용히
 * 덮는다** — 사용자는 그 값을 고른 적이 없는데도.
 *
 * 그래서 기억에는 **사용자가 기본값과 다르게 고른 값만** 남긴다. 같은 값은 저장하지
 * 않고 매번 코드에서 다시 읽는다. 비워 둔 칸(`""`)이 기본값과 다르면 그것도 **사용자의
 * 선택**이므로 남긴다.
 *
 * 읽을 때 비교하는 방법(= "기억한 값이 현재 기본값과 다를 때만 쓴다")은 이 문제를
 * **못 막는다**: 기본값이 A→B 로 바뀌면 기억한 A 는 B 와 "다르므로" 그대로 이긴다.
 * 막으려던 바로 그 경우다. 쓰는 쪽에서 거르는 것이 맞다.
 *
 * **예외는 `plain`** — 「비밀 아님」으로 풀어 둔 칸은 값이 기본값과 같아도 남긴다.
 * 안 그러면 그 플래그까지 사라져 매 실행마다 다시 눌러야 한다(라운드 10 이 없애려던
 * 바로 그 불편이다).
 * ════════════════════════════════════════════════════════════════════
 */
export function toStorableVariables(
  entries: readonly {
    key: string;
    value: string;
    custom?: boolean;
    plain?: boolean;
    /** 코드가 말한 값. `null`/`undefined` 면 비교하지 않는다(직접 추가한 변수 등). */
    codeDefault?: string | null;
  }[],
): StoredRunVariable[] {
  const byKey = new Map<string, StoredRunVariable>();
  for (const entry of entries) {
    const key = entry.key.trim();
    if (key === "" || key.length > 100) continue;
    const plain = entry.plain === true;
    const codeDefault = entry.codeDefault ?? null;
    if (!plain && codeDefault !== null && entry.value === codeDefault) continue;
    byKey.set(key, {
      key,
      value: isSecretVariableKey(key) && !plain ? "" : entry.value.slice(0, MAX_VALUE_LENGTH),
      custom: entry.custom === true,
      plain,
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
    const plain = record["plain"] === true;
    out.push({
      key,
      // ★ 읽을 때도 비밀 키는 값을 버린다. 저장 시점 규칙이 바뀌었거나
      //   누군가 손으로 넣어 둔 평문이 화면에 되살아나지 않게 한다.
      //   `plain` 으로 **사용자가 직접 푼 칸**만 예외다(머리 주석) — 그 플래그는
      //   이 파일이 직접 쓴 것이고, 손으로 고칠 수 있는 자리라는 점에서는 값과 같다
      //   (localStorage 를 고칠 수 있는 쪽은 이미 그 브라우저를 쥐고 있다).
      value:
        (isSecretVariableKey(key) && !plain) || typeof record["value"] !== "string"
          ? ""
          : (record["value"] as string).slice(0, MAX_VALUE_LENGTH),
      custom: record["custom"] === true,
      plain,
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
  entries: readonly {
    key: string;
    value: string;
    custom?: boolean;
    plain?: boolean;
    codeDefault?: string | null;
  }[],
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
