import { describe, expect, it } from "vitest";
import {
  CreateRunDtoSchema,
  CreateRunRequestSchema,
  collectSecretValues,
  isSecretVariableKey,
  maskVariablesForStorage,
} from "./run.js";

describe("CreateRunDtoSchema", () => {
  it("시나리오 실행 요청을 통과시킨다", () => {
    const dto = CreateRunDtoSchema.parse({
      scenarioId: "11111111-1111-4111-8111-111111111111",
      baseUrl: "https://x.example.com",
      envLabel: "스테이징",
      browser: "chromium",
      variables: {},
    });
    expect(dto.browser).toBe("chromium");
    expect(dto.secretKeys).toEqual([]);
  });

  it("scenarioId 와 suiteId 가 둘 다 없으면 거부한다", () => {
    const result = CreateRunDtoSchema.safeParse({
      baseUrl: "https://x.example.com",
      envLabel: "스테이징",
    });
    expect(result.success).toBe(false);
  });

  it("scenarioId 와 suiteId 를 동시에 주면 거부한다", () => {
    const result = CreateRunDtoSchema.safeParse({
      scenarioId: "11111111-1111-4111-8111-111111111111",
      suiteId: "22222222-2222-4222-8222-222222222222",
      baseUrl: "https://x.example.com",
      envLabel: "스테이징",
    });
    expect(result.success).toBe(false);
  });

  it("baseUrl 이 URL 이 아니면 거부한다", () => {
    const result = CreateRunDtoSchema.safeParse({
      suiteId: "22222222-2222-4222-8222-222222222222",
      baseUrl: "not-a-url",
      envLabel: "스테이징",
    });
    expect(result.success).toBe(false);
  });
});

describe("Secret 변수 처리", () => {
  const variables = {
    "testUser.email": "qa@example.com",
    "testUser.password": "hunter2",
    apiToken: "abc123",
    tenant: "acme",
  };

  it("키 이름 규칙으로 Secret 을 판별한다", () => {
    expect(isSecretVariableKey("testUser.password")).toBe(true);
    expect(isSecretVariableKey("apiToken")).toBe(true);
    expect(isSecretVariableKey("testUser.email")).toBe(false);
    expect(isSecretVariableKey("tenant", ["tenant"])).toBe(true);
  });

  it("저장용 변환에서 Secret 값이 평문으로 남지 않는다", () => {
    const masked = maskVariablesForStorage(variables);
    expect(JSON.stringify(masked)).not.toContain("hunter2");
    expect(JSON.stringify(masked)).not.toContain("abc123");
    expect(masked["testUser.email"]).toBe("qa@example.com");
  });

  it("마스킹 대상 값 목록을 모은다", () => {
    expect(collectSecretValues(variables).sort()).toEqual(["abc123", "hunter2"]);
  });
});

/**
 * ★ 라운드 7 — 여러 시나리오를 한 번에 실행하는 경로(`scenarioIds`).
 *
 * 세 대상(`scenarioId` · `scenarioIds` · `suiteId`)이 **배타적**이라는 규칙과,
 * 같은 시나리오를 두 번 담지 못한다는 규칙을 계약 단계에서 못박는다 — 서버가 이 규칙을
 * 믿고 `batch_sequence` 를 요청 순서 그대로 매기기 때문이다.
 */
describe("CreateRunRequestSchema — scenarioIds (라운드 7)", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  const suite = "33333333-3333-4333-8333-333333333333";

  it("여러 시나리오를 요청 순서 그대로 통과시킨다", () => {
    const parsed = CreateRunRequestSchema.parse({ scenarioIds: [b, a] });
    expect(parsed.scenarioIds).toEqual([b, a]);
    expect(parsed.scenarioId).toBeUndefined();
  });

  it("대상을 하나도 주지 않으면 거부한다", () => {
    expect(CreateRunRequestSchema.safeParse({}).success).toBe(false);
  });

  it("scenarioIds 와 다른 대상을 동시에 주면 거부한다", () => {
    expect(CreateRunRequestSchema.safeParse({ scenarioIds: [a], scenarioId: b }).success).toBe(
      false,
    );
    expect(CreateRunRequestSchema.safeParse({ scenarioIds: [a], suiteId: suite }).success).toBe(
      false,
    );
  });

  it("같은 시나리오를 두 번 담으면 거부한다", () => {
    expect(CreateRunRequestSchema.safeParse({ scenarioIds: [a, a] }).success).toBe(false);
  });

  it("빈 배열은 거부한다 — 0건짜리 묶음은 실행이 아니다", () => {
    expect(CreateRunRequestSchema.safeParse({ scenarioIds: [] }).success).toBe(false);
  });

  it("단건 경로(scenarioId)는 그대로 통과한다", () => {
    expect(CreateRunRequestSchema.safeParse({ scenarioId: a }).success).toBe(true);
  });
});
