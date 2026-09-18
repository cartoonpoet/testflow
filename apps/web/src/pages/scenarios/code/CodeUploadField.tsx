import { useRef, useState } from "react";
import { MAX_SCENARIO_CODE_BYTES } from "@testflow/contracts";
import { NoticeBox, NoticeLine } from "@/components";
import { Button } from "@/components/ui";
import { toast } from "@/hooks/useToast";

/**
 * `.spec.ts` 업로드 + codegen 반입 안내 (Task 5.3).
 *
 * ★ **서버에 multipart 를 보내지 않는다.** 브라우저가 `File.text()` 로 읽어 에디터에 채우고,
 *   저장은 기존 `PUT /api/scenarios/:id/code`(JSON) 하나로 끝난다 —
 *   API 의 `bodyParser:false` 부트스트랩에 새 미들웨어를 얹지 않기 위해서다(04-gen-2 §5).
 *   덤으로 **올린 즉시 검증 결과가 보인다**(서버 왕복 전에).
 */

/** 받아들이는 확장자. codegen 산출물은 `.ts` 로 떨어지고 `.spec.ts` 도 여기에 포함된다. */
const ACCEPTED = [".ts"] as const;

export type CodeUploadFieldProps = {
  onLoaded: (filename: string, content: string) => void;
  disabled?: boolean;
};

export function CodeUploadField({ onLoaded, disabled = false }: CodeUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);

  const command = "npx playwright codegen https://staging.example.com";

  return (
    <div data-slot="code-upload" className="rounded-panel border border-line bg-panel p-[18px]">
      <h3 className="mb-[8px] text-[13px]">파일로 넣기</h3>
      <p className="m-0 mb-[12px] text-[11px] leading-[1.6] text-muted">
        `.ts` 파일 1개를 올리면 내용이 아래 편집기에 채워집니다. 서버에는 저장 버튼을 눌러야
        올라갑니다. 상한은 {String(Math.floor(MAX_SCENARIO_CODE_BYTES / 1024))}KB 입니다.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".ts,.spec.ts"
        data-testid="code-upload-input"
        disabled={disabled}
        className="block w-full text-[11px] text-muted file:mr-[10px] file:rounded-btn file:border file:border-line file:bg-panel file:px-[10px] file:py-[6px] file:text-[10px] file:font-bold file:text-ink"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // 같은 파일을 연속으로 올려도 change 가 다시 나게 값을 비운다.
          event.target.value = "";
          if (file === undefined) return;

          const reason = rejectReason(file);
          if (reason !== null) {
            toast(reason, { label: "파일을 읽지 못했습니다", tone: "danger" });
            return;
          }
          void file
            .text()
            .then((content) => {
              onLoaded(file.name, content);
              toast(`${file.name} 을 편집기에 넣었습니다. 내용을 확인하고 저장하세요.`, {
                label: "파일 읽기",
              });
            })
            .catch((error: Error) => {
              toast(error.message, { label: "파일을 읽지 못했습니다", tone: "danger" });
            });
        }}
      />

      <NoticeBox title="이미 만들어 둔 Playwright 코드가 있다면">
        <NoticeLine>
          아래 명령으로 브라우저를 조작하면 Playwright 가 코드를 만들어 줍니다. 생성된 코드를
          그대로 붙여넣거나 파일로 저장해 올리면 됩니다.
        </NoticeLine>
        <div className="mt-[10px] flex items-center gap-[8px]">
          <code
            data-testid="codegen-command"
            className="min-w-0 flex-1 truncate rounded-btn border border-notice-line bg-panel px-[10px] py-[7px] font-mono text-[10px] text-ink"
          >
            {command}
          </code>
          <Button
            data-testid="codegen-copy"
            onClick={() => {
              void navigator.clipboard
                .writeText(command)
                .then(() => {
                  setCopied(true);
                  toast("명령을 복사했습니다.", { label: "복사" });
                })
                .catch(() => {
                  toast("클립보드를 쓸 수 없습니다. 명령을 직접 선택해 복사하세요.", {
                    label: "복사 실패",
                    tone: "danger",
                  });
                });
            }}
          >
            {copied ? "복사됨" : "복사"}
          </Button>
        </div>
      </NoticeBox>
    </div>
  );
}

/** 읽기 전에 거절할 이유. 없으면 `null`. 이유는 **한국어로** 돌려준다. */
function rejectReason(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!ACCEPTED.some((extension) => lower.endsWith(extension))) {
    return `${file.name} 은 지원하지 않는 확장자입니다. .ts 파일만 올릴 수 있습니다.`;
  }
  if (file.size > MAX_SCENARIO_CODE_BYTES) {
    return `파일이 너무 큽니다. ${String(file.size)}바이트 / 허용 ${String(MAX_SCENARIO_CODE_BYTES)}바이트.`;
  }
  return null;
}
