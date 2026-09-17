import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ProjectSchema, type Project } from "@testflow/contracts";
import { api, queryKeys } from "@/lib";

const ProjectListSchema = z.array(ProjectSchema);

/**
 * 현재 워크스페이스의 프로젝트.
 *
 * MVP 는 **단일 공용 워크스페이스**라 프로젝트 선택 UI 가 없다(사이드바 스위처는 disabled).
 * 그래서 `GET /api/projects` 의 **첫 건**을 현재 프로젝트로 본다.
 * 프로젝트가 여럿이 되면 이 훅이 바뀌는 지점이다 — 화면들은 `projectId` 만 보므로
 * 여기 한 곳만 고치면 된다.
 *
 * `staleTime: Infinity` — 프로젝트는 화면 안에서 바뀌지 않는다.
 */
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => api.get<Project[]>("/projects", { schema: ProjectListSchema }),
    staleTime: Infinity,
  });
}

export function useCurrentProject() {
  const query = useProjects();
  return {
    ...query,
    project: query.data?.[0],
    projectId: query.data?.[0]?.id,
  };
}
