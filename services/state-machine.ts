import { appendAudit, type AuditActorType } from "@/lib/audit";
import {
  NotFoundError,
  PolicyViolationError,
  VerificationRequiredError,
} from "@/lib/errors";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import {
  requestStatuses,
  type RequestStatus,
} from "@/models/model-types";
import { connectDB } from "@/lib/db";
import { assertVerified } from "@/services/verification-service";

export type StateMachineActor = {
  actorId: string;
  actorType: AuditActorType;
};

export const allowedRequestTransitions: Record<
  RequestStatus,
  readonly RequestStatus[]
> = {
  RECEIVED: ["VERIFICATION_PENDING", "VERIFIED", "REJECTED", "FAILED"],
  VERIFICATION_PENDING: ["VERIFIED", "REJECTED", "FAILED"],
  VERIFIED: ["PLAN_PROPOSED", "SEARCHING", "REJECTED", "FAILED"],
  PLAN_PROPOSED: ["PLAN_APPROVED", "REJECTED", "FAILED"],
  PLAN_APPROVED: ["SEARCHING", "REJECTED", "FAILED"],
  SEARCHING: ["INVENTORY_READY", "REJECTED", "FAILED"],
  INVENTORY_READY: [
    "AWAITING_CORRECTION_APPROVAL",
    "AWAITING_DELETION_APPROVAL",
    "EXPORT_READY",
    "COMPLETED",
    "REJECTED",
    "FAILED",
  ],
  AWAITING_CORRECTION_APPROVAL: ["EXECUTING", "COMPLETED", "REJECTED", "FAILED"],
  AWAITING_DELETION_APPROVAL: ["EXECUTING", "COMPLETED", "REJECTED", "FAILED"],
  EXECUTING: ["EXPORT_READY", "COMPLETED", "FAILED"],
  EXPORT_READY: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  REJECTED: [],
  FAILED: [],
} satisfies Record<RequestStatus, readonly RequestStatus[]>;

export function isAllowedRequestTransition(
  from: RequestStatus,
  to: RequestStatus,
): boolean {
  return allowedRequestTransitions[from].includes(to);
}

function isRequestStatus(value: string): value is RequestStatus {
  return (requestStatuses as readonly string[]).includes(value);
}

export async function transitionRequestStatus(
  requestId: string,
  nextStatus: RequestStatus,
  actor: StateMachineActor,
): Promise<Awaited<ReturnType<typeof PrivacyRequest.findOne>>> {
  await connectDB();
  const request = await PrivacyRequest.findOne({ requestId });

  if (!request) {
    throw new NotFoundError(`Request ${requestId} was not found.`);
  }

  const currentStatus = request.status;
  if (!isAllowedRequestTransition(currentStatus, nextStatus)) {
    await appendAudit({
      requestId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      eventType: "STATUS_CHANGED",
      input: { from: currentStatus, to: nextStatus },
      status: "denied",
      error: { code: "ILLEGAL_STATE_TRANSITION" },
    });
    throw new PolicyViolationError(
      `Request status cannot transition from ${currentStatus} to ${nextStatus}.`,
      409,
    );
  }

  if (
    nextStatus === "VERIFIED" ||
    nextStatus === "PLAN_PROPOSED" ||
    nextStatus === "PLAN_APPROVED" ||
    nextStatus === "SEARCHING" ||
    nextStatus === "INVENTORY_READY" ||
    nextStatus === "AWAITING_CORRECTION_APPROVAL" ||
    nextStatus === "AWAITING_DELETION_APPROVAL" ||
    nextStatus === "EXECUTING" ||
    nextStatus === "EXPORT_READY" ||
    nextStatus === "COMPLETED"
  ) {
    try {
      assertVerified(request);
    } catch (error: unknown) {
      if (!(error instanceof VerificationRequiredError)) {
        throw error;
      }
      await appendAudit({
        requestId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        eventType: "STATUS_CHANGED",
        input: { from: currentStatus, to: nextStatus },
        status: "denied",
        error: { code: error.code },
      });
      throw error;
    }
  }

  const updatedRequest = await PrivacyRequest.findOneAndUpdate(
    { requestId, status: currentStatus },
    { $set: { status: nextStatus } },
    { returnDocument: "after", runValidators: true },
  );
  if (!updatedRequest) {
    await appendAudit({
      requestId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      eventType: "STATUS_CHANGED",
      input: { from: currentStatus, to: nextStatus },
      status: "denied",
      error: { code: "CONCURRENT_STATE_CHANGE" },
    });
    throw new PolicyViolationError(
      "Request status changed concurrently; reload before retrying.",
      409,
    );
  }

  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "STATUS_CHANGED",
    input: { from: currentStatus, to: nextStatus },
    status: "ok",
  });

  return updatedRequest;
}

export function parseRequestStatus(value: string): RequestStatus | null {
  return isRequestStatus(value) ? value : null;
}
