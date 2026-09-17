import { describe, expect, it } from "vitest";
import { SECRET_MASK } from "@testflow/contracts";
import { maskByKey, maskErrorMessage, maskSecrets } from "./mask.js";

describe("maskSecrets — 값 기반", () => {
  it("03-phases Task 4.3 완료 기준: Playwright 에러에 실린 입력값을 지운다", () => {
    const result = maskSecrets("locator resolved to input[value='hunter2']", ["hunter2"]);
    expect(result).not.toContain("hunter2");
    expect(result).toBe(`locator resolved to input[value='${SECRET_MASK}']`);
  });

  it("한 문자열에 여러 번 나와도 전부 지운다", () => {
    expect(maskSecrets("hunter2 / hunter2", ["hunter2"])).toBe(`${SECRET_MASK} / ${SECRET_MASK}`);
  });

  it("긴 값을 먼저 지워 부분 문자열이 남지 않는다", () => {
    const result = maskSecrets("pw=hunter2secret", ["hunter2", "hunter2secret"]);
    expect(result).toBe(`pw=${SECRET_MASK}`);
  });

  it("정규식 메타문자가 든 값도 문자 그대로 다룬다", () => {
    expect(maskSecrets("token is a.b*c", ["a.b*c"])).toBe(`token is ${SECRET_MASK}`);
  });

  it("너무 짧은 값(3자 미만)은 치환하지 않는다 — 문장이 통째로 망가진다", () => {
    expect(maskSecrets("a class of apples", ["a"])).toBe("a class of apples");
  });

  it("중첩된 객체·배열을 재귀 순회한다", () => {
    const input = { steps: [{ log: "typed hunter2 into #pw" }] };
    expect(maskSecrets(input, ["hunter2"])).toEqual({
      steps: [{ log: `typed ${SECRET_MASK} into #pw` }],
    });
  });

  it("원본을 변형하지 않는다", () => {
    const input = { log: "hunter2" };
    maskSecrets(input, ["hunter2"]);
    expect(input.log).toBe("hunter2");
  });

  it("순환 참조에서 무한 루프에 빠지지 않는다", () => {
    const input: Record<string, unknown> = { log: "hunter2" };
    input["self"] = input;
    const result = maskSecrets(input, ["hunter2"]) as Record<string, unknown>;
    expect(result["log"]).toBe(SECRET_MASK);
    expect(result["self"]).toBe("[circular]");
  });
});

describe("maskByKey — 키 기반", () => {
  it.each(["password", "passwd", "pwd", "secret", "token", "apiKey", "api_key", "Authorization"])(
    "'%s' 키의 값을 가린다",
    (key) => {
      const result = maskByKey({ [key]: "plain-value" }) as Record<string, unknown>;
      expect(result[key]).toBe(SECRET_MASK);
    },
  );

  it("Secret 이 아닌 키는 건드리지 않는다", () => {
    expect(maskByKey({ email: "tester@example.com" })).toEqual({ email: "tester@example.com" });
  });

  it("중첩 객체 안의 Secret 키도 가린다", () => {
    expect(maskByKey({ variables: { testUser: { password: "hunter2" } } })).toEqual({
      variables: { testUser: { password: SECRET_MASK } },
    });
  });

  it("null/undefined 는 그대로 둔다(키가 있다는 사실 자체는 유출이 아니다)", () => {
    expect(maskByKey({ password: null })).toEqual({ password: null });
  });
});

describe("maskErrorMessage", () => {
  it("Error 의 message 를 마스킹한 문자열을 돌려준다", () => {
    const error = new Error("fill failed: value='hunter2'");
    expect(maskErrorMessage(error, ["hunter2"])).toBe(`fill failed: value='${SECRET_MASK}'`);
  });

  it("문자열도 그대로 받는다", () => {
    expect(maskErrorMessage("hunter2 실패", ["hunter2"])).toBe(`${SECRET_MASK} 실패`);
  });

  it("Error 가 아닌 값도 문자열로 만든다", () => {
    expect(maskErrorMessage({ reason: "hunter2" }, ["hunter2"])).toContain(SECRET_MASK);
  });
});

describe("maskSecrets — Error 객체", () => {
  it("message 와 stack 을 모두 마스킹한다", () => {
    const error = new Error("boom hunter2");
    const result = maskSecrets(error, ["hunter2"]) as { message: string; stack?: string };
    expect(result.message).toBe(`boom ${SECRET_MASK}`);
    expect(result.stack ?? "").not.toContain("hunter2");
  });
});
