import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { SuiteDetail } from "@testflow/contracts";
import { Button, Input, Modal, PageHead, Panel, StateView } from "@/components/ui";
import { useScenarioList } from "@/hooks/useScenarios";
import { moveItem, useSuiteDetail, useSuiteMutations } from "@/hooks/useSuites";
import { toast } from "@/hooks/useToast";
import { RunDialog } from "@/pages/runs/RunDialog";
import { ScenarioPicker } from "./SuiteFormFields";

/**
 * 스위트 상세 — **시안 미제공 화면**.
 *
 * 빌더(화면 3)의 스텝 목록 패턴을 그대로 가져왔다.
 *   - 순서 변경은 **▲▼ 버튼 + `Alt+↑/↓`** (Gen-Phase 10 결정 — 드래그 라이브러리를 넣지 않는다)
 *   - 행 모양은 `.step-card` 의 번호칩(28×28·반경9) + 이름 + 우측 액션
 *   - 순서·추가·제거를 **한 번의 `PATCH { scenarioIds }`** 로 보낸다.
 *     빌더의 `PUT /steps` 와 달리 원본을 다시 읽을 필요가 없다(화면이 가진 것이 id 뿐이라
 *     "화면에서 지워진 정보"가 없다 — 04-gen-10 이슈 1번의 css fallback 같은 함정이 없다).
 */
export function SuiteDetailPage() {
  const { suiteId } = useParams<{ suiteId: string }>();
  const navigate = useNavigate();
  const detail = useSuiteDetail(suiteId);
  const { patch, remove } = useSuiteMutations();

  const [runOpen, setRunOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const suite = detail.data;

  const applyOrder = (scenarioIds: readonly string[]) => {
    if (suiteId === undefined) return;
    patch.mutate({ suiteId, dto: { scenarioIds: [...scenarioIds] } });
  };

  return (
    <>
      <PageHead
        title={suite?.name ?? "테스트 스위트"}
        description={
          suite === undefined
            ? "스위트를 불러오는 중입니다."
            : `시나리오 ${String(suite.scenarios.length)}건 · 실행하면 한 묶음(batch)으로 생성됩니다`
        }
        action={
          suite === undefined ? undefined : (
            <div className="flex gap-[9px]">
              <Button
                variant="danger"
                data-slot="suite-delete-open"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                삭제
              </Button>
              <Button
                variant="primary"
                data-slot="suite-run-open"
                disabled={suite.scenarios.length === 0}
                onClick={() => {
                  setRunOpen(true);
                }}
              >
                ▶ 스위트 실행
              </Button>
            </div>
          )
        }
      />

      {detail.isError ? (
        <div className="rounded-table border border-line bg-panel">
          <StateView
            tone="error"
            title="스위트를 불러오지 못했습니다"
            description={detail.error.message}
            onRetry={() => void detail.refetch()}
          />
        </div>
      ) : null}

      {suite === undefined ? null : (
        <>
          <SuiteNamePanel
            key={suite.name}
            suite={suite}
            onRename={(name) => {
              if (suiteId === undefined) return;
              patch.mutate(
                { suiteId, dto: { name } },
                {
                  onSuccess: () => {
                    toast("스위트 이름을 저장했습니다", { label: "저장" });
                  },
                },
              );
            }}
            saving={patch.isPending}
          />

          <Panel
            title="실행 순서"
            className="mt-[18px]"
            bodyClassName="p-[14px]"
            action={patch.isPending ? "저장 중…" : undefined}
          >
            {suite.scenarios.length === 0 ? (
              <StateView
                title="담긴 시나리오가 없습니다"
                description="스위트에 시나리오를 추가하면 위에서부터 차례로 실행됩니다."
                action={
                  <Button
                    variant="primary"
                    onClick={() => {
                      setAddOpen(true);
                    }}
                  >
                    ＋ 시나리오 추가
                  </Button>
                }
              />
            ) : (
              <>
                {suite.scenarios.map((scenario, index) => (
                  <div
                    key={scenario.id}
                    data-slot="suite-scenario"
                    data-sequence={index + 1}
                    className="mb-[9px] grid grid-cols-[34px_1fr_auto] items-center gap-[10px] rounded-step border border-line p-[13px] last:mb-0"
                    onKeyDown={(event) => {
                      if (!event.altKey) return;
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      const to = event.key === "ArrowUp" ? index - 1 : index + 1;
                      applyOrder(
                        moveItem(suite.scenarios, index, to).map((item) => item.id),
                      );
                    }}
                  >
                    <span className="grid h-[28px] w-[28px] place-items-center rounded-chip bg-step-no text-[11px] font-extrabold text-step-no-ink">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-[12px]">{scenario.name}</strong>
                    </span>
                    <span className="flex items-center gap-[6px]">
                      <Button
                        size="icon"
                        aria-label="위로"
                        data-slot="suite-move-up"
                        disabled={index === 0 || patch.isPending}
                        onClick={() => {
                          applyOrder(
                            moveItem(suite.scenarios, index, index - 1).map((item) => item.id),
                          );
                        }}
                      >
                        ▲
                      </Button>
                      <Button
                        size="icon"
                        aria-label="아래로"
                        data-slot="suite-move-down"
                        disabled={index === suite.scenarios.length - 1 || patch.isPending}
                        onClick={() => {
                          applyOrder(
                            moveItem(suite.scenarios, index, index + 1).map((item) => item.id),
                          );
                        }}
                      >
                        ▼
                      </Button>
                      <Button
                        variant="danger"
                        aria-label="스위트에서 제거"
                        data-slot="suite-remove-scenario"
                        disabled={suite.scenarios.length <= 1 || patch.isPending}
                        title={
                          suite.scenarios.length <= 1
                            ? "스위트에는 시나리오가 최소 1건 있어야 합니다"
                            : undefined
                        }
                        onClick={() => {
                          applyOrder(
                            suite.scenarios
                              .filter((item) => item.id !== scenario.id)
                              .map((item) => item.id),
                          );
                        }}
                      >
                        제거
                      </Button>
                    </span>
                  </div>
                ))}

                <Button
                  size="block"
                  className="mt-[12px] border-dashed border-add-step-line bg-add-step-bg text-brand"
                  data-slot="suite-add-open"
                  onClick={() => {
                    setAddOpen(true);
                  }}
                >
                  ＋ 시나리오 추가
                </Button>
              </>
            )}
          </Panel>

          <RunDialog
            open={runOpen}
            onOpenChange={setRunOpen}
            target={{ suiteId: suite.id }}
            targetName={suite.name}
            scenarioCount={suite.scenarios.length}
          />

          <AddScenarioModal
            open={addOpen}
            onOpenChange={setAddOpen}
            suite={suite}
            onSubmit={(ids) => {
              applyOrder(ids);
              setAddOpen(false);
            }}
            saving={patch.isPending}
          />

          <Modal
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title="스위트를 삭제할까요?"
            description="담긴 시나리오는 지워지지 않습니다. 이 스위트로 돌린 실행 이력도 그대로 남습니다."
            footer={
              <>
                <Button
                  onClick={() => {
                    setDeleteOpen(false);
                  }}
                >
                  취소
                </Button>
                <Button
                  variant="danger"
                  data-slot="suite-delete-confirm"
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate(suite.id, {
                      onSuccess: () => {
                        toast("스위트를 삭제했습니다", { label: "삭제" });
                        void navigate("/suites");
                      },
                    });
                  }}
                >
                  삭제
                </Button>
              </>
            }
          >
            <p className="m-0 text-[12px] leading-[1.6]">{suite.name}</p>
          </Modal>
        </>
      )}
    </>
  );
}

