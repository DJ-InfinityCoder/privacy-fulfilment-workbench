import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendAudit, sanitizeForAudit } from "@/lib/audit";
import { AuditEvent } from "@/models/AuditEvent";
import { Counter } from "@/models/Counter";
import { listAudit, verifyAuditChain } from "@/services/audit-service";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("privacy_audit_test");
  await mongoose.connect(process.env.MONGODB_URI);
});

beforeEach(async () => {
  await Promise.all([
    AuditEvent.collection.deleteMany({}),
    Counter.collection.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

function auditEvent(index: number) {
  return {
    requestId: `PRQ-TEST-${index}`,
    actorType: "system" as const,
    actorId: "test-runner",
    eventType: "TOOL_CALL" as const,
    input: {
      source: "user_profiles",
      recordId: `USR-${index}`,
      fieldName: "email",
      value: `private-${index}@example.test`,
    },
    status: "ok" as const,
  };
}

describe("append-only audit chain", () => {
  it("appends events and verifies their hashes and links", async () => {
    await appendAudit(auditEvent(1));
    await appendAudit(auditEvent(2));

    await expect(verifyAuditChain()).resolves.toEqual({
      valid: true,
      brokenAtSeq: null,
    });
    await expect(verifyAuditChain("PRQ-TEST-2")).resolves.toEqual({
      valid: true,
      brokenAtSeq: null,
    });
  });

  it("detects tampering with a stored event", async () => {
    await appendAudit(auditEvent(1));
    await appendAudit(auditEvent(2));
    await AuditEvent.collection.updateOne(
      { seq: 1 },
      { $set: { eventType: "TOOL_FAILED" } },
    );

    await expect(verifyAuditChain()).resolves.toEqual({
      valid: false,
      brokenAtSeq: 1,
    });
  });

  it("serializes 20 concurrent appends into unique consecutive sequence numbers", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => appendAudit(auditEvent(index))),
    );
    const events = await AuditEvent.find().sort({ seq: 1 }).lean();

    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(new Set(events.map((event) => event.hash)).size).toBe(20);
    await expect(verifyAuditChain()).resolves.toEqual({
      valid: true,
      brokenAtSeq: null,
    });
  });

  it("hashes potentially sensitive values but preserves record and field identifiers", async () => {
    const safe = sanitizeForAudit({
      recordId: "USR-1001",
      fieldName: "email",
      value: "private@example.test",
      internalNotes: "synthetic private note",
    });

    expect(safe).toMatchObject({
      recordId: "USR-1001",
      fieldName: "email",
    });
    expect(safe).not.toHaveProperty("value");
    expect(safe).not.toHaveProperty("internalNotes");

    await appendAudit(auditEvent(1));
    const savedEvent = await AuditEvent.findOne({ seq: 1 }).lean();
    const serialized = JSON.stringify(savedEvent);
    expect(serialized).not.toContain("private-1@example.test");
    expect(serialized).toContain("email");
    expect(serialized).toContain("USR-1");
  });

  it("blocks document saves that attempt to mutate an existing audit event", async () => {
    await appendAudit(auditEvent(1));
    const event = await AuditEvent.findOne({ seq: 1 });
    if (!event) {
      throw new Error("Expected the audit event to exist.");
    }
    event.eventType = "TOOL_FAILED";

    await expect(event.save()).rejects.toThrow("append-only");
  });

  it("blocks query updates and deletes through schema hooks", async () => {
    await appendAudit(auditEvent(1));

    await expect(
      AuditEvent.updateOne({ seq: 1 }, { $set: { actorId: "changed" } }),
    ).rejects.toThrow("append-only");
    await expect(AuditEvent.deleteMany({})).rejects.toThrow("append-only");
  });

  it("lists events with filters and bounded pagination", async () => {
    await appendAudit(auditEvent(1));
    await appendAudit({ ...auditEvent(2), status: "denied" });
    await appendAudit(auditEvent(3));

    const page = await listAudit({
      status: "ok",
      page: 2,
      pageSize: 1,
    });
    expect(page).toMatchObject({
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    expect(page.events).toHaveLength(1);
    expect(page.events[0].seq).toBe(1);

    await expect(listAudit({ pageSize: 101 })).rejects.toThrow(
      "between 1 and 100",
    );
  });
});
