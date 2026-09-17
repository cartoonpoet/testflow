import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateSuiteDtoSchema, type SuiteListItem } from "@testflow/contracts";
import { ProjectGate } from "@/components";
import { Button, Input, Modal, PageHead, Skeleton, StateView, StatusDot } from "@/components/ui";
import { EMPTY_MARK, RUN_STATUS_LABEL, RUN_STATUS_TONE, formatRelativeTime } from "@/lib";
import { useScenarioList } from "@/hooks/useScenarios";
import { useSuiteList, useSuiteMutations } from "@/hooks/useSuites";
import { toast } from "@/hooks/useToast";
import { ScenarioPicker } from "./SuiteFormFields";

export { SuiteDetailPage } from "./SuiteDetail";

/**
 * 테스트 스위트 목록 — **시안 미제공 화면**(01-clarify "시안 미제공 화면").
 *
 * 새 디자인을 만들지 않고 **기존 4화면의 패턴만 재사용**했다.
 *   - 머리: `PageHead` (시안 `.page-head`)
 *   - 본문: 시나리오 목록과 **같은 table-wrap + th(#f5f7f6·10px·.04em) + td(12px)**
 *   - 상태: `StatusDot`(시안 `.mini-status`)
 *   - 생성: `Modal`(새 프리미티브) + 시나리오 선택 목록
 * 새 색·새 반경을 만들지 않았다(Task 11.7 완료 기준 — 이 화면에 HEX 리터럴 0건).
 */
const COLUMNS = ["스위트", "시나리오", "최근 실행", ""] as const;

