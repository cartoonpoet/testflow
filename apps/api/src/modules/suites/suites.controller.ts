import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { CreateSuiteDtoSchema, PatchSuiteDtoSchema } from "@testflow/contracts";
import type {
  CreateSuiteDto,
  PatchSuiteDto,
  SuiteDetail,
  SuiteListItem,
} from "@testflow/contracts";
import { zodBody } from "../../common/pipes/zod-validation.pipe.js";
import { SuitesService } from "./suites.service.js";

@Controller()
export class SuitesController {
  constructor(private readonly suites: SuitesService) {}

  @Get("projects/:projectId/suites")
  list(@Param("projectId") projectId: string): Promise<SuiteListItem[]> {
    return this.suites.list(projectId);
  }

  @Post("projects/:projectId/suites")
  create(
    @Param("projectId") projectId: string,
    @Body(zodBody(CreateSuiteDtoSchema)) dto: CreateSuiteDto,
  ): Promise<SuiteDetail> {
    return this.suites.create(projectId, dto);
  }

  @Get("suites/:id")
  findOne(@Param("id") id: string): Promise<SuiteDetail> {
    return this.suites.findOne(id);
  }

  @Patch("suites/:id")
  patch(
    @Param("id") id: string,
    @Body(zodBody(PatchSuiteDtoSchema)) dto: PatchSuiteDto,
  ): Promise<SuiteDetail> {
    return this.suites.patch(id, dto);
  }

  @Delete("suites/:id")
  @HttpCode(204)
  remove(@Param("id") id: string): Promise<void> {
    return this.suites.remove(id);
  }
}
