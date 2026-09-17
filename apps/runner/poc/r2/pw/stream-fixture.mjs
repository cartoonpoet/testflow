/**
 * 라운드 2 PoC — 경로 A: 커스텀 fixture 주입 (스트리밍을 `page` fixture 로 감싼다)
 *
 * ⚠️ PoC 전용 임시물. 제품 코드가 아니다.
 * ⚠️ **일부러 평문 .mjs 다.** Playwright 의 TS 로더를 거치지 않는 위치(node_modules shim)에서도
 *    Node 가 그대로 로드할 수 있어야 하기 때문이다.
 *
 * `page` fixture 를 덮어써서, 테스트가 page 를 쓰기 시작하기 **직전**에
 * `startScreencast`(`src/record/screencast.ts` — 무수정 재사용)를 붙이고 끝나면 뗀다.
 *
 * ★ 프레임을 worker 프로세스 밖으로 내보내는 방법: **WS 클라이언트**.
 *   worker → (ws /r2/ingest) → Runner 호스트 → (ws /r2/view) → 브라우저 캔버스.
 *   stdout IPC 는 JPEG 바이너리에 부적합하고(프레이밍·base64), 파일은 지연이 붙는다.
 */
import { WebSocket } from "ws";

import { startScreencast } from "../../../dist-poc/src/record/screencast.js";

const FRAME_HEADER_BYTES = 25;
const SIZE = { width: 1280, height: 800 };
const QUALITY = 60;

function encodeFrame(frameId, capturedAtMs, w, h, jpeg) {
  const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
  header.writeUInt8(0x01, 0);
  header.writeUInt32BE(frameId >>> 0, 1);
  header.writeDoubleBE(capturedAtMs, 5);
  header.writeDoubleBE(Date.now(), 13);
  header.writeUInt16BE(w, 21);
  header.writeUInt16BE(h, 23);
  return Buffer.concat([header, jpeg]);
}

/** `TESTFLOW_R2_INGEST_WS` 가 없으면 아무 것도 하지 않는다(사용자가 그냥 돌릴 때와 동일). */
export function extendTest(baseTest) {
  return baseTest.extend({
    page: async ({ page }, use, testInfo) => {
      const url = process.env.TESTFLOW_R2_INGEST_WS ?? "";
      if (url === "") {
        await use(page);
        return;
      }
      const maxFps = Number(process.env.TESTFLOW_R2_MAX_FPS ?? "15");
      const minInterval = maxFps > 0 ? 1000 / maxFps : 0;

      const ws = new WebSocket(url);
      await new Promise((done) => {
        ws.once("open", done);
        ws.once("error", done);
      });

      let frameId = 0;
      let lastSentAt = 0;
      let produced = 0;
      let sent = 0;
      let bytes = 0;

      const handle = await startScreencast(page, {
        size: SIZE,
        quality: QUALITY,
        trackPageScale: true,
        onFrame: (frame) => {
          produced += 1;
          const now = Date.now();
          if (minInterval > 0 && now - lastSentAt < minInterval) return;
          if (ws.readyState !== WebSocket.OPEN) return;
          // ★ 드롭 정책 — 라운드 1과 같다. 밀리면 버린다.
          if (ws.bufferedAmount > 256 * 1024) return;
          lastSentAt = now;
          frameId += 1;
          const payload = encodeFrame(
            frameId,
            frame.capturedAtMs,
            frame.viewportWidth,
            frame.viewportHeight,
            frame.data,
          );
          ws.send(payload, { binary: true });
          sent += 1;
          bytes += payload.byteLength;
        },
      });

      try {
        await use(page);
      } finally {
        await handle.stop().catch(() => undefined);
        // 측정 스크립트가 읽을 수 있게 worker 쪽 수치도 남긴다.
        console.log(
          `[R2FX] ${JSON.stringify({
            test: testInfo.title,
            workerIndex: testInfo.workerIndex,
            timestampKind: handle.timestampKind,
            produced,
            sent,
            bytes,
          })}`,
        );
        await new Promise((done) => {
          ws.once("close", done);
          ws.close();
          setTimeout(done, 300);
        });
      }
    },
  });
}
