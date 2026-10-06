import mongoose, { Schema } from "mongoose";

export interface ApprovalDocument {
  approvalId: string;
  requestId: string;
  kind: "PLAN" | "CORRECTION" | "DELETION" | "EXPORT";
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";
  actionSetHash: string;
  requestedBy: string;
  decidedBy?: string;
  decidedByRole?: "approver";
  decidedAt?: Date;
  comment?: string;
  expiresAt: Date;
}

const ApprovalSchema = new Schema<ApprovalDocument>(
  {
    approvalId: { type: String, required: true, unique: true, trim: true },
    requestId: { type: String, required: true, index: true },
    kind: {
      type: String,
      enum: ["PLAN", "CORRECTION", "DELETION", "EXPORT"],
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CONSUMED"],
      required: true,
      index: true,
    },
    actionSetHash: { type: String, required: true },
    requestedBy: { type: String, required: true },
    decidedBy: { type: String },
    decidedByRole: { type: String, enum: ["approver"] },
    decidedAt: { type: Date },
    comment: { type: String },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true, strict: "throw" },
);

ApprovalSchema.index({ requestId: 1, kind: 1, status: 1 });

export const Approval =
  mongoose.models.Approval ||
  mongoose.model<ApprovalDocument>("Approval", ApprovalSchema);
