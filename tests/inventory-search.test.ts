import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditEvent } from "@/models/AuditEvent";
import { ActivityLog } from "@/models/ActivityLog";
import { Counter } from "@/models/Counter";
import { DataInventory } from "@/models/DataInventory";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { SupportTicket } from "@/models/SupportTicket";
import { UserProfile } from "@/models/UserProfile";
import { runSearch } from "@/services/search-service";
import { reviewInventory } from "@/services/inventory-service";
import { transitionRequestStatus } from "@/services/state-machine";
import { POST as reviewPost } from "@/app/api/requests/[id]/inventory/review/route";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("privacy_inventory_test");
  await mongoose.connect(process.env.MONGODB_URI);
});

beforeEach(async () => {
  process.env.CHAOS_MODE = "false";
  await Promise.all([
    AuditEvent.collection.deleteMany({}),
    ActivityLog.collection.deleteMany({}),
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

async function addVerifiedRequest() {
  return PrivacyRequest.create({
    requestId: "PRQ-INVENTORY-0001",
    type: "ACCESS",
    status: "VERIFIED",
    requesterName: "Priya Sharma",
    requesterEmail: "priya@example.test",
    rawText: "Please provide the mock account information.",
    subjectUserId: "USR-INVENTORY-1",
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
}

async function addMockSources() {
  await UserProfile.create({
    userId: "USR-INVENTORY-1",
    fullName: "Priya Sharma",
    email: "priya@example.test",
    phone: "+1-202-555-0142",
    dateOfBirth: new Date("1991-04-18T00:00:00.000Z"),
    address: "100 Example Avenue",
    preferences: { theme: "light" },
    marketingConsent: true,
    accountStatus: "active",
    internalRiskScore: 18,
    internalRiskDetails: "CANARY-RISK-9931",
  });
  await SupportTicket.create({
    ticketId: "TKT-INVENTORY-1",
    userId: "USR-INVENTORY-1",
    subject: "Mock account question",
    status: "closed",
    messages: [
      {
        author: "Priya",
        authorType: "customer",
        text: "My synthetic request.",
        at: new Date(),
      },
      {
        author: "Other customer",
        authorType: "other_customer",
        text: "CANARY-OTHERCUST-7782",
        at: new Date(),
      },
    ],
    internalNotes: ["CANARY-INTERNAL-NOTE-3311"],
    category: "account",
  });
  await ActivityLog.create({
    logId: "LOG-INVENTORY-1",
    userId: "USR-INVENTORY-1",
    event: "login",
    ip: "192.0.2.41",
    userAgent: "Synthetic Browser",
    at: new Date(),
    securityFlag: true,
    metadata: { note: "CANARY-METADATA-9911" },
  });
}

describe("request search and inventory", () => {
  it("searches all three sources and creates a classified, redacted inventory", async () => {
    await addVerifiedRequest();
    await addMockSources();

    const inventory = await runSearch("PRQ-INVENTORY-0001", {
      actorId: "privacy-ops",
      actorType: "human",
    });
    const request = await PrivacyRequest.findOne({
      requestId: "PRQ-INVENTORY-0001",
    });
    const sources = new Set(inventory.items.map((item) => item.source));
    const profile = inventory.items.find((item) => item.source === "user_profiles");
    const ticket = inventory.items.find((item) => item.source === "support_tickets");
    const log = inventory.items.find((item) => item.source === "activity_logs");

    expect([...sources]).toEqual([
      "user_profiles",
      "support_tickets",
      "activity_logs",
    ]);
    expect(request?.status).toBe("INVENTORY_READY");
    expect(profile?.fields).toContainEqual(
      expect.objectContaining({
        name: "internalRiskScore",
        classification: "RESTRICTED",
        includeInExport: false,
      }),
    );
    expect(profile?.fields.find((field) => field.name === "email")?.valuePreview).not.toBe(
      "priya@example.test",
    );
    expect(ticket?.relevance).toBe("POSSIBLE");
    expect(ticket?.fields).toContainEqual(
      expect.objectContaining({
        name: "internalNotes",
        classification: "INTERNAL",
        includeInExport: false,
      }),
    );
    expect(ticket?.fields).toContainEqual(
      expect.objectContaining({
        name: "thirdPartyMessages",
        classification: "THIRD_PARTY",
        includeInExport: false,
      }),
    );
    expect(log?.fields).toContainEqual(
      expect.objectContaining({
        name: "securityFlag",
        classification: "RESTRICTED",
        deletionEligible: false,
        deletionReason: expect.stringContaining("365 days"),
      }),
    );
    expect(JSON.stringify(inventory)).not.toContain("CANARY-RISK-9931");
    expect(JSON.stringify(inventory)).not.toContain("CANARY-OTHERCUST-7782");
    expect(JSON.stringify(inventory)).not.toContain("CANARY-INTERNAL-NOTE-3311");
    expect(JSON.stringify(inventory)).not.toContain("CANARY-METADATA-9911");
  });

  it("denies enabling restricted export fields with HTTP 409 policy error", async () => {
    await addVerifiedRequest();
    await addMockSources();
    const inventory = await runSearch("PRQ-INVENTORY-0001");
    const profile = inventory.items.find((item) => item.source === "user_profiles");
    if (!profile) {
      throw new Error("Expected the profile inventory item.");
    }

    await expect(
      reviewInventory(
        "PRQ-INVENTORY-0001",
        {
          inventoryVersion: inventory.version,
          comment: "Reviewed inventory",
          fields: [
            {
              source: "user_profiles",
              recordId: profile.recordId,
              fieldName: "internalRiskScore",
              includeInExport: true,
            },
          ],
        },
        { actorId: "reviewer-1", actorType: "human" },
      ),
    ).rejects.toMatchObject({
      code: "POLICY_VIOLATION",
      httpStatus: 409,
    });
    const response = await reviewPost(
      new Request("http://localhost/api/requests/PRQ-INVENTORY-0001/inventory/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryVersion: inventory.version,
          comment: "Attempt blocked field toggle",
          fields: [
            {
              source: "user_profiles",
              recordId: profile.recordId,
              fieldName: "internalRiskScore",
              includeInExport: true,
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "PRQ-INVENTORY-0001" }) },
    );
    expect(response.status).toBe(409);
    expect(
      await DataInventory.findOne({
        requestId: "PRQ-INVENTORY-0001",
        version: inventory.version,
      }).then((saved) => saved?.status),
    ).toBe("DRAFT");
  });

  it("reviews an inventory and regenerates as a new version without overwriting", async () => {
    await addVerifiedRequest();
    await addMockSources();
    const first = await runSearch("PRQ-INVENTORY-0001");
    await reviewInventory(
      "PRQ-INVENTORY-0001",
      {
        inventoryVersion: first.version,
        comment: "Reviewed all source matches.",
        fields: first.items.flatMap((item) =>
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

    const second = await runSearch("PRQ-INVENTORY-0001");
    const versions = await DataInventory.find({
      requestId: "PRQ-INVENTORY-0001",
    })
      .sort({ version: 1 })
      .lean();

    expect(second.version).toBe(2);
    expect(versions.map((version) => version.version)).toEqual([1, 2]);
    expect(versions[0].status).toBe("REVIEWED");
    expect(versions[1].status).toBe("DRAFT");
  });

  it("supports explicitly transitioning an already verified request into search", async () => {
    await addVerifiedRequest();
    await transitionRequestStatus("PRQ-INVENTORY-0001", "SEARCHING", {
      actorId: "privacy-ops",
      actorType: "human",
    });
    await addMockSources();

    const inventory = await runSearch("PRQ-INVENTORY-0001");
    expect(inventory.items).toHaveLength(3);
  });
});
