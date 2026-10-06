import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditEvent } from "@/models/AuditEvent";
import { ActionExecution } from "@/models/ActionExecution";
import { ActivityLog } from "@/models/ActivityLog";
import { Approval } from "@/models/Approval";
import { Counter } from "@/models/Counter";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { SupportTicket } from "@/models/SupportTicket";
import { UserProfile } from "@/models/UserProfile";
import {
  createToolActionSetHash,
  getLlmToolDefinitions,
  invokeTool,
  type ToolContext,
} from "@/tools/registry";
import { sha256Json } from "@/lib/hash";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("privacy_tools_test");
  await mongoose.connect(process.env.MONGODB_URI);
});

beforeEach(async () => {
  process.env.CHAOS_MODE = "false";
  await Promise.all([
    AuditEvent.collection.deleteMany({}),
    ActionExecution.collection.deleteMany({}),
    ActivityLog.collection.deleteMany({}),
    Approval.collection.deleteMany({}),
    Counter.collection.deleteMany({}),
    PrivacyRequest.collection.deleteMany({}),
    SupportTicket.collection.deleteMany({}),
    UserProfile.collection.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function createVerifiedRequest() {
  await PrivacyRequest.create({
    requestId: "PRQ-TOOLS-0001",
    type: "CORRECTION",
    status: "VERIFIED",
    requesterName: "Taylor Example",
    requesterEmail: "taylor@example.test",
    rawText: "Please update my email address.",
    subjectUserId: "USR-TOOLS-1",
    receivedAt: new Date("2025-01-01T00:00:00.000Z"),
    dueAt: new Date("2025-01-31T00:00:00.000Z"),
    extension: { applied: false },
    assignee: "operator-1",
    verification: {
      status: "PASSED",
      attempts: 1,
      factorsSubmitted: [],
      score: 2,
      verifiedAt: new Date(),
    },
    plan: { proposedActions: [] },
  });
}

function context(
  role: "agent" | "system" = "agent",
  extras: Partial<ToolContext["actor"]> = {},
): ToolContext {
  return {
    requestId: "PRQ-TOOLS-0001",
    actor: {
      role,
      actorId: role === "system" ? "operator-system" : "planning-agent",
      actorType: role === "agent" ? "agent" : "system",
      ...extras,
    },
  };
}

async function createProfile(
  userId: string,
  fullName: string,
  email: string,
  internalRiskDetails = "CANARY-RISK-9931",
) {
  return UserProfile.create({
    userId,
    fullName,
    email,
    phone: "+1-202-555-0142",
    dateOfBirth: new Date("1990-05-16T00:00:00.000Z"),
    address: "14 Synthetic Way",
    preferences: { theme: "light" },
    marketingConsent: false,
    accountStatus: "active",
    internalRiskScore: 12,
    internalRiskDetails,
  });
}

describe("agent tool registry", () => {
  it("denies agent write tools and appends TOOL_DENIED", async () => {
    await createVerifiedRequest();

    const result = await invokeTool(context(), "apply_correction", {
      approvalId: "approval-1",
      idempotencyKey: "correction-idem-1",
      source: "user_profiles",
      recordId: "USR-TOOLS-1",
      field: "email",
      value: "new@example.test",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TOOL_NOT_PERMITTED" },
    });
    const denied = await AuditEvent.findOne({
      requestId: "PRQ-TOOLS-0001",
      eventType: "TOOL_DENIED",
    }).lean();
    expect(denied?.toolName).toBe("apply_correction");
    expect(await ActionExecution.countDocuments()).toBe(0);
  });

  it("denies unknown tools and audits the denial", async () => {
    await createVerifiedRequest();

    const result = await invokeTool(context(), "erase_everything", {});

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TOOL_NOT_PERMITTED" },
    });
    expect(
      await AuditEvent.countDocuments({
        requestId: "PRQ-TOOLS-0001",
        eventType: "TOOL_DENIED",
        toolName: "erase_everything",
      }),
    ).toBe(1);
  });

  it("scopes searches and omits restricted and third-party canary content", async () => {
    await createVerifiedRequest();
    await createProfile("USR-TOOLS-1", "Taylor Example", "taylor@example.test");
    await createProfile(
      "USR-OTHER-2",
      "Another Example",
      "other@example.test",
      "CANARY-OTHER-RISK-7782",
    );
    await SupportTicket.create({
      ticketId: "TKT-TOOLS-1",
      userId: "USR-TOOLS-1",
      subject: "Synthetic ticket",
      status: "closed",
      messages: [
        {
          author: "Taylor",
          authorType: "customer",
          text: "My synthetic request.",
          at: new Date(),
        },
        {
          author: "Other Customer",
          authorType: "other_customer",
          text: "CANARY-OTHERCUST-7782",
          at: new Date(),
        },
        {
          author: "Agent",
          authorType: "agent",
          text: "Synthetic agent-only text.",
          at: new Date(),
        },
      ],
      internalNotes: ["CANARY-INTERNAL-NOTE-9931"],
      category: "account",
    });
    await ActivityLog.create({
      logId: "LOG-TOOLS-1",
      userId: "USR-TOOLS-1",
      event: "login",
      ip: "192.0.2.41",
      userAgent: "Synthetic Browser",
      at: new Date(),
      securityFlag: true,
      metadata: { secret: "CANARY-METADATA-9931" },
    });

    const [profiles, tickets, logs] = await Promise.all([
      invokeTool(context(), "search_user_profiles", {}),
      invokeTool(context(), "search_support_tickets", {}),
      invokeTool(context(), "search_activity_logs", {}),
    ]);
    const serialized = JSON.stringify([profiles, tickets, logs]);

    expect(serialized).toContain("USR-TOOLS-1");
    expect(serialized).not.toContain("USR-OTHER-2");
    expect(serialized).not.toContain("CANARY-RISK-9931");
    expect(serialized).not.toContain("CANARY-OTHER-RISK-7782");
    expect(serialized).not.toContain("CANARY-OTHERCUST-7782");
    expect(serialized).not.toContain("CANARY-INTERNAL-NOTE-9931");
    expect(serialized).not.toContain("CANARY-METADATA-9931");
    expect(serialized).toContain("192.0.x.x");
  });

  it("enforces persisted approval and replays an idempotent correction safely", async () => {
    await createVerifiedRequest();
    await createProfile("USR-TOOLS-1", "Taylor Example", "taylor@example.test");
    const value = "corrected@example.test";
    const action = {
      actionType: "CORRECTION",
      source: "user_profiles",
      recordId: "USR-TOOLS-1",
      field: "email",
      valueHash: sha256Json(value),
    };
    const hash = createToolActionSetHash(action);
    const approval = await Approval.create({
      approvalId: "APR-TOOLS-1",
      requestId: "PRQ-TOOLS-0001",
      kind: "CORRECTION",
      status: "APPROVED",
      actionSetHash: hash,
      requestedBy: "agent",
      decidedBy: "approver-1",
      decidedByRole: "approver",
      decidedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const actor = {
      actionSetHash: hash,
      approval: { valid: true, kind: "CORRECTION" as const, actionSetHash: hash },
    };
    const input = {
      approvalId: approval.approvalId,
      idempotencyKey: "correction-idem-0001",
      source: "user_profiles" as const,
      recordId: "USR-TOOLS-1",
      field: "email",
      value,
    };

    const first = await invokeTool(context("system", actor), "apply_correction", input);
    const replay = await invokeTool(context("system", actor), "apply_correction", input);

    expect(first).toMatchObject({ ok: true, data: { applied: true } });
    expect(replay).toEqual(first);
    expect((await UserProfile.findOne({ userId: "USR-TOOLS-1" }))?.email).toBe(value);
    expect(await ActionExecution.countDocuments({ status: "SUCCEEDED" })).toBe(1);
    expect(
      await Approval.countDocuments({ approvalId: "APR-TOOLS-1", status: "CONSUMED" }),
    ).toBe(1);
  });

  it("blocks retained activity logs and anonymizes profiles for approved deletion", async () => {
    await createVerifiedRequest();
    await createProfile("USR-TOOLS-1", "Taylor Example", "taylor@example.test");
    await ActivityLog.create({
      logId: "LOG-RETAINED-1",
      userId: "USR-TOOLS-1",
      event: "security-alert",
      ip: "192.0.2.41",
      userAgent: "Synthetic Browser",
      at: new Date(),
      securityFlag: true,
      metadata: {},
    });

    const blockedAction = {
      actionType: "DELETION",
      source: "activity_logs",
      recordId: "LOG-RETAINED-1",
    };
    const blockedHash = createToolActionSetHash(blockedAction);
    await Approval.create({
      approvalId: "APR-TOOLS-RETAINED",
      requestId: "PRQ-TOOLS-0001",
      kind: "DELETION",
      status: "APPROVED",
      actionSetHash: blockedHash,
      requestedBy: "agent",
      decidedBy: "approver-1",
      decidedByRole: "approver",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const blockedResult = await invokeTool(
      context("system", {
        actionSetHash: blockedHash,
        approval: {
          valid: true,
          kind: "DELETION",
          actionSetHash: blockedHash,
        },
      }),
      "apply_deletion",
      {
        approvalId: "APR-TOOLS-RETAINED",
        idempotencyKey: "delete-retained-log-0001",
        source: "activity_logs",
        recordId: "LOG-RETAINED-1",
      },
    );
    expect(blockedResult).toMatchObject({
      ok: false,
      error: { code: "POLICY_VIOLATION" },
    });
    expect(await ActivityLog.exists({ logId: "LOG-RETAINED-1" })).not.toBeNull();

    const profileAction = {
      actionType: "DELETION",
      source: "user_profiles",
      recordId: "USR-TOOLS-1",
    };
    const profileHash = createToolActionSetHash(profileAction);
    await Approval.create({
      approvalId: "APR-TOOLS-PROFILE",
      requestId: "PRQ-TOOLS-0001",
      kind: "DELETION",
      status: "APPROVED",
      actionSetHash: profileHash,
      requestedBy: "agent",
      decidedBy: "approver-1",
      decidedByRole: "approver",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const profileResult = await invokeTool(
      context("system", {
        actionSetHash: profileHash,
        approval: {
          valid: true,
          kind: "DELETION",
          actionSetHash: profileHash,
        },
      }),
      "apply_deletion",
      {
        approvalId: "APR-TOOLS-PROFILE",
        idempotencyKey: "delete-profile-0001",
        source: "user_profiles",
        recordId: "USR-TOOLS-1",
      },
    );

    expect(profileResult).toMatchObject({
      ok: true,
      data: { applied: true, method: "anonymized", exceptionCode: "R-PRF-1" },
    });
    expect(
      await UserProfile.exists({
        userId: "USR-TOOLS-1",
        accountStatus: "anonymized",
      }),
    ).not.toBeNull();
  });

  it("only exposes read and propose tools to LLMs", () => {
    const definitions = getLlmToolDefinitions();
    expect(definitions.map(({ name }) => name)).not.toContain("apply_correction");
    expect(definitions.map(({ name }) => name)).not.toContain("apply_deletion");
    expect(definitions.map(({ name }) => name)).toContain("propose_correction");
  });
});
