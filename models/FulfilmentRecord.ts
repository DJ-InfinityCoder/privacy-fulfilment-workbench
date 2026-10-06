import mongoose, { Schema } from "mongoose";
import type { JsonRecord } from "@/models/model-types";

export interface FulfilmentRecordDocument {
  requestId: string;
  recordId: string;
  summary: string;
  timeline: unknown[];
  approvals: unknown[];
  actions: unknown[];
  inventoryVersion: number;
  exportManifest: JsonRecord;
  details: JsonRecord;
  disclaimers: string[];
  contentHash: string;
  finalizedAt: Date;
}

const immutableFulfilmentMessage =
  "Finalized fulfilment records are write-once and cannot be changed.";
const FulfilmentRecordSchema = new Schema<FulfilmentRecordDocument>(
  {
    requestId: { type: String, required: true, unique: true },
    recordId: { type: String, required: true, unique: true },
    summary: { type: String, required: true },
    timeline: { type: [Schema.Types.Mixed], required: true, default: [] },
    approvals: { type: [Schema.Types.Mixed], required: true, default: [] },
    actions: { type: [Schema.Types.Mixed], required: true, default: [] },
    inventoryVersion: { type: Number, required: true, min: 1 },
    exportManifest: { type: Schema.Types.Mixed, required: true },
    details: { type: Schema.Types.Mixed, required: true },
    disclaimers: { type: [String], required: true, default: [] },
    contentHash: { type: String, required: true, unique: true },
    finalizedAt: { type: Date, required: true },
  },
  { timestamps: true, strict: "throw" },
);

FulfilmentRecordSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error(immutableFulfilmentMessage);
  }
});
FulfilmentRecordSchema.pre(
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
    throw new Error(immutableFulfilmentMessage);
  },
);

export const FulfilmentRecord =
  mongoose.models.FulfilmentRecord ||
  mongoose.model<FulfilmentRecordDocument>(
    "FulfilmentRecord",
    FulfilmentRecordSchema,
  );
