import { describe, expect, it } from "vitest";
import { MASK, isSecretKey, maskRecord, maskSecretValues, maskValue } from "./mask";

describe("UI 마스킹", () => {
  it("시안 표기(••••••••)와 같은 문자열을 쓴다", () => {
    expect(MASK).toBe("••••••••");
  });

  it("Secret 키 이름을 서버 규칙과 같게 판정한다", () => {
    for (const key of ["password", "userPwd", "API_KEY", "authToken", "clientSecret"]) {
      expect(isSecretKey(key)).toBe(true);
    }
    for (const key of ["email", "baseUrl", "orderNo"]) {
      expect(isSecretKey(key)).toBe(false);
    }
  });

  it("isSecret 스텝 입력값을 마스킹한다", () => {
    expect(maskValue("hunter2", true)).toBe(MASK);
    expect(maskValue("tester@example.com", false)).toBe("tester@example.com");
  });

  it("변수 레코드는 키 이름 기준으로 마스킹한다", () => {
    expect(maskRecord({ "testUser.email": "a@b.c", password: "hunter2" })).toEqual({
      "testUser.email": "a@b.c",
      password: MASK,
    });
  });

  it("에러 메시지에 박힌 평문 Secret 값을 지운다", () => {
    const raw = "locator resolved to input[value='hunter2']";
    expect(maskSecretValues(raw, ["hunter2"])).not.toContain("hunter2");
    expect(maskSecretValues(raw, ["hunter2"])).toContain(MASK);
  });

  it("2글자 이하 값은 오탐이 커서 치환하지 않는다", () => {
    expect(maskSecretValues("a b c", ["a"])).toBe("a b c");
  });
});
