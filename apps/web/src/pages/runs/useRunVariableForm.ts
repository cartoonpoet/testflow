import { useCallback, useMemo, useState } from "react";
import { isSecretVariableKey, variablePrefillValue, type RunVariable } from "@testflow/contracts";
import { loadRememberedVariables, rememberVariables } from "./run-variable-memory";

/**
 * 실행 다이얼로그의 **변수 칸 상태**를 한곳에 모은 훅.
 *
 * ## `useEffect` 를 쓰지 않는다
 * 감지 결과(`detected`)는 다이얼로그가 열린 뒤 **늦게 도착**한다. 그때 state 를 다시
 * 채우려면 effect 가 필요해지고, 그러면 사용자가 이미 친 글자를 덮어쓰는 경합이 생긴다.
 *
 * 대신 **값과 칸 목록을 분리**했다:
 *  - `values` 는 마운트 시점에 localStorage 로 한 번 초기화된다(동기 · `useState` 초기화 함수).
 *  - 어떤 칸을 **그릴지**는 `detected` 가 정하고, 그 칸의 값은 언제나 `values[key] ?? ""` 다.
 *  → 감지가 늦게 와도 칸이 뜨는 순간 기억해 둔 값이 이미 들어 있다. effect 가 필요 없다.
 *
 * ## ★ 라운드 11 — 코드의 기본값을 **칸에 채운다**(자동 바인딩)
 *
 * 라운드 10 은 기본값을 placeholder 로만 알렸다. "그럼 그냥 실제 값을 채워 달라" 가
 * 사용자의 요구다. 여기서도 **effect 를 쓰지 않는다** — 값을 state 에 미리 밀어 넣는
 * 대신, **읽을 때 겹쳐 본다**:
 *
 * ```
 * valueOf(key) = values[key] ?? prefill(key) ?? ""
 * ```
 *
 * `values[key]` 는 **사람이 만진 흔적**(기억해 둔 값 · 이번에 친 글자)이고,
 * `prefill(key)` 는 **코드가 말한 값**이다. 사람이 만진 적이 없을 때만 코드가 이긴다.
 * 감지가 늦게 도착해도 칸이 뜨는 순간 값이 들어 있다(라운드 9·10 과 같은 성질).
 *
 * ★ 칸을 **지운 것**(`values[key] === ""`)과 **만진 적이 없는 것**(`undefined`)은 다르다.
 *   `??` 는 빈 문자열을 통과시키므로 지운 칸은 빈 채로 남는다 — 의도한 동작이다.
 *
 * ## 기억
 * 제출 시 `rememberVariables()` 를 부른다. **비밀값은 그 함수가 언제나 버린다**
 * (`run-variable-memory.ts` 머리 주석).
 *
 * ★ 라운드 11 — **코드의 기본값과 같은 값은 기억하지 않는다.** 기억해 두면 나중에
 *   코드의 기본값이 바뀌었을 때 브라우저에 남은 **옛 값이 조용히 새 기본값을 덮는다**
 *   (사용자는 자기가 그 값을 고른 적이 없는데도). 기억에는 **사용자가 기본값과 다르게
 *   고른 값만** 남기고, 같은 값은 매번 코드에서 다시 읽는다.
 *   (읽을 때 비교하는 방법도 있지만, 그러면 기본값이 바뀐 순간 "기억한 옛 값 ≠ 새 기본값"
 *   이 되어 옛 값이 이긴다 — 막으려던 바로 그 경우를 못 막는다.)
 */

/** 직접 추가한 변수 1행. `id` 는 키 이름을 고치는 중에도 행이 흔들리지 않게 하는 용도다. */
export type CustomVariableRow = { id: number; key: string; value: string };

