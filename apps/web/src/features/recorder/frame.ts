/**
 * 녹화 스트림의 **프레임 봉투 파서**와 **좌표 역변환** — 순수 함수만 둔다.
 *
 * 둘 다 Gen-Phase 3(PoC-1) `apps/runner/poc/client/index.html` 에서 승격한 것이고,
 * 송출 쪽 구현은 `apps/runner/src/record/ws-server.ts` 의 `encodeFrame()` 이다.
 * **양쪽이 같은 바이트 배치를 봐야 한다** — 바꾸려면 두 파일을 같이 고쳐야 한다.
 *
 * | offset | size | 타입    | 필드 |
 * |--------|------|---------|------|
 * |      0 |    1 | u8      | `0x01` = frame |
 * |      1 |    4 | u32 BE  | frameId |
 * |      5 |    8 | f64 BE  | capturedAtMs (epoch ms) |
 * |     13 |    8 | f64 BE  | serverSendAtMs (epoch ms) |
 * |     21 |    2 | u16 BE  | viewportWidth |
 * |     23 |    2 | u16 BE  | viewportHeight |
 * |     25 |    — | bytes   | JPEG (base64 아님) |
 */

/** 송출 쪽(`ws-server.ts`)의 같은 이름 상수와 반드시 같은 값이어야 한다. */
export const FRAME_HEADER_BYTES = 25;

/** 봉투 첫 바이트. 프레임 이외의 바이너리가 섞여 들어와도 조용히 무시하기 위한 판별자. */
export const FRAME_KIND_FRAME = 0x01;

/** 원격 브라우저 뷰포트 크기(CSS 픽셀). 프레임 헤더가 매 프레임 알려 준다. */
export type RemoteViewport = { readonly w: number; readonly h: number };

/**
 * 캔버스의 **화면상 상자**. `getBoundingClientRect()` 결과를 그대로 넣는다.
 *
 * ★ `width`/`height` 는 **CSS 표시 크기**다. `canvas.width`(내부 해상도)가 아니다.
 */
export type CanvasBox = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type DecodedFrame = {
  readonly id: number;
  readonly capturedAtMs: number;
  readonly serverSendAtMs: number;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly blob: Blob;
};

/**
 * 바이너리 WS 메시지 1건을 프레임으로 푼다. 프레임이 아니면 `null`.
 *
 * JPEG 은 **바이너리 그대로** 오므로 base64 디코드가 없다(대역폭 33% 절약 —
 * 02-context "전송"). 렌더는 `createImageBitmap(blob)` → `drawImage` 다.
 */
export function decodeFrame(buffer: ArrayBuffer): DecodedFrame | null {
  if (buffer.byteLength < FRAME_HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== FRAME_KIND_FRAME) return null;

  const width = view.getUint16(21);
  const height = view.getUint16(23);
  if (width <= 0 || height <= 0) return null;

  return {
    id: view.getUint32(1),
    capturedAtMs: view.getFloat64(5),
    serverSendAtMs: view.getFloat64(13),
    width,
    height,
    bytes: buffer.byteLength,
    blob: new Blob([new Uint8Array(buffer, FRAME_HEADER_BYTES)], { type: "image/jpeg" }),
  };
}

/**
 * ★ 이 프로젝트에서 가장 틀리기 쉬운 한 줄.
 *
 * ```
 * remoteX = (clientX - rect.left) * (remoteW / rect.width)
 * ```
 *
 * **`rect.width` 로 나눈다 — `canvas.width` 가 아니다.** PoC-1 의 음성 대조군이
 * 이 한 글자 차이로 클릭 적중률을 27/27 → 9/27(최대 오차 364.78px)로 떨어뜨렸다.
 * `canvas.width` 를 쓰면 **배율 100% 에서만 맞고** 70%·130% 에서 전부 빗나간다
 * (04-gen-3 "음성 대조군").
 *
 * `pageScaleFactor` 보정은 **서버(`input-bridge.ts`)가 한다** — 클라이언트는
 * 그 값을 알 방법이 없다(04-gen-3 결론). 여기서는 위 공식까지만 한다.
 */
export function toRemotePoint(
  clientX: number,
  clientY: number,
  box: CanvasBox,
  remote: RemoteViewport,
): { x: number; y: number } {
  // 캔버스가 아직 레이아웃되지 않았으면 0 으로 나누게 된다.
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  return {
    x: (clientX - box.left) * (remote.w / box.width),
    y: (clientY - box.top) * (remote.h / box.height),
  };
}
