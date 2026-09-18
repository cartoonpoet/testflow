import { useCallback, useMemo, useState } from "react";
import { isSecretVariableKey, type RunVariable } from "@testflow/contracts";
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
 * ## 기억
 * 제출 시 `rememberVariables()` 를 부른다. **비밀값은 그 함수가 언제나 버린다**
 * (`run-variable-memory.ts` 머리 주석).
 */

/** 직접 추가한 변수 1행. `id` 는 키 이름을 고치는 중에도 행이 흔들리지 않게 하는 용도다. */
export type CustomVariableRow = { id: number; key: string; value: string };

export type RunVariableForm = {
  /** 감지분 + 직접 추가분을 합쳐 실제로 그릴 칸 목록. */
  fields: readonly RunVariable[];
  customs: readonly CustomVariableRow[];
  valueOf: (key: string) => string;
  setValue: (key: string, value: string) => void;
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

  const fields = useMemo<RunVariable[]>(() => {
    const keys = detected.length > 0 ? detected.map((v) => v.key) : [...fallbackKeys];
    return keys.map((key) => ({ key, isSecret: isSecretVariableKey(key) }));
  }, [detected, fallbackKeys]);

  const valueOf = useCallback((key: string) => values[key] ?? "", [values]);

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
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
   */
  const collect = useCallback((): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.key] ?? "";
      if (value !== "") out[field.key] = value;
    }
    for (const row of customs) {
      const key = row.key.trim();
      if (key === "" || row.value === "") continue;
      out[key] = row.value;
    }
    return out;
  }, [customs, fields, values]);

  const remember = useCallback(() => {
    rememberVariables(scenarioId, [
      ...fields.map((field) => ({
        key: field.key,
        value: values[field.key] ?? "",
        custom: false,
      })),
      ...customs.map((row) => ({ key: row.key, value: row.value, custom: true })),
    ]);
  }, [customs, fields, scenarioId, values]);

  const clearSecrets = useCallback(() => {
    setValues((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (isSecretVariableKey(key)) next[key] = "";
      }
      return next;
    });
    setCustoms((prev) =>
      prev.map((row) => (isSecretVariableKey(row.key) ? { ...row, value: "" } : row)),
    );
  }, []);

  return {
    fields,
    customs,
    valueOf,
    setValue,
    addCustom,
    patchCustom,
    removeCustom,
    collect,
    remember,
    clearSecrets,
  };
}
