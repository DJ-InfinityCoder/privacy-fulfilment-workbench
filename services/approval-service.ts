import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendAudit, type AuditActorType } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import {
  ApprovalRequiredError,
  NotFoundError,
  PolicyViolationError,
  ValidationError,
} from "@/lib/errors";
import { sha256Json } from "@/lib/hash";
import { Approval, type ApprovalDocument } from "@/models/Approval";
import { DataInventory } from "@/models/DataInventory";
import { PrivacyRequest, type PrivacyRequestDocument } from "@/models/PrivacyRequest";
import type { DataSourceName } from "@/models/model-types";
import { orgPolicy } from "@/policy/org-policy";
import { getExportApprovalHash } from "@/services/export-service";
import { assertVerified } from "@/services/verification-service";
import { transitionRequestStatus } from "@/services/state-machine";
import { planSchema, type Plan } from "@/agent/prompts";

export type ApprovalKind = ApprovalDocument["kind"];
export type ApprovalActor = {
  actorId: string;
  actorType: AuditActorType;
  role: string;
};

export type ApprovalAction =
  | {
  type: "CORRECTION";
  source: Exclude<DataSourceName, "activity_logs">;
  recordId: string;
  field: string;
  newValue: unknown;
}
  | {
  type: "DELETION";
  source: DataSourceName;
  recordId: string;
};

const approvalKinds = ["PLAN", "CORRECTION", "DELETION", "EXPORT"] as const;
const sourceOperations: Record<DataSourceName, readonly string[]> = {
  user_profiles: orgPolicy.dataSources.user_profiles.allowedOperations,
  support_tickets: orgPolicy.dataSources.support_tickets.allowedOperations,
  activity_logs: orgPolicy.dataSources.activity_logs.allowedOperations,
};

function parsePlan(request: PrivacyRequestDocument): Plan {
  const parsed = planSchema.safeParse(request.plan);
  if (!parsed.success) {
    throw new ValidationError("The request does not have a valid proposed plan.");
  }
  return parsed.data;
}

export function getApprovalActions(
  request: PrivacyRequestDocument,
  kind: "CORRECTION" | "DELETION",
): ApprovalAction[] {
  const plan = parsePlan(request);
  const actions: ApprovalAction[] = [];

  for (const proposed of plan.proposedActions) {
    if (proposed.type !== kind) {
      continue;
    }
    if (!sourceOperations[proposed.source].includes(
      kind === "CORRECTION" ? "correct" : "delete",
    )) {
      throw new PolicyViolationError(
        `${kind} is not permitted for the proposed data source.`,
      );
    }
    if (!proposed.recordId) {
      throw new ValidationError(
        `${kind.toLowerCase()} proposals must identify a record.`,
      );
    }

    if (kind === "CORRECTION") {
      if (
        proposed.source === "activity_logs" ||
        !proposed.field ||
        !Object.hasOwn(proposed, "newValue") ||
        proposed.newValue === undefined
      ) {
        throw new ValidationError(
          "Correction proposals must include an allowed source, field, and new value.",
        );
      }
      actions.push({
        type: kind,
        source: proposed.source,
        recordId: proposed.recordId,
        field: proposed.field,
        newValue: proposed.newValue,
      });
    } else {
      actions.push({
        type: kind,
        source: proposed.source,
        recordId: proposed.recordId,
      });
    }
  }

  return actions.sort((left, right) =>
    `${left.source}:${left.recordId}:${
      left.type === "CORRECTION" ? left.field : ""
    }`.localeCompare(
      `${right.source}:${right.recordId}:${
        right.type === "CORRECTION" ? right.field : ""
      }`,
    ),
  );
}

export async function getApprovalActionSetHash(
  request: PrivacyRequestDocument,
  kind: ApprovalKind,
): Promise<string> {
  if (kind === "PLAN") {
    return sha256Json(parsePlan(request));
  }
  if (kind === "CORRECTION" || kind === "DELETION") {
    const actions = getApprovalActions(request, kind);
    if (actions.length === 0) {
      throw new ValidationError(`There are no ${kind.toLowerCase()} actions to approve.`);
    }
    return sha256Json(actions);
  }

  const inventory = await DataInventory.findOne({ requestId: request.requestId })
    .sort({ version: -1 })
    .lean();
  if (!inventory || inventory.status !== "REVIEWED") {
    throw new ApprovalRequiredError(
      "A reviewed inventory is required before requesting export approval.",
    );
  }
  return getExportApprovalHash(inventory);
}

