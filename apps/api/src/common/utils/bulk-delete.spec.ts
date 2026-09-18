import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { exceptionMessage, runBulkDelete } from "./bulk-delete.js";

const A = "0407001b-e36c-489a-baff-e51e54ffcb42";
const B = "11111111-2222-4333-8444-555555555555";
const C = "99999999-8888-4777-8666-555555555555";

describe("runBulkDelete", () => {
  it("전부 성공하면 deleted 에 요청 순서대로 담긴다", async () => {
    const seen: string[] = [];
    const result = await runBulkDelete(
      [A, B, C],
      async (id) => {
        seen.push(id);
        await Promise.resolve();
      },
      "없다",
    );

    expect(seen).toEqual([A, B, C]);
    expect(result).toEqual({ requested: 3, deleted: [A, B, C], skipped: [] });
  });

  it("★ 404 한 건이 나머지를 막지 않는다 — 부분 성공이 정상 응답이다", async () => {
    const result = await runBulkDelete(
      [A, B, C],
      async (id) => {
        if (id === B) throw new NotFoundException("서버 문구");
        await Promise.resolve();
      },
      "이미 삭제된 실행입니다.",
    );

    expect(result.deleted).toEqual([A, C]);
    expect(result.skipped).toEqual([
      { id: B, reason: "not_found", message: "이미 삭제된 실행입니다." },
    ]);
  });

  it("★ 409(진행 중)는 서버가 만든 문장을 그대로 싣는다 — 문구가 두 벌이 되지 않게", async () => {
    const result = await runBulkDelete(
      [A],
      () => {
        throw new ConflictException("진행 중인 실행은 삭제할 수 없습니다 (RUN-0007).");
      },
      "없다",
    );

    expect(result.deleted).toEqual([]);
    expect(result.skipped[0]).toEqual({
      id: A,
      reason: "in_progress",
      message: "진행 중인 실행은 삭제할 수 없습니다 (RUN-0007).",
    });
  });

  it("★ 그 밖의 예외는 삼키지 않고 그대로 던진다(부분 성공이 아니라 고장이다)", async () => {
    await expect(
      runBulkDelete(
        [A],
        () => {
          throw new BadRequestException("계약 위반");
        },
        "없다",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("requested 는 실제 요청 건수다(성공 건수가 아니다)", async () => {
    const result = await runBulkDelete(
      [A, B],
      (id) => {
        if (id === A) throw new NotFoundException();
        return Promise.resolve();
      },
      "없다",
    );
    expect(result.requested).toBe(2);
    expect(result.deleted).toHaveLength(1);
  });
});

describe("exceptionMessage", () => {
  it("문자열 응답을 그대로 쓴다", () => {
    expect(exceptionMessage(new ConflictException("한 줄"))).toBe("한 줄");
  });

  it("객체 응답의 message 를 꺼낸다", () => {
    expect(exceptionMessage(new NotFoundException({ statusCode: 404, message: "없다" }))).toBe(
      "없다",
    );
  });

  it("배열 message(ValidationPipe)는 한 줄로 눕힌다", () => {
    const error = new BadRequestException({ statusCode: 400, message: ["a", "b"] });
    expect(exceptionMessage(error)).toBe("a, b");
  });
});
