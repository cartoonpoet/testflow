import { describe, expect, it } from "vitest";
import {
  CreateRunDtoSchema,
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
