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

/**
 * ★ Gen-Phase 12 Task 12.4 — Playwright 에러 메시지 전수 형태.
 *
 * 입력값이 에러에 실려 나오는 형태가 **하나가 아니다.** 아래는 Playwright 1.63 에서
 * 실제로 관측되는 문자열 모양을 그대로 옮긴 것이다. 하나라도 빠지면 그 경로로 평문이 샌다.
 * (여기 있는 문자열은 `poc-mask.ts` 실측으로 확인한 실제 에러 원문과 같은 형태다.)
 */
describe("maskSecrets — Playwright 에러 메시지 형태 전수", () => {
  const PW = "Tf!SecretPw#2026";

  const CASES: readonly { name: string; raw: string }[] = [
    {
      name: "locator.fill 타임아웃 — call log 에 value 가 박힌다",
      raw:
        `locator.fill: Timeout 10000ms exceeded.\n` +
        `Call log:\n  - waiting for locator("input[value='${PW}']")\n`,
    },
    {
      name: "expect().toHaveValue() — 기대/실제 양쪽에 값이 나온다",
      raw:
        `expect(locator).toHaveValue(expected)\n` +
        `Expected string: "${PW}"\nReceived string: "${PW}x"\n`,
    },
    {
      name: "waiting for locator(...) — getByRole 이름에 값이 들어간 경우",
      raw: `Error: strict mode violation: waiting for getByRole('textbox', { name: '${PW}' })`,
    },
    {
      name: "assert_text 불일치 — 우리 인터프리터가 만드는 문장",
      raw: `텍스트가 기대값과 다릅니다. 기대(포함): "${PW}" / 실제: ""`,
    },
    {
      name: "page.goto — URL 에 자격증명이 실린 경우",
      raw: `page.goto: net::ERR_ABORTED at https://user:${PW}@staging.example.com/login`,
    },
    {
      name: "JSON 직렬화된 요청 body 가 에러에 딸려 온 경우",
      raw: `Request failed: {"username":"qa-tester","password":"${PW}"}`,
    },
  ];

  it.each(CASES)("$name", ({ raw }) => {
    const masked = maskErrorMessage(raw, [PW]);
    expect(masked).not.toContain(PW);
    expect(masked).toContain(SECRET_MASK);
  });

  it("객체로 감싸 들어와도(SSE payload·API 응답 형태) 전부 잡는다", () => {
    const payload = {
      event: "step.finished",
      step: { sequence: 3, errorMessage: CASES[0]!.raw },
      steps: [{ errorMessage: CASES[1]!.raw }],
    };
    expect(JSON.stringify(maskSecrets(payload, [PW]))).not.toContain(PW);
  });

  it("값 목록이 비면(job 만료) 키 기반만 남는다 — 이때 error 문자열은 못 잡는다", () => {
    // 사실대로 고정해 두는 테스트다. 그래서 Runner 가 **쓰기 전에** 마스킹해야 한다(경로 ③).
    expect(maskErrorMessage(CASES[0]!.raw, [])).toContain(PW);
    expect(maskByKey({ password: PW })).toEqual({ password: SECRET_MASK });
  });
});
