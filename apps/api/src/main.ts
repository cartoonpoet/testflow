import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import { MAX_ATTACHMENT_BYTES, MAX_SCENARIO_CODE_BYTES } from "@testflow/contracts";
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

/**
 * ★ JSON 본문 상한 — 라운드 2에서 올렸다. **실측으로 발견한 문제다.**
 *
 * express 의 기본값은 **100KB** 다. 그런데 코드 시나리오 본문의 계약상 상한은
 * `MAX_SCENARIO_CODE_BYTES`(256KiB)이고, 그것을 넘겼을 때 사용자가 받아야 하는 응답은
 * `validateScenarioCode()` 의 **400 + `details`(줄 번호 · 한국어 사유)** 다.
 * 기본값 그대로 두면 **101KB 짜리 정상 코드가 `413 request entity too large` 로 거부**되고
 * (계약상 허용 범위인데도) 256KiB 초과 본문은 우리 검증기에 **닿지도 못한다.**
 * 실제로 262KB 본문을 PUT 해서 413 을 받아 확인했다.
 *
 * → **전송 상한은 의미 상한보다 반드시 커야 한다.** JSON 직렬화는 따옴표·역슬래시 이스케이프로
 *   본문을 부풀리므로 256KiB 에 넉넉한 여유를 둔 4배(1MiB)로 잡는다. 의미 상한은 여전히
 *   `MAX_SCENARIO_CODE_BYTES` 이고 **거부 주체는 `validateScenarioCode()` 하나다.**
 *   (제어문자로만 채운 병적인 입력은 이스케이프가 6배까지 부풀어 여전히 413 이 될 수 있다 —
 *   그런 입력은 어차피 의미 상한도 넘으므로 거부가 정답이다.)
 */
app.useBodyParser("json", { limit: MAX_SCENARIO_CODE_BYTES * 4 });

/**
 * ★ 첨부파일(테스트 데이터) 업로드 — `application/octet-stream` **raw body** (라운드 3).
 *
 * `multer`/`busboy` 를 추가하지 않기 위한 선택이다(라운드 1·2 가 지킨 "런타임 의존성 추가 없음").
 * `express.raw()` 는 `@nestjs/platform-express` 가 이미 갖고 있어 **새 의존성이 0개**다.
 * base64 를 JSON 에 싣는 대안은 본문을 **33% 부풀리기만** 하고 얻는 것이 없다.
 *
 * `type` 을 `application/octet-stream` 으로 **좁힌다** — 기본값도 그것이지만 명시한다.
 * 좁히지 않으면 JSON 요청까지 이 파서가 가로챌 수 있고, 그러면 **기존 API 전부가 깨진다.**
 *
 * 전송 상한은 의미 상한(`MAX_ATTACHMENT_BYTES`)보다 커야 한다 — 코드 본문에서 배운
 * 교훈 그대로다(위 주석). raw 는 이스케이프가 없어 부풀지 않으므로 여유를 1MiB 만 둔다.
 * 그래야 **상한 초과의 거부 주체가 `ScenarioAttachmentService`(413 + 한국어 사유)** 가 되고,
 * express 의 영어 `request entity too large` 가 사용자에게 보이지 않는다.
 */
app.useBodyParser("raw", {
  type: "application/octet-stream",
  limit: MAX_ATTACHMENT_BYTES + 1024 * 1024,
});

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
