/**
 * TestFlow 파비콘 래스터 생성기 — Gen-Phase 15 (브랜드 아이덴티티)
 *
 * ★ 새 의존성을 설치하지 않는다.
 *   PNG 는 레포에 이미 있는 Playwright(Chromium)로 SVG 를 렌더해 스크린샷으로 뽑는다.
 *   .ico 는 Node Buffer 로 직접 조립한다(ICO 컨테이너에 PNG 를 그대로 담는 Vista+ 형식).
 *   sharp·svgexport·to-ico 같은 도구를 추가하지 않는 이유가 이것이다.
 *
 * ★ 각 PNG 는 "최종 크기로 직접 렌더"한다. 큰 이미지를 축소하지 않는다.
 *   16px 아이콘을 32px 에서 줄이면 라이브 링의 2px 구멍이 뿌옇게 뭉갠다.
 *
 * 실행:
 *   node .pipeline/<run>/assets/15-brand/generate-icons.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../../../../apps/web");
const pub = resolve(webRoot, "public");

// 워크스페이스에 이미 설치된 playwright 를 해석한다(신규 설치 없음).
// pnpm 은 패키지별로 node_modules 를 격리하므로, playwright 를 실제로 의존하는
// apps/runner 기준으로 해석한다. 읽기만 하며 apps/runner 는 건드리지 않는다.
const require = createRequire(resolve(here, "../../../../apps/runner/package.json"));
const { chromium } = require("playwright");

const MARK = readFileSync(resolve(pub, "favicon.svg"), "utf8");

/** 홈 화면 아이콘은 iOS 가 스스로 라운딩한다 → 배경을 풀블리드로 깔고 글리프만 안쪽에 둔다. */
const APPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="180" height="180">
  <rect width="32" height="32" fill="#49c493"/>
  <g transform="translate(4.048 3.616) scale(0.72)">
    <path fill="none" stroke="#10201b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" d="M7.4 24.4h7.2v-12h2.6"/>
    <circle cx="23.4" cy="12.4" r="4.9" fill="#10201b"/>
    <circle cx="23.4" cy="12.4" r="2" fill="#49c493"/>
  </g>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function raster(svg, size, out) {
  await page.setViewportSize({ width: size, height: size });
  // 배경을 투명하게 둔다 — 마크가 스스로 타일 배경을 갖고 있다.
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>` +
      svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`),
  );
  const buf = await page.screenshot({ omitBackground: true });
  if (out) writeFileSync(out, buf);
  return buf;
}

// 16/32/48 PNG 는 .ico 안에 그대로 들어가므로 public/ 에 낱장으로 두지 않는다
// (참조되지 않는 파일이 빌드에 실린다). 눈으로 확인할 사본만 증적 폴더에 남긴다.
const png16 = await raster(MARK, 16, resolve(here, "favicon-16.png"));
const png32 = await raster(MARK, 32, resolve(here, "favicon-32.png"));
const png48 = await raster(MARK, 48, resolve(here, "favicon-48.png"));
await raster(APPLE, 180, resolve(pub, "apple-touch-icon.png"));
await browser.close();

/**
 * 멀티사이즈 .ico 조립.
 *   ICONDIR(6) + ICONDIRENTRY(16) * N + 이미지 데이터
 * ICO 는 Vista 부터 엔트리에 PNG 스트림을 그대로 담을 수 있다. BMP 로 다시 인코딩할
 * 필요가 없어 외부 도구 없이 Buffer 만으로 만들 수 있다.
 */
function buildIco(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const dir = [];
  for (const { size, buf } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += buf.length;
  }
  return Buffer.concat([head, ...dir, ...images.map((i) => i.buf)]);
}

writeFileSync(
  resolve(pub, "favicon.ico"),
  buildIco([
    { size: 16, buf: png16 },
    { size: 32, buf: png32 },
    { size: 48, buf: png48 },
  ]),
);

console.log("favicon-16.png / favicon-32.png / apple-touch-icon.png / favicon.ico 생성 완료");
