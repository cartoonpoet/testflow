import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ScenarioCodeEntity } from "@testflow/db";
import {
  hasBlockingIssues,
  scenarioCodeByteLength,
  validateScenarioCode,
} from "@testflow/contracts";
import type { PutScenarioCodeDto, ScenarioCode } from "@testflow/contracts";
import { ScenariosService } from "./scenarios.service.js";

/**
 * 코드 시나리오 본문(`scenario_codes`) 의 조회·저장·삭제.
 *
 * ## 이 서비스가 `scenarios.service.ts` 와 분리된 이유
 * `scenarios` 목록 조회는 **코드 본문을 한 바이트도 읽으면 안 된다**(03-phases 쟁점 1 —
 * `MEDIUMTEXT` 를 뜨거운 테이블에 붙이지 않는 이유가 그것이다). 서비스가 하나면
 * "목록에서 실수로 본문 레포지토리를 건드리는" 경로가 생긴다. 리포지토리 자체를 분리해
 * 그 실수를 구조적으로 막는다 — `ScenariosService` 는 `ScenarioCodeEntity` 를 주입받지 않는다.
 *
 * ## 검증은 contracts 의 순수 함수 하나로만 한다
 * `hasBlockingIssues(validateScenarioCode(content))`. web 도 저장 전에 **같은 함수**를 쓴다
 * (03-phases 쟁점 5 — 두 벌이면 규칙이 어긋나는 순간 한쪽이 뚫린다).
 * **`severity:"warning"`(예: `test(` 가 없음)은 저장을 막지 않는다.**
 *
 * ★ 이 검사는 **보안 경계가 아니다.** 정규식은 우회된다(`require(["f","s"].join(""))`).
 *   보안은 실행 격리(03-phases 쟁점 4 · `RUNNER_CODE_EXECUTION_MODE`)가 담당하고,
 *   이 검사는 "왜 안 돌아가는지"를 사용자에게 알려 주는 UX 장치다.
 */
@Injectable()
export class ScenarioCodeService {
  constructor(
    @InjectRepository(ScenarioCodeEntity)
    private readonly codes: Repository<ScenarioCodeEntity>,
    private readonly scenarios: ScenariosService,
  ) {}

  /** `GET /api/scenarios/:id/code` — 본문이 없으면 404 다(빈 문자열로 내려주지 않는다). */
  async findOne(scenarioId: string): Promise<ScenarioCode> {
    await this.scenarios.mustFind(scenarioId);
    const row = await this.codes.findOne({ where: { scenarioId } });
    if (!row) {
      throw new NotFoundException(`코드 본문이 아직 없습니다: ${scenarioId}`);
    }
    return toScenarioCode(row);
  }

  /**
   * `PUT /api/scenarios/:id/code` — upsert.
   *
   * ★ **업로드 전용 엔드포인트를 만들지 않는다.** 웹이 `File.text()` 로 읽어 이리로 보낸다.
   *   근거: multipart 를 받으려면 파서 의존성(`multer`/`busboy`)이 늘고 `.npmrc` 의
   *   `minimum-release-age=1440` 게이트를 또 통과해야 하는데, **코드는 어차피 텍스트라
   *   얻는 것이 없다.** base64 도 마찬가지로 얻는 것 없이 33% 크기만 늘린다.
   *   라운드 1이 끝까지 지킨 "런타임 의존성 추가 없음" 기조를 그대로 둔다.
   */
  async put(scenarioId: string, dto: PutScenarioCodeDto): Promise<ScenarioCode> {
    const scenario = await this.scenarios.mustFind(scenarioId);
    if (scenario.sourceType !== "code") {
      throw new BadRequestException(
        "녹화(steps) 시나리오에는 코드 본문을 붙일 수 없습니다. 코드 시나리오로 새로 만드세요.",
      );
    }

    // `filename` 은 `PutScenarioCodeDtoSchema` 가 이미 막았다(경로 문자·`..`·확장자).
    // 여기서 또 검사하지 않는다 — 규칙이 두 벌이 되면 어긋난다.
    assertNoBlockingIssues(dto.content);

    const existing = await this.codes.findOne({ where: { scenarioId } });
    const entity =
      existing ??
      this.codes.create({
        scenarioId,
      });
    entity.filename = dto.filename;
    entity.content = dto.content;
    entity.sizeBytes = scenarioCodeByteLength(dto.content);

    return toScenarioCode(await this.codes.save(entity));
  }

  /** `DELETE /api/scenarios/:id/code` — 본문만 지운다(시나리오는 남는다). 204. */
  async remove(scenarioId: string): Promise<void> {
    await this.scenarios.mustFind(scenarioId);
    const result = await this.codes.delete({ scenarioId });
    if (result.affected === 0) {
      throw new NotFoundException(`코드 본문이 아직 없습니다: ${scenarioId}`);
    }
  }
}

/**
 * 400 + `details: CodeValidationIssue[]`.
 *
 * 응답 형태를 `ZodValidationPipe` 와 맞춘다(`{statusCode, error, message, details}`) —
 * 웹이 에러 처리 분기를 두 벌 갖지 않게 하기 위해서다. 다만 `details` 의 원소는
 * `CodeValidationIssue` 라 **줄·열 번호가 들어 있다**(에디터가 그 줄에 표시한다).
 */
export function assertNoBlockingIssues(content: string): void {
  const issues = validateScenarioCode(content);
  if (!hasBlockingIssues(issues)) return;

  throw new BadRequestException({
    statusCode: 400,
    error: "Bad Request",
    message: "코드에 저장할 수 없는 문제가 있습니다.",
    // 경고(`no_test`)도 함께 싣는다 — 저장을 막지는 않지만 사용자에게는 보여야 한다.
    details: issues,
  });
}

export function toScenarioCode(entity: ScenarioCodeEntity): ScenarioCode {
  return {
    scenarioId: entity.scenarioId,
    filename: entity.filename,
    content: entity.content,
    sizeBytes: entity.sizeBytes,
    updatedAt: entity.updatedAt.toISOString(),
  };
}
