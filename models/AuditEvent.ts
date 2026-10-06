import mongoose, { Schema } from "mongoose";
import {
  auditEventTypes,
  type AuditEventType,
  type JsonRecord,
} from "@/models/model-types";

export interface AuditEventDocument {
  seq: number;
  requestId?: string;
  actorType: "human" | "agent" | "system";
  actorId: string;
  eventType: AuditEventType;
  toolName?: string;
  input: JsonRecord;
  output?: JsonRecord;
  status: "ok" | "error" | "denied";
  error?: JsonRecord;
  at: Date;
  prevHash: string;
  hash: string;
}

const immutableAuditMessage = "Audit events are append-only and cannot be changed.";
const AuditEventSchema = new Schema<AuditEventDocument>(
  {
    seq: { type: Number, required: true, unique: true, min: 1 },
    requestId: { type: String, index: true },
    actorType: { type: String, enum: ["human", "agent", "system"], required: true },
    actorId: { type: String, required: true },
    eventType: { type: String, enum: auditEventTypes, required: true },
    toolName: { type: String },
    input: { type: Schema.Types.Mixed, required: true },
    output: { type: Schema.Types.Mixed },
    status: { type: String, enum: ["ok", "error", "denied"], required: true },
    error: { type: Schema.Types.Mixed },
    at: { type: Date, required: true, index: true },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
  },
  { timestamps: true, strict: "throw" },
);

AuditEventSchema.index({ requestId: 1, seq: 1 });
AuditEventSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error(immutableAuditMessage);
  }
});
AuditEventSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  function () {
    throw new Error(immutableAuditMessage);
  },
);

export const AuditEvent =
  mongoose.models.AuditEvent ||
  mongoose.model<AuditEventDocument>("AuditEvent", AuditEventSchema);