function approvalTtlMinutes(): number {
  const configured = process.env.APPROVAL_TTL_MINUTES;
  if (configured === undefined || configured.trim() === "") {
    return orgPolicy.approvalRules.ttlMinutes;
  }
  const minutes = Number(configured);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10_080) {
    throw new ValidationError("APPROVAL_TTL_MINUTES must be between 1 and 10080.");
  }
  return minutes;
}

function isApprovalKind(value: unknown): value is ApprovalKind {
  return (
    typeof value === "string" &&
    (approvalKinds as readonly string[]).includes(value)
  );
}

function publicApproval(approval: ApprovalDocument & { _id?: unknown }) {
  return {
    approvalId: approval.approvalId,
    requestId: approval.requestId,
    kind: approval.kind,
    status: approval.status,
    actionSetHash: approval.actionSetHash,
    requestedBy: approval.requestedBy,
    decidedBy: approval.decidedBy,
    decidedByRole: approval.decidedByRole,
    decidedAt: approval.decidedAt,
    comment: approval.comment,
    expiresAt: approval.expiresAt,
  };
}

async function getRequest(requestId: string) {
  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError(`Request ${requestId} was not found.`);
  }
  assertRequestVerified(request);
  return request;
}

function assertRequestVerified(
  request: Parameters<typeof assertVerified>[0],
): void {
  assertVerified(request);
}

export async function requestApproval(
  requestId: string,
  kind: ApprovalKind,
  actor: ApprovalActor,
) {
  await connectDB();
  if (!isApprovalKind(kind)) {
    throw new ValidationError("Approval kind is invalid.");
  }
  const request = await getRequest(requestId);
  const actionSetHash = await getApprovalActionSetHash(request, kind);
  const now = new Date();
  const approval = await Approval.create({
    approvalId: `APR-${randomUUID()}`,
    requestId,
    kind,
    status: "PENDING",
    actionSetHash,
    requestedBy: actor.actorId,
    expiresAt: new Date(now.getTime() + approvalTtlMinutes() * 60_000),
  });

  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "APPROVAL_REQUESTED",
    input: { approvalId: approval.approvalId, kind, actionSetHash },
    status: "ok",
  });

  if (kind === "DELETION" && request.status === "INVENTORY_READY") {
    await transitionRequestStatus(requestId, "AWAITING_DELETION_APPROVAL", {
      actorId: actor.actorId,
      actorType: actor.actorType,
    });
  } else if (kind === "CORRECTION" && request.status === "INVENTORY_READY") {
    await transitionRequestStatus(requestId, "AWAITING_CORRECTION_APPROVAL", {
      actorId: actor.actorId,
      actorType: actor.actorType,
    });
  }

  return publicApproval(approval);
}

const decisionSchema = z.enum(["APPROVED", "REJECTED"]);

