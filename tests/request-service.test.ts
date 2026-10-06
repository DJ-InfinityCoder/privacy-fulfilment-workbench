import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditEvent } from "@/models/AuditEvent";
import { Counter } from "@/models/Counter";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { createRequest, getDeadlineInfo } from "@/services/request-service";
import {
  isAllowedRequestTransition,
  transitionRequestStatus,
} from "@/services/state-machine";
import { VerificationRequiredError } from "@/lib/errors";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("privacy_request_test");
  await mongoose.connect(process.env.MONGODB_URI);
});

beforeEach(async () => {
  await Promise.all([
    AuditEvent.collection.deleteMany({}),
    Counter.collection.deleteMany({}),
    PrivacyRequest.collection.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const requestInput = {
  type: "ACCESS" as const,
  requesterName: "Test Subject",
  requesterEmail: "subject@example.test",
  rawText: "Please provide my synthetic account information.",
  subjectUserId: "USR-TEST-1",
};

describe("request state machine", () => {
  it("allows only explicitly listed transitions", () => {
    expect(isAllowedRequestTransition("RECEIVED", "VERIFICATION_PENDING")).toBe(true);
    expect(isAllowedRequestTransition("RECEIVED", "VERIFIED")).toBe(true);
    expect(isAllowedRequestTransition("RECEIVED", "COMPLETED")).toBe(false);
    expect(isAllowedRequestTransition("COMPLETED", "RECEIVED")).toBe(false);
  });

  it("changes state and appends a status event for an allowed transition", async () => {
    const request = await createRequest(requestInput);
    const updated = await transitionRequestStatus(
      request.requestId,
      "VERIFICATION_PENDING",
      { actorId: "test-operator", actorType: "human" },
    );

    expect(updated?.status).toBe("VERIFICATION_PENDING");
    const auditEvent = await AuditEvent.findOne({
      requestId: request.requestId,
      eventType: "STATUS_CHANGED",
    }).lean();
    expect(auditEvent?.status).toBe("ok");
  });

  it("audits an illegal transition as denied and reports HTTP 409", async () => {
    const request = await createRequest(requestInput);

    await expect(
      transitionRequestStatus(request.requestId, "COMPLETED", {
        actorId: "test-operator",
        actorType: "human",
      }),
    ).rejects.toMatchObject({
      code: "POLICY_VIOLATION",
      httpStatus: 409,
    });

    const unchanged = await PrivacyRequest.findOne({ requestId: request.requestId });
    const deniedEvent = await AuditEvent.findOne({
      requestId: request.requestId,
      status: "denied",
    }).lean();
    expect(unchanged?.status).toBe("RECEIVED");
    expect(deniedEvent?.eventType).toBe("STATUS_CHANGED");
  });

  it("does not allow the state machine to bypass identity verification", async () => {
    const request = await createRequest(requestInput);

    await expect(
      transitionRequestStatus(request.requestId, "VERIFIED", {
        actorId: "test-operator",
        actorType: "human",
      }),
    ).rejects.toBeInstanceOf(VerificationRequiredError);

    const deniedEvent = await AuditEvent.findOne({
      requestId: request.requestId,
      status: "denied",
    }).lean();
    expect(deniedEvent?.error?.code).toBe("VERIFICATION_REQUIRED");
  });
});

describe("deadline calculations", () => {
  it("marks a request overdue and reports negative days remaining", async () => {
    const request = await createRequest({
      ...requestInput,
      receivedAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    const info = getDeadlineInfo(
      request,
      new Date("2024-02-02T00:00:00.000Z"),
    );

    expect(info.state).toBe("OVERDUE");
    expect(info.daysRemaining).toBe(-2);
    expect(info.percentElapsed).toBe(100);
  });

  it("marks a request at risk when its deadline is seven days away", async () => {
    const request = await createRequest({
      ...requestInput,
      receivedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    const info = getDeadlineInfo(
      request,
      new Date("2025-01-24T00:00:00.000Z"),
    );

    expect(info.state).toBe("AT_RISK");
    expect(info.daysRemaining).toBe(7);
    expect(info.percentElapsed).toBeCloseTo(76.6667, 3);
  });

  it("keeps requests on track when more than seven days remain", async () => {
    const request = await createRequest({
      ...requestInput,
      receivedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    expect(
      getDeadlineInfo(request, new Date("2025-01-23T00:00:00.000Z")).state,
    ).toBe("ON_TRACK");
  });

  it("uses UTC elapsed days across a leap-year February", async () => {
    const request = await createRequest({
      ...requestInput,
      receivedAt: new Date("2024-01-31T00:00:00.000Z"),
    });
    expect(request.dueAt.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });

  it("handles a non-leap-year month end correctly", async () => {
    const request = await createRequest({
      ...requestInput,
      receivedAt: new Date("2025-01-31T00:00:00.000Z"),
    });
    expect(request.dueAt.toISOString()).toBe("2025-03-02T00:00:00.000Z");
  });
});
