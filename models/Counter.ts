import mongoose, { Schema } from "mongoose";

export interface CounterDocument {
  _id: string;
  value: number;
  lockedUntil?: Date;
  lockToken?: string;
}

const CounterSchema = new Schema<CounterDocument>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, min: 0, default: 0 },
    lockedUntil: { type: Date },
    lockToken: { type: String },
  },
  { timestamps: true, versionKey: false, strict: "throw" },
);

export const Counter =
  mongoose.models.Counter || mongoose.model<CounterDocument>("Counter", CounterSchema);
