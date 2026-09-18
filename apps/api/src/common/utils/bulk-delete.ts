import { ConflictException, NotFoundException } from "@nestjs/common";
import type { BulkDeleteResult, BulkDeleteSkipped } from "@testflow/contracts";

/**
 * 다중 삭제 루프 — **시나리오와 실행 이력이 한 벌을 같이 쓴다** (라운드 8).
 *
 * 두 컨트롤러가 각자 루프를 갖고 있으면 "건너뛴 이유를 무엇으로 분류하는가"가
 * 조용히 갈린다(한쪽만 404 를 실패로 취급하는 식으로). 분류는 여기 한 곳이다.
 *
 * ## 왜 던지지 않는가
 * 5건을 고르면 그중 1건이 진행 중(409)일 수 있고 1건은 옆 탭에서 이미 지워졌을(404)
 * 수 있다. 이때 답은 "성공"도 "실패"도 아니라 **"3건 지웠고 2건은 이래서 건너뛰었다"** 다.
 * 한 건 때문에 전체를 되돌리면 지울 수 있었던 3건까지 사용자가 다시 골라야 한다.
 * 그 외의 예외(DB 장애 등)는 **그대로 던진다** — 그건 부분 성공이 아니라 고장이다.
 *
 * ## 왜 직렬인가
 * 삭제는 디스크 `rm` 을 동반한다. 병렬이면 같은 볼륨에 N개가 동시에 붙고, 실패 하나가
 * 어느 대상의 것인지 로그에서 흐려진다. 상한은 `BULK_DELETE_MAX`(100)라 직렬로 충분하다.
 */
export async function runBulkDelete(
  ids: readonly string[],
  removeOne: (id: string) => Promise<void>,
  notFoundMessage: string,
): Promise<BulkDeleteResult> {
  const deleted: string[] = [];
  const skipped: BulkDeleteSkipped[] = [];

  for (const id of ids) {
    try {
      await removeOne(id);
      deleted.push(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        skipped.push({ id, reason: "not_found", message: notFoundMessage });
        continue;
      }
      if (error instanceof ConflictException) {
        skipped.push({ id, reason: "in_progress", message: exceptionMessage(error) });
        continue;
      }
      throw error;
    }
  }

  return { requested: ids.length, deleted, skipped };
}

/**
 * Nest 예외에서 **사람이 읽을 문장**만 꺼낸다.
 *
 * `getResponse()` 는 문자열일 수도, `{statusCode,message,error}` 객체일 수도,
 * `message` 가 배열(ValidationPipe)일 수도 있다. 화면에 그대로 나갈 값이라
 * 셋을 모두 문장으로 눕힌다.
 */
export function exceptionMessage(error: {
  getResponse: () => unknown;
  message: string;
}): string {
  const body = error.getResponse();
  if (typeof body === "string") return body;
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join(", ");
  }
  return error.message;
}