export async function decideApproval(
  approvalId: string,
  decision: unknown,
  approver: ApprovalActor,
  comment?: string,
) {
  await connectDB();
  const parsedDecision = decisionSchema.safeParse(decision);
  if (!parsedDecision.success) {
    throw new ValidationError("Decision must be APPROVED or REJECTED.");
  }
  const normalizedComment = comment?.trim();
  if (
    parsedDecision.data === "REJECTED" &&
    (!normalizedComment || normalizedComment.length > 2000)
  ) {
    throw new ValidationError("A rejection comment is required (maximum 2000 characters).");
  }
  if (
    !orgPolicy.approvalRules.allowedApproverRoles.some(
      (role) => role === approver.role,
    )
  ) {
    await appendAudit({
      actorType: approver.actorType,
      actorId: approver.actorId,
      eventType: "APPROVAL_REJECTED",
      input: { approvalId, decision: parsedDecision.data },
      status: "denied",
      error: { code: "APPROVER_ROLE_REQUIRED" },
    });
    throw new PolicyViolationError(
      "Only an approver may decide an approval.",
    );
  }

  const approval = await Approval.findOne({ approvalId });
  if (!approval) {
    throw new NotFoundError(`Approval ${approvalId} was not found.`);
  }
  const request = await getRequest(approval.requestId);
  const now = new Date();

  if (approval.status !== "PENDING") {
    throw new ApprovalRequiredError("This approval is no longer pending.");
  }
  if (approval.expiresAt.getTime() <= now.getTime()) {
    await Approval.updateOne(
      { _id: approval._id, status: "PENDING", expiresAt: { $lte: now } },
      { $set: { status: "EXPIRED" } },
    );
    await appendAudit({
      requestId: approval.requestId,
      actorType: approver.actorType,
      actorId: approver.actorId,
      eventType: "APPROVAL_EXPIRED",
      input: { approvalId, kind: approval.kind },
      status: "error",
    });
    throw new ApprovalRequiredError("This approval has expired.");
  }

  const currentHash = await getApprovalActionSetHash(request, approval.kind);
  if (currentHash !== approval.actionSetHash) {
    await Approval.updateOne(
      { _id: approval._id, status: "PENDING" },
      { $set: { status: "EXPIRED" } },
    );
    await appendAudit({
      requestId: approval.requestId,
      actorType: approver.actorType,
      actorId: approver.actorId,
      eventType: "APPROVAL_EXPIRED",
      input: { approvalId, kind: approval.kind },
      status: "error",
      error: { code: "ACTION_SET_CHANGED" },
    });
    throw new ApprovalRequiredError(
      "The approved plan or action set has changed; request a new approval.",
    );
  }

  if (
    parsedDecision.data === "APPROVED" &&
    approver.actorId === request.assignee
  ) {
    await appendAudit({
      requestId: approval.requestId,
      actorType: approver.actorType,
      actorId: approver.actorId,
      eventType: "APPROVAL_REJECTED",
      input: { approvalId, kind: approval.kind },
      status: "denied",
      error: { code: "FOUR_EYES_REQUIRED" },
    });
    throw new PolicyViolationError(
      "Approval must be decided by someone other than the request assignee.",
    );
  }

  const decided = await Approval.findOneAndUpdate(
    {
      _id: approval._id,
      status: "PENDING",
      actionSetHash: currentHash,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        status: parsedDecision.data,
        decidedBy: approver.actorId,
        decidedByRole: approver.role,
        decidedAt: now,
        ...(normalizedComment ? { comment: normalizedComment } : {}),
      },
    },
    { returnDocument: "after", runValidators: true },
  );
  if (!decided) {
    await appendAudit({
      requestId: approval.requestId,
      actorType: approver.actorType,
      actorId: approver.actorId,
      eventType: "APPROVAL_REJECTED",
      input: { approvalId, kind: approval.kind },
      status: "denied",
      error: { code: "APPROVAL_CHANGED_CONCURRENTLY" },
    });
    throw new ApprovalRequiredError(
      "The approval changed concurrently; reload before deciding.",
    );
  }

  await appendAudit({
    requestId: approval.requestId,
    actorType: approver.actorType,
    actorId: approver.actorId,
    eventType:
      parsedDecision.data === "APPROVED"
        ? "APPROVAL_GRANTED"
        : "APPROVAL_REJECTED",
    input: {
      approvalId,
      kind: decided.kind,
      actionSetHash: decided.actionSetHash,
      ...(normalizedComment ? { comment: normalizedComment } : {}),
    },
    status: "ok",
  });

  if (
    decided.kind === "PLAN" &&
    parsedDecision.data === "APPROVED" &&
    request.status === "PLAN_PROPOSED"
  ) {
    await transitionRequestStatus(request.requestId, "PLAN_APPROVED", {
      actorId: approver.actorId,
      actorType: approver.actorType,
    });
  }

  return publicApproval(decided);
}

export async function findValidActionApproval(
  request: PrivacyRequestDocument,
  kind: "CORRECTION" | "DELETION",
  options: { allowConsumedReplay?: boolean } = {},
) {
  const actionSetHash = await getApprovalActionSetHash(request, kind);
  const approval = await Approval.findOne({
    requestId: request.requestId,
    kind,
    actionSetHash,
    status: { $in: options.allowConsumedReplay ? ["APPROVED", "CONSUMED"] : ["APPROVED"] },
  })
    .sort({ decidedAt: -1 })
    .lean();
  if (
    !approval ||
    !approval.decidedBy ||
    !approval.decidedByRole ||
    !orgPolicy.approvalRules.allowedApproverRoles.some(
      (role) => role === approval.decidedByRole,
    ) ||
    (approval.status !== "CONSUMED" && approval.expiresAt.getTime() <= Date.now())
  ) {
    if (approval?.status === "APPROVED") {
      await Approval.updateOne(
        { _id: approval._id, status: "APPROVED" },
        { $set: { status: "EXPIRED" } },
      );
      await appendAudit({
        requestId: request.requestId,
        actorType: "system",
        actorId: "approval-service",
        eventType: "APPROVAL_EXPIRED",
        input: { approvalId: approval.approvalId, kind },
        status: "error",
      });
    }
    throw new ApprovalRequiredError(
      `A current approved ${kind.toLowerCase()} action set is required.`,
    );
  }
  if (
    kind === "DELETION" &&
    orgPolicy.approvalRules.deletionApproverMustDifferFromAssignee &&
    approval.decidedBy === request.assignee
  ) {
    throw new PolicyViolationError(
      "Deletion approval must come from someone other than the request assignee.",
    );
  }
  return approval;
}
