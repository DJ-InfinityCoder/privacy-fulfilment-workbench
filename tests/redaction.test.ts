import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditEvent } from "@/models/AuditEvent";
import { ActivityLog } from "@/models/ActivityLog";
import { Approval } from "@/models/Approval";
import { Counter } from "@/models/Counter";
import { DataInventory } from "@/models/DataInventory";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { SupportTicket } from "@/models/SupportTicket";
import { UserProfile } from "@/models/UserProfile";
import { getExportApprovalHash, generateExport } from "@/services/export-service";
import { reviewInventory } from "@/services/inventory-service";
import { redactRecord } from "@/services/redaction-service";
import { runSearch } from "@/services/search-service";
import { GET as exportGet } from "@/app/api/requests/[id]/export/route";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("privacy_redaction_test");
  await mongoose.connect(process.env.MONGODB_URI);
});

beforeEach(async () => {
  process.env.CHAOS_MODE = "false";
  await Promise.all([
    AuditEvent.collection.deleteMany({}),
    ActivityLog.collection.deleteMany({}),
    Approval.collection.deleteMany({}),
    Counter.collection.deleteMany({}),
    DataInventory.collection.deleteMany({}),
    PrivacyRequest.collection.deleteMany({}),
    SupportTicket.collection.deleteMany({}),
    UserProfile.collection.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function prepareApprovedExport() {
  await PrivacyRequest.create({
    requestId: "PRQ-EXPORT-0001",
    type: "ACCESS",
    status: "VERIFIED",
    requesterName: "Priya Sharma",
    requesterEmail: "priya.sharma@example.test",
    rawText: "Please provide mock account information.",
    subjectUserId: "USR-1001",
    receivedAt: new Date("2025-01-01T00:00:00.000Z"),
    dueAt: new Date("2025-01-31T00:00:00.000Z"),
    extension: { applied: false },
    assignee: "privacy-ops",
    verification: {
      status: "PASSED",
      attempts: 1,
      factorsSubmitted: [],
      score: 2,
      verifiedAt: new Date(),
    },
  });
  await UserProfile.create({
    userId: "USR-1001",
    fullName: "Priya Sharma",
    email: "priya.sharma@example.test",
    phone: "+1-202-555-0101",
    dateOfBirth: new Date("1991-04-18T00:00:00.000Z"),
    lastOrderCity: "Sample City",
    address: "100 Example Avenue",
    preferences: { language: "en", theme: "light" },
    marketingConsent: true,
    accountStatus: "active",
    internalRiskScore: 18,
    internalRiskDetails: "CANARY-RISK-9931",
  });
  await SupportTicket.create({
    ticketId: "TKT-EXPORT-1",
    userId: "USR-1001",
    subject: "Mock account question",
    status: "closed",
    messages: [
      {
        author: "Priya Sharma",
        authorType: "customer",
        text: "I need help with my synthetic account.",
        at: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        author: "Other customer",
        authorType: "other_customer",
        text: "CANARY-OTHERCUST-7782 contact owner@example.test or +1-202-555-0177",
        at: new Date("2025-01-02T00:00:00.000Z"),
      },
      {
        author: "Agent",
        authorType: "agent",
        text: "CANARY-AGENT-7788 discussed with Priya Sharma.",
        at: new Date("2025-01-03T00:00:00.000Z"),
      },
    ],
    internalNotes: ["CANARY-INTERNAL-NOTE-3311"],
    category: "account",
  });
  await ActivityLog.create({
    logId: "LOG-EXPORT-1",
    userId: "USR-1001",
    event: "login",
    ip: "203.0.113.42",
    userAgent: "Synthetic Browser",
    at: new Date("2025-01-04T00:00:00.000Z"),
    securityFlag: true,
    metadata: { detail: "CANARY-LOG-METADATA-1144" },
  });

  const inventory = await runSearch("PRQ-EXPORT-0001");
  await reviewInventory(
    "PRQ-EXPORT-0001",
    {
      inventoryVersion: inventory.version,
      comment: "Reviewed export fields.",
      fields: inventory.items.flatMap((item) =>
        item.fields.map((field) => ({
          source: item.source,
          recordId: item.recordId,
          fieldName: field.name,
          includeInExport: field.includeInExport,
        })),
      ),
    },
    { actorId: "reviewer-1", actorType: "human" },
  );
  const reviewedInventory = await DataInventory.findOne({
    requestId: "PRQ-EXPORT-0001",
    version: inventory.version,
  }).lean();
  if (!reviewedInventory) {
    throw new Error("Expected the reviewed inventory to exist.");
  }
  await Approval.create({
    approvalId: "APR-EXPORT-1",
    requestId: "PRQ-EXPORT-0001",
    kind: "EXPORT",
    status: "APPROVED",
    actionSetHash: getExportApprovalHash(reviewedInventory),
    requestedBy: "privacy-ops",
    decidedBy: "approver-1",
    decidedByRole: "approver",
    decidedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
}

describe("policy redaction and export", () => {
  it("removes restricted fields, masks IPs, and redacts third-party message text", () => {
    const result = redactRecord(
      "support_tickets",
      {
        ticketId: "TKT-REDACT-1",
        subject: "Synthetic subject",
        internalNotes: ["CANARY-INTERNAL-4444"],
        messages: [
          {
            authorType: "other_customer",
            text: "Contact Alice Example at alice@example.test or +1-202-555-0199.",
          },
          {
            authorType: "agent",
            text: "Spoke with Alice Example; call 202-555-0123.",
          },
          { authorType: "customer", text: "My own mock request." },
        ],
      },
      ["Alice Example"],
    );
    const json = JSON.stringify(result);

    expect(result.record).not.toHaveProperty("internalNotes");
    expect(json).not.toContain("alice@example.test");
    expect(json).not.toContain("202-555-0199");
    expect(json).not.toContain("Alice Example");
    expect(json).toContain("[REDACTED: third-party data]");
    expect(result.manifest.map((entry) => entry.ruleId)).toContain(
      "REDACT-FREE-TEXT-EMAIL",
    );
    expect(result.manifest.map((entry) => entry.ruleId)).toContain(
      "REDACT-FREE-TEXT-PHONE",
    );
    expect(result.manifest.map((entry) => entry.ruleId)).toContain(
      "REDACT-FREE-TEXT-NAME",
    );

    const ipResult = redactRecord("activity_logs", {
      logId: "LOG-REDACT-1",
      event: "login",
      ip: "203.0.113.42",
      securityFlag: true,
    });
    expect(ipResult.record.ip).toBe("203.0.113.xxx");
    expect(ipResult.record).not.toHaveProperty("securityFlag");
  });

  it("generates JSON and HTML without seeded restricted or third-party canaries", async () => {
    await prepareApprovedExport();

    const generated = await generateExport("PRQ-EXPORT-0001", {
      actorId: "privacy-ops",
      actorType: "human",
    });
    const outputs = `${JSON.stringify(generated.json)}\n${generated.html}`;

    for (const canary of [
      "CANARY-RISK-9931",
      "CANARY-OTHERCUST-7782",
      "CANARY-AGENT-7788",
      "CANARY-INTERNAL-NOTE-3311",
      "CANARY-LOG-METADATA-1144",
      "owner@example.test",
      "+1-202-555-0177",
    ]) {
      expect(outputs).not.toContain(canary);
    }
    expect(generated.json.redactionManifest.length).toBeGreaterThan(0);
    expect(generated.json.disclaimer).toContain("does not provide legal advice");
    expect(generated.html).toContain(generated.json.contentHash);
    expect(
      await AuditEvent.countDocuments({
        requestId: "PRQ-EXPORT-0001",
        eventType: "EXPORT_GENERATED",
      }),
    ).toBe(1);
  });

  it("requires a current matching export approval and supports JSON/HTML routes", async () => {
    await prepareApprovedExport();
    const jsonResponse = await exportGet(
      new Request("http://localhost/api/requests/PRQ-EXPORT-0001/export?format=json"),
      { params: Promise.resolve({ id: "PRQ-EXPORT-0001" }) },
    );
    const htmlResponse = await exportGet(
      new Request("http://localhost/api/requests/PRQ-EXPORT-0001/export?format=html"),
      { params: Promise.resolve({ id: "PRQ-EXPORT-0001" }) },
    );

    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get("content-type")).toContain("application/json");
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get("content-type")).toContain("text/html");
    expect(await htmlResponse.text()).toContain("Redaction manifest");
  });

  it("rejects a missing or mismatched EXPORT approval", async () => {
    await prepareApprovedExport();
    await Approval.updateOne(
      { approvalId: "APR-EXPORT-1" },
      { $set: { actionSetHash: "not-the-reviewed-inventory-hash" } },
    );

    const response = await exportGet(
      new Request("http://localhost/api/requests/PRQ-EXPORT-0001/export?format=json"),
      { params: Promise.resolve({ id: "PRQ-EXPORT-0001" }) },
    );
    const payload = (await response.json()) as {
      error?: { code?: string };
    };

    expect(response.status).toBe(403);
    expect(payload.error?.code).toBe("APPROVAL_REQUIRED");
  });
});
