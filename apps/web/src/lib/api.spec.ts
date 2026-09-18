import { describe, expect, it } from "vitest";
import {
  ApiError,
  UNEXPECTED_SERVER_ERROR_MESSAGE,
  toApiError,
  toNetworkError,
} from "./api";

describe("toNetworkError — 연결 실패를 사용자 문장으로", () => {
  it("★ 브라우저의 영어 원문(`Failed to fetch`)이 화면에 뜨지 않는다", () => {
    const error = toNetworkError(new TypeError("Failed to fetch"));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(
      "네트워크 또는 API 서버 연결이 끊겼습니다. 서버 상태를 확인한 뒤 다시 시도해 주세요.",
    );
    expect((error as ApiError).message).not.toContain("fetch");
  });

  it("status 는 0 이다 — HTTP 응답이 없었다는 뜻이고, 4xx 가 아니라 재시도 대상이다", () => {
    expect((toNetworkError(new TypeError("Failed to fetch")) as ApiError).status).toBe(0);
  });

  it("원문은 `body` 에 남긴다 — 콘솔·디버깅에서 필요하다", () => {
    const original = new TypeError("Failed to fetch");
    expect((toNetworkError(original) as ApiError).body).toBe(original);
  });

  it("★ AbortError 는 감싸지 않는다 — 취소는 고장이 아니다", () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    expect(toNetworkError(abort)).toBe(abort);
  });

  it("이미 ApiError 면 그대로 둔다(이중 포장 금지)", () => {
    const api = new ApiError(404, "없습니다");
    expect(toNetworkError(api)).toBe(api);
  });
});

describe("toApiError — 서버 오류 표시", () => {
  it("★ Nest 기본 500 문구는 한국어로 바꾼다 — 화면의 유일한 영어 문장이었다", () => {
    const error = toApiError(500, { statusCode: 500, message: "Internal server error" });
    expect(error.message).toBe(UNEXPECTED_SERVER_ERROR_MESSAGE);
    expect(error.status).toBe(500);
  });

  it("★ 서버가 준 다른 메시지는 그대로 쓴다 — 지어낸 문구로 원인을 덮지 않는다", () => {
    const error = toApiError(409, {
      statusCode: 409,
      message: "진행 중인 실행은 삭제할 수 없습니다 (RUN-0281, status: running).",
    });
    expect(error.message).toContain("RUN-0281");
  });

  it("ValidationPipe 가 주는 배열 메시지는 합쳐서 details 에도 남긴다", () => {
    const error = toApiError(400, { statusCode: 400, message: ["a는 필수", "b는 숫자"] });
    expect(error.message).toBe("a는 필수, b는 숫자");
    expect(error.details).toEqual(["a는 필수", "b는 숫자"]);
  });

  it("JSON 이 아닌 본문은 상태 코드만으로 설명한다", () => {
    expect(toApiError(502, "<html>bad gateway</html>").message).toContain("502");
  });
});
