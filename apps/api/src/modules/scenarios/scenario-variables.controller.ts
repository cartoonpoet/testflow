import { Controller, Get, Param } from "@nestjs/common";
import type { ScenarioVariablesResponse } from "@testflow/contracts";
import { ScenarioVariablesService } from "./scenario-variables.service.js";

/**
 * `GET /api/scenarios/:id/variables` — 실행 다이얼로그가 "무슨 칸을 그릴지" 묻는 곳.
 *
 * ERDify 규약 — `@Controller()` 빈 인자 + 메서드마다 전체 경로. 인증·Guard 없음(비회원제).
 *
 * ★ **시나리오 상세(`GET /api/scenarios/:id`)에 얹지 않은 근거**는
 *   `scenario-variables.service.ts` 머리 주석에 있다(뜨거운 엔드포인트 + 코드 본문 조인 금지).
 *
 * ★ 경로가 `scenarios/:id` 보다 **한 segment 길어** 매칭이 겹치지 않는다
 *   (`scenarios/bulk-delete` 처럼 선언 순서를 신경 쓸 필요가 없다).
 *
 * ★ **쓰기 경로가 없다.** 변수 목록은 원본에서 매번 계산하는 파생값이고 저장하지 않는다 —
 *   `runs` 에 `variables` 컬럼을 두지 않은 결정(02-context (c))과 같은 선이다.
 */
@Controller()
export class ScenarioVariablesController {
  constructor(private readonly variables: ScenarioVariablesService) {}

  @Get("scenarios/:id/variables")
  findOne(@Param("id") id: string): Promise<ScenarioVariablesResponse> {
    return this.variables.findOne(id);
  }
}
