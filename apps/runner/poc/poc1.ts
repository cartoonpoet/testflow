/**
 * PoC-1 실행 스크립트 골격 (03-phases Task 3.1)
 *
 * ⚠️ PoC 전용 임시물이다. 제품 코드가 아니다(Gen-Phase 7 에서 `record/session.ts` 로 승격).
 *
 * 하는 일: 원격 브라우저 1개를 띄우고 `--target` 페이지를 연 뒤, 프레임 송출 WS 서버를 붙인다.
 * 직접 실행하면 캔버스 클라이언트 URL 을 출력하고 Ctrl+C 까지 살아 있는다(눈으로 확인하는 용도).
 * 자동 측정은 `measure.ts` 가 이 파일의 `startPoc()` 를 재사용한다.
 *
 * 사용:
 *   yarn workspace @testflow/runner poc:serve -- --target local
 *   yarn workspace @testflow/runner poc:serve -- --target playwright-dev --quality 40
 */
import { chromium, type Browser, type Page } from "playwright";

import type { InputDriver } from "../src/record/input-bridge.js";
import type { ScreencastDriver } from "../src/record/screencast.js";
import { startPocServer, type PocServer } from "./poc-ws-server.js";

/** 검증 대상. 사내 스테이징이 아니라 **공개 사이트 + 로컬 더미**다(Gen-Phase 12 에서 사내 대상 별도 검증). */
export const TARGETS = {
  /** 좌표 정확도 측정용 3×3 그리드 더미 로그인 페이지. PoC 서버가 직접 서빙한다. */
  local: { kind: "static", path: "/fixtures/login.html" },
  /** 실제 공개 사이트 — 무거운 실페이지에서의 지연·fps 확인용. */
  "playwright-dev": { kind: "remote", url: "https://playwright.dev" },
  /**
   * ★ **사내 스테이징 대상** (03-phases Task 12.3 — 주소 미확보로 보류된 Task).
   *
   * 주소는 코드에 박지 않는다. 사내 URL 이 레포·PR·로그에 남으면 안 되기 때문이다.
   * 주소를 확보하면 환경변수로만 넘긴다:
   *
   * ```bash
   * yarn workspace @testflow/runner build:poc
   * POC_CUSTOM_URL="https://staging.내부도메인/login" \
   *   node apps/runner/dist-poc/poc/measure.js --target custom
   * ```
   *
   * 값이 없으면 `startPoc()` 이 즉시 에러를 던진다(조용히 다른 곳을 재는 것보다 낫다).
   */
  custom: { kind: "remote", url: "" },
} as const;

export type TargetName = keyof typeof TARGETS;

/** `custom` 타깃의 URL. 환경변수에서만 읽는다 — 사내 주소를 소스에 남기지 않기 위해서다. */
export function customTargetUrl(): string {
  const url = process.env["POC_CUSTOM_URL"] ?? "";
  if (url === "") {
    throw new Error(
      "--target custom 을 쓰려면 POC_CUSTOM_URL 환경변수가 필요합니다. " +
        '예: POC_CUSTOM_URL="https://staging.example.internal/login" node dist-poc/poc/measure.js --target custom',
    );
  }
  return url;
}

export const DEFAULT_SIZE = { width: 1280, height: 800 } as const;

export interface StartPocOptions {
  target?: TargetName;
  quality?: number;
  size?: { width: number; height: number };
  screencastDriver?: ScreencastDriver;
  inputDriver?: InputDriver;
  port?: number;
  headless?: boolean;
}

export interface PocHandle {
  browser: Browser;
  page: Page;
  server: PocServer;
  target: TargetName;
  clientUrl: (scale: number) => string;
  close: () => Promise<void>;
}

/**
 * 정지 화면에서는 screencast 가 프레임을 만들지 않는다(변경분만 송출).
 * 실효 fps 를 재려면 화면이 계속 바뀌어야 하므로, 자체 애니메이션이 없는 대상에는
 * rAF 로 움직이는 작은 막대를 주입한다. **이 사실은 보고서에 반드시 명시한다** —
 * 주입 없이 잰 fps 는 "브라우저의 최대 송출 능력"이 아니라 "페이지가 얼마나 자주 바뀌었나"다.
 */
