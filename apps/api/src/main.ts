import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import { AppModule } from "./app.module.js";

/**
 * NestJS 부트스트랩 (ERDify 규약 이식 — 02-context "부트스트랩").
 *
 * ★ NestJS 12 는 순수 ESM 이다. **상대 경로 import 에 `.js` 확장자가 없으면**
 *   컴파일은 통과해도 런타임에 `ERR_MODULE_NOT_FOUND` 로 죽는다.
 *
 * ERDify 와 달라진 점 2가지 (둘 다 의도적):
 *  - `cookieParser` 제외 — 비회원제라 쿠키를 읽지 않는다.
 *  - `bodyParser: false` 를 쓰지 않는다 — raw body 가 필요한 경로(웹훅·서명 검증)가
 *    없으므로 Nest 기본 JSON 파서를 그대로 쓴다.
 *
 * ★ `.env` 로딩은 `ConfigModule` 하나가 전담한다. `node --env-file` 을 병행하지 않는다
 *   — 우선순위가 두 벌이 되면 어느 값이 이겼는지 아무도 설명할 수 없게 된다.
 *   규약 전문은 `src/common/config/env.ts` 상단 주석 참조.
 */
const app = await NestFactory.create<NestExpressApplication>(AppModule);

app.use(compression());

app.enableCors({
  origin:
    process.env["NODE_ENV"] === "production"
      ? (process.env["CORS_ORIGINS"]?.split(",").filter((o) => o !== "") ?? [])
      : true,
  credentials: true,
});

app.setGlobalPrefix("api");

/**
 * ERDify 규약의 전역 ValidationPipe.
 *
 * 다만 이 프로젝트의 **실질 검증은 zod** 다 (`common/pipes/zod-validation.pipe.ts`).
 * 핸들러 파라미터 타입이 class-validator 클래스가 아니라 zod 추론 타입이라
 * 이 파이프는 통과만 시킨다. `packages/contracts` 가 단일 타입 소스이므로
 * DTO 클래스를 따로 두지 않기로 했다.
 */
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

app.enableShutdownHooks();

const port = Number(process.env["API_PORT"] ?? 4000);
await app.listen(port);

new Logger("Bootstrap").log(`TestFlow API 기동: http://localhost:${String(port)}/api`);
