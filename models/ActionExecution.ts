import mongoose, { Schema } from "mongoose";
import {
  dataSourceNames,
  type DataSourceName,
  type JsonRecord,
} from "@/models/model-types";

export interface ActionExecutionDocument {
  requestId: string;
  actionType: "CORRECTION" | "DELETION";
  target: {
    source: DataSourceName;
    recordId: string;
    field?: string;
  };
  payloadHash: string;
  idempotencyKey: string;
  status: "PENDING" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  attempts: number;
  leaseUntil?: Date;
  result?: JsonRecord;
  error?: JsonRecord;
  beforeSnapshot?: JsonRecord;
  afterSnapshot?: JsonRecord;
  approvalId?: string;
}

const ActionTargetSchema = new Schema<ActionExecutionDocument["target"]>(
  {
    source: { type: String, enum: dataSourceNames, required: true },
    recordId: { type: String, required: true },
    field: { type: String },
  },
  { _id: false },
);

const ActionExecutionSchema = new Schema<ActionExecutionDocument>(
  {
    requestId: { type: String, required: true, index: true },
    actionType: { type: String, enum: ["CORRECTION", "DELETION"], required: true },
    target: { type: ActionTargetSchema, required: true },
    payloadHash: { type: String, required: true },
    idempotencyKey: { type: String, required: true, unique: true, trim: true },
    status: {
      type: String,
      enum: ["PENDING", "EXECUTING", "SUCCEEDED", "FAILED", "SKIPPED"],
      required: true,
      index: true,
    },
    attempts: { type: Number, required: true, min: 0, default: 0 },
    leaseUntil: { type: Date, index: true },
    result: { type: Schema.Types.Mixed },
    error: { type: Schema.Types.Mixed },
    beforeSnapshot: { type: Schema.Types.Mixed, select: false },
    afterSnapshot: { type: Schema.Types.Mixed, select: false },
    approvalId: { type: String, index: true },
  },
  { timestamps: true, strict: "throw" },
);

ActionExecutionSchema.index({ requestId: 1, status: 1, createdAt: -1 });

export const ActionExecution =
  mongoose.models.ActionExecution ||
  mongoose.model<ActionExecutionDocument>("ActionExecution", ActionExecutionSchema);
