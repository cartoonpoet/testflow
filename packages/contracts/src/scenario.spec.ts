import { describe, expect, it } from "vitest";
import {
  CreateScenarioDtoSchema,
  DEFAULT_SCENARIO_CODE_FILENAME,
  MAX_SCENARIO_CODE_BYTES,
  PatchScenarioDtoSchema,
  PutScenarioCodeDtoSchema,
  SCENARIO_SOURCE_TYPES,
  ScenarioCodeFilenameSchema,
  ScenarioCodeSchema,
  scenarioCodeByteLength,
} from "./scenario.js";

describe("ScenarioSourceType", () => {
  it("steps 와 code 두 종류다", () => {
    expect(SCENARIO_SOURCE_TYPES).toEqual(["steps", "code"]);
  });

  it("★ sourceType 없이 만들면 steps 다 — 기존 호출부가 그대로 통과한다", () => {
    const dto = CreateScenarioDtoSchema.parse({ name: "x" });
    expect(dto.sourceType).toBe("steps");
  });

  it("code 시나리오를 만들 수 있다", () => {
    expect(CreateScenarioDtoSchema.parse({ name: "x", sourceType: "code" }).sourceType).toBe("code");
  });

  it("알 수 없는 sourceType 은 거부한다", () => {
    expect(CreateScenarioDtoSchema.safeParse({ name: "x", sourceType: "sql" }).success).toBe(false);
  });

  it("★ sourceType 은 생성 후 바꿀 수 없다 — PATCH DTO 에 필드가 없다", () => {
    expect("sourceType" in PatchScenarioDtoSchema.shape).toBe(false);
  });
});

describe("코드 본문 계약", () => {
  it("상한은 256KiB 다", () => {
    expect(MAX_SCENARIO_CODE_BYTES).toBe(262144);
  });

  it("바이트 수는 UTF-8 기준이다 (UTF-16 길이가 아니다)", () => {
    expect(scenarioCodeByteLength("abc")).toBe(3);
    expect(scenarioCodeByteLength("한글")).toBe(6);
    expect("한글".length).toBe(2);
  });

  it("PUT DTO 는 ScenarioCodeSchema 에서 파생된다(필드가 어긋날 수 없다)", () => {
    expect(Object.keys(PutScenarioCodeDtoSchema.shape).sort()).toEqual(["content", "filename"]);
    const dto = PutScenarioCodeDtoSchema.parse({ filename: "login.spec.ts", content: "x" });
    expect(dto.filename).toBe("login.spec.ts");
  });

  it("기본 파일명은 규칙을 만족한다", () => {
    expect(ScenarioCodeFilenameSchema.safeParse(DEFAULT_SCENARIO_CODE_FILENAME).success).toBe(true);
  });

  it.each([
    "../../etc/passwd",
    "dir/login.spec.ts",
    "dir\\login.spec.ts",
    "login.ts",
    "login.spec.js",
    "..spec.ts",
    "",
  ])("위험하거나 규칙 밖인 파일명 %s 를 거부한다", (filename) => {
    expect(ScenarioCodeFilenameSchema.safeParse(filename).success).toBe(false);
  });

  it("정상 응답 형태를 통과시킨다", () => {
    const parsed = ScenarioCodeSchema.parse({
      scenarioId: "11111111-1111-4111-8111-111111111111",
      filename: "codegen-login.spec.ts",
      content: "import { test } from '@playwright/test';",
      sizeBytes: 39,
      updatedAt: "2026-09-18T00:00:00.000Z",
    });
    expect(parsed.sizeBytes).toBe(39);
  });
});
