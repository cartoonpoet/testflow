import { BadRequestException } from "@nestjs/common";
import type { PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * zod 기반 검증 파이프.
 *
 * ## 왜 class-validator 가 아닌가
 * `packages/contracts` 의 zod 스키마가 web·api·runner **3자의 단일 타입 소스**다
 * (03-phases 전 Gen-Phase 공통 규율). DTO 클래스를 따로 만들면 같은 규칙이 두 벌이 되고
 * 반드시 어긋난다. 그래서 검증은 전부 contracts 스키마로 한다.
 *
 * `main.ts` 의 전역 `ValidationPipe` 는 ERDify 부트스트랩 규약을 지키려고 남겨 뒀지만,
 * 핸들러 파라미터 타입이 클래스가 아니라 zod 추론 타입이라 실제로는 통과만 시킨다.
 * **실질 검증은 이 파이프다.**
 *
 * ## 사용법
 * ```ts
 * @Post("projects/:projectId/scenarios")
 * create(@Body(zodBody(CreateScenarioDtoSchema)) dto: CreateScenarioDto) {}
 *
 * @Get("projects/:projectId/scenarios")
 * list(@Query(zodBody(ScenarioListQuerySchema)) query: ScenarioListQuery) {}
 * ```
 */
export class ZodValidationPipe<TOut> implements PipeTransform<unknown, TOut> {
  constructor(private readonly schema: ZodType<TOut>) {}

  transform(value: unknown): TOut {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new BadRequestException({
      statusCode: 400,
      error: "Bad Request",
      message: "요청 값이 올바르지 않습니다.",
      // 어떤 필드가 왜 틀렸는지 알려 준다. 값 자체는 싣지 않는다(비밀번호 유출 방지).
      details: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
  }
}

/** `@Body(zodBody(Schema))` / `@Query(zodBody(Schema))` 형태로 쓰는 축약. */
export function zodBody<TOut>(schema: ZodType<TOut>): ZodValidationPipe<TOut> {
  return new ZodValidationPipe(schema);
}
