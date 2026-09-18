import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RUN_QUEUE_NAME } from "@testflow/contracts";
import { ProjectEntity, RunEntity, StepResultEntity } from "@testflow/db";
import { LiveStreamController } from "./live-stream.controller.js";
import { RunsController } from "./runs.controller.js";
import { RunsService } from "./runs.service.js";
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
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RunEntity, StepResultEntity, ProjectEntity]),
    BullModule.registerQueue({ name: RUN_QUEUE_NAME }),
  ],
  controllers: [RunsController, RunsSseController, LiveStreamController],
  providers: [RunsService, RunEventsService],
  exports: [RunsService, RunEventsService],
})
export class RunsModule {}
