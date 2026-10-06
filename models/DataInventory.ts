import mongoose, { Schema } from "mongoose";
import {
  classifications,
  dataSourceNames,
  type Classification,
  type DataSourceName,
} from "@/models/model-types";

export interface InventoryField {
  name: string;
  classification: Classification;
  valuePreview: string;
  includeInExport: boolean;
  redactionReason?: string;
  deletionEligible: boolean;
  deletionReason?: string;
}

export interface InventoryItem {
  source: DataSourceName;
  recordId: string;
  fields: InventoryField[];
  relevance: "DIRECT" | "POSSIBLE" | "UNRELATED";
  notes?: string;
}

export interface DataInventoryDocument {
  requestId: string;
  version: number;
  status: "DRAFT" | "REVIEWED";
  items: InventoryItem[];
  generatedAt: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  comment?: string;
}

const InventoryFieldSchema = new Schema<InventoryField>(
  {
    name: { type: String, required: true },
    classification: { type: String, enum: classifications, required: true },
    valuePreview: { type: String, required: true, maxlength: 500 },
    includeInExport: { type: Boolean, required: true, default: false },
    redactionReason: { type: String },
    deletionEligible: { type: Boolean, required: true, default: false },
    deletionReason: { type: String },
  },
  { _id: false },
);

const InventoryItemSchema = new Schema<InventoryItem>(
  {
    source: { type: String, enum: dataSourceNames, required: true },
    recordId: { type: String, required: true },
    fields: { type: [InventoryFieldSchema], required: true, default: [] },
    relevance: {
      type: String,
      enum: ["DIRECT", "POSSIBLE", "UNRELATED"],
      required: true,
    },
    notes: { type: String },
  },
  { _id: false },
);

const DataInventorySchema = new Schema<DataInventoryDocument>(
  {
    requestId: { type: String, required: true, index: true },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["DRAFT", "REVIEWED"], required: true },
    items: { type: [InventoryItemSchema], required: true, default: [] },
    generatedAt: { type: Date, required: true },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    comment: { type: String },
  },
  { timestamps: true, strict: "throw" },
);

DataInventorySchema.index({ requestId: 1, version: 1 }, { unique: true });
DataInventorySchema.index({ status: 1, generatedAt: -1 });

export const DataInventory =
  mongoose.models.DataInventory ||
  mongoose.model<DataInventoryDocument>("DataInventory", DataInventorySchema);
