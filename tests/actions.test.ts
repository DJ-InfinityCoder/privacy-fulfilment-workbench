import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AuditEvent } from "@/models/AuditEvent";
import { ActionExecution } from "@/models/ActionExecution";
import { ActivityLog } from "@/models/ActivityLog";
import { Approval } from "@/models/Approval";
import { Counter } from "@/models/Counter";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { SupportTicket } from "@/models/SupportTicket";
import { UserProfile } from "@/models/UserProfile";
import { sha256Json } from "@/lib/hash";
import {
  decideApproval,
  requestApproval,
} from "@/services/approval-service";
import {
  executeApprovedActions,
  retryAction,
} from "@/services/action-service";
import { orgPolicy } from "@/policy/org-policy";

let mongo: MongoMemoryServer;

const analyst = {
  actorId: "operator-1",
  actorType: "human" as const,
  role: "analyst",
};
const approver = {
  actorId: "approver-1",
  actorType: "human" as const,
  role: "approver",
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("privacy_actions_test");
  await mongoose.connect(process.env.MONGODB_URI);
});

beforeEach(async () => {
  process.env.CHAOS_MODE = "false";
  vi.restoreAllMocks();
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

function plan(proposedActions: Array<Record<string, unknown>>) {
  return {
    interpretation: {
      requestType: "DELETION",
      confidence: 1,
      summary: "Demonstration action plan.",
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

async function createRequest(
  requestId: string,
  proposedActions: Array<Record<string, unknown>>,
) {
  const requestPlan = plan(proposedActions);
  await PrivacyRequest.create({
    requestId,
    type: "DELETION",
    status: "VERIFIED",
    requesterName: "Morgan Example",
    requesterEmail: "morgan@example.test",
    rawText: "Please fulfil my mock privacy request.",
    subjectUserId: "USR-ACTIONS-1",
    receivedAt: new Date("2025-01-01T00:00:00.000Z"),
    dueAt: new Date("2025-01-31T00:00:00.000Z"),
    extension: { applied: false },
    assignee: analyst.actorId,
    verification: {
      status: "PASSED",
      attempts: 2,
      factorsSubmitted: [],
      score: 2,
      verifiedAt: new Date(),
    },
    plan: requestPlan,
    planVersion: "1",
    planHash: sha256Json(requestPlan),
  });
}

async function createProfile() {
  return UserProfile.create({
    userId: "USR-ACTIONS-1",
    fullName: "Morgan Example",
    email: "morgan@example.test",
    phone: "+1-202-555-0172",
    dateOfBirth: new Date("1990-02-03T00:00:00.000Z"),
    address: "17 Mockingbird Lane",
    preferences: { theme: "light" },
    marketingConsent: true,
    accountStatus: "active",
    internalRiskScore: 14,
    internalRiskDetails: "Synthetic only.",
  });
}

function deletionAction(recordId = "USR-ACTIONS-1") {
  return {
    type: "DELETION",
    source: "user_profiles",
    recordId,
    rationale: "Fulfil the verified mock deletion request.",
    reversible: false,
    risk: "MEDIUM",
  };
}

function correctionAction(newValue = "updated@example.test") {
  return {
    type: "CORRECTION",
    source: "user_profiles",
    recordId: "USR-ACTIONS-1",
    field: "email",
    newValue,
    rationale: "Use the value proposed for this mock request.",
    reversible: true,
    risk: "LOW",
  };
}

async function approve(requestId: string, kind: "CORRECTION" | "DELETION") {
  const created = await requestApproval(requestId, kind, analyst);
  await decideApproval(created.approvalId, "APPROVED", approver);
  return Approval.findOne({ approvalId: created.approvalId });
}

describe("approval-bound idempotent action execution", () => {
  it("applies a correction once and audits a duplicate replay", async () => {
    await createRequest("PRQ-ACTIONS-0001", [correctionAction()]);
    await createProfile();
    await approve("PRQ-ACTIONS-0001", "CORRECTION");

    const first = await executeApprovedActions("PRQ-ACTIONS-0001", "CORRECTION");
    const second = await executeApprovedActions("PRQ-ACTIONS-0001", "CORRECTION");

    expect(first.outcomes).toHaveLength(1);
    expect(second.outcomes[0]?.status).toBe("SUCCEEDED");
    expect(
      (await UserProfile.findOne({ userId: "USR-ACTIONS-1" }))?.email,
    ).toBe("updated@example.test");
    expect(await ActionExecution.countDocuments({ status: "SUCCEEDED" })).toBe(1);
    expect(
      await AuditEvent.countDocuments({ eventType: "ACTION_SKIPPED_DUPLICATE" }),
    ).toBeGreaterThanOrEqual(1);
    expect((await Approval.findOne({ requestId: "PRQ-ACTIONS-0001" }))?.status).toBe(
      "CONSUMED",
    );
  });

  it("allows five concurrent executions to produce only one tombstone", async () => {
    await createRequest("PRQ-ACTIONS-0002", [deletionAction()]);
    await createProfile();
    await approve("PRQ-ACTIONS-0002", "DELETION");

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        executeApprovedActions("PRQ-ACTIONS-0002", "DELETION"),
      ),
    );

    const profile = await UserProfile.findOne({ userId: "USR-ACTIONS-1" });
    expect(profile?.accountStatus).toBe("anonymized");
    expect(profile?.fullName).toBe("Anonymized User");
    expect(await ActionExecution.countDocuments({ status: "SUCCEEDED" })).toBe(1);
    expect(results).toHaveLength(5);
  });

  it("blocks expired, rejected, and changed-action-set approvals", async () => {
    await createRequest("PRQ-ACTIONS-0003", [correctionAction()]);
    await createProfile();

    const expiredApproval = await requestApproval(
      "PRQ-ACTIONS-0003",
      "CORRECTION",
      analyst,
    );
    await decideApproval(expiredApproval.approvalId, "APPROVED", approver);
    await Approval.updateOne(
      { approvalId: expiredApproval.approvalId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await expect(
      executeApprovedActions("PRQ-ACTIONS-0003", "CORRECTION"),
    ).rejects.toThrow(/approved/i);

    const rejectedApproval = await requestApproval(
      "PRQ-ACTIONS-0003",
      "CORRECTION",
      analyst,
    );
    await decideApproval(
      rejectedApproval.approvalId,
      "REJECTED",
      approver,
      "Needs review.",
    );
    await expect(
      executeApprovedActions("PRQ-ACTIONS-0003", "CORRECTION"),
    ).rejects.toThrow(/approved/i);

    const changedSetApproval = await requestApproval(
      "PRQ-ACTIONS-0003",
      "CORRECTION",
      analyst,
    );
    await decideApproval(changedSetApproval.approvalId, "APPROVED", approver);
    const changedPlan = plan([correctionAction("another@example.test")]);
    await PrivacyRequest.updateOne(
      { requestId: "PRQ-ACTIONS-0003" },
      { $set: { plan: changedPlan, planHash: sha256Json(changedPlan) } },
    );
    await expect(
      executeApprovedActions("PRQ-ACTIONS-0003", "CORRECTION"),
    ).rejects.toThrow(/approved/i);
    expect(await ActionExecution.countDocuments()).toBe(0);
  });

  it("does not let a correction approval authorize deletion", async () => {
    await createRequest("PRQ-ACTIONS-0004", [
      correctionAction(),
      deletionAction(),
    ]);
    await createProfile();
    await approve("PRQ-ACTIONS-0004", "CORRECTION");

    await expect(
      executeApprovedActions("PRQ-ACTIONS-0004", "DELETION"),
    ).rejects.toThrow(/approved/i);
    expect((await UserProfile.findOne({ userId: "USR-ACTIONS-1" }))?.accountStatus).toBe(
      "active",
    );
  });

  it("enforces four-eyes deletion approval and records retention skips", async () => {
    const ticketDelete = {
      ...deletionAction("TKT-ACTIONS-OPEN"),
      source: "support_tickets",
    };
    await createRequest("PRQ-ACTIONS-0006", [ticketDelete]);
    await SupportTicket.create({
      ticketId: "TKT-ACTIONS-OPEN",
      userId: "USR-ACTIONS-1",
      subject: "Synthetic customer request",
      status: "open",
      messages: [],
      internalNotes: [],
      category: "account",
    });
    const pending = await requestApproval(
      "PRQ-ACTIONS-0006",
      "DELETION",
      analyst,
    );
    await expect(
      decideApproval(
        pending.approvalId,
        "APPROVED",
        { ...approver, actorId: analyst.actorId },
      ),
    ).rejects.toThrow(/other than the request assignee/i);

    await decideApproval(pending.approvalId, "APPROVED", approver);
    const execution = await executeApprovedActions(
      "PRQ-ACTIONS-0006",
      "DELETION",
    );
    expect(execution.outcomes[0]?.status).toBe("SKIPPED");
    expect(execution.outcomes[0]?.result.exceptionCode).toBe("R-TKT-1");
    expect(
      (await SupportTicket.findOne({ ticketId: "TKT-ACTIONS-OPEN" }))?.subject,
    ).toBe("Synthetic customer request");
    expect(
      await AuditEvent.countDocuments({
        requestId: "PRQ-ACTIONS-0006",
        eventType: "ACTION_SKIPPED",
      }),
    ).toBe(1);
  });

  it("retries a chaos failure with the same key and changes the profile once", async () => {
    await createRequest("PRQ-ACTIONS-0005", [deletionAction()]);
    await createProfile();
    await approve("PRQ-ACTIONS-0005", "DELETION");

    process.env.CHAOS_MODE = "true";
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    await expect(
      executeApprovedActions("PRQ-ACTIONS-0005", "DELETION"),
    ).rejects.toThrow(/attempt 1/i);
    random.mockRestore();
    process.env.CHAOS_MODE = "false";

    const failed = await ActionExecution.findOne({
      requestId: "PRQ-ACTIONS-0005",
    }).lean();
    expect(failed?.status).toBe("FAILED");
    const retried = await retryAction(String(failed?._id), analyst);

    expect(retried.outcomes[0]?.status).toBe("SUCCEEDED");
    expect(
      await ActionExecution.countDocuments({
        requestId: "PRQ-ACTIONS-0005",
        status: "SUCCEEDED",
      }),
    ).toBe(1);
    expect(
      (await ActionExecution.findOne({ requestId: "PRQ-ACTIONS-0005" }))?.attempts,
    ).toBe(2);
    expect((await UserProfile.findOne({ userId: "USR-ACTIONS-1" }))?.accountStatus).toBe(
      "anonymized",
    );
    expect(
      await AuditEvent.countDocuments({
        requestId: "PRQ-ACTIONS-0005",
        eventType: "ACTION_FAILED",
      }),
    ).toBe(1);
  });

  it("prohibits analyst from deciding an approval", async () => {
    await createRequest("PRQ-ACTIONS-ROLE-1", [correctionAction()]);
    const pending = await requestApproval("PRQ-ACTIONS-ROLE-1", "CORRECTION", analyst);
    await expect(
      decideApproval(pending.approvalId, "APPROVED", analyst),
    ).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
  });

  it("allows approver to decide an approval", async () => {
    await createRequest("PRQ-ACTIONS-ROLE-2", [correctionAction()]);
    const pending = await requestApproval("PRQ-ACTIONS-ROLE-2", "CORRECTION", analyst);
    const decided = await decideApproval(pending.approvalId, "APPROVED", approver);
    expect(decided.status).toBe("APPROVED");
  });

  it("ensures a CORRECTION approval can never authorize a DELETION action execution", async () => {
    await createRequest("PRQ-ACTIONS-CROSS-1", [correctionAction(), deletionAction()]);
    await createProfile();
    await approve("PRQ-ACTIONS-CROSS-1", "CORRECTION");
    await expect(
      executeApprovedActions("PRQ-ACTIONS-CROSS-1", "DELETION"),
    ).rejects.toThrow(/approved deletion action set is required/i);
  });
});