const MOTION_SCRIPT = `
(() => {
  if (document.getElementById('__tf_motion')) return 'already';
  const d = document.createElement('div');
  d.id = '__tf_motion';
  d.style.cssText = 'position:fixed;left:0;bottom:0;width:60px;height:16px;background:#087f5b;z-index:2147483647;pointer-events:none';
  document.body.appendChild(d);
  let x = 0;
  const tick = () => { x = (x + 6) % 1200; d.style.transform = 'translateX(' + x + 'px)'; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return 'injected';
})()`;

export async function startPoc(options: StartPocOptions = {}): Promise<PocHandle> {
  const target: TargetName = options.target ?? "local";
  const size = options.size ?? DEFAULT_SIZE;

  const browser = await chromium.launch({ headless: options.headless ?? true });
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const server = await startPocServer({
    page,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.quality === undefined ? {} : { quality: options.quality }),
    size,
    ...(options.screencastDriver === undefined ? {} : { screencastDriver: options.screencastDriver }),
    ...(options.inputDriver === undefined ? {} : { inputDriver: options.inputDriver }),
  });

  const spec = TARGETS[target];
  const url =
    spec.kind === "static"
      ? server.httpUrl(spec.path)
      : target === "custom"
        ? customTargetUrl()
        : spec.url;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (spec.kind === "remote") {
    await page.evaluate<string>(MOTION_SCRIPT);
  }

  return {
    browser,
    page,
    server,
    target,
    clientUrl: (scale) =>
      server.httpUrl(`/client/index.html?ws=${encodeURIComponent(server.wsUrl())}&scale=${String(scale)}`),
    close: async () => {
      await server.close();
      await browser.close();
    },
  };
}

/* ── CLI ────────────────────────────────────────────────────── */

export function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

export function isTargetName(value: string | undefined): value is TargetName {
  return value === "local" || value === "playwright-dev";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targetArg = args["target"];
  if (targetArg !== undefined && !isTargetName(targetArg)) {
    throw new Error(`--target 은 ${Object.keys(TARGETS).join(" | ")} 중 하나여야 한다 (받은 값: ${targetArg})`);
  }
  const qualityArg = args["quality"];
  const poc = await startPoc({
    ...(targetArg === undefined ? {} : { target: targetArg }),
    ...(qualityArg === undefined ? {} : { quality: Number(qualityArg) }),
    ...(args["screencast-driver"] === "cdp" ? { screencastDriver: "cdp" as const } : {}),
    ...(args["input-driver"] === "playwright" ? { inputDriver: "playwright" as const } : {}),
    ...(args["port"] === undefined ? {} : { port: Number(args["port"]) }),
  });

  console.log(`[poc1] target        : ${poc.target}`);
  console.log(`[poc1] screencast    : ${poc.server.screencast.driver}`);
  console.log(`[poc1] input driver  : ${poc.server.input.driver}`);
  console.log(`[poc1] page scale    : ${JSON.stringify(poc.server.screencast.getPageScale())}`);
  console.log(`[poc1] client (100%) : ${poc.clientUrl(1)}`);
  console.log(`[poc1] client ( 70%) : ${poc.clientUrl(0.7)}`);
  console.log(`[poc1] client (130%) : ${poc.clientUrl(1.3)}`);
  console.log("[poc1] Ctrl+C 로 종료");

  const shutdown = (): void => {
    void poc.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  setInterval(() => {
    const s = poc.server.stats();
    console.log(
      `[poc1] produced=${String(s.framesProduced)} sent=${String(s.framesSent)} ` +
        `dropped(bp)=${String(s.framesDroppedBackpressure)} dropped(noclient)=${String(s.framesDroppedNoClient)} ` +
        `bytes=${String(s.bytesSent)} contract=${s.contractCheck}`,
    );
  }, 5000);
}

// measure.ts 가 이 모듈을 import 하므로, 직접 실행됐을 때만 main() 을 돈다.
if (process.argv[1]?.endsWith("poc1.js") === true) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
