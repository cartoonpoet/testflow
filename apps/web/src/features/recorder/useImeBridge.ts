import { useCallback, useRef } from "react";
import type * as React from "react";
import type { RecorderClientMessage } from "@testflow/contracts";

/**
 * 한글 IME 브리지 — **A안** (Task 10.7).
 *
 * ## A안이 하는 일
 * 화면에 보이지 않는 `<input>` 에 포커스를 잡아 **로컬 IME 가 거기서 조합**하게 하고,
 * `compositionend` 에서 **최종 문자열만** 꺼내 `{t:'ime', kind:'commit', text}` 로 1회 보낸다.
 * Runner 는 이것을 `Input.insertText` 한 번으로 처리한다.
 * 조합 중간 상태(`ㄱ`→`가`→`간`)는 **네트워크를 건너지 않는다** — 왕복 지연이 조합에 끼어들면
 * 자모가 깨지기 때문이다.
 *
 * ## 경로를 가르는 기준 — `isComposing`
 * - 조합 중(한글·일본어·중국어) → **IME 경로**. keydown 은 보내지 않는다.
 * - 조합 없음(영문·숫자·특수키·기능키) → **키 경로**(`{t:'key'}`). 원격에서 `keydown` 이
 *   정상 발생하므로 keydown 에 의존하는 위젯(자동완성·단축키)이 동작한다.
 *
 * Chrome 은 IME 조합 첫 키에서 `isComposing` 이 아직 false 인 채로 `keyCode 229` /
 * `key === "Process"` 를 준다. 두 가지를 같이 본다.
 *
 * ## A안의 알려진 한계 (사실 기록)
 * `Input.insertText` 는 `beforeinput`/`input` 만 발생시키고 **keydown/keypress/keyup 이 없다**
 * (`input-bridge.ts` 주석). 한글을 키 이벤트로 감지하는 위젯에서는 깨질 수 있다.
 * 그때가 **B안(`imeSetComposition` 중계) 승급** 시점이다 — 아래 `IME_BRIDGE_MODE` 를
 * `"composition"` 으로 바꾸면 이 파일은 준비돼 있지만, **Runner 의 `input-bridge.ts` 의
 * `setComposition`/`commitComposition` 이 아직 호출 시 에러를 던진다**(04-gen-3/7).
 * 그러므로 지금은 `"insert-text"` 에서 움직이면 안 된다. 정확도 정식 검증은 PoC-2(Gen-Phase 12).
 *
 * ## 비밀번호가 이 DOM 에 남지 않게 하는 법
 * 테스터가 원격 비밀번호 칸에 입력하면 그 글자가 **이 숨은 input 에도** 들어온다.
 * 조합이 끝나거나(`compositionend`) 조합 없는 입력이 들어온 직후(`input`) **값을 즉시 비운다.**
 * 그래서 DOM 에 남는 시간이 한 tick 을 넘지 않는다. `autoComplete="off"` 도 같이 건다.
 */

/** 경로 전환 플래그. B안 승급 시 이 한 줄만 바꾼다(단 Runner 쪽이 먼저 구현돼야 한다). */
export type ImeBridgeMode = "insert-text" | "composition";

/** A안 고정. `"composition"` 으로 올리려면 Runner 의 input-bridge 를 먼저 구현해야 한다. */
export const IME_BRIDGE_MODE: ImeBridgeMode = "insert-text";

/** CDP `Input.dispatchKeyEvent` 의 modifiers 비트마스크. */
const MODIFIER_ALT = 1;
const MODIFIER_CTRL = 2;
const MODIFIER_META = 4;
const MODIFIER_SHIFT = 8;

function modifiersOf(event: React.KeyboardEvent<HTMLInputElement>): number {
  return (
    (event.altKey ? MODIFIER_ALT : 0) |
    (event.ctrlKey ? MODIFIER_CTRL : 0) |
    (event.metaKey ? MODIFIER_META : 0) |
    (event.shiftKey ? MODIFIER_SHIFT : 0)
  );
}

/**
 * 키 이벤트에 실어 보낼 문자.
 * 있으면 Runner 가 `keyDown`(문자 입력), 없으면 `rawKeyDown`(기능키)으로 보낸다.
 */
function keyText(key: string): string | undefined {
  if (key === "Enter") return "\r";
  return key.length === 1 ? key : undefined;
}

function isImeKey(event: React.KeyboardEvent<HTMLInputElement>): boolean {
  return (
    event.nativeEvent.isComposing ||
    event.key === "Process" ||
    event.nativeEvent.keyCode === 229
  );
}

