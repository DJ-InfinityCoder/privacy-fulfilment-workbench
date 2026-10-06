import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditEvent } from "@/models/AuditEvent";
import { Counter } from "@/models/Counter";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { UserProfile } from "@/models/UserProfile";
import { createRequest } from "@/services/request-service";
import {
  assertVerified,
  overrideVerification,
  verifyRequestIdentity,
} from "@/services/verification-service";
import { VerificationRequiredError } from "@/lib/errors";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("privacy_verification_test");
  await mongoose.connect(process.env.MONGODB_URI);
});

beforeEach(async () => {
  await Promise.all([
    AuditEvent.collection.deleteMany({}),
    Counter.collection.deleteMany({}),
    PrivacyRequest.collection.deleteMany({}),
    UserProfile.collection.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

async function addProfile(
  overrides: Partial<{
    userId: string;
    fullName: string;
    email: string;
    phone: string;
    dateOfBirth: Date;
    lastOrderCity: string;
  }> = {},
) {
  return UserProfile.create({
    userId: overrides.userId ?? "USR-VERIFY-1",
    fullName: overrides.fullName ?? "Verification Subject",
    email: overrides.email ?? "verify.subject@example.test",
    phone: overrides.phone ?? "+1-202-555-0142",
    dateOfBirth: overrides.dateOfBirth ?? new Date("1990-05-16T00:00:00.000Z"),
    address: "14 Synthetic Way",
    preferences: { theme: "light" },
    marketingConsent: false,
    accountStatus: "active",
    internalRiskScore: 5,
    ...(overrides.lastOrderCity ? { lastOrderCity: overrides.lastOrderCity } : {}),
  });
}

async function addRequest() {
  return createRequest({
    type: "ACCESS",
    requesterName: "Verification Subject",
    requesterEmail: "verify.subject@example.test",
    rawText: "Please provide my mock account details.",
  });
}

describe("verification service", () => {
  it("passes matching email, phone, and date-of-birth factors", async () => {
    await addProfile();
    const request = await addRequest();

    const result = await verifyRequestIdentity(
      request.requestId,
      {
        email: "VERIFY.SUBJECT@example.test",
        phoneLast4: "0142",
        dateOfBirth: "1990-05-16",
      },
      { actorId: "operator-1", actorType: "human" },
    );

    expect(result).toEqual({
      status: "PASSED",
      missing: [],
      attempts: 1,
      attemptsRemaining: 2,
    });
    const updated = await PrivacyRequest.findOne({ requestId: request.requestId });
    expect(updated?.status).toBe("VERIFIED");
    expect(updated?.subjectUserId).toBe("USR-VERIFY-1");
    expect(updated?.verification.factorsSubmitted).toHaveLength(3);
    expect(updated?.verification.factorsSubmitted[0].valueHash).not.toContain(
      "verify.subject",
    );
  });

  it("returns only missing factor names and does not reveal wrong submitted values", async () => {
    await addProfile();
    const request = await addRequest();

    const result = await verifyRequestIdentity(
      request.requestId,
      {
        email: "wrong@example.test",
        accountId: "USR-VERIFY-1",
        dateOfBirth: "1980-01-01",
      },
      { actorId: "operator-1", actorType: "human" },
    );

    expect(result.status).toBe("FAILED");
    expect(result.missing).toEqual(["email_match", "knowledge_factor"]);
    expect(JSON.stringify(result)).not.toContain("wrong@example.test");
    const events = await AuditEvent.find({ requestId: request.requestId }).lean();
    expect(JSON.stringify(events)).not.toContain("wrong@example.test");
    expect(JSON.stringify(events)).not.toContain("1980-01-01");
  });

  it("locks verification after three failed submissions", async () => {
    await addProfile();
    const request = await addRequest();
    const badSubmission = {
      email: "wrong@example.test",
      accountId: "USR-VERIFY-1",
      dateOfBirth: "1980-01-01",
    };

    const first = await verifyRequestIdentity(request.requestId, badSubmission, {
      actorId: "operator-1",
      actorType: "human",
    });
    const second = await verifyRequestIdentity(request.requestId, badSubmission, {
      actorId: "operator-1",
      actorType: "human",
    });
    const third = await verifyRequestIdentity(request.requestId, badSubmission, {
      actorId: "operator-1",
      actorType: "human",
    });

    expect([first.status, second.status, third.status]).toEqual([
      "FAILED",
      "FAILED",
      "LOCKED",
    ]);
    const updated = await PrivacyRequest.findOne({ requestId: request.requestId });
    expect(updated?.verification.attempts).toBe(3);
    expect(updated?.verification.status).toBe("LOCKED");
    await expect(
      verifyRequestIdentity(request.requestId, badSubmission, {
        actorId: "operator-1",
        actorType: "human",
      }),
    ).rejects.toMatchObject({ httpStatus: 409 });
    await expect(
      AuditEvent.countDocuments({
        requestId: request.requestId,
        eventType: "VERIFICATION_LOCKED",
      }),
    ).resolves.toBe(1);
  });

  it("asks for an account ID when phone last four matches multiple profiles", async () => {
    await addProfile({ userId: "USR-VERIFY-A" });
    await addProfile({
      userId: "USR-VERIFY-B",
      email: "other.subject@example.test",
      phone: "+1-415-555-0142",
    });
    const request = await addRequest();

    const result = await verifyRequestIdentity(
      request.requestId,
      {
        email: "verify.subject@example.test",
        phoneLast4: "0142",
        dateOfBirth: "1990-05-16",
      },
      { actorId: "operator-1", actorType: "human" },
    );

    expect(result.status).toBe("AMBIGUOUS");
    expect(result.missing).toEqual(["account_id_or_phone_last4"]);
    const updated = await PrivacyRequest.findOne({ requestId: request.requestId });
    expect(updated?.subjectUserId).toBeUndefined();
  });

  it("supports last order city as a knowledge factor", async () => {
    await addProfile({ lastOrderCity: "Sample City" });
    const request = await addRequest();

    const result = await verifyRequestIdentity(
      request.requestId,
      {
        email: "verify.subject@example.test",
        accountId: "USR-VERIFY-1",
        lastOrderCity: "sample city",
      },
      { actorId: "operator-1", actorType: "human" },
    );

    expect(result.status).toBe("PASSED");
  });

  it("requires an approver role and audits successful overrides", async () => {
    const profile = await addProfile();
    const request = await addRequest();

    await expect(
      overrideVerification(
        request.requestId,
        { subjectUserId: profile.userId, reason: "Manual review complete." },
        { actorId: "operator-1", actorType: "human", role: "analyst" },
      ),
    ).rejects.toMatchObject({ code: "POLICY_VIOLATION" });
    await expect(
      AuditEvent.countDocuments({
        requestId: request.requestId,
        eventType: "VERIFICATION_OVERRIDE",
        status: "denied",
      }),
    ).resolves.toBe(1);

    const updated = await overrideVerification(
      request.requestId,
      { subjectUserId: profile.userId, reason: "Manual review complete." },
      { actorId: "approver-1", actorType: "human", role: "approver" },
    );

    expect(updated.verification.status).toBe("PASSED");
    expect(updated.status).toBe("VERIFIED");
    await expect(
      AuditEvent.countDocuments({
        requestId: request.requestId,
        eventType: "VERIFICATION_OVERRIDE",
        status: "ok",
      }),
    ).resolves.toBe(1);
    const auditJson = JSON.stringify(
      await AuditEvent.find({ requestId: request.requestId }).lean(),
    );
    expect(auditJson).not.toContain("Manual review complete.");
  });

  it("asserts that unverified requests cannot proceed to data operations", async () => {
    const request = await addRequest();
    expect(() => assertVerified(request)).toThrow(VerificationRequiredError);

    await addProfile();
    const result = await verifyRequestIdentity(
      request.requestId,
      {
        email: "verify.subject@example.test",
        accountId: "USR-VERIFY-1",
        dateOfBirth: "1990-05-16",
      },
      { actorId: "operator-1", actorType: "human" },
    );
    expect(result.status).toBe("PASSED");
    const verified = await PrivacyRequest.findOne({ requestId: request.requestId });
    if (!verified) {
      throw new Error("Expected verified request.");
    }
    expect(() => assertVerified(verified)).not.toThrow();
  });
});
