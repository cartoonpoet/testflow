import { describe, expect, it } from "vitest";
import { FRAME_HEADER_BYTES, decodeFrame, toRemotePoint } from "./frame";

function buildEnvelope(options: {
  kind?: number;
  id: number;
  capturedAtMs: number;
  serverSendAtMs: number;
  width: number;
  height: number;
  payload: Uint8Array;
}): ArrayBuffer {
  const buffer = new ArrayBuffer(FRAME_HEADER_BYTES + options.payload.byteLength);
  const view = new DataView(buffer);
  view.setUint8(0, options.kind ?? 0x01);
  view.setUint32(1, options.id);
  view.setFloat64(5, options.capturedAtMs);
  view.setFloat64(13, options.serverSendAtMs);
  view.setUint16(21, options.width);
  view.setUint16(23, options.height);
  new Uint8Array(buffer).set(options.payload, FRAME_HEADER_BYTES);
  return buffer;
}

describe("decodeFrame", () => {
  const payload = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it("Runner 의 encodeFrame 과 같은 바이트 배치를 읽는다", () => {
    const frame = decodeFrame(
      buildEnvelope({
        id: 4_294_967_295,
        capturedAtMs: 1_726_500_000_123.5,
        serverSendAtMs: 1_726_500_000_140.25,
        width: 1280,
        height: 800,
        payload,
      }),
    );

    expect(frame).not.toBeNull();
    expect(frame?.id).toBe(4_294_967_295);
    expect(frame?.capturedAtMs).toBe(1_726_500_000_123.5);
    expect(frame?.serverSendAtMs).toBe(1_726_500_000_140.25);
    expect(frame?.width).toBe(1280);
    expect(frame?.height).toBe(800);
    expect(frame?.bytes).toBe(FRAME_HEADER_BYTES + payload.byteLength);
    expect(frame?.blob.size).toBe(payload.byteLength);
    expect(frame?.blob.type).toBe("image/jpeg");
  });

  it("헤더보다 짧은 버퍼 · 다른 판별자 · 0 크기는 무시한다", () => {
    expect(decodeFrame(new ArrayBuffer(FRAME_HEADER_BYTES - 1))).toBeNull();
    expect(
      decodeFrame(
        buildEnvelope({ kind: 0x02, id: 1, capturedAtMs: 0, serverSendAtMs: 0, width: 10, height: 10, payload }),
      ),
    ).toBeNull();
    expect(
      decodeFrame(
        buildEnvelope({ id: 1, capturedAtMs: 0, serverSendAtMs: 0, width: 0, height: 0, payload }),
      ),
    ).toBeNull();
  });
});

describe("toRemotePoint — ★ rect.width 로 나눈다 (canvas.width 가 아니다)", () => {
  const remote = { w: 1280, h: 800 } as const;

  /**
   * 원격 좌표 → 캔버스 CSS 좌표(기하학적 역함수). 측정 스크립트(PoC-1 `measure.ts`)가
   * 쓰는 것과 같은 정의다. 변환식과 **다른 방식으로** 계산해야 대조가 의미를 갖는다.
   */
  function toClientPoint(rx: number, ry: number, box: { left: number; top: number; width: number; height: number }) {
    return { x: box.left + (rx * box.width) / remote.w, y: box.top + (ry * box.height) / remote.h };
  }

  // 배율 3종 — PoC-1 이 버그를 잡은 매트릭스와 같다. 100% 만 재면 버그가 안 잡힌다.
  const scales = [0.7, 1, 1.3] as const;
  const targets = [
    { x: 0, y: 0 },
    { x: 640, y: 400 },
    { x: 1279, y: 799 },
    { x: 137, y: 622 },
  ];

  for (const scale of scales) {
    it(`배율 ${String(scale * 100)}% 에서 왕복 오차가 0 이다`, () => {
      const box = { left: 24.5, top: 118.25, width: remote.w * scale, height: remote.h * scale };
      for (const target of targets) {
        const client = toClientPoint(target.x, target.y, box);
        const back = toRemotePoint(client.x, client.y, box, remote);
        expect(back.x).toBeCloseTo(target.x, 6);
        expect(back.y).toBeCloseTo(target.y, 6);
      }
    });
  }

  it("★ canvas.width(내부 해상도)로 나누면 배율 100% 외에서 어긋난다 — 음성 대조군", () => {
    const scale = 0.7;
    const box = { left: 0, top: 0, width: remote.w * scale, height: remote.h * scale };
    const client = toClientPoint(640, 400, box);

    // 올바른 변환
    expect(toRemotePoint(client.x, client.y, box, remote).x).toBeCloseTo(640, 6);

    // 고장난 변환: rect.width 대신 canvas.width(=remote.w)로 나눈 경우
    const broken = (client.x - box.left) * (remote.w / remote.w);
    expect(Math.abs(broken - 640)).toBeGreaterThan(190); // 448 → 640, 192px 어긋난다
  });

  it("레이아웃 전(폭 0)에는 0 을 돌려주고 Infinity 를 만들지 않는다", () => {
    const point = toRemotePoint(10, 10, { left: 0, top: 0, width: 0, height: 0 }, remote);
    expect(point).toEqual({ x: 0, y: 0 });
  });
});
