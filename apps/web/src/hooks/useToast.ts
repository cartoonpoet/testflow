import { useSyncExternalStore } from "react";

/** 시안 toast 는 2.2초 후 자동 소멸한다. */
export const TOAST_DURATION_MS = 2200;

export type ToastTone = "default" | "danger";

export type ToastItem = {
  readonly id: number;
  /** 강조 라벨 (시안 `.toast b` — brand 계열 색). */
  readonly label?: string;
  readonly message: string;
  readonly tone: ToastTone;
};

/**
 * 모듈 레벨 외부 스토어.
 *
 * Provider·Context 없이 `useSyncExternalStore` 로 구독한다.
 * 자동 소멸 타이머도 여기서 건다 — 컴포넌트 `useEffect` 에 두면
 * StrictMode 이중 마운트에서 타이머가 두 번 걸린다.
 */
let items: readonly ToastItem[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function notify(): void {
  for (const listener of listeners) listener();
}

/** React 밖(테스트·비-React 코드)에서도 구독할 수 있게 공개한다. */
export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): readonly ToastItem[] {
  return items;
}

export function dismissToast(id: number): void {
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  notify();
}

/**
 * 저장·적용·발행 등 사용자 행동 결과 알림의 단일 경로.
 * 컴포넌트 밖(이벤트 핸들러·react-query onSuccess)에서도 그냥 호출하면 된다.
 */
export function toast(
  message: string,
  options: { label?: string; tone?: ToastTone } = {},
): number {
  const id = nextId++;
  const item: ToastItem = {
    id,
    message,
    tone: options.tone ?? "default",
    ...(options.label === undefined ? {} : { label: options.label }),
  };
  items = [...items, item];
  notify();
  setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
  return id;
}

/** Toaster 전용. 화면 코드에서는 `toast()` 만 쓰면 된다. */
export function useToasts(): readonly ToastItem[] {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts);
}
