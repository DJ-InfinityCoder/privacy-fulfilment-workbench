import { AuditEvent, type AuditEventDocument } from "@/models/AuditEvent";
import {
  AUDIT_GENESIS_HASH,
  calculateAuditEventHash,
} from "@/lib/audit";
import { connectDB } from "@/lib/db";

export type ListAuditOptions = {
  requestId?: string;
  eventType?: string;
  status?: "ok" | "error" | "denied";
  page?: number;
  pageSize?: number;
};

export type AuditPage = {
  events: AuditEventDocument[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AuditChainVerification = {
  valid: boolean;
  brokenAtSeq: number | null;
};

export async function verifyAuditChain(
  requestId?: string,
): Promise<AuditChainVerification> {
  await connectDB();

  let endAtSequence: number | undefined;
  if (requestId !== undefined) {
    const latestRequestEvent = await AuditEvent.findOne({ requestId })
      .sort({ seq: -1 })
      .select({ seq: 1 })
      .lean();
    if (!latestRequestEvent) {
      return { valid: true, brokenAtSeq: null };
    }
    endAtSequence = latestRequestEvent.seq;
  }

  const events = await AuditEvent.find(
    endAtSequence === undefined ? {} : { seq: { $lte: endAtSequence } },
  )
    .sort({ seq: 1 })
    .lean();
  let previousSequence: number | null = null;
  let previousHash = AUDIT_GENESIS_HASH;

  for (const event of events) {
    if (
      (previousSequence === null && event.seq !== 1) ||
      (previousSequence !== null && event.seq !== previousSequence + 1) ||
      event.prevHash !== previousHash
    ) {
      return { valid: false, brokenAtSeq: event.seq };
    }

    if (
      calculateAuditEventHash(event.prevHash, {
        seq: event.seq,
        ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
        actorType: event.actorType,
        actorId: event.actorId,
        eventType: event.eventType,
        ...(event.toolName === undefined ? {} : { toolName: event.toolName }),
        input: event.input,
        ...(event.output === undefined ? {} : { output: event.output }),
        status: event.status,
        ...(event.error === undefined ? {} : { error: event.error }),
        at: event.at,
      }) !==
      event.hash
    ) {
      return { valid: false, brokenAtSeq: event.seq };
    }

    previousSequence = event.seq;
    previousHash = event.hash;
  }

  return { valid: true, brokenAtSeq: null };
}

export async function listAudit(options: ListAuditOptions = {}): Promise<AuditPage> {
  await connectDB();

  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;

  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("Audit page must be a positive integer.");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new RangeError("Audit page size must be an integer between 1 and 100.");
  }

  const query = {
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    ...(options.eventType === undefined ? {} : { eventType: options.eventType }),
    ...(options.status === undefined ? {} : { status: options.status }),
  };
  const [events, total] = await Promise.all([
    AuditEvent.find(query)
      .sort({ seq: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    AuditEvent.countDocuments(query),
  ]);

  return {
    events,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
