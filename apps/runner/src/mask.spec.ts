import { describe, expect, it } from "vitest";
import { SECRET_MASK } from "@testflow/contracts";
import { maskErrorMessage, maskSecretText } from "./mask.js";

/**
 * ★ 이 테스트가 지키는 것: **DB 에 평문 비밀번호가 남지 않는다.**
 * `step_results.error_message` / `runs.error_message` 는 API 를 거치지 않으므로
 * 여기서 막지 못하면 영구 저장된다.
 */
describe("maskSecretText", () => {
  it("Playwright 에러 메시지에 박힌 평문을 지운다", () => {
    const raw = `locator.fill: Timeout 10000ms exceeded.\nCall log: waiting for locator("input[value='hunter2SuperSecret']")`;
    const masked = maskSecretText(raw, ["hunter2SuperSecret"]);
    expect(masked).not.toContain("hunter2SuperSecret");
    expect(masked).toContain(SECRET_MASK);
  });

  it("같은 값이 여러 번 나와도 전부 지운다", () => {
    const masked = maskSecretText("a=secret1234 b=secret1234", ["secret1234"]);
    expect(masked).toBe(`a=${SECRET_MASK} b=${SECRET_MASK}`);
  });

  it("★ 긴 값을 먼저 지운다 — 짧은 값이 먼저면 긴 값의 조각이 남는다", () => {
    const masked = maskSecretText("pw=abc123456", ["abc", "abc123456"]);
    expect(masked).toBe(`pw=${SECRET_MASK}`);
  });

  it("★ 3자 미만은 지우지 않는다 — 문서 전체가 읽을 수 없게 된다", () => {
    expect(maskSecretText("a quick brown fox", ["a"])).toBe("a quick brown fox");
  });

  it("정규식 메타문자가 든 값도 리터럴로 처리한다", () => {
    expect(maskSecretText("v=p@ss.w+rd", ["p@ss.w+rd"])).toBe(`v=${SECRET_MASK}`);
  });

  it("마스킹 대상이 없으면 원문 그대로다", () => {
    expect(maskSecretText("nothing to hide", [])).toBe("nothing to hide");
  });
});

describe("maskErrorMessage", () => {
  it("Error 객체의 message 를 마스킹한다", () => {
    const error = new Error("expected hunter2SuperSecret but got x");
    expect(maskErrorMessage(error, ["hunter2SuperSecret"])).toBe(
      `expected ${SECRET_MASK} but got x`,
    );
  });

  it("문자열·기타 타입도 받는다", () => {
    expect(maskErrorMessage("plain", [])).toBe("plain");
    expect(maskErrorMessage(42, [])).toBe("42");
  });
});
