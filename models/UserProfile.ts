import mongoose, { Schema } from "mongoose";

export interface UserProfileDocument {
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: Date;
  lastOrderCity?: string;
  address: string;
  preferences: Record<string, unknown>;
  marketingConsent: boolean;
  accountStatus: "active" | "suspended" | "closed" | "anonymized";
  internalRiskScore: number;
  internalRiskDetails?: string;
  anonymizedAt?: Date;
}

const UserProfileSchema = new Schema<UserProfileDocument>(
  {
    userId: { type: String, required: true, trim: true, unique: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    lastOrderCity: { type: String, trim: true },
    address: { type: String, required: true, trim: true },
    preferences: { type: Schema.Types.Mixed, required: true, default: {} },
    marketingConsent: { type: Boolean, required: true, default: false },
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "closed", "anonymized"],
      required: true,
      default: "active",
    },
    internalRiskScore: { type: Number, required: true, min: 0, max: 100, select: false },
    internalRiskDetails: { type: String, select: false },
    anonymizedAt: { type: Date },
  },
  { timestamps: true, strict: "throw" },
);

UserProfileSchema.index({ fullName: 1 });
UserProfileSchema.index({ accountStatus: 1, updatedAt: -1 });

export const UserProfile =
  mongoose.models.UserProfile ||
  mongoose.model<UserProfileDocument>("UserProfile", UserProfileSchema);
