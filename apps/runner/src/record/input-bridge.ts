/**
 * 화면 전달 계층 — 입력 역주입 (03-phases Task 3.3)
 *
 * ★ `screencast.ts` 와 짝이다. PoC-1 이 실패해 1번(별도 창) 방식으로 후퇴하면
 *   **이 두 파일만 교체**한다. 수집 4단계(감지·Locator·변환·적재)는 이 파일을 모른다.
 *
 * ★ 드라이버 2종을 같은 인터페이스 뒤에 둔다(Task 3.3 완료 기준).
 *     - `"cdp"`        — `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText`
 *     - `"playwright"` — `page.mouse.move/down/up/wheel` · `page.keyboard.*`
 *                        (`page.mouse` 는 좌표 기반이라 대체 가능하다 — 02-context 가 비교를 지시)
 *   `TESTFLOW_INPUT_DRIVER=playwright|cdp` 또는 `createInputBridge(page, { driver })` 로 전환한다.
 *
 * ★ 좌표 규약: 들어오는 x/y 는 **원격 뷰포트 CSS 픽셀**이다.
 *   (클라이언트가 `(clientX - rect.left) * (remoteW / rect.width)` 로 캔버스 스케일을 이미 나눴다.)
 *   `pageScaleFactor` 는 **클라이언트가 알 수 없으므로 여기서** 한 번 더 나눈다
 *   (`pageScaleProvider` 주입 — 보통 `ScreencastHandle.getPageScale` 를 그대로 넘긴다).
 *
 * ★ IME: 인터페이스만 뚫어 두고 **A안(`Input.insertText`)만 구현**한다.
 *   B안(`imeSetComposition`/`imeCommitComposition`) 승급 시에도 이 파일 안에서만 바뀐다.
 *   한글 IME 실검증은 PoC-2(Gen-Phase 12) 범위이며 이번 Gen-Phase 에서 측정하지 않는다.
 */
import type { CDPSession, Page } from "playwright";
import type { RecorderClientMessage } from "@testflow/contracts";

import type { PageScaleInfo } from "./screencast.js";

type MouseMessage = Extract<RecorderClientMessage, { t: "mouse" }>;
type WheelMessage = Extract<RecorderClientMessage, { t: "wheel" }>;
type KeyMessage = Extract<RecorderClientMessage, { t: "key" }>;
type ImeMessage = Extract<RecorderClientMessage, { t: "ime" }>;

export type InputDriver = "cdp" | "playwright";

export interface InputBridgeOptions {
  /** 기본값은 `TESTFLOW_INPUT_DRIVER` → 없으면 `"cdp"`. */
  driver?: InputDriver;
  /** `pageScaleFactor` 보정용. 생략하면 스케일 1 로 본다. */
  pageScaleProvider?: () => PageScaleInfo;
}

export interface InputBridge {
  readonly driver: InputDriver;

  /** WS 로 들어온 C→S 메시지 1건을 그대로 처리한다. 서버가 쓰는 유일한 진입점. */
  dispatch(message: RecorderClientMessage): Promise<void>;

  mouse(message: MouseMessage): Promise<void>;
  wheel(message: WheelMessage): Promise<void>;
  key(message: KeyMessage): Promise<void>;

  /* ── IME (02-context 표) ── */
  /** A안 — 조합이 끝난 최종 문자열을 1회 삽입. keydown 은 발생하지 않는다. */
  insertText(text: string): Promise<void>;
  /** B안 — 조합 중간 상태. **미구현**(PoC-2 / Gen-Phase 12). */
  setComposition(text: string, selectionStart?: number, selectionEnd?: number): Promise<void>;
  /** B안 — 조합 확정. **미구현**(PoC-2 / Gen-Phase 12). */
  commitComposition(): Promise<void>;

  /** 처리한 메시지 수(종류별). */
  stats(): Readonly<Record<"mouse" | "wheel" | "key" | "ime", number>>;
  close(): Promise<void>;
}