export type ImeInputHandlers = {
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onCompositionStart: () => void;
  onCompositionUpdate: (event: React.CompositionEvent<HTMLInputElement>) => void;
  onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => void;
  onInput: (event: React.FormEvent<HTMLInputElement>) => void;
};

export type ImeBridge = {
  /**
   * 숨은 입력란에 붙일 **콜백 ref**.
   * ref 객체를 그대로 밖으로 내보내면 렌더 중 ref 접근이 되어(react-hooks/refs)
   * 규칙에 걸린다. 콜백 ref 는 평범한 함수라 그 문제가 없다.
   */
  attachInput: (element: HTMLInputElement | null) => void;
  /** 캔버스를 누른 순간 호출한다 — 로컬 IME 가 붙을 곳을 만들어 준다. */
  focus: () => void;
  handlers: ImeInputHandlers;
  mode: ImeBridgeMode;
};

export function useImeBridge(options: {
  send: (message: RecorderClientMessage) => boolean;
  enabled: boolean;
}): ImeBridge {
  const { send, enabled } = options;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  /** 직전 `input` 이 키 경로로 이미 전송된 것인지. 중복 전송을 막는다. */
  const keyHandledRef = useRef(false);

  const attachInput = useCallback((element: HTMLInputElement | null) => {
    inputRef.current = element;
  }, []);

  const clearBuffer = useCallback(() => {
    const input = inputRef.current;
    if (input !== null) input.value = "";
  }, []);

  const focus = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Tab 은 포커스를 빼앗아 이후 입력이 원격으로 가지 않게 만든다.
      if (event.key === "Tab") event.preventDefault();
      if (!enabled) return;
      if (isImeKey(event)) return; // ← IME 경로. compositionend 가 최종 문자열을 보낸다.

      const text = keyText(event.key);
      if (text !== undefined) keyHandledRef.current = true;
      send({
        t: "key",
        kind: "down",
        key: event.key,
        ...(event.code === "" ? {} : { code: event.code }),
        ...(text === undefined ? {} : { text }),
        modifiers: modifiersOf(event),
      });
    },
    [enabled, send],
  );

  const onKeyUp = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!enabled) return;
      if (isImeKey(event)) return;
      send({
        t: "key",
        kind: "up",
        key: event.key,
        ...(event.code === "" ? {} : { code: event.code }),
        modifiers: modifiersOf(event),
      });
    },
    [enabled, send],
  );

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const onCompositionUpdate = useCallback(
    (event: React.CompositionEvent<HTMLInputElement>) => {
      // B안 전용 경로. A안에서는 중간 상태를 보내지 않는다(위 주석).
      if (IME_BRIDGE_MODE !== "composition") return;
      if (!enabled) return;
      send({ t: "ime", kind: "set", text: event.data });
    },
    [enabled, send],
  );

  const onCompositionEnd = useCallback(
    (event: React.CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      const text = event.data;
      // 빈 확정(조합 취소)은 보내지 않는다 — 원격에 빈 insertText 를 날리면 의미가 없다.
      if (enabled && text !== "") {
        send({ t: "ime", kind: "commit", text });
      }
      clearBuffer();
    },
    [clearBuffer, enabled, send],
  );

  /**
   * ★ 조합 없이 **텍스트가 통째로 삽입되는 경로**를 받는다 — 붙여넣기, 그리고
   *   자동화 도구의 `Input.insertText`(키 이벤트 없이 글자만 넣는다).
   *   키 경로로 이미 보낸 글자(`keyHandledRef`)와 조합 확정 직후 따라오는
   *   `insertCompositionText`(compositionend 가 이미 보냈다)는 제외해야 **중복 전송이 안 난다.**
   *
   *   그리고 어느 경로든 **끝나면 값을 비운다** — 비밀번호가 이 DOM 에 남지 않게.
   */
  const onInput = useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      // 조합 중에 비우면 IME 가 깨진다. 조합이 끝난 뒤에만 비운다.
      if (composingRef.current) return;

      const native = event.nativeEvent as InputEvent;
      const data = native.data ?? "";
      const composed = native.inputType === "insertCompositionText";
      if (enabled && !composed && !keyHandledRef.current && data !== "") {
        send({ t: "ime", kind: "commit", text: data });
      }
      keyHandledRef.current = false;
      clearBuffer();
    },
    [clearBuffer, enabled, send],
  );

  return {
    attachInput,
    focus,
    mode: IME_BRIDGE_MODE,
    handlers: {
      onKeyDown,
      onKeyUp,
      onCompositionStart,
      onCompositionUpdate,
      onCompositionEnd,
      onInput,
    },
  };
}
