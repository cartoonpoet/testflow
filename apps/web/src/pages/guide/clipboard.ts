/**
 * 클립보드 복사 — **비 secure context 폴백 포함**.
 *
 * ## ★ 이게 왜 중요한가
 * `navigator.clipboard` 는 **secure context(HTTPS 또는 localhost)에서만 존재**한다.
 * 이 제품의 사내 배포는 `http://61.98.69.147` 즉 **평문 HTTP + IP 주소**다.
 * 그 환경의 크롬에서 `navigator.clipboard` 는 아예 `undefined` 다 — 개발자 PC 의
 * `http://localhost:4173` 은 예외적으로 secure context 로 취급되므로
 * **로컬에서만 확인하면 이 버그를 절대 못 만난다.**
 *
 * 이 화면의 핵심 산출물이 "AI 에게 붙여넣을 프롬프트 복사"라서, 배포 환경에서 복사가
 * 죽으면 화면을 만든 의미가 사라진다. 그래서 3단으로 내려간다.
 *
 *   1) `navigator.clipboard.writeText` — 있으면 쓴다(HTTPS·localhost).
 *   2) 숨긴 `<textarea>` + `document.execCommand('copy')` — deprecated 지만
 *      **평문 HTTP 크롬/엣지에서 아직 동작하는 유일한 경로**다. 사용자의 클릭 이벤트
 *      안에서 동기적으로 실행돼야 하므로 이 함수는 1)이 실패한 뒤 **동기로** 2)를 탄다.
 *   3) 둘 다 실패 → `"manual"`. 호출부가 "직접 선택해 복사하세요" 로 안내한다.
 *
 * ## 인라인 스타일을 쓰지 않는다
 * `textarea` 는 화면 밖에 둬야 하는데, `element.style.*` 로 쓰면 스타일이 컴포넌트/함수로
 * 새어 나온다(레포 규율: 스타일 값은 `globals.css` 에만). `globals.css` 의
 * `@utility tf-offscreen` 클래스 이름만 붙인다.
 *
 * `display:none` · `visibility:hidden` 은 쓸 수 없다 — 그 요소는 선택(select)이 되지 않아
 * `execCommand('copy')` 가 빈 문자열을 복사한다. 그래서 화면 밖으로 밀어내는 방식이다.
 */

export type CopyResult = "clipboard-api" | "exec-command" | "manual";

/** `navigator.clipboard` 를 쓸 수 있는가. 평문 HTTP 에서는 `false` 다. */
function hasClipboardApi(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
}

/**
 * 화면 밖 `<textarea>` 로 선택 → `execCommand('copy')`.
 * 반드시 **동기**다. 비동기로 미루면 사용자 제스처 컨텍스트가 끊겨 브라우저가 거부한다.
 */
function copyByExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.className = "tf-offscreen";
  document.body.appendChild(area);

  // iOS 사파리는 focus 없이 setSelectionRange 만으로는 선택이 잡히지 않는다.
  const active = document.activeElement;
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    // 일부 브라우저는 제거된 API 를 호출하면 던진다. `copied` 는 false 로 남는다.
  }

  area.remove();
  if (active instanceof HTMLElement) active.focus();
  return copied;
}

/**
 * 텍스트를 클립보드에 넣는다. 어느 경로로 성공했는지(또는 실패했는지)를 돌려준다.
 * 호출부는 결과에 따라 토스트 문구를 고른다.
 */
export async function copyText(text: string): Promise<CopyResult> {
  if (hasClipboardApi()) {
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard-api";
    } catch {
      // 권한 거부·포커스 상실 등. 아래 폴백으로 내려간다.
    }
  }

  return copyByExecCommand(text) ? "exec-command" : "manual";
}
