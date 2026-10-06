import { randomUUID } from "node:crypto";
import { AuditEvent, type AuditEventDocument } from "@/models/AuditEvent";
import { Counter } from "@/models/Counter";
import type { AuditEventType, JsonRecord } from "@/models/model-types";
import { connectDB } from "@/lib/db";
import { sha256, stableStringify } from "@/lib/hash";

export type AuditStatus = "ok" | "error" | "denied";
export type AuditActorType = "human" | "agent" | "system";

export type AuditEventInput = {
  requestId?: string;
  actorType: AuditActorType;
  actorId: string;
  eventType: AuditEventType;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  status: AuditStatus;
  error?: unknown;
  at?: Date;
};

const auditSequenceCounterId = "auditEventSequence";
const auditChainLockId = "auditChainLock";
const lockLeaseMilliseconds = 120_000;
const lockWaitMilliseconds = 30_000;
const retryDelayMilliseconds = 10;
export const AUDIT_GENESIS_HASH = "0".repeat(64);

const safeScalarKeys = new Set([
  "actionId",
  "actorId",
  "actorType",
  "approvalId",
  "attempt",
  "attempts",
  "at",
  "classification",
  "code",
  "errorCode",
  "count",
  "dueAt",
  "eventType",
  "factor",
  "factors",
  "field",
  "fieldName",
  "id",
  "inventoryId",
  "inputTokens",
  "kind",
  "latencyMs",
  "logId",
  "model",
  "missing",
  "page",
  "pageSize",
  "planVersion",
  "provider",
  "recordId",
  "requestId",
  "score",
  "seq",
  "source",
  "status",
  "success",
  "toolName",
  "type",
  "outputTokens",
  "userId",
  "version",
  "valueHash",
]);

const sensitiveKeyPattern =
  /(?:value|raw|text|email|phone|address|birth|dob|ip|useragent|token|secret|password|risk|metadata|note|comment|message|query|payload|snapshot|details)/i;

function isHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value) || /^sha256:[a-f0-9]{32,}$/i.test(value);
}

function hashedPropertyName(key: string): string {
  return key.toLowerCase().endsWith("hash") ? key : `${key}Hash`;
}

function sanitizeValue(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return key && safeScalarKeys.has(key) ? value.toISOString() : sha256(value.toISOString());
  }

  if (Array.isArray(value)) {
    if (key && safeScalarKeys.has(key)) {
      return value.map((entry) => sanitizeValue(entry, key === "factors" ? "factor" : key));
    }
    return value.map((entry) => sanitizeValue(entry));
  }

  if (typeof value === "object") {
    const sanitized: JsonRecord = {};

    for (const [property, propertyValue] of Object.entries(value)) {
      if (
        propertyValue === null ||
        propertyValue === undefined ||
        (typeof propertyValue === "object" &&
          !(propertyValue instanceof Date))
      ) {
        sanitized[property] = sanitizeValue(propertyValue, property);
        continue;
      }

      if (
        property.toLowerCase().endsWith("hash") &&
        typeof propertyValue === "string" &&
        isHash(propertyValue)
      ) {
        sanitized[property] = propertyValue;
      } else if (
        safeScalarKeys.has(property) &&
        !sensitiveKeyPattern.test(property)
      ) {
        sanitized[property] =
          propertyValue instanceof Date
            ? propertyValue.toISOString()
            : propertyValue;
      } else {
        sanitized[hashedPropertyName(property)] = sha256(
          stableStringify(propertyValue),
        );
      }
    }

    return sanitized;
  }

  if (key && safeScalarKeys.has(key) && !sensitiveKeyPattern.test(key)) {
    return value;
  }

  return sha256(stableStringify(value));
}

export function sanitizeForAudit(value: unknown): unknown {
  return sanitizeValue(value);
}

function canonicalEvent(
  event: Omit<AuditEventDocument, "hash">,
): JsonRecord {
  return {
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
    at: event.at.toISOString(),
  };
}

