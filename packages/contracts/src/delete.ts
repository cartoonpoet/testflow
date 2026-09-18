import { z } from "zod";

/**
 * 삭제 계약 — 시나리오·실행 이력이 **같은 모양**을 쓴다 (라운드 8).
 *
 * ════════════════════════════════════════════════════════════════════
 * ## ★ 다중 삭제를 `POST …/bulk-delete` 로 한 이유
 *
 * | 후보 | 부분 성공 표현 | id 길이 한계 | 프록시 호환 | 판정 |
 * |---|---|---|---|---|
 * | `DELETE /runs?ids=a,b,c` | ✗ 204 에 본문이 없다 | **URL 길이**(id 36자 × N) | ○ | ✗ |
 * | `DELETE /runs` + 본문 | △ | 없음 | **✗ RFC 9110 이 본문 의미를 정의하지 않는다** | ✗ |
 * | **`POST /runs/bulk-delete`** | **✓ 200 + 결과 본문** | 없음 | ○ | **✓ 채택** |
 *
 * 결정적인 것은 **부분 성공**이다. 5건을 고르면 그중 1건이 진행 중(409)일 수 있고,
 * 1건은 옆 탭에서 이미 지워졌을(404) 수 있다. 이때 답은 "성공"도 "실패"도 아니라
 * **"3건 지웠고 2건은 이러이러해서 건너뛰었다"** 이다 — 204 로는 그 말을 할 수 없고,
 * 전체를 409 로 되돌리면 지울 수 있었던 3건까지 사용자가 다시 골라야 한다.
 *
 * 이 레포는 이미 **행위형 POST**(`POST /runs/:id/cancel`, `POST /scenarios/:id/publish`)를
 * 쓰고 있어 표기도 어긋나지 않는다. 단건은 그대로 `DELETE /runs/:id` → 204 다
 * (단건에는 부분 성공이 없다 — 되면 되고 안 되면 404/409 다).
 * ════════════════════════════════════════════════════════════════════
 */

/**
 * 한 번에 지울 수 있는 최대 건수.
 *
 * 목록 1페이지(시나리오 20건 · 실행 30건)보다 넉넉하되, 한 요청이 수백 건의
 * 디스크 삭제를 직렬로 끌고 가지 않게 막는다. 화면의 "전체 선택"은 페이지 단위다.
 */
export const BULK_DELETE_MAX = 100;

export const BulkDeleteRequestSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(BULK_DELETE_MAX),
});
export type BulkDeleteRequest = z.infer<typeof BulkDeleteRequestSchema>;

/**
 * 건너뛴 이유.
 *  - `not_found` — 이미 없다(다른 탭에서 지웠거나 잘못된 id).
 *  - `in_progress` — 진행 중이라 지울 수 없다. 먼저 취소해야 한다.
 */
export const BULK_DELETE_SKIP_REASONS = ["not_found", "in_progress"] as const;
export const BulkDeleteSkipReasonSchema = z.enum(BULK_DELETE_SKIP_REASONS);
export type BulkDeleteSkipReason = z.infer<typeof BulkDeleteSkipReasonSchema>;

export const BulkDeleteSkippedSchema = z.object({
  id: z.uuid(),
  reason: BulkDeleteSkipReasonSchema,
  /** 사람이 읽을 문장. **서버가 만든 것을 화면이 그대로 쓴다**(문구가 두 벌이 되지 않게). */
  message: z.string(),
});
export type BulkDeleteSkipped = z.infer<typeof BulkDeleteSkippedSchema>;

export const BulkDeleteResultSchema = z.object({
  requested: z.number().int().nonnegative(),
  deleted: z.array(z.uuid()),
  skipped: z.array(BulkDeleteSkippedSchema),
});
export type BulkDeleteResult = z.infer<typeof BulkDeleteResultSchema>;

/**
 * 다중 삭제 결과 1줄 요약. 토스트 문구가 화면마다 달라지지 않게 한 곳에 둔다.
 *
 * `unit` 은 "시나리오" / "실행 이력" 처럼 세는 단위 이름이다.
 */
export function bulkDeleteSummary(result: BulkDeleteResult, unit: string): string {
  const done = `${unit} ${String(result.deleted.length)}건을 삭제했습니다.`;
  if (result.skipped.length === 0) return done;
  return `${done} ${String(result.skipped.length)}건은 건너뛰었습니다.`;
}
