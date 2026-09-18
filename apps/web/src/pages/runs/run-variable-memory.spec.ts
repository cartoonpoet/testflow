import { describe, expect, it } from "vitest";
import {
  parseStoredVariables,
  toStorableVariables,
} from "./run-variable-memory";

/**
 * ★ 이 파일의 핵심은 **"비밀값이 저장 대상에 남지 않는다"** 하나다.
 *   나머지는 그 규칙을 우회할 수 있는 경로(직접 추가 · 손으로 고친 저장소)를 막는다.
 */
describe("toStorableVariables", () => {
  it("★ 비밀 키의 값은 언제나 빈 문자열이다 (이름만 남는다)", () => {
    const stored = toStorableVariables([
      { key: "username", value: "qa-tester" },
      { key: "password", value: "PLAINTEXT-SECRET-1234" },
    ]);
    expect(stored).toEqual([
      { key: "username", value: "qa-tester", custom: false },
      { key: "password", value: "", custom: false },
    ]);
    expect(JSON.stringify(stored)).not.toContain("PLAINTEXT-SECRET-1234");
  });

  it("★ 이름 규칙에 걸리는 키는 전부 버린다", () => {
    const stored = toStorableVariables([
      { key: "lawyer_password", value: "a1" },
      { key: "admin_token", value: "b2" },
      { key: "API_KEY", value: "c3" },
      { key: "client_secret", value: "d4" },
      { key: "PWD", value: "e5" },
    ]);
    expect(stored.every((item) => item.value === "")).toBe(true);
    expect(stored.map((item) => item.key)).toEqual([
      "lawyer_password",
      "admin_token",
      "API_KEY",
      "client_secret",
      "PWD",
    ]);
  });

  it("★ 직접 추가한 비밀 변수도 값이 저장되지 않는다", () => {
    const stored = toStorableVariables([
      { key: "my_secret", value: "LEAK-ME", custom: true },
    ]);
    expect(stored).toEqual([{ key: "my_secret", value: "", custom: true }]);
  });

  it("비밀이 아닌 값은 그대로 기억한다", () => {
    expect(
      toStorableVariables([
        { key: "lawyer_email", value: "UI_il_1@test.com" },
        { key: "projectName", value: "보안점검-1", custom: true },
      ]),
    ).toEqual([
      { key: "lawyer_email", value: "UI_il_1@test.com", custom: false },
      { key: "projectName", value: "보안점검-1", custom: true },
    ]);
  });

  it("빈 키·공백 키는 버린다(직접 추가하다 만 행)", () => {
    expect(toStorableVariables([{ key: "   ", value: "x" }, { key: "", value: "y" }])).toEqual([]);
  });

  it("키 앞뒤 공백을 다듬고 같은 키는 뒤엣것이 이긴다", () => {
    expect(
      toStorableVariables([
        { key: "projectName", value: "before" },
        { key: " projectName ", value: "after", custom: true },
      ]),
    ).toEqual([{ key: "projectName", value: "after", custom: true }]);
  });
});

describe("parseStoredVariables", () => {
  it("★ 저장소에 평문 비밀값이 들어 있어도 읽을 때 버린다", () => {
    const raw = JSON.stringify([{ key: "password", value: "INJECTED-PLAINTEXT", custom: false }]);
    expect(parseStoredVariables(raw)).toEqual([
      { key: "password", value: "", custom: false },
    ]);
  });

  it("빈 값·깨진 JSON·배열이 아닌 값은 빈 배열", () => {
    expect(parseStoredVariables(null)).toEqual([]);
    expect(parseStoredVariables("")).toEqual([]);
    expect(parseStoredVariables("{oops")).toEqual([]);
    expect(parseStoredVariables('{"key":"a"}')).toEqual([]);
  });

  it("모양이 틀린 원소는 건너뛴다", () => {
    const raw = JSON.stringify([null, 3, { value: "no key" }, { key: "ok", value: "1" }]);
    expect(parseStoredVariables(raw)).toEqual([{ key: "ok", value: "1", custom: false }]);
  });

  it("왕복한다", () => {
    const stored = toStorableVariables([
      { key: "general_email", value: "UI_general@test.com" },
      { key: "general_password", value: "hunter2" },
    ]);
    expect(parseStoredVariables(JSON.stringify(stored))).toEqual(stored);
  });
});
