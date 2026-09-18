import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui";
import { toast } from "@/hooks/useToast";
import { copyText } from "./clipboard";
import { CODE_TOKEN_CLASS, tokenizeCode } from "./highlight";

/**
 * 가이드 화면의 코드/프롬프트 블록.
 *
 * ## 가로 스크롤은 **블록 안에서만**
 * `pre` 가 `overflow-x-auto` 를 갖고, 바깥 래퍼는 `min-w-0` 으로 그리드/플렉스의
 * 기본 `min-width:auto` 를 푼다. 이 두 개가 짝이 아니면 긴 코드 한 줄이 본문 폭을 밀어
 * **페이지 전체가 가로로 넘친다**(모바일에서 제일 흔한 사고다).
 *
 * ## 복사 버튼을 "아무 블록에나" 붙이지 않는 이유
 * 이 문서의 ts 코드 블록 8개 중 6개는 `// ❌` 가 섞인 **대조 예시**다. 거기에 복사 버튼을
 * 붙이면 "하지 말라고 적어 둔 코드"를 한 번의 클릭으로 가져가게 된다.
 * 그래서 복사 버튼은 **그대로 써도 되는 것 2개**에만 붙인다
 *   - AI 프롬프트 (이 문서의 핵심 산출물)
 *   - 환경변수 전체 예시 (붙여넣어 바로 돌아가는 완결된 테스트)
 * 나머지는 버튼 없이 둔다 — 드래그 선택은 언제나 된다(`select-text`).
 */
export type CodeBlockProps = {
  code: string;
  /** `ts` 만 구문 강조한다. 프롬프트는 코드가 아니라 평문이라 강조하지 않는다. */
  lang: "ts" | "text";
  /** 머리 바에 들어갈 설명. 없으면 머리 바 자체가 없다. */
  caption?: string;
  /** 복사 버튼 표시 여부. */
  copy?: boolean;
};

export function CodeBlock({ code, lang, caption, copy = false }: CodeBlockProps) {
  const head = caption !== undefined || copy;

  return (
    <div
      data-slot="guide-code"
      className="mt-[12px] min-w-0 overflow-hidden rounded-step border border-line bg-panel"
    >
      {head ? (
        <div className="flex items-center justify-between gap-[10px] border-b border-line bg-table-head px-[13px] py-[8px]">
          <span className="min-w-0 truncate text-[11px] font-750 text-table-head-ink">
            {caption}
          </span>
          {copy ? <CopyButton text={code} what={caption ?? "코드"} /> : null}
        </div>
      ) : null}

      <pre
        data-slot="guide-pre"
        className={cn(
          "m-0 overflow-x-auto px-[14px] py-[13px]",
          "font-mono text-[12.5px] leading-[1.75] whitespace-pre select-text",
        )}
      >
        <code>{lang === "ts" ? <Highlighted code={code} /> : code}</code>
      </pre>
    </div>
  );
}

function Highlighted({ code }: { code: string }) {
  return (
    <>
      {/*
        key 로 배열 인덱스를 쓴다. `tokenizeCode` 는 순수 함수이고 `code` 는 상수라
        같은 블록에서 토큰 배열이 재정렬되는 일이 없다 — 인덱스가 안정적인 신원이다.
      */}
      {tokenizeCode(code).map((token, index) => (
        <span key={index} className={CODE_TOKEN_CLASS[token.kind]}>
          {token.text}
        </span>
      ))}
    </>
  );
}

/**
 * 복사 버튼.
 *
 * `useEffect` 를 쓰지 않는다 — 복사 완료 표시는 로컬 state 하나이고, 되돌리기는
 * `setTimeout` 이 아니라 **다음 복사/이탈**에 맡긴다… 고 하고 싶지만 그러면 버튼이
 * 영원히 "복사됨" 으로 남는다. 타이머는 핸들러 안에서 걸고 여기서만 끝난다
 * (마운트/언마운트 수명과 무관하므로 이펙트가 필요 없다).
 */
function CopyButton({ text, what }: { text: string; what: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const result = await copyText(text);

    if (result === "manual") {
      toast("복사하지 못했습니다. 블록을 직접 선택해 복사해 주세요.", {
        label: "복사 실패",
        tone: "danger",
      });
      return;
    }

    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 1600);
    toast(`클립보드에 복사했습니다 — ${what}`, { label: "복사됨" });
  }

  return (
    <Button
      data-slot="guide-copy"
      data-copied={copied}
      aria-label={`${what} 복사`}
      className="min-h-[30px] shrink-0 px-[10px] py-[4px] text-[11px]"
      onClick={() => {
        void handleCopy();
      }}
    >
      {copied ? "✓ 복사됨" : "⧉ 복사"}
    </Button>
  );
}
