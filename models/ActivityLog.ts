import mongoose, { Schema } from "mongoose";
import type { JsonRecord } from "@/models/model-types";

export interface ActivityLogDocument {
  logId: string;
  userId: string;
  event: string;
  ip: string;
  userAgent: string;
  at: Date;
  securityFlag: boolean;
  metadata: JsonRecord;
}

const ActivityLogSchema = new Schema<ActivityLogDocument>(
  {
    logId: { type: String, required: true, unique: true, trim: true },
    userId: { type: String, required: true },
    event: { type: String, required: true, trim: true },
    ip: { type: String, required: true, trim: true },
    userAgent: { type: String, required: true },
    at: { type: Date, required: true, index: true },
    securityFlag: { type: Boolean, required: true, default: false },
    metadata: { type: Schema.Types.Mixed, required: true, default: {} },
  },
  { timestamps: true, strict: "throw" },
);

ActivityLogSchema.index({ userId: 1, at: -1 });
ActivityLogSchema.index({ securityFlag: 1, at: 1 });

export const ActivityLog =
  mongoose.models.ActivityLog ||
  mongoose.model<ActivityLogDocument>("ActivityLog", ActivityLogSchema);
