import { ProjectEntity } from "./project.entity.js";
import { ScenarioEntity } from "./scenario.entity.js";
import { ScenarioCodeEntity } from "./scenario-code.entity.js";
import { ScenarioAttachmentEntity } from "./scenario-attachment.entity.js";
import { TestStepEntity } from "./test-step.entity.js";
import { SuiteEntity } from "./suite.entity.js";
import { SuiteScenarioEntity } from "./suite-scenario.entity.js";
import { RunEntity } from "./run.entity.js";
import { StepResultEntity } from "./step-result.entity.js";
import { ArtifactEntity } from "./artifact.entity.js";
import { RecordingSessionEntity } from "./recording-session.entity.js";

export {
  ProjectEntity,
  ScenarioEntity,
  ScenarioCodeEntity,
  ScenarioAttachmentEntity,
  TestStepEntity,
  SuiteEntity,
  SuiteScenarioEntity,
  RunEntity,
  StepResultEntity,
  ArtifactEntity,
  RecordingSessionEntity,
};

/**
 * 엔티티 **11종**. glob 이 아니라 명시 배열로 등록한다(ERDify 규약).
 *
 * ★ `ProjectVariableEntity` 는 존재하지 않는다 — `project_variables` 테이블을 만들지 않기로
 *   확정했다 (02-context "★ 사용자 최종 결정" (c)).
 * ★ `ScenarioCodeEntity` 는 라운드 2에서 추가됐다(코드 시나리오 본문, `scenarios` 와 1:1).
 */
export const entities = [
  ProjectEntity,
  ScenarioEntity,
  ScenarioCodeEntity,
  // ★ 라운드 3 — 시나리오 첨부파일(테스트 데이터) 메타. 바이트는 ARTIFACT_ROOT 에 있다.
  ScenarioAttachmentEntity,
  TestStepEntity,
  SuiteEntity,
  SuiteScenarioEntity,
  RunEntity,
  StepResultEntity,
  ArtifactEntity,
  RecordingSessionEntity,
] as const;
