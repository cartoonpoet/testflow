import { describe, expect, it } from "vitest";
import { TS_CODE_BLOCKS } from "./content";
import { tokenizeCode } from "./highlight";

/**
 * 구문 강조 토크나이저.
 *
 * ★ 제일 중요한 성질은 **무손실**이다 — 토큰의 `text` 를 이으면 언제나 입력과 같다.
 *   이게 깨지면 화면에 보이는 코드가 원본과 조용히 달라진다(사용자는 그걸 복사한다).
 */
describe("tokenizeCode", () => {
  it("토큰을 이으면 언제나 원본과 같다 (문서의 코드 블록 전부)", () => {
    for (const code of TS_CODE_BLOCKS) {
      const joined = tokenizeCode(code)
        .map((t) => t.text)
        .join("");
      expect(joined).toBe(code);
    }
  });

  it("빈 문자열도 처리한다", () => {
    expect(tokenizeCode("")).toEqual([]);
  });

  it("문자열 안의 `//` 를 주석으로 오인하지 않는다", () => {
    const tokens = tokenizeCode("await page.goto('https://a.b/c');     // ❌");
    const strings = tokens.filter((t) => t.kind === "string").map((t) => t.text);
    const comments = tokens.filter((t) => t.kind === "comment").map((t) => t.text);

    expect(strings).toEqual(["'https://a.b/c'"]);
    expect(comments).toEqual(["// ❌"]);
  });

  it("따옴표가 중첩된 선택자를 통째로 문자열로 본다", () => {
    const tokens = tokenizeCode(`page.locator('input[type="file"]')`);
    expect(tokens.filter((t) => t.kind === "string").map((t) => t.text)).toEqual([
      `'input[type="file"]'`,
    ]);
  });

  it("키워드·숫자를 구분한다", () => {
    const tokens = tokenizeCode("const n = 12;");
    expect(tokens.find((t) => t.kind === "keyword")?.text).toBe("const");
    expect(tokens.find((t) => t.kind === "number")?.text).toBe("12");
  });

  it("주석 안의 단어는 키워드로 쪼개지지 않는다", () => {
    const tokens = tokenizeCode("// import 는 하나만");
    expect(tokens).toEqual([{ kind: "comment", text: "// import 는 하나만" }]);
  });
});
