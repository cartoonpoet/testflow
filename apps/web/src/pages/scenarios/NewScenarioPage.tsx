import { useState } from "react";
import type * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ScenarioSchema, type Scenario } from "@testflow/contracts";
import { ProjectGate } from "@/components";
import { Button, Input, PageHead, Panel } from "@/components/ui";
import { api, queryKeys } from "@/lib";
import { toast } from "@/hooks/useToast";
import { useCurrentProject } from "@/hooks/useProject";

/**
 * `/scenarios/new` — 빌더로 들어가기 전 **껍데기 1건**을 만든다.
 *
 * 녹화 세션은 `POST /api/scenarios/:id/recordings` 라 **시나리오가 먼저 있어야 한다.**
 * 그래서 이름만 받아 만들고 곧바로 `/scenarios/:id` 빌더로 넘긴다
 * (시안에는 이 단계가 없다 — 시안의 빌더는 이미 만들어진 시나리오를 편집하는 화면이다).
 */
export function NewScenarioPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { projectId } = useCurrentProject();

  const [name, setName] = useState("");
  const [feature, setFeature] = useState("");
  const [authorName, setAuthorName] = useState("");

  const create = useMutation({
    mutationFn: (body: { name: string; feature?: string; authorName?: string }) =>
      api.post<Scenario>(`/projects/${String(projectId)}/scenarios`, body, {
        schema: ScenarioSchema,
      }),
    onSuccess: (scenario) => {
      void client.invalidateQueries({ queryKey: queryKeys.scenarios(scenario.projectId) });
      navigate(`/scenarios/${scenario.id}`, { replace: true });
    },
    onError: (error: Error) => {
      toast(error.message, { label: "생성 실패", tone: "danger" });
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    create.mutate({
      name: trimmed,
      ...(feature.trim() === "" ? {} : { feature: feature.trim() }),
      ...(authorName.trim() === "" ? {} : { authorName: authorName.trim() }),
    });
  };

  return (
    <>
      <PageHead
        title="시나리오 만들기"
        description="먼저 이름을 정하면 바로 녹화 화면으로 넘어갑니다."
      />
      <ProjectGate>
        <Panel title="새 시나리오" className="max-w-[560px]">
          <form onSubmit={submit} className="p-[18px]">
            <label className="block">
              <span className="mb-[7px] block text-label text-muted">시나리오 이름</span>
              <Input
                value={name}
                autoFocus
                data-testid="new-scenario-name"
                placeholder="예: 정상 로그인 후 대시보드 진입"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <label className="mt-[16px] block">
              <span className="mb-[7px] block text-label text-muted">기능 (선택)</span>
              <Input
                value={feature}
                placeholder="예: 회원·인증"
                onChange={(event) => {
                  setFeature(event.target.value);
                }}
              />
            </label>
            <label className="mt-[16px] block">
              <span className="mb-[7px] block text-label text-muted">작성자 (선택)</span>
              <Input
                value={authorName}
                placeholder="예: 김테스터"
                onChange={(event) => {
                  setAuthorName(event.target.value);
                }}
              />
            </label>
            <div className="mt-[20px] flex justify-end">
              <Button
                variant="primary"
                type="submit"
                data-testid="new-scenario-submit"
                disabled={create.isPending || name.trim() === "" || projectId === undefined}
              >
                {create.isPending ? "만드는 중…" : "만들고 녹화하기"}
              </Button>
            </div>
          </form>
        </Panel>
      </ProjectGate>
    </>
  );
}
