import { createRoot } from "react-dom/client";
import "./styles/globals.css";

/**
 * 화면 구현은 Gen-Phase 8 이후에 채운다.
 * 시안 토큰은 styles/globals.css 의 @theme 블록 한 곳에서만 정의한다.
 */
function App() {
  return <div className="p-6 text-brand">TestFlow</div>;
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
