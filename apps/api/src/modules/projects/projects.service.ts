import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ProjectEntity } from "@testflow/db";
import type { PatchProjectDto, Project } from "@testflow/contracts";

/**
 * 프로젝트 — **화면이 없는 값 공급용 모듈**이다 (03-phases Task 4.5).
 *
 * ## `baseUrl` 의 용도
 * `projects.base_url` 은 **실행 다이얼로그의 기본값(placeholder)** 일 뿐이다.
 * 실행 요청(`POST /api/runs`)은 `baseUrl` 을 body 로 직접 받는 것이 주 경로이고,
 * 이 값은 그 입력창에 미리 채워 넣을 후보에 지나지 않는다
 * (02-context "★ 사용자 최종 결정" (a)).
 *
 * ## `variables` 가 없는 이유
 * 계정·비밀번호를 DB 에 저장하지 않기로 확정했다(동 (c)). `project_variables` 테이블도,
 * 엔티티도, 응답 필드도 **존재하지 않는다.** 실행 변수는 실행 요청 body 로만 들어오고
 * 큐 페이로드에만 잠깐 존재한다.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
  ) {}

  /** `GET /api/projects` — 목록. 시안 API 스펙대로 4개 필드만 낸다. */
  async findAll(): Promise<Project[]> {
    const rows = await this.projects.find({ order: { createdAt: "ASC" } });
    return rows.map(toProjectSummary);
  }

  /** `GET /api/projects/:id` — 상세. 목록 4필드 + 시각 2종. */
  async findOne(id: string): Promise<Project> {
    return toProjectDetail(await this.mustFind(id));
  }

  /** `PATCH /api/projects/:id` */
  async patch(id: string, dto: PatchProjectDto): Promise<Project> {
    const project = await this.mustFind(id);

    if (dto.name !== undefined) project.name = dto.name;
    if (dto.baseUrl !== undefined) project.baseUrl = dto.baseUrl;
    if (dto.defaultEnvLabel !== undefined) project.defaultEnvLabel = dto.defaultEnvLabel;

    return toProjectDetail(await this.projects.save(project));
  }

  private async mustFind(id: string): Promise<ProjectEntity> {
    const project = await this.projects.findOne({ where: { id } });
    if (!project) throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${id}`);
    return project;
  }
}

function toProjectSummary(entity: ProjectEntity): Project {
  return {
    id: entity.id,
    name: entity.name,
    baseUrl: entity.baseUrl,
    defaultEnvLabel: entity.defaultEnvLabel,
  };
}

function toProjectDetail(entity: ProjectEntity): Project {
  return {
    ...toProjectSummary(entity),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
