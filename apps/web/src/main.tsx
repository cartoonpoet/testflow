import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installGlobalErrorHandlers } from "./lib/global-errors";
import "./styles/globals.css";

/**
 * ★ 전역 오류 리스너를 **렌더보다 먼저** 건다.
 *
 * ErrorBoundary 는 렌더 중 예외만 잡는다. 이벤트 핸들러·타이머·await 되지 않은 Promise 는
 * `window` 리스너만 볼 수 있고, 그중 일부는 첫 렌더 도중에도 터진다(예: SSE 구독이
 * 즉시 실패하는 경우). 근거와 경계 구분은 `lib/global-errors.ts` 상단 주석 참조.
 */
installGlobalErrorHandlers();

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error('#root 엘리먼트를 찾을 수 없습니다 (index.html 확인)');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
