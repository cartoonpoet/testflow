import { useRef } from "react";
import {
  MAX_ATTACHMENTS_PER_SCENARIO,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  attachmentLimitMessage,
  type ScenarioAttachmentList,
} from "@testflow/contracts";
import { NoticeBox, NoticeLine } from "@/components";
import { Button, Skeleton, StateView } from "@/components/ui";
import { toast } from "@/hooks/useToast";
import {
  useDeleteScenarioAttachment,
  useUploadScenarioAttachment,
} from "@/hooks/useScenarioAttachments";
import { formatBytes } from "@/lib";

/**
 * 첨부파일(테스트 데이터) 관리 — 업로드 · 목록 · 삭제 (라운드 3).
 *
 * ## 왜 필요한가
 * `setInputFiles('테스트용 파일-1.docx')` 를 쓰는 코드는 **파일 실물이 실행 디렉토리에
 * 있어야** 돌아간다. 여기서 올린 파일이 실행 시점에 작업 디렉토리 루트에 그대로 놓인다.
 *
 * ## ★ 코드 업로드(`CodeUploadField`)와 무엇이 다른가
 * 코드는 텍스트라 `File.text()` 로 읽어 **에디터에 채우고** 저장 버튼을 눌러야 서버로 갔다.
 * 첨부는 **바이너리**라 에디터에 채울 것이 없고, 고를 즉시 서버로 올린다
 * (`POST …/attachments`, `application/octet-stream`). 저장 버튼과 무관하다 —
 * 첨부는 코드 본문과 **다른 리소스**다.
 *
 * ## 상한을 화면에서 먼저 본다
 * 서버가 413 으로 다시 막지만(단일 진실), 파일을 다 올린 뒤에 거부당하면 사용자는
 * 10MiB 를 헛되이 전송한다. 문구는 contracts 의 `attachmentLimitMessage()` 하나를 쓴다 —
 * 서버와 **같은 문장**이라야 사용자가 다른 소리로 읽지 않는다.
 */
export type AttachmentsFieldProps = {
  scenarioId: string;
  data: ScenarioAttachmentList | undefined;
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  /** 코드가 참조하는데 아직 없는 파일 이름들. 있으면 안내를 띄운다. */
  missingNames?: readonly string[];
  disabled?: boolean;
};

export function AttachmentsField({
  scenarioId,
  data,
  isPending,
  error,
  onRetry,
  missingNames = [],
  disabled = false,
}: AttachmentsFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const upload = useUploadScenarioAttachment(scenarioId);
  const remove = useDeleteScenarioAttachment(scenarioId);

  const items = data?.items ?? [];
  const totalBytes = data?.totalBytes ?? 0;
  const busy = disabled || upload.isPending || remove.isPending;

  return (
    <div
      data-slot="attachments"
      className="mt-[15px] rounded-panel border border-line bg-panel p-[18px]"
    >
      <h3 className="mb-[8px] text-[13px]">테스트 데이터 (첨부파일)</h3>
      <p className="m-0 mb-[12px] text-[11px] leading-[1.6] text-muted">
        여기에 올린 파일은 실행할 때 <strong>작업 디렉토리에 그대로 놓입니다.</strong> 코드에서{" "}
        <code className="font-mono">setInputFiles(&apos;파일명&apos;)</code> 처럼 파일명만 쓰면
        됩니다. 개당 {formatBytes(MAX_ATTACHMENT_BYTES)} · 최대{" "}
        {String(MAX_ATTACHMENTS_PER_SCENARIO)}개 · 합계 {formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)}{" "}
        까지입니다.
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        data-testid="attachment-upload-input"
        disabled={busy}
        className="block w-full text-[11px] text-muted file:mr-[10px] file:rounded-btn file:border file:border-line file:bg-panel file:px-[10px] file:py-[6px] file:text-[10px] file:font-bold file:text-ink"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // 같은 파일을 연속으로 올려도 change 가 다시 나게 값을 비운다.
          event.target.value = "";
          for (const file of files) {
            if (file.size === 0) {
              toast(`${file.name} 은 빈 파일입니다.`, {
                label: "올리지 못했습니다",
                tone: "danger",
              });
              continue;
            }
            if (file.size > MAX_ATTACHMENT_BYTES) {
              toast(attachmentLimitMessage("file", file.size), {
                label: "올리지 못했습니다",
                tone: "danger",
              });
              continue;
            }
            upload.mutate(file, {
              onSuccess: (saved) => {
                toast(`${saved.filename} 을 올렸습니다.`, { label: "첨부파일" });
              },
              onError: (uploadError: Error) => {
                toast(uploadError.message, { label: "올리지 못했습니다", tone: "danger" });
              },
            });
          }
        }}
      />

      <div className="mt-[12px]">
        {isPending ? (
          <>
            <Skeleton className="h-[28px] w-full" />
            <Skeleton className="mt-[6px] h-[28px] w-full" />
          </>
        ) : error !== null ? (
          <StateView
            tone="error"
            title="첨부파일 목록을 불러오지 못했습니다"
            description={error.message}
            onRetry={onRetry}
          />
        ) : items.length === 0 ? (
          <p
            data-testid="attachment-empty"
            className="m-0 rounded-btn border border-dashed border-line px-[10px] py-[12px] text-center text-[11px] text-muted"
          >
            아직 올린 파일이 없습니다.
          </p>
        ) : (
          <ul data-testid="attachment-list" className="m-0 flex list-none flex-col gap-[6px] p-0">
            {items.map((item) => (
              <li
                key={item.id}
                data-slot="attachment-row"
                data-filename={item.filename}
                className="flex items-center gap-[8px] rounded-btn border border-line px-[10px] py-[7px]"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink">
                  {item.filename}
                </span>
                <span className="shrink-0 text-[10px] text-muted">
                  {formatBytes(item.sizeBytes)}
                </span>
                <a
                  data-slot="attachment-download"
                  href={item.url}
                  download={item.filename}
                  className="shrink-0 rounded-btn border border-line px-[8px] py-[4px] text-[10px] font-bold text-ink transition-colors duration-150 hover:border-btn-hover-line hover:bg-btn-hover-bg focus-visible:border-brand focus-visible:shadow-focus-ring focus-visible:outline-none"
                >
                  받기
                </a>
                <Button
                  data-testid="attachment-delete"
                  disabled={busy}
                  onClick={() => {
                    remove.mutate(item.id, {
                      onSuccess: () => {
                        toast(`${item.filename} 을 지웠습니다.`, { label: "첨부파일" });
                      },
                      onError: (removeError: Error) => {
                        toast(removeError.message, {
                          label: "지우지 못했습니다",
                          tone: "danger",
                        });
                      },
                    });
                  }}
                >
                  삭제
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length === 0 ? null : (
        <p className="m-0 mt-[8px] text-[10px] text-muted">
          {String(items.length)}개 · 합계 {formatBytes(totalBytes)} /{" "}
          {formatBytes(MAX_ATTACHMENT_TOTAL_BYTES)}
        </p>
      )}

      {missingNames.length === 0 ? null : (
        <NoticeBox title="코드가 찾는 파일이 없습니다">
          <NoticeLine>
            <span data-testid="attachment-missing" className="font-mono">
              {missingNames.join(" · ")}
            </span>
          </NoticeLine>
          <NoticeLine>
            <code className="font-mono">setInputFiles</code> 가 위 이름을 쓰는데 첨부 목록에
            없습니다. 지금 실행하면 파일을 찾지 못해 실패합니다. 파일명을 코드에서 만들고
            있다면 무시해도 됩니다.
          </NoticeLine>
        </NoticeBox>
      )}
    </div>
  );
}
