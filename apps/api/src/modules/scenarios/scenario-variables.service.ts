import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ScenarioCodeEntity, TestStepEntity } from "@testflow/db";
import { detectScenarioVariables } from "@testflow/contracts";
import type { ScenarioVariablesResponse } from "@testflow/contracts";
import { ScenariosService } from "./scenarios.service.js";

/**
 * "이 시나리오를 실행하려면 어떤 변수를 입력해야 하는가" — `GET /api/scenarios/:id/variables`.
 *
 * ════════════════════════════════════════════════════════════════════
 * ## ★ 왜 시나리오 **상세에 얹지 않았나**
 *
 * `GET /api/scenarios/:id` 는 빌더가 여는 **뜨거운 엔드포인트**이고, 답을 만들려면
 * **코드 본문(`scenario_codes.content`, 최대 256KiB `MEDIUMTEXT`)을 읽어야 한다.**
 * 상세에 얹으면:
 *
 *  ① `ScenariosService` 가 `ScenarioCodeEntity` 를 주입받게 된다 —
 *    "목록·상세가 코드 본문을 한 바이트도 읽지 않는다"는 구조적 방어(03-phases 쟁점 1,
 *    `scenario-code.service.ts` 머리 주석)가 그 순간 무너진다.
 *  ② 빌더가 스텝을 저장할 때마다 상세를 다시 읽는데, 그때마다 본문을 끌고 온다.
 *    변수 목록이 필요한 곳은 **실행 다이얼로그 하나**다.
 *  ③ 웹 캐시에서도 `scenario` 와 `scenarioCode` 키를 분리해 둔 규율
 *    (`queryClient.ts`)과 어긋난다.
 *
 * 그래서 **별도 경로 + 별도 서비스**다. `scenarioAttachments`·`scenarioCode` 가 이미
 * 같은 규율로 분리돼 있어 새로운 패턴이 아니다.
 *
 * ## 왜 `ScenarioCodeService` 에 메서드를 더하지 않았나
 * 그 서비스는 **코드 본문만** 보는 것이 규율인데 여기는 `test_steps` 도 읽어야 한다.
 * 거기에 스텝 리포지토리를 주입하면 "코드 전용" 이라는 성질이 사라진다.
 * ════════════════════════════════════════════════════════════════════
 *
 * ★ 판정 자체는 `contracts` 의 순수 함수(`detectScenarioVariables`) 하나가 한다.
 *   **정규식 스캐너이고 보안 경계가 아니다** — `run-variables.ts` 머리 주석을 읽어라.
 *   못 잡은 변수는 웹이 「변수 추가」로 메운다.
 */
@Injectable()
export class ScenarioVariablesService {
  constructor(
    @InjectRepository(ScenarioCodeEntity)
    private readonly codes: Repository<ScenarioCodeEntity>,
    @InjectRepository(TestStepEntity)
    private readonly steps: Repository<TestStepEntity>,
    private readonly scenarios: ScenariosService,
  ) {}

  async findOne(scenarioId: string): Promise<ScenarioVariablesResponse> {
    const scenario = await this.scenarios.mustFind(scenarioId);

    /*
     * ★ `sourceType` 으로 **읽을 것을 고른다.** 순수 함수 쪽은 둘 다 받아 합치지만,
     *   서버에서까지 둘 다 읽으면 코드 시나리오가 언제나 0행인 `test_steps` 를 세고
     *   녹화 시나리오가 언제나 없는 `MEDIUMTEXT` 를 조회한다 — 공짜가 아니다.
     */
    const code =
      scenario.sourceType === "code"
        ? // `select` 로 본문만 집는다(`filename`·`size_bytes` 는 필요 없다).
          (await this.codes.findOne({ where: { scenarioId }, select: { content: true } }))?.content ??
          ""
        : "";

    const steps =
      scenario.sourceType === "steps"
        ? await this.steps.find({
            where: { scenarioId },
            order: { sequence: "ASC" },
            select: { targetJson: true, inputJson: true, optionsJson: true },
          })
        : [];

    const detected = detectScenarioVariables({
      code,
      steps: steps.map((step) => ({
        target: step.targetJson,
        input: step.inputJson,
        options: step.optionsJson,
      })),
    });

    return {
      scenarioId: scenario.id,
      sourceType: scenario.sourceType,
      variables: detected.variables,
      truncated: detected.truncated,
    };
  }
}