export type RunVariableForm = {
  /** 감지분 + 직접 추가분을 합쳐 실제로 그릴 칸 목록. */
  fields: readonly RunVariable[];
  customs: readonly CustomVariableRow[];
  /** 칸에 실제로 보이는 값 — 사람이 만진 값이 없으면 **코드의 기본값**이다. */
  valueOf: (key: string) => string;
  setValue: (key: string, value: string) => void;
  /**
   * ★ 라운드 11 — 지금 값이 **코드의 기본값 그대로인가**(= 사용자가 고르지 않았는가).
   *
   * 접힌 줄의 「직접 입력한 값 N개」 배지가 이것으로 센다. 자동 바인딩 뒤에는
   * "값이 들어 있다"가 더 이상 "사용자가 넣었다"를 뜻하지 않는다.
   */
  isCodeDefault: (key: string) => boolean;
  /**
   * ★ 라운드 10 — 이 칸을 **지금 비밀로 다룰 것인가**.
   *
   * `isSecretVariableKey()` 가 판정한 결과에서, 사용자가 「비밀 아님」으로 직접 푼 칸만
   * 빠진다. **자동 판정은 그대로다**(`run-variable-memory.ts` 머리 주석).
   * 마스킹 여부(`type="password"`)·저장 제외·제출 후 비우기가 모두 이 한 함수를 본다.
   */
  isSecretField: (key: string) => boolean;
  /** 사용자가 그 칸을 「비밀 아님」으로 풀었는가. */
  isPlain: (key: string) => boolean;
  /** 「비밀 아님」 ↔ 되돌리기. 되돌릴 때는 그때까지 친 값을 **버린다**(평문을 남기지 않는다). */
  togglePlain: (key: string) => void;
  addCustom: () => void;
  patchCustom: (id: number, patch: Partial<Omit<CustomVariableRow, "id">>) => void;
  removeCustom: (id: number) => void;
  /** 실행 요청에 실을 `variables`. **빈 값은 넣지 않는다.** */
  collect: () => Record<string, string>;
  /** 제출 직후 호출 — 비밀이 아닌 값만 브라우저에 남긴다. */
  remember: () => void;
  /** 제출 후 비밀 칸을 비운다(폼에 평문을 남기지 않는다). */
  clearSecrets: () => void;
};

