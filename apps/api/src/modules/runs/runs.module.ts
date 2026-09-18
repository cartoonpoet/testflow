import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RUN_QUEUE_NAME } from "@testflow/contracts";
import { ProjectEntity, RunEntity, StepResultEntity } from "@testflow/db";
import { ArtifactsModule } from "../artifacts/artifacts.module.js";
import { LiveStreamController } from "./live-stream.controller.js";
import { RunsController } from "./runs.controller.js";
import { RunsService } from "./runs.service.js";
import { StaleRunReaper } from "./runs.reaper.js";
import { RunEventsService, RunsSseController } from "./runs.sse.js";

/**
 * 실행 모듈.
 *
 * `BullModule.forRootAsync` 는 `app.module.ts` 에 이미 있으므로 여기서는
 * 큐 하나만 등록한다(Gen-Phase 4 전달사항 4번).
 *
 * `RunEventsService` 를 export 하는 이유: Gen-Phase 6 이후 다른 모듈(예: artifacts 의
 * `artifact.ready`)이 같은 발행 절차를 재사용해야 하기 때문이다. 발행 코드가 두 벌이 되면
 * `seq` 규약이 반드시 어긋난다.
 *
 * `StaleRunReaper` 는 컨트롤러가 없는 **주기 작업**이다. 다른 모듈이 부를 일이 없어
 * export 하지 않는다 — 회수 경로가 두 곳에서 불리면 중복 회수 방지 근거를 다시 따져야 한다.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RunEntity, StepResultEntity, ProjectEntity]),
    BullModule.registerQueue({ name: RUN_QUEUE_NAME }),
    /*
     * ★ 실행 삭제가 **디스크의 증적 파일까지** 지우기 위해 필요하다(라운드 8).
     *   `ArtifactsModule` 은 이 모듈을 import 하지 않으므로 순환이 아니다.
     */
    ArtifactsModule,
  ],
  controllers: [RunsController, RunsSseController, LiveStreamController],
  providers: [RunsService, RunEventsService, StaleRunReaper],
  exports: [RunsService, RunEventsService],
})
export class RunsModule {}
