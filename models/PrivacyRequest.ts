import mongoose, { Schema } from "mongoose";
import {
  requestStatuses,
  requestTypes,
  type JsonRecord,
  type RequestStatus,
  type RequestType,
} from "@/models/model-types";

export interface SubmittedVerificationFactor {
  factor: string;
  valueHash: string;
}

export interface PrivacyRequestDocument {
  requestId: string;
  type: RequestType;
  status: RequestStatus;
  requesterName: string;
  requesterEmail: string;
  rawText: string;
  subjectUserId?: string;
  receivedAt: Date;
  dueAt: Date;
  extension: {
    applied: boolean;
    reason?: string;
    newDueAt?: Date;
  };
  assignee?: string;
  verification: {
    status: "PENDING" | "PASSED" | "FAILED" | "LOCKED" | "AMBIGUOUS";
    attempts: number;
    factorsSubmitted: SubmittedVerificationFactor[];
    score: number;
    verifiedAt?: Date;
    verifiedBy?: string;
  };
  plan?: JsonRecord;
  planVersion?: string;
  planHash?: string;
  inventoryId?: string;
  fulfilmentRecordId?: string;
}

const SubmittedFactorSchema = new Schema<SubmittedVerificationFactor>(
  {
    factor: { type: String, required: true },
    valueHash: { type: String, required: true },
  },
  { _id: false },
);

const PrivacyRequestSchema = new Schema<PrivacyRequestDocument>(
  {
    requestId: { type: String, required: true, unique: true, trim: true },
    type: { type: String, enum: requestTypes, required: true, index: true },
    status: { type: String, enum: requestStatuses, required: true, index: true },
    requesterName: { type: String, required: true, trim: true },
    requesterEmail: { type: String, required: true, trim: true, lowercase: true },
    rawText: { type: String, required: true },
    subjectUserId: { type: String, index: true },
    receivedAt: { type: Date, required: true, index: true },
    dueAt: { type: Date, required: true },
    extension: {
      applied: { type: Boolean, required: true, default: false },
      reason: { type: String },
      newDueAt: { type: Date },
    },
    assignee: { type: String, trim: true },
    verification: {
      status: {
        type: String,
        enum: ["PENDING", "PASSED", "FAILED", "LOCKED", "AMBIGUOUS"],
        required: true,
        default: "PENDING",
      },
      attempts: { type: Number, required: true, min: 0, default: 0 },
      factorsSubmitted: { type: [SubmittedFactorSchema], required: true, default: [] },
      score: { type: Number, required: true, min: 0, max: 3, default: 0 },
      verifiedAt: { type: Date },
      verifiedBy: { type: String },
    },
    plan: { type: Schema.Types.Mixed },
    planVersion: { type: String },
    planHash: { type: String },
    inventoryId: { type: String },
    fulfilmentRecordId: { type: String },
  },
  { timestamps: true, strict: "throw" },
);

PrivacyRequestSchema.index({ status: 1, dueAt: 1 });
PrivacyRequestSchema.index({ requesterEmail: 1, receivedAt: -1 });

export const PrivacyRequest =
  mongoose.models.PrivacyRequest ||
  mongoose.model<PrivacyRequestDocument>("PrivacyRequest", PrivacyRequestSchema);
