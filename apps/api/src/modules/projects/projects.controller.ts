import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { PatchProjectDtoSchema } from "@testflow/contracts";
import type { PatchProjectDto, Project } from "@testflow/contracts";
import { zodBody } from "../../common/pipes/zod-validation.pipe.js";
import { ProjectsService } from "./projects.service.js";

/** ERDify 규약 — `@Controller()` 빈 인자 + 메서드마다 전체 경로. */
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get("projects")
  findAll(): Promise<Project[]> {
    return this.projects.findAll();
  }

  @Get("projects/:id")
  findOne(@Param("id") id: string): Promise<Project> {
    return this.projects.findOne(id);
  }

  @Patch("projects/:id")
  patch(
    @Param("id") id: string,
    @Body(zodBody(PatchProjectDtoSchema)) dto: PatchProjectDto,
  ): Promise<Project> {
    return this.projects.patch(id, dto);
  }
}