/** 조합 없는 키를 CDP 로 보낼 때 쓰는 최소 가상 키코드 표. 없는 키는 0 으로 나간다. */
const WINDOWS_VIRTUAL_KEY: Readonly<Record<string, number>> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
};

/**
 * IME 조합 중임을 알리는 관례적 가상 키코드(`key: "Process"`).
 * 실제 한글 IME 는 조합 중 매 키마다 이 keydown 을 보낸다 — 페이지들이 이미 이 값을 전제로 짜여 있다.
 */
const IME_PROCESS_KEY_CODE = 229;

function virtualKeyCode(key: string): number {
  const mapped = WINDOWS_VIRTUAL_KEY[key];
  if (mapped !== undefined) return mapped;
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

/** `Input.dispatchMouseEvent` 의 `buttons` 비트마스크. left=1, right=2, middle=4. */
function buttonsMask(button: MouseMessage["button"], pressed: boolean): number {
  if (!pressed) return 0;
  if (button === "right") return 2;
  if (button === "middle") return 4;
  return 1;
}

export async function createInputBridge(
  page: Page,
  options: InputBridgeOptions = {},
): Promise<InputBridge> {
  const driver: InputDriver =
    options.driver ?? (process.env["TESTFLOW_INPUT_DRIVER"] === "playwright" ? "playwright" : "cdp");

  // insertText(A안) 는 Playwright 에 대응 API 가 없어 드라이버와 무관하게 CDP 가 필요하다.
  const cdp: CDPSession = await page.context().newCDPSession(page);

  const counters = { mouse: 0, wheel: 0, key: 0, ime: 0 };

  /** 원격 뷰포트 CSS 좌표 → 실제 디스패치 좌표. pageScaleFactor 가 1 이면 항등이다. */
  const toDispatchPoint = (x: number, y: number): { x: number; y: number } => {
    const scale = options.pageScaleProvider?.().pageScaleFactor ?? 1;
    if (!Number.isFinite(scale) || scale === 0 || scale === 1) return { x, y };
    return { x: x / scale, y: y / scale };
  };

  const mouse = async (message: MouseMessage): Promise<void> => {
    counters.mouse += 1;
    const { x, y } = toDispatchPoint(message.x, message.y);
    if (driver === "playwright") {
      if (message.kind === "move") {
        await page.mouse.move(x, y);
        return;
      }
      // Playwright 의 down/up 은 "현재 커서 위치"에 찍히므로 좌표 이동이 선행돼야 한다.
      await page.mouse.move(x, y);
      const opts = { button: message.button, clickCount: Math.max(1, message.clickCount) };
      if (message.kind === "down") await page.mouse.down(opts);
      else await page.mouse.up(opts);
      return;
    }
    const type =
      message.kind === "move" ? "mouseMoved" : message.kind === "down" ? "mousePressed" : "mouseReleased";
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: message.kind === "move" ? "none" : message.button,
      buttons: buttonsMask(message.button, message.kind === "down"),
      clickCount: message.kind === "move" ? 0 : Math.max(1, message.clickCount),
      modifiers: message.modifiers,
    });
  };

  const wheel = async (message: WheelMessage): Promise<void> => {
    counters.wheel += 1;
    const { x, y } = toDispatchPoint(message.x, message.y);
    if (driver === "playwright") {
      await page.mouse.move(x, y);
      await page.mouse.wheel(message.deltaX, message.deltaY);
      return;
    }
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: message.deltaX,
      deltaY: message.deltaY,
      modifiers: 0,
    });
  };

  const key = async (message: KeyMessage): Promise<void> => {
    counters.key += 1;
    if (driver === "playwright") {
      if (message.kind === "down") await page.keyboard.down(message.key);
      else if (message.kind === "up") await page.keyboard.up(message.key);
      else await page.keyboard.press(message.key);
      return;
    }
    const base = {
      key: message.key,
      code: message.code ?? "",
      windowsVirtualKeyCode: virtualKeyCode(message.key),
      nativeVirtualKeyCode: virtualKeyCode(message.key),
      modifiers: message.modifiers,
      ...(message.text === undefined ? {} : { text: message.text }),
    };
    if (message.kind === "down" || message.kind === "press") {
      await cdp.send("Input.dispatchKeyEvent", {
        type: message.text === undefined ? "rawKeyDown" : "keyDown",
        ...base,
      });
    }
    if (message.kind === "up" || message.kind === "press") {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    }
  };

  /* ── IME ── */

  const insertText = async (text: string): Promise<void> => {
    counters.ime += 1;

    // ★ PoC-2(Gen-Phase 12 Task 12.1) 실측 결과로 추가된 경로 — "A안+".
    //
    //   `Input.insertText` 단독은 `keydown`/`keypress`/`keyup` 을 **전혀** 만들지 않는다
    //   (`beforeinput`/`input` 만). 그래서 `keydown` 에 의존하는 위젯이 통째로 죽는다:
    //     - 입력 중 실시간 자동완성 → 목록이 한 번도 안 뜬다 (실측 suggestions 0건)
    //     - keydown 에서 preventDefault 하는 마스킹 input → 핸들러가 아예 안 돈다 (blocked 0건)
    //
    //   해법은 B안(`imeSetComposition`)이 **아니다** — 그것도 keydown 을 만들지 않는다
    //   (실측: composition 이벤트만 생기고 keydown 은 여전히 0). 실제 IME 가 조합 중
    //   매 키마다 보내는 **`keyCode 229`(key="Process") keydown** 을 앞뒤로 붙이는 것이
    //   유일하게 효과가 있었다 (실측: suggestions 0→2, numericKeydown 0→1).
    //
    //   ⚠️ 한계: `preventDefault()` 로 `insertText` 를 **취소할 수는 없다.** 마스킹 input 의
    //      핸들러는 돌지만 값은 들어간다. 이는 실제 IME 조합 입력의 동작과 같은 부류의
    //      제약이며, 완전 해소는 B안 조합 중계가 필요하다(05-eval "미해결" 참조).
    const imeKeyEvent = {
      key: "Process",
      windowsVirtualKeyCode: IME_PROCESS_KEY_CODE,
      nativeVirtualKeyCode: IME_PROCESS_KEY_CODE,
    } as const;
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...imeKeyEvent });
    // Playwright 에 `insertText` 대응 API 가 없어 드라이버와 무관하게 CDP 를 쓴다.
    await cdp.send("Input.insertText", { text });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...imeKeyEvent });
  };

  const notImplemented = (name: string): Promise<void> =>
    Promise.reject(
      new Error(
        `input-bridge: ${name}() 는 B안(imeSetComposition) 승급 시 구현한다. ` +
          `PoC-1(Gen-Phase 3) 범위가 아니다 — PoC-2 / Gen-Phase 12 참조.`,
      ),
    );

  const bridge: InputBridge = {
    driver,
    mouse,
    wheel,
    key,
    insertText,
    setComposition: (_text, _selectionStart, _selectionEnd) => notImplemented("setComposition"),
    commitComposition: () => notImplemented("commitComposition"),
    dispatch: async (message) => {
      switch (message.t) {
        case "mouse":
          return mouse(message);
        case "wheel":
          return wheel(message);
        case "key":
          return key(message);
        case "ime":
          return dispatchIme(message);
        case "resize":
          // 뷰포트 변경은 세션 수명주기(session.ts, Gen-Phase 7)의 책임이다.
          // 화면 전달 계층이 브라우저 상태를 바꾸면 후퇴 시 교체 범위가 넓어진다.
          return;
      }
    },
    stats: () => ({ ...counters }),
    close: async () => {
      await cdp.detach().catch(() => undefined);
    },
  };

  async function dispatchIme(message: ImeMessage): Promise<void> {
    if (message.kind === "commit") return insertText(message.text);
    return bridge.setComposition(message.text, message.selectionStart, message.selectionEnd);
  }

  return bridge;
}
