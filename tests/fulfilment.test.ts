import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendAudit } from "@/lib/audit";
import { sha256Json } from "@/lib/hash";
import { ActionExecution } from "@/models/ActionExecution";
import { Approval } from "@/models/Approval";
import { AuditEvent } from "@/models/AuditEvent";
import { Counter } from "@/models/Counter";
import { DataInventory } from "@/models/DataInventory";
import { FulfilmentRecord } from "@/models/FulfilmentRecord";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { orgPolicy } from "@/policy/org-policy";
import { decideApproval, requestApproval } from "@/services/approval-service";
import {
  calculateFulfilmentRecordHash,
  finalizeRequest,
  getFulfilmentRecord,
  verifyFulfilmentRecordHash,
} from "@/services/fulfilment-service";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("privacy_fulfilment_test");
  await mongoose.connect(process.env.MONGODB_URI);
});

beforeEach(async () => {
  await Promise.all([
    ActionExecution.collection.deleteMany({}),
    Approval.collection.deleteMany({}),
    AuditEvent.collection.deleteMany({}),
    Counter.collection.deleteMany({}),
    DataInventory.collection.deleteMany({}),
    FulfilmentRecord.collection.deleteMany({}),
    PrivacyRequest.collection.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

function plan(
  requestType: "ACCESS" | "CORRECTION" | "DELETION" = "ACCESS",
  proposedActions: Array<Record<string, unknown>> = [],
) {
  return {
    interpretation: {
      requestType,
      confidence: 1,
      summary: "Prepare a mock access export.",
      ambiguities: [],
    },
    missingInformation: [],
    verificationAssessment: { status: "PASSED", missingFactors: [] },
    likelySources: [],
    steps: [],
    proposedActions,
    risks: [],
    policyExceptions: [],
    estimatedDeadlineImpact: "None.",
    disclaimer: orgPolicy.disclaimers.plan,
    generatedBy: {
      provider: "fallback",
      model: "deterministic",
      usedFallbackPlanner: true,
    },
  };
}

async function createAccessRequest(
  requestId: string,
  options: {
    requestType?: "ACCESS" | "CORRECTION" | "DELETION";
    proposedActions?: Array<Record<string, unknown>>;
    status?: "INVENTORY_READY" | "EXECUTING";
  } = {},
) {
  const requestType = options.requestType ?? "ACCESS";
  const requestPlan = plan(requestType, options.proposedActions ?? []);
  await PrivacyRequest.create({
    requestId,
    type: requestType,
    status: options.status ?? "INVENTORY_READY",
    requesterName: "Alex Mock",
    requesterEmail: "alex@example.test",
    rawText: "Synthetic access request text.",
    subjectUserId: "USR-FULFIL-1",
    receivedAt: new Date("2025-01-01T00:00:00.000Z"),
    dueAt: new Date("2025-01-31T00:00:00.000Z"),
    extension: { applied: false },
    assignee: "analyst-1",
    verification: {
      status: "PASSED",
      attempts: 2,
      factorsSubmitted: [
        { factor: "email_match", valueHash: "a".repeat(64) },
        { factor: "knowledge_factor", valueHash: "b".repeat(64) },
      ],
      score: 2,
      verifiedAt: new Date("2025-01-02T00:00:00.000Z"),
      verifiedBy: "analyst-1",
    },
    plan: requestPlan,
    planVersion: "1",
    planHash: sha256Json(requestPlan),
  });
  await DataInventory.create({
    requestId,
    version: 1,
    status: "REVIEWED",
    items: [],
    generatedAt: new Date("2025-01-03T00:00:00.000Z"),
    reviewedBy: "analyst-1",
    reviewedAt: new Date("2025-01-03T00:05:00.000Z"),
    comment: "Reviewed synthetic inventory.",
  });
}

async function approvePlan(requestId: string) {
  const approval = await requestApproval(requestId, "PLAN", {
    actorId: "analyst-1",
    actorType: "human",
    role: "analyst",
  });
  return decideApproval(
    approval.approvalId,
    "APPROVED",
    {
      actorId: "approver-1",
      actorType: "human",
      role: "approver",
    },
  );
}

async function addAccessExportAudit(requestId: string) {
  await appendAudit({
    requestId,
    actorType: "system",
    actorId: "export-service",
    eventType: "EXPORT_GENERATED",
    input: { format: "JSON_AND_HTML", inventoryVersion: 1 },
    output: {
      contentHash: "c".repeat(64),
      manifestHash: "d".repeat(64),
      redactionCount: 2,
      recordCount: 1,
    },
    status: "ok",
  });
}

describe("fulfilment record finalization", () => {
  it("finalizes with a verifiable hash and returns the same record on replay", async () => {
    await createAccessRequest("PRQ-FULFIL-0001");
    await approvePlan("PRQ-FULFIL-0001");
    await addAccessExportAudit("PRQ-FULFIL-0001");

    const first = await finalizeRequest("PRQ-FULFIL-0001");
    const second = await finalizeRequest("PRQ-FULFIL-0001");

    expect(first.finalized).toBe(true);
    expect(second.finalized).toBe(true);
    if (!first.finalized || !second.finalized) {
      throw new Error("Expected both calls to finalize.");
    }
    expect(first.hashValid).toBe(true);
    expect(verifyFulfilmentRecordHash(first.record)).toBe(true);
    expect(first.record.contentHash).toBe(
      calculateFulfilmentRecordHash(first.record),
    );
    expect(second.idempotentReplay).toBe(true);
    expect(second.record.contentHash).toBe(first.record.contentHash);
    expect(second.record.recordId).toBe(first.record.recordId);
    expect(first.record.details.verification).toMatchObject({
      status: "PASSED",
      factorsProvided: ["email_match", "knowledge_factor"],
    });
    expect(JSON.stringify(first.record.details.verification)).not.toContain(
      "a".repeat(64),
    );
    expect(first.record.disclaimers).toContain(
      "Prepared under organizational policy v2025.1. This record is not a legal determination.",
    );
    expect(first.record.exportManifest).toMatchObject({
      generated: true,
      manifestHash: "d".repeat(64),
    });
    expect((await PrivacyRequest.findOne({ requestId: "PRQ-FULFIL-0001" }))?.status).toBe(
      "COMPLETED",
    );

    const fetched = await getFulfilmentRecord("PRQ-FULFIL-0001");
    expect(fetched.hashValid).toBe(true);
    expect(fetched.html).toContain(
      "Prepared under organizational policy v2025.1. This record is not a legal determination.",
    );
  });

  it("returns an exact precondition list without creating a partial record", async () => {
    await createAccessRequest("PRQ-FULFIL-0002");
    const result = await finalizeRequest("PRQ-FULFIL-0002");

    expect(result.finalized).toBe(false);
    if (result.finalized) {
      throw new Error("Expected preconditions to block finalization.");
    }
    expect(result.unmetPreconditions.map((item) => item.code)).toEqual(
      expect.arrayContaining(["PLAN_NOT_APPROVED", "EXPORT_REQUIRED"]),
    );
    expect(await FulfilmentRecord.countDocuments()).toBe(0);
  });

  it("blocks attempts to mutate the finalized record", async () => {
    await createAccessRequest("PRQ-FULFIL-0003");
    await approvePlan("PRQ-FULFIL-0003");
    await addAccessExportAudit("PRQ-FULFIL-0003");
    const result = await finalizeRequest("PRQ-FULFIL-0003");
    if (!result.finalized) {
      throw new Error("Expected finalization to succeed.");
    }

    await expect(
      FulfilmentRecord.updateOne(
        { requestId: "PRQ-FULFIL-0003" },
        { $set: { summary: "tampered" } },
      ),
    ).rejects.toThrow(/write-once/i);
  });

  it("stores action status and snapshot field names without snapshot values", async () => {
    const requestId = "PRQ-FULFIL-0004";
    await createAccessRequest(requestId, {
      requestType: "CORRECTION",
      status: "EXECUTING",
      proposedActions: [
        {
          type: "CORRECTION",
          source: "user_profiles",
          recordId: "USR-FULFIL-1",
          field: "email",
          newValue: "corrected@example.test",
          rationale: "Apply the requested synthetic correction.",
          reversible: true,
          risk: "LOW",
        },
      ],
    });
    await approvePlan(requestId);
    const actionApproval = await requestApproval(requestId, "CORRECTION", {
      actorId: "analyst-1",
      actorType: "human",
      role: "analyst",
    });
    await decideApproval(actionApproval.approvalId, "APPROVED", {
      actorId: "approver-1",
      actorType: "human",
      role: "approver",
    });
    await ActionExecution.create({
      requestId,
      actionType: "CORRECTION",
      target: {
        source: "user_profiles",
        recordId: "USR-FULFIL-1",
        field: "email",
      },
      payloadHash: sha256Json("corrected@example.test"),
      idempotencyKey: "fulfilment-action-unique-0001",
      status: "SUCCEEDED",
      attempts: 2,
      approvalId: actionApproval.approvalId,
      beforeSnapshot: { email: sha256Json("old@example.test") },
      afterSnapshot: { email: sha256Json("corrected@example.test") },
    });

    const result = await finalizeRequest(requestId);
    if (!result.finalized) {
      throw new Error(`Unexpected finalization block: ${JSON.stringify(result.unmetPreconditions)}`);
    }
    expect(result.record.actions[0]).toMatchObject({
      actionType: "CORRECTION",
      status: "SUCCEEDED",
      attempts: 2,
      beforeFieldNames: ["email"],
      afterFieldNames: ["email"],
    });
    expect(result.record.details.failuresAndRetries).toMatchObject({
      actionCount: 1,
      failedCount: 0,
      retryCount: 1,
    });
    expect(JSON.stringify(result.record.actions)).not.toContain("old@example.test");
    expect(JSON.stringify(result.record.actions)).not.toContain(
      "corrected@example.test",
    );
  });
});
