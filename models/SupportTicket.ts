import mongoose, { Schema } from "mongoose";

export interface SupportMessage {
  author: string;
  authorType: "customer" | "agent" | "other_customer";
  text: string;
  at: Date;
}

export interface SupportTicketDocument {
  ticketId: string;
  userId: string;
  subject: string;
  status: "open" | "closed" | "legal_hold";
  messages: SupportMessage[];
  internalNotes: string[];
  category: string;
}

const MessageSchema = new Schema<SupportMessage>(
  {
    author: { type: String, required: true },
    authorType: {
      type: String,
      enum: ["customer", "agent", "other_customer"],
      required: true,
    },
    text: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const SupportTicketSchema = new Schema<SupportTicketDocument>(
  {
    ticketId: { type: String, required: true, unique: true, trim: true },
    userId: { type: String, required: true, index: true },
    subject: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["open", "closed", "legal_hold"],
      required: true,
      index: true,
    },
    messages: { type: [MessageSchema], required: true, default: [] },
    internalNotes: { type: [String], required: true, default: [], select: false },
    category: { type: String, required: true, trim: true },
  },
  { timestamps: true, strict: "throw" },
);

SupportTicketSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const SupportTicket =
  mongoose.models.SupportTicket ||
  mongoose.model<SupportTicketDocument>("SupportTicket", SupportTicketSchema);
