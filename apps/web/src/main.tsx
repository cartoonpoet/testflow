import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error('#root 엘리먼트를 찾을 수 없습니다 (index.html 확인)');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
