import type { Artifact } from "@testflow/contracts";
import { DeleteDialog, DeleteTargetList, DeleteTargetRow } from "@/components";
import { formatBytes } from "@/lib";

/**
 * 실행 이력 삭제 확인 — **실행 목록(다중)과 실행 상세(단건)가 같은 것을 쓴다** (라운드 8).
 *
 * ════════════════════════════════════════════════════════════════════
 * ## ★ 증적이 함께 사라진다는 사실을 **개수로** 말한다
 * 실행 이력 삭제는 "표에서 한 줄 지우기" 가 아니다. 그 실행의 **영상(webm) · trace(zip) ·
 * 스크린샷**이 디스크에서 사라진다. 실패 원인을 다시 볼 수 있는 유일한 자료다.
 * 그래서 "증적 N개 · 합계 M" 을 **실제 값**으로 적는다 — 개수를 모르면 적지 않는다.
 *
 * (`artifacts` DB 행은 FK CASCADE 가, 디스크 파일은 서버가 `runs/<runId>/` 디렉토리째
 *  지운다. 07-attachments §8 의 고아 파일 97MB 사고를 반복하지 않기 위한 구조다.)
 * ════════════════════════════════════════════════════════════════════
 */
export type RunDeleteTarget = {
  id: string;
  runCode: string;
  scenarioName: string;
  /** 아는 화면만 준다. `undefined` = 아직 못 읽었다 — 숫자를 쓰지 않는다. */
  artifacts?: readonly Artifact[];
};

export type RunDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: readonly RunDeleteTarget[];
  pending?: boolean;
  onConfirm: () => void;
};

export function RunDeleteDialog({
  open,
  onOpenChange,
  targets,
  pending = false,
  onConfirm,
}: RunDeleteDialogProps) {
  const single = targets.length === 1 ? targets[0] : undefined;
  const total = totalArtifacts(targets);

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        single === undefined
          ? `실행 이력 ${String(targets.length)}건을 삭제할까요?`
          : "이 실행 이력을 삭제할까요?"
      }
      description={
        single === undefined
          ? `아래 ${String(targets.length)}건과 각각의 증적이 모두 삭제됩니다.`
          : `${single.runCode} · ${single.scenarioName}`
      }
      warning={
        <>
          <strong>증적(영상 · trace · 스크린샷)이 디스크에서 함께 삭제됩니다.</strong>
          {total === null
            ? " 실패 원인을 다시 볼 자료가 남지 않습니다."
            : ` 지금 ${String(total.count)}개 · 합계 ${formatBytes(total.bytes)} 가 있고, 삭제 후에는 실패 원인을 다시 볼 자료가 남지 않습니다.`}{" "}
          시나리오와 코드는 <strong>지워지지 않습니다</strong> — 언제든 다시 실행할 수 있습니다.
        </>
      }
      confirmLabel={single === undefined ? `${String(targets.length)}건 삭제` : "삭제"}
      confirmTestId="run-delete-confirm"
      pending={pending}
      onConfirm={onConfirm}
    >
      <DeleteTargetList>
        {targets.map((target) => (
          <DeleteTargetRow
            key={target.id}
            title={target.scenarioName}
            detail={`${target.runCode} · ${artifactLabel(target.artifacts)}`}
          />
        ))}
      </DeleteTargetList>
    </DeleteDialog>
  );
}

/** 대상 1건의 증적 요약. 아직 못 읽었으면 개수를 쓰지 않는다. */
export function artifactLabel(artifacts: readonly Artifact[] | undefined): string {
  if (artifacts === undefined) return "증적 확인 중…";
  if (artifacts.length === 0) return "증적 없음";
  const bytes = artifacts.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  return `증적 ${String(artifacts.length)}개 · ${formatBytes(bytes)}`;
}

/**
 * 전체 합계. **한 건이라도 못 읽었으면 `null`** 이다 —
 * 일부만 더한 값을 "합계"라고 적으면 실제보다 작은 숫자를 보여 주게 된다.
 */
export function totalArtifacts(
  targets: readonly RunDeleteTarget[],
): { count: number; bytes: number } | null {
  let count = 0;
  let bytes = 0;
  for (const target of targets) {
    if (target.artifacts === undefined) return null;
    count += target.artifacts.length;
    bytes += target.artifacts.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  }
  return { count, bytes };
}
