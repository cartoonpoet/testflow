import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ProjectEntity,
  RecordingSessionEntity,
  ScenarioEntity,
  TestStepEntity,
} from "@testflow/db";
import { RecordingsController } from "./recordings.controller.js";
import { RecordingsService } from "./recordings.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RecordingSessionEntity,
      ScenarioEntity,
      ProjectEntity,
      TestStepEntity,
    ]),
  ],
  controllers: [RecordingsController],
  providers: [RecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