export function SuitesPage() {
  const navigate = useNavigate();
  const suites = useSuiteList();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHead
        title="테스트 스위트"
        description="여러 시나리오를 하나의 회귀 묶음으로 묶어 한 번에 실행합니다."
        action={
          <Button
            variant="primary"
            data-slot="suite-create-open"
            onClick={() => {
              setCreating(true);
            }}
          >
            ＋ 스위트 만들기
          </Button>
        }
      />

      <ProjectGate>
        {suites.isPending ? <SuiteTableSkeleton /> : null}

        {suites.isError ? (
          <div className="rounded-table border border-line bg-panel">
            <StateView
              tone="error"
              title="스위트 목록을 불러오지 못했습니다"
              description={suites.error.message}
              onRetry={() => void suites.refetch()}
            />
          </div>
        ) : null}

        {suites.data !== undefined && suites.data.length === 0 ? (
          <div className="rounded-table border border-line bg-panel">
            <StateView
              title="아직 스위트가 없습니다"
              description="회귀 테스트로 자주 함께 도는 시나리오를 한 묶음으로 만들어 보세요."
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setCreating(true);
                  }}
                >
                  ＋ 스위트 만들기
                </Button>
              }
            />
          </div>
        ) : null}

        {suites.data !== undefined && suites.data.length > 0 ? (
          <div
            data-slot="table-wrap"
            className="overflow-auto rounded-table border border-line bg-panel"
          >
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr>
                  {COLUMNS.map((column, index) => (
                    <th
                      key={column === "" ? `col-${String(index)}` : column}
                      scope="col"
                      className="bg-table-head px-[15px] py-[12px] text-left text-th text-table-head-ink"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suites.data.map((suite) => (
                  <SuiteRow
                    key={suite.id}
                    suite={suite}
                    onOpen={() => {
                      void navigate(`/suites/${suite.id}`);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <CreateSuiteModal open={creating} onOpenChange={setCreating} />
      </ProjectGate>
    </>
  );
}

function SuiteRow({ suite, onOpen }: { suite: SuiteListItem; onOpen: () => void }) {
  const last = suite.lastRun;
  const known = last !== null && Object.hasOwn(RUN_STATUS_LABEL, last.status);

  return (
    <tr
      role="link"
      tabIndex={0}
      data-slot="suite-row"
      aria-label={suite.name}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
      className="cursor-pointer outline-none [&:focus-visible>td]:bg-row-hover [&:hover>td]:bg-row-hover"
    >
      <td className="border-t border-line px-[15px] py-[15px] text-td font-750">{suite.name}</td>
      <td className="border-t border-line px-[15px] py-[15px] text-td">
        {String(suite.scenarioCount)}개
      </td>
      <td className="border-t border-line px-[15px] py-[15px] text-td">
        {last === null ? (
          EMPTY_MARK
        ) : (
          <>
            <StatusDot
              tone={known ? RUN_STATUS_TONE[last.status as keyof typeof RUN_STATUS_TONE] : "gray"}
            >
              {known ? RUN_STATUS_LABEL[last.status as keyof typeof RUN_STATUS_LABEL] : last.status}
            </StatusDot>
            <small className="mt-[3px] block text-muted">
              {formatRelativeTime(last.finishedAt)}
            </small>
          </>
        )}
      </td>
      <td className="border-t border-line px-[15px] py-[15px] text-td text-right">
        <span className="text-[11px] text-muted">열기 →</span>
      </td>
    </tr>
  );
}

function CreateSuiteModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { create } = useSuiteMutations();
  const scenarios = useScenarioList(
    { q: "", status: "", feature: "", page: 1 },
    100,
  );

  const [name, setName] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed = CreateSuiteDtoSchema.safeParse({ name: name.trim(), scenarioIds: selected });
    if (!parsed.success) {
      setError(
        selected.length === 0
          ? "시나리오를 1건 이상 선택해 주세요."
          : "스위트 이름을 입력해 주세요.",
      );
      return;
    }
    setError(null);

    create.mutate(parsed.data, {
      onSuccess: (suite) => {
        toast("스위트를 만들었습니다", { label: "생성" });
        onOpenChange(false);
        setName("");
        setSelected([]);
        void navigate(`/suites/${suite.id}`);
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      title="스위트 만들기"
      description="선택한 순서가 곧 실행 순서입니다. 순서는 만든 뒤에도 바꿀 수 있습니다."
      footer={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            취소
          </Button>
          <Button
            variant="primary"
            data-slot="suite-create-submit"
            disabled={create.isPending}
            onClick={submit}
          >
            {create.isPending ? "만드는 중…" : "만들기"}
          </Button>
        </>
      }
    >
      <label className="mb-[14px] block">
        <span className="mb-[6px] block text-label text-muted">스위트 이름</span>
        <Input
          data-slot="suite-name"
          value={name}
          placeholder="로그인 회귀 묶음"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>

      <span className="mb-[6px] block text-label text-muted">
        시나리오 ({String(selected.length)}건 선택)
      </span>

      {scenarios.isPending ? (
        <Skeleton className="h-[120px] w-full" />
      ) : (
        <ScenarioPicker
          scenarios={scenarios.data?.items ?? []}
          selectedIds={selected}
          onToggle={(scenarioId) => {
            setSelected((prev) =>
              prev.includes(scenarioId)
                ? prev.filter((id) => id !== scenarioId)
                : [...prev, scenarioId],
            );
          }}
        />
      )}

      {error === null ? null : (
        <p role="alert" className="mt-[12px] mb-0 text-[11px] text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}

function SuiteTableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-auto rounded-table border border-line bg-panel">
      <table className="w-full min-w-[620px] border-collapse">
        <tbody>
          {Array.from({ length: rows }, (_, index) => (
            <tr key={index}>
              <td className="border-t border-line px-[15px] py-[15px]">
                <Skeleton className="h-[12px] w-[40%]" />
              </td>
              <td className="border-t border-line px-[15px] py-[15px]">
                <Skeleton className="h-[12px] w-[40px]" />
              </td>
              <td className="border-t border-line px-[15px] py-[15px]">
                <Skeleton className="h-[12px] w-[70px]" />
              </td>
              <td className="border-t border-line px-[15px] py-[15px]">
                <Skeleton className="h-[12px] w-[40px]" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
