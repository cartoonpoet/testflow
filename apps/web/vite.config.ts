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
   * ★ React 런타임을 **고정 청크**로 분리한다 (라운드 3).
   *
   * 그 전까지는 rolldown 의 자동 분할에 맡겼다. 자동 분할은 "이 모듈에 도달하는
   * 엔트리·동적청크의 집합"으로 묶는데, **동적 import 를 하나 더 만들면 그 집합이
   * 통째로 재편된다.** 실제로 코드 에디터를 `lazy()` 로 쪼갠 순간 기존 공용 청크
   * (`useProject-*.js` 330KB)가 엔트리에 흡수돼 엔트리가 515KB 가 됐고,
   * **초기 로드 총량은 그대로인데 `vite build` 의 500KB 경고만 새로 떴다.**
   *
   * React 는 화면과 무관하게 항상 받는 것이고 버전도 거의 안 바뀐다. 자동 분할의
   * 우연에 맡기지 말고 여기에 못박는다 — 경고가 사라지고 캐시 수명도 길어진다.
   *
   * **범위를 react 계열로 좁힌 이유**: `node_modules` 전체를 한 그룹으로 묶으면
   * CodeMirror(420KB)까지 초기 로드 청크로 끌려 들어온다. 그러면 이번 작업의 전제가
   * 깨진다. 반드시 좁게 유지할 것.
   */
  build: {
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
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