function SuiteNamePanel({
  suite,
  onRename,
  saving,
}: {
  suite: SuiteDetail;
  onRename: (name: string) => void;
  saving: boolean;
}) {
  // `key` 로 서버 값이 바뀔 때만 초기화한다(useEffect 금지 규율 — Gen-Phase 10 패턴).
  const [name, setName] = useState(suite.name);
  const dirty = name.trim() !== suite.name && name.trim() !== "";

  return (
    <Panel title="스위트 이름" bodyClassName="p-[18px]">
      <div className="flex items-center gap-[9px]">
        <Input
          data-slot="suite-rename"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !dirty) return;
            event.preventDefault();
            onRename(name.trim());
          }}
        />
        <Button
          variant="primary"
          data-slot="suite-rename-save"
          disabled={!dirty || saving}
          onClick={() => {
            onRename(name.trim());
          }}
        >
          저장
        </Button>
      </div>
    </Panel>
  );
}

function AddScenarioModal({
  open,
  onOpenChange,
  suite,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suite: SuiteDetail;
  onSubmit: (scenarioIds: readonly string[]) => void;
  saving: boolean;
}) {
  const scenarios = useScenarioList({ q: "", status: "", feature: "", page: 1 }, 100);
  const current = suite.scenarios.map((scenario) => scenario.id);
  const [selected, setSelected] = useState<readonly string[]>([]);

  const candidates = (scenarios.data?.items ?? []).filter(
    (scenario) => !current.includes(scenario.id),
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      title="시나리오 추가"
      description="선택한 시나리오가 목록 맨 뒤에 붙습니다. 순서는 추가 후 ▲▼ 로 바꿉니다."
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
            data-slot="suite-add-submit"
            disabled={selected.length === 0 || saving}
            onClick={() => {
              onSubmit([...current, ...selected]);
              setSelected([]);
            }}
          >
            추가
          </Button>
        </>
      }
    >
      <ScenarioPicker
        scenarios={candidates}
        selectedIds={selected}
        onToggle={(scenarioId) => {
          setSelected((prev) =>
            prev.includes(scenarioId)
              ? prev.filter((id) => id !== scenarioId)
              : [...prev, scenarioId],
          );
        }}
      />
    </Modal>
  );
}
