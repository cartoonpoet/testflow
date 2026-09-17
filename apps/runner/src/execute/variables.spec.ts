import { describe, expect, it } from "vitest";
import {
  VariableResolutionError,
  buildVariableTable,
  referencedKeys,
  resolveGotoUrl,
  substitute,
} from "./variables.js";

const scope = {
  variables: { "testUser.email": "qa@example.com", "testUser.password": "hunter2SuperSecret" },
  baseUrl: "https://staging.example.com",
  envLabel: "스테이징",
};

describe("buildVariableTable", () => {
  it("baseUrl·envLabel 을 테이블에 넣는다", () => {
    const table = buildVariableTable(scope);
    expect(table["baseUrl"]).toBe("https://staging.example.com");
    expect(table["envLabel"]).toBe("스테이징");
    expect(table["testUser.email"]).toBe("qa@example.com");
  });

  it("★ run 스냅샷(baseUrl)이 같은 이름의 사용자 변수를 이긴다", () => {
    // 실행 다이얼로그에서 입력한 baseUrl 이 실제로 실행된 주소여야 이력이 재현 가능하다.
    const table = buildVariableTable({ ...scope, variables: { baseUrl: "https://evil.example" } });
    expect(table["baseUrl"]).toBe("https://staging.example.com");
  });
});

describe("substitute", () => {
  const table = buildVariableTable(scope);

  it("점이 들어간 키를 한 덩어리로 찾는다", () => {
    expect(substitute("{{testUser.email}}", table)).toBe("qa@example.com");
  });

  it("공백을 허용한다", () => {
    expect(substitute("{{  testUser.email  }}", table)).toBe("qa@example.com");
  });

  it("한 문자열에 여러 개가 있어도 전부 치환한다", () => {
    expect(substitute("{{baseUrl}}/login?u={{testUser.email}}", table)).toBe(
      "https://staging.example.com/login?u=qa@example.com",
    );
  });

  it("치환할 것이 없으면 원문 그대로다", () => {
    expect(substitute("그냥 문자열", table)).toBe("그냥 문자열");
  });

  it("★ 없는 변수는 던진다 — 조용히 남기면 {{password}} 가 폼에 입력된다", () => {
    expect(() => substitute("{{nope}}", table)).toThrow(VariableResolutionError);
  });

  it("★ 에러 메시지에 값이 아니라 키 이름만 들어간다", () => {
    try {
      substitute("{{nope}} {{alsoNope}}", table);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("{{nope}}");
      expect(message).toContain("{{alsoNope}}");
      expect(message).not.toContain("hunter2SuperSecret");
    }
  });
});

describe("referencedKeys", () => {
  it("중복을 제거해 참조된 키만 돌려준다", () => {
    expect(referencedKeys("{{a}}/{{b}}/{{a}}")).toEqual(["a", "b"]);
  });
  it("없으면 빈 배열", () => {
    expect(referencedKeys("no placeholders")).toEqual([]);
  });
});

describe("resolveGotoUrl", () => {
  it("{{baseUrl}} 치환 후 절대 URL 이면 그대로", () => {
    expect(resolveGotoUrl("{{baseUrl}}/login", scope)).toBe("https://staging.example.com/login");
  });

  it("상대 경로는 baseUrl 기준으로 절대화한다", () => {
    expect(resolveGotoUrl("/login.html", scope)).toBe("https://staging.example.com/login.html");
  });

  it("baseUrl 에 이미 경로가 있어도 슬래시가 겹치지 않는다", () => {
    expect(resolveGotoUrl("login", { ...scope, baseUrl: "https://x.example/app" })).toBe(
      "https://x.example/app/login",
    );
  });

  it("다른 스킴의 절대 URL 도 통과시킨다", () => {
    expect(resolveGotoUrl("http://127.0.0.1:8899/a.html", scope)).toBe("http://127.0.0.1:8899/a.html");
  });
});
