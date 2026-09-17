import { describe, expect, it } from "vitest";
import { RECORDING_TOKEN_TTL_SEC, recordingTokenKey } from "@testflow/contracts";
import {
  generateRecordingToken,
  hashRecordingToken,
  verifyRecordingToken,
} from "./recording-token.js";
import { buildRecorderWsUrl } from "./recordings.service.js";

const SESSION_ID = "11111111-2222-4333-8444-555555555555";

describe("녹화 세션 토큰", () => {
  it("base64url 43자 (32바이트 엔트로피)", () => {
    const token = generateRecordingToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("매번 다른 값이 나온다", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateRecordingToken()));
    expect(tokens.size).toBe(50);
  });

  it("Redis 에는 평문이 아니라 sha256 hex 만 저장된다", () => {
    const token = generateRecordingToken();
    const hash = hashRecordingToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
  });

  it("올바른 토큰만 검증을 통과한다", () => {
    const token = generateRecordingToken();
    const stored = hashRecordingToken(token);
    expect(verifyRecordingToken(token, stored)).toBe(true);
    expect(verifyRecordingToken(generateRecordingToken(), stored)).toBe(false);
  });

  it("키가 폐기(null)됐으면 어떤 토큰도 통과하지 못한다", () => {
    const token = generateRecordingToken();
    expect(verifyRecordingToken(token, null)).toBe(false);
    expect(verifyRecordingToken(token, "")).toBe(false);
  });

  it("길이가 다른 해시에 대해 던지지 않고 false 를 돌려준다", () => {
    expect(verifyRecordingToken(generateRecordingToken(), "deadbeef")).toBe(false);
  });

  it("Redis 키 규약이 contracts 에 고정돼 있다", () => {
    expect(recordingTokenKey(SESSION_ID)).toBe(`testflow:rec:token:${SESSION_ID}`);
    expect(RECORDING_TOKEN_TTL_SEC).toBe(600);
  });
});

describe("buildRecorderWsUrl — API 포트가 아니라 RUNNER_WS_PORT 를 가리킨다", () => {
  it("기본은 ws://RUNNER_WS_HOST:RUNNER_WS_PORT/rec/:sessionId?token=", () => {
    process.env["RUNNER_WS_PUBLIC_URL"] = "";
    process.env["RUNNER_WS_HOST"] = "127.0.0.1";
    process.env["RUNNER_WS_PORT"] = "4100";

    const url = buildRecorderWsUrl(SESSION_ID, "tok");
    expect(url).toBe(`ws://127.0.0.1:4100/rec/${SESSION_ID}?token=tok`);
    expect(url).not.toContain(":4000");
  });

  it("RUNNER_WS_PUBLIC_URL 이 있으면 그것을 베이스로 쓴다 (nginx /rec/ 프록시)", () => {
    process.env["RUNNER_WS_PUBLIC_URL"] = "wss://testflow.internal/rec/";
    expect(buildRecorderWsUrl(SESSION_ID, "tok")).toBe(
      `wss://testflow.internal/rec/${SESSION_ID}?token=tok`,
    );
    process.env["RUNNER_WS_PUBLIC_URL"] = "";
  });
});
