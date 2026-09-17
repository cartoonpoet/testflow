import { CreateProjects1758000000001 } from "./001-create-projects.js";
import { CreateScenarios1758000000002 } from "./002-create-scenarios.js";
import { CreateTestSteps1758000000003 } from "./003-create-test-steps.js";
import { CreateSuites1758000000004 } from "./004-create-suites.js";
import { CreateRuns1758000000005 } from "./005-create-runs.js";
import { CreateStepResults1758000000006 } from "./006-create-step-results.js";
import { CreateArtifacts1758000000007 } from "./007-create-artifacts.js";
import { CreateRecordingSessions1758000000008 } from "./008-create-recording-sessions.js";
import { SeedDefaultProject1758000000009, DEFAULT_PROJECT_ID } from "./009-seed-default-project.js";
import { AddRunListIndexes1758000000010 } from "./010-add-run-list-indexes.js";
import { AddScenarioSource1758000000011 } from "./011-add-scenario-source.js";

export {
  CreateProjects1758000000001,
  CreateScenarios1758000000002,
  CreateTestSteps1758000000003,
  CreateSuites1758000000004,
  CreateRuns1758000000005,
  CreateStepResults1758000000006,
  CreateArtifacts1758000000007,
  CreateRecordingSessions1758000000008,
  SeedDefaultProject1758000000009,
  DEFAULT_PROJECT_ID,
  AddRunListIndexes1758000000010,
  AddScenarioSource1758000000011,
};

/**
 * ★ glob 이 아니라 **명시 import 배열**로 등록한다 (ERDify 규약).
 *   빌드 산출물 경로/확장자 변화에 영향받지 않고, 실행 순서가 코드로 드러난다.
 *
 * 배열 순서 = 실행 순서다. FK 의존 순서를 지켜야 한다
 * (projects → scenarios → test_steps → suites → runs → step_results → artifacts → recording_sessions).
 */
export const migrations = [
  CreateProjects1758000000001,
  CreateScenarios1758000000002,
  CreateTestSteps1758000000003,
  CreateSuites1758000000004,
  CreateRuns1758000000005,
  CreateStepResults1758000000006,
  CreateArtifacts1758000000007,
  CreateRecordingSessions1758000000008,
  SeedDefaultProject1758000000009,
  AddRunListIndexes1758000000010,
  // 라운드 2 — scenarios.source_type · scenario_codes · runs.source_type
  AddScenarioSource1758000000011,
] as const;
