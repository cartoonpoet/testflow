import { useState } from "react";
import type * as React from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ScenarioSchema,
  type Scenario,
  type ScenarioSourceType,
} from "@testflow/contracts";
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
 *
 * ## 라운드 2 — 경로 선택 2종
 * `sourceType` 은 **생성 후 바꿀 수 없다**(`PATCH` 가 400 으로 거부한다 — 04-gen-2).
 * 그래서 만드는 이 자리에서 한 번만 고른다.
 * **기본 선택은 "녹화"** 라 기존 사용자의 조작(이름 입력 → 만들기)이 그대로다.
 */
const PATHS = [
  {
    value: "steps",
    title: "브라우저에서 녹화하기",
    description: "원격 브라우저를 직접 조작하면 단계가 자동으로 쌓입니다.",
    submit: "만들고 녹화하기",
  },
  {
    value: "code",
    title: "테스트 코드 넣기",
    description: "`playwright codegen` 산출물 같은 `.spec.ts` 파일 1개를 붙여넣거나 올립니다.",
    submit: "만들고 코드 넣기",
  },
] as const satisfies readonly {
  value: ScenarioSourceType;
  title: string;
  description: string;
  submit: string;
}[];

export function NewScenarioPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { projectId } = useCurrentProject();

  const [name, setName] = useState("");
  const [feature, setFeature] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [sourceType, setSourceType] = useState<ScenarioSourceType>("steps");

  const create = useMutation({
    mutationFn: (body: {
      name: string;
      sourceType: ScenarioSourceType;
      feature?: string;
      authorName?: string;
    }) =>
      api.post<Scenario>(`/projects/${String(projectId)}/scenarios`, body, {
        schema: ScenarioSchema,
      }),
    onSuccess: (scenario) => {
      void client.invalidateQueries({ queryKey: queryKeys.scenarios(scenario.projectId) });
      // 경로에 따라 도착지가 갈린다 — 코드 시나리오에는 빌더·인스펙터가 의미가 없다.
      navigate(
        scenario.sourceType === "code"
          ? `/scenarios/${scenario.id}/code`
          : `/scenarios/${scenario.id}`,
        { replace: true },
      );
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
      sourceType,
      ...(feature.trim() === "" ? {} : { feature: feature.trim() }),
      ...(authorName.trim() === "" ? {} : { authorName: authorName.trim() }),
    });
  };

  const selected = PATHS.find((path) => path.value === sourceType) ?? PATHS[0];

  return (
    <>
      <PageHead
        title="시나리오 만들기"
        description="만드는 방법을 고르고 이름을 정하면 바로 다음 화면으로 넘어갑니다."
      />
      <ProjectGate>
        <Panel title="새 시나리오" className="max-w-[560px]">
          <form onSubmit={submit} className="p-[18px]">
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-[7px] block p-0 text-label text-muted">
                만드는 방법
              </legend>
              <div className="grid grid-cols-2 gap-[10px] max-mobile:grid-cols-1">
                {PATHS.map((path) => (
                  <label
                    key={path.value}
                    data-slot="source-type-option"
                    data-value={path.value}
                    className={cn(
                      "block cursor-pointer rounded-step border border-line p-[13px]",
                      "transition-colors duration-150 hover:border-step-hover-line",
                      "has-[:checked]:border-step-selected-line has-[:checked]:bg-step-selected-bg",
                      "has-[:focus-visible]:shadow-focus-ring",
                    )}
                  >
                    <input
                      type="radio"
                      name="sourceType"
                      value={path.value}
                      checked={sourceType === path.value}
                      data-testid={`new-scenario-source-${path.value}`}
                      className="sr-only"
                      onChange={() => {
                        setSourceType(path.value);
                      }}
                    />
                    <strong className="block text-[12px]">{path.title}</strong>
                    <span className="mt-[4px] block text-[10px] leading-[1.6] text-muted">
                      {path.description}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-[16px] block">
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
                {create.isPending ? "만드는 중…" : selected.submit}
              </Button>
            </div>
          </form>
        </Panel>
      </ProjectGate>
    </>
  );
}