export function useRunVariableForm(params: {
  /** 변수를 기억할 대상. 다중 선택·스위트 실행이면 `undefined`(기억하지 않는다). */
  scenarioId: string | undefined;
  /** 서버가 원본에서 찾아낸 변수. 아직 안 왔으면 빈 배열. */
  detected: readonly RunVariable[];
  /** 감지 0개(또는 감지 불가)일 때 보여 줄 기본 칸. 지금까지의 「계정」·「비밀번호」다. */
  fallbackKeys: readonly string[];
}): RunVariableForm {
  const { scenarioId, detected, fallbackKeys } = params;

  const remembered = useMemo(() => loadRememberedVariables(scenarioId), [scenarioId]);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const item of remembered) initial[item.key] = item.value;
    return initial;
  });

  const [customs, setCustoms] = useState<CustomVariableRow[]>(() =>
    remembered
      .filter((item) => item.custom)
      .map((item, index) => ({ id: index, key: item.key, value: item.value })),
  );
  const [nextId, setNextId] = useState(() => remembered.length + 1);

  /** 사용자가 「비밀 아님」으로 푼 키들. 기억해 둔 것으로 초기화한다(매번 다시 누르지 않게). */
  const [plainKeys, setPlainKeys] = useState<ReadonlySet<string>>(
    () => new Set(remembered.filter((item) => item.plain).map((item) => item.key)),
  );

  /**
   * ★ 감지분은 **객체 그대로** 쓴다(키만 뽑아 다시 만들지 않는다) —
   *   `defaultValue` 가 여기서 떨어지면 화면이 필수/선택을 가를 근거를 잃는다.
   *   감지가 0개일 때의 기본 칸은 **기본값 없음**이다(계정·비밀번호는 넣어야 한다).
   */
  const fields = useMemo<RunVariable[]>(() => {
    if (detected.length > 0) return [...detected];
    return fallbackKeys.map((key) => ({
      key,
      isSecret: isSecretVariableKey(key),
      /*
       * ★ 감지 0개일 때의 기본 칸은 **코드가 무엇을 선언했는지 모른다**(읽을 코드가
       *   없거나 대상이 하나가 아니다). `required` 는 "코드가 선언했다"는 뜻이므로
       *   거짓으로 두고, 기본값이 없다는 사실(`null`)만으로 필수가 된다 — 결과는
       *   지금까지와 같다(계정·비밀번호가 언제나 보인다).
       */
      required: false,
      defaultValue: null,
    }));
  }, [detected, fallbackKeys]);

  /**
   * 키 → **코드가 말한 값**. 채우면 안 되는 기본값(잘림 · 템플릿 · 필수 칸)은
   * 아예 들어오지 않는다 — 그 판정은 `variablePrefillValue()` 한 곳에 있다.
   */
  const prefills = useMemo(() => {
    const map = new Map<string, string>();
    for (const field of fields) {
      const value = variablePrefillValue(field);
      if (value !== null) map.set(field.key, value);
    }
    return map;
  }, [fields]);

  const valueOf = useCallback(
    (key: string) => values[key] ?? prefills.get(key) ?? "",
    [prefills, values],
  );

  const isCodeDefault = useCallback(
    (key: string) => (values[key] ?? prefills.get(key) ?? "") === (prefills.get(key) ?? ""),
    [prefills, values],
  );

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isPlain = useCallback((key: string) => plainKeys.has(key), [plainKeys]);

  const isSecretField = useCallback(
    (key: string) => isSecretVariableKey(key) && !plainKeys.has(key),
    [plainKeys],
  );

  const togglePlain = useCallback((key: string) => {
    setPlainKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // ★ 토글하면 값을 비운다. 「비밀 아님」으로 풀어 둔 칸을 다시 잠글 때
    //   그때까지 친 평문이 화면·기억에 남으면 안 되고, 반대 방향에서도
    //   가려진 채 친 값이 갑자기 평문으로 드러나면 안 된다.
    setValues((prev) => ({ ...prev, [key]: "" }));
  }, []);

  const addCustom = useCallback(() => {
    setCustoms((prev) => [...prev, { id: nextId, key: "", value: "" }]);
    setNextId((prev) => prev + 1);
  }, [nextId]);

  const patchCustom = useCallback(
    (id: number, patch: Partial<Omit<CustomVariableRow, "id">>) => {
      setCustoms((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    },
    [],
  );

  const removeCustom = useCallback((id: number) => {
    setCustoms((prev) => prev.filter((row) => row.id !== id));
  }, []);

  /**
   * ★ **빈 값은 키째로 빼고 보낸다** (지금까지의 계정·비밀번호 동작 그대로다).
   *   코드 시나리오는 `process.env[…] ?? "기본값"` 이 살아나고, 녹화 시나리오는
   *   `VariableResolutionError` 로 **어느 키가 없는지** 분명하게 실패한다.
   *   빈 문자열을 보내면 녹화 쪽이 조용히 빈 값을 입력하고 엉뚱한 곳에서 실패한다.
   *
   * ★ 라운드 11 — 채워진 기본값은 **그대로 실려 나간다**(보이는 것이 곧 보내는 것이다).
   *   결과는 같다: 보내면 `process.env[…]` 에 그 값이 들어가고, 안 보내면 코드의
   *   `?? "그 값"` 이 살아난다. **같은 값**이 쓰인다.
   *   채울 수 없는 기본값(템플릿 · 잘린 값)은 칸이 비어 있으므로 예전처럼 전달되지 않는다 —
   *   즉 "잘린 값이 전송될" 경로가 존재하지 않는다.
   */
  const collect = useCallback((): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.key] ?? prefills.get(field.key) ?? "";
      if (value !== "") out[field.key] = value;
    }
    for (const row of customs) {
      const key = row.key.trim();
      if (key === "" || row.value === "") continue;
      out[key] = row.value;
    }
    return out;
  }, [customs, fields, prefills, values]);

  const remember = useCallback(() => {
    rememberVariables(scenarioId, [
      /*
       * ★ 라운드 11 — **코드의 기본값과 같은 값은 기억하지 않는다.** 거르는 것은
       *   `toStorableVariables()` 다 — 저장 규칙(비밀값 버리기 포함)을 한곳에 모아 둔
       *   그 함수를 지나야 규칙이 두 벌이 되지 않는다. 여기서는 **코드가 말한 값**을
       *   같이 실어 줄 뿐이다.
       */
      ...fields.map((field) => ({
        key: field.key,
        value: values[field.key] ?? prefills.get(field.key) ?? "",
        custom: false,
        plain: plainKeys.has(field.key),
        codeDefault: prefills.get(field.key) ?? null,
      })),
      /*
       * ★ 직접 추가한 변수에는 `plain` 을 **주지 않는다.** 그 칸에는 토글도 없다 —
       *   코드에 평문 기본값이 있다는 근거가 없으니 오탐인지 진짜 비밀인지 알 수 없다.
       */
      ...customs.map((row) => ({ key: row.key, value: row.value, custom: true })),
    ]);
  }, [customs, fields, plainKeys, prefills, scenarioId, values]);

  const clearSecrets = useCallback(() => {
    setValues((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        // ★ 「비밀 아님」으로 푼 칸은 비우지 않는다 — 그러지 않으면 기억해 둔 값이
        //   제출 직후 사라져 "왜 매번 다시 쳐야 하나" 가 그대로 남는다.
        if (isSecretVariableKey(key) && !plainKeys.has(key)) next[key] = "";
      }
      return next;
    });
    setCustoms((prev) =>
      prev.map((row) => (isSecretVariableKey(row.key) ? { ...row, value: "" } : row)),
    );
  }, [plainKeys]);

  return {
    fields,
    customs,
    valueOf,
    setValue,
    isCodeDefault,
    isSecretField,
    isPlain,
    togglePlain,
    addCustom,
    patchCustom,
    removeCustom,
    collect,
    remember,
    clearSecrets,
  };
}
