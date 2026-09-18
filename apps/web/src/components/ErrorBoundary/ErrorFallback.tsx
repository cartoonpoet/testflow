import { Button, Panel, StateView } from "@/components/ui";

/**
 * 오류 화면의 **표시**만 담당한다. 오류를 어디서 받았는지는 호출부가 안다 —
 * `ErrorBoundary`(렌더 중 예외) 와 `RouteErrorElement`(react-router 가 가로챈 예외) 가
 * 같은 화면을 그려야 하므로 여기 하나로 모았다. 둘이 다르게 생기면 사용자는
 * "같은 고장인데 왜 화면이 다르지" 를 겪는다.
 *
 * ## 스택은 사용자에게 보여 주지 않는다
 * 스택에는 내부 파일 경로·번들 해시가 그대로 들어 있고 사용자가 할 수 있는 일이 없다.
 * `import.meta.env.DEV` 에서만 접어서 보여 준다 — 운영 번들에서는 이 분기가 통째로 제거된다.
 */
export type ErrorFallbackProps = {
  error: Error;
  /** `root` 는 화면 전체를 대신 그린다(셸이 없을 때). `route` 는 셸 안 본문만. */
  variant: "root" | "route";
  /** "다시 시도" 동작. 주지 않으면 새로고침한다. */
  onRetry?: () => void;
};

/** 배포 직후 흔한 실패 — 이전 빌드의 청크를 받으려다 404 가 난다. 새로고침이 유일한 해법이다. */
export function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(
    error.message,
  );
}

export function ErrorFallback({ error, variant, onRetry }: ErrorFallbackProps) {
  const chunk = isChunkLoadError(error);
  const reload = (): void => {
    window.location.reload();
  };

  const view = (
    <StateView
      tone="error"
      title={chunk ? "화면을 불러오지 못했습니다" : "화면을 그리지 못했습니다"}
      description={
        <>
          {chunk
            ? "새 버전이 배포되어 이전 화면 파일을 더 이상 받을 수 없습니다. 새로고침하면 최신 화면을 받습니다."
            : "이 화면을 그리는 중 오류가 생겨 내용을 표시할 수 없습니다. 다시 시도해도 같다면 새로고침해 주세요."}
          {import.meta.env.DEV ? <DevDetail error={error} /> : null}
        </>
      }
      onRetry={chunk || onRetry === undefined ? reload : onRetry}
      retryLabel={chunk || onRetry === undefined ? "새로고침" : "다시 시도"}
      /*
       * ★ `<Link>` 가 아니라 `<a href>` 다. 루트 경계는 라우터 **바깥**이라 `<Link>` 가 던진다.
       *   라우트 경계에서도 `<a>` 를 쓰는데, 깨진 화면에서 벗어나는 데는 **문서를 통째로
       *   다시 받는 쪽이 더 확실하기** 때문이다(깨진 모듈 상태까지 버린다).
       */
      action={
        <Button asChild data-slot="error-home">
          <a href="/">대시보드로</a>
        </Button>
      }
    />
  );

  if (variant === "root") {
    return (
      <div
        data-slot="error-root"
        className="flex min-h-screen items-center justify-center bg-bg p-[24px]"
      >
        <Panel className="w-full max-w-[560px]">{view}</Panel>
      </div>
    );
  }

  return <Panel data-slot="error-route">{view}</Panel>;
}

/** 개발 모드 전용 상세. 운영 번들에는 렌더되지 않는다. */
function DevDetail({ error }: { error: Error }) {
  return (
    <details data-slot="error-detail" className="mt-[10px] text-left">
      <summary className="cursor-pointer text-[11px] text-muted">
        개발용 상세 (운영 화면에는 나오지 않습니다)
      </summary>
      <pre className="mt-[6px] max-h-[220px] overflow-auto rounded-chip bg-hint px-[10px] py-[8px] text-[10px] leading-[1.5] text-hint-ink">
        {error.stack ?? error.message}
      </pre>
    </details>
  );
}

/** 던져진 값이 무엇이든 `Error` 로 만든다(문자열·객체를 던지는 코드가 있다). */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  return new Error("알 수 없는 오류");
}
