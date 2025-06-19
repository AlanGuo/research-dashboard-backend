import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";
import {
  VolumeBacktestParamsDto,
  VolumeBacktestResponse,
} from "../dto/volume-backtest-params.dto";

export type AsyncBacktestTaskDocument = AsyncBacktestTask & Document;

export enum TaskStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

@Schema({ timestamps: true })
export class AsyncBacktestTask {
  @Prop({ required: true, unique: true })
  taskId: string;

  @Prop({ required: true, enum: TaskStatus, default: TaskStatus.PENDING })
  status: TaskStatus;

  @Prop({ required: true, type: Object })
  params: VolumeBacktestParamsDto;

  @Prop()
  currentTime: string; // 当前处理的时间点 (ISO string)

  @Prop()
  startedAt: Date;

  @Prop()
  completedAt: Date;

  @Prop()
  errorMessage: string;

  @Prop({ type: Object })
  result: VolumeBacktestResponse;

  @Prop({ default: 0 })
  processingTimeMs: number;
}

export const AsyncBacktestTaskSchema =
  SchemaFactory.createForClass(AsyncBacktestTask);

// 创建索引
AsyncBacktestTaskSchema.index({ taskId: 1 });
AsyncBacktestTaskSchema.index({ status: 1 });
AsyncBacktestTaskSchema.index({ createdAt: 1 });
