import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * API 오리진. apps/api 의 기본 포트(`API_PORT` 기본값 4000)와 같다.
 *
 * `process.env` 를 읽지 않는다 — 이 tsconfig 는 `types: ["vite/client"]` 뿐이라
 * Node 전역이 선언돼 있지 않다(전역 타입을 늘리려고 @types/node 를 끌어들이는 것보다
 * 상수 한 줄이 낫다). 다른 포트가 필요하면 `VITE_API_BASE_URL` 로 오리진째 바꾸면 된다.
 */
const API_PROXY = { target: "http://127.0.0.1:4000", changeOrigin: true };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  /**
   * `/api` 프록시.
   *
   * `lib/api.ts` 의 베이스는 `/api` 이고 **동일 오리진**을 전제한다(사내 단일 서버 배포에서
   * nginx 가 그렇게 프록시한다). 개발·preview 는 포트가 갈리므로 여기서 같은 모양을 만든다.
   * 이렇게 하면 CORS 가 아예 등장하지 않고, `VITE_API_BASE_URL` 로 오리진을 갈아 끼우는
   * 경로도 그대로 남는다.
   *
   * preview 에도 같은 프록시를 둔다 — 렌더 검증은 build 산출물을 preview 로 띄워서 한다.
   */
  server: { port: 5173, proxy: { "/api": API_PROXY } },
  preview: { port: 4173, proxy: { "/api": API_PROXY } },
});