export function calculateAuditEventHash(
  prevHash: string,
  event: Omit<AuditEventDocument, "hash" | "prevHash">,
): string {
  const fullEvent = canonicalEvent({ ...event, prevHash });
  return sha256(`${prevHash}${stableStringify(fullEvent)}`);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeRecord(value: unknown): JsonRecord {
  const sanitized = sanitizeForAudit(value ?? {});
  if (!isJsonRecord(sanitized)) {
    return { valueHash: sha256(stableStringify(sanitized)) };
  }
  return sanitized;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireAuditLock(): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < lockWaitMilliseconds) {
    const lockToken = randomUUID();
    const now = new Date();

    try {
      const lock = await Counter.findOneAndUpdate(
        {
          _id: auditChainLockId,
          $or: [
            { lockedUntil: { $exists: false } },
            { lockedUntil: { $lte: now } },
          ],
        },
        {
          $set: {
            lockToken,
            lockedUntil: new Date(now.getTime() + lockLeaseMilliseconds),
          },
          $setOnInsert: { value: 0 },
        },
        {
          upsert: true,
          returnDocument: "after",
          setDefaultsOnInsert: true,
        },
      );

      if (lock?.lockToken === lockToken) {
        return lockToken;
      }
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }

    await delay(retryDelayMilliseconds);
  }

  throw new Error("Timed out waiting to append to the audit chain.");
}

async function releaseAuditLock(lockToken: string): Promise<void> {
  await Counter.updateOne(
    { _id: auditChainLockId, lockToken },
    { $unset: { lockToken: 1, lockedUntil: 1 } },
  );
}

async function nextSequence(): Promise<number> {
  const lastEvent = await AuditEvent.findOne().sort({ seq: -1 }).select({ seq: 1 }).lean();
  const sequenceCounter = await Counter.findById(auditSequenceCounterId).lean();
  const lastSequence = lastEvent?.seq ?? 0;

  if (!sequenceCounter) {
    await Counter.create({ _id: auditSequenceCounterId, value: lastSequence });
  } else if (sequenceCounter.value < lastSequence) {
    await Counter.updateOne(
      { _id: auditSequenceCounterId },
      { $set: { value: lastSequence } },
    );
  }

  const counter = await Counter.findOneAndUpdate(
    { _id: auditSequenceCounterId },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean();

  if (!counter) {
    throw new Error("Failed to allocate an audit sequence number.");
  }

  return counter.value;
}

export async function appendAudit(event: AuditEventInput): Promise<AuditEventDocument> {
  await connectDB();
  const lockToken = await acquireAuditLock();
  let sequence: number | undefined;

  try {
    sequence = await nextSequence();
    const previousEvent = await AuditEvent.findOne({ seq: { $lt: sequence } })
      .sort({ seq: -1 })
      .lean();
    const prevHash = previousEvent?.hash ?? AUDIT_GENESIS_HASH;
    const eventData: Omit<AuditEventDocument, "hash" | "prevHash"> = {
      seq: sequence,
      ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
      actorType: event.actorType,
      actorId: event.actorId,
      eventType: event.eventType,
      ...(event.toolName === undefined ? {} : { toolName: event.toolName }),
      input: sanitizeRecord(event.input),
      ...(event.output === undefined
        ? {}
        : { output: sanitizeRecord(event.output) }),
      status: event.status,
      ...(event.error === undefined
        ? {}
        : { error: sanitizeRecord(event.error) }),
      at: event.at ? new Date(event.at) : new Date(),
    };
    const hash = calculateAuditEventHash(prevHash, eventData);

    return await AuditEvent.create({ ...eventData, prevHash, hash });
  } catch (error: unknown) {
    if (sequence !== undefined) {
      try {
        await Counter.updateOne(
          { _id: auditSequenceCounterId, value: sequence },
          { $inc: { value: -1 } },
        );
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [error, rollbackError],
          "Audit append failed and its sequence allocation could not be rolled back.",
        );
      }
    }
    throw error;
  } finally {
    await releaseAuditLock(lockToken);
  }
}
