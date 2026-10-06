import { appendAudit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import {
  NotFoundError,
  PolicyViolationError,
  ValidationError,
  VerificationRequiredError,
} from "@/lib/errors";
import { sha256Json } from "@/lib/hash";
import { ActionExecution } from "@/models/ActionExecution";
import { Approval } from "@/models/Approval";
import { AuditEvent } from "@/models/AuditEvent";
import { DataInventory } from "@/models/DataInventory";
import {
  FulfilmentRecord,
  type FulfilmentRecordDocument,
} from "@/models/FulfilmentRecord";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import type { PrivacyRequestDocument } from "@/models/PrivacyRequest";
import type { JsonRecord } from "@/models/model-types";
import { orgPolicy } from "@/policy/org-policy";
import { getDeadlineInfo } from "@/services/request-service";
import { transitionRequestStatus } from "@/services/state-machine";
import { verifyAuditChain } from "@/services/audit-service";
import { getApprovalActionSetHash } from "@/services/approval-service";
import { assertVerified } from "@/services/verification-service";

const fulfilmentStatement =
  "Prepared under organizational policy v2025.1. This record is not a legal determination.";

export type FulfilmentActor = {
  actorId: string;
  actorType: "human" | "system";
};

export type UnmetPrecondition = {
  code: string;
  message: string;
  details?: JsonRecord;
};

export type FinalizeResult =
  | {
      finalized: true;
      record: FulfilmentRecordDocument;
      hashValid: true;
      idempotentReplay: boolean;
    }
  | {
      finalized: false;
      requestId: string;
      unmetPreconditions: UnmetPrecondition[];
    };

type StoredRecord = FulfilmentRecordDocument & {
  _id?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  __v?: number;
};

function recordContent(record: FulfilmentRecordDocument): JsonRecord {
  return {
    requestId: record.requestId,
    recordId: record.recordId,
    summary: record.summary,
    timeline: record.timeline,
    approvals: record.approvals,
    actions: record.actions,
    inventoryVersion: record.inventoryVersion,
    exportManifest: record.exportManifest,
    details: record.details,
    disclaimers: record.disclaimers,
    finalizedAt: record.finalizedAt,
  };
}

export function calculateFulfilmentRecordHash(
  record: FulfilmentRecordDocument,
): string {
  return sha256Json(recordContent(record));
}

export function verifyFulfilmentRecordHash(
  record: FulfilmentRecordDocument,
): boolean {
  return calculateFulfilmentRecordHash(record) === record.contentHash;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

function isObjectRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idempotentResult(
  record: StoredRecord,
): FinalizeResult {
  const publicRecord = record as FulfilmentRecordDocument;
  const hashValid = verifyFulfilmentRecordHash(publicRecord);
  if (!hashValid) {
    throw new PolicyViolationError(
      "The stored fulfilment record failed its content-hash verification.",
      409,
    );
  }
  return {
    finalized: true,
    record: publicRecord,
    hashValid: true,
    idempotentReplay: true,
  };
}

function planGeneratedBy(requestPlan: unknown): JsonRecord {
  if (
    isObjectRecord(requestPlan) &&
    isObjectRecord(requestPlan.generatedBy)
  ) {
    return {
      provider: requestPlan.generatedBy.provider,
      model: requestPlan.generatedBy.model,
      usedFallbackPlanner: requestPlan.generatedBy.usedFallbackPlanner,
    };
  }
  return { provider: "unknown", model: "unknown", usedFallbackPlanner: false };
}

function planActionKinds(requestPlan: unknown): Array<"CORRECTION" | "DELETION"> {
  if (!isObjectRecord(requestPlan) || !Array.isArray(requestPlan.proposedActions)) {
    return [];
  }
  const kinds = new Set<"CORRECTION" | "DELETION">();
  for (const action of requestPlan.proposedActions) {
    if (
      isObjectRecord(action) &&
      (action.type === "CORRECTION" || action.type === "DELETION")
    ) {
      kinds.add(action.type);
    }
  }
  return [...kinds];
}

function planExceptions(requestPlan: unknown): JsonRecord[] {
  if (!isObjectRecord(requestPlan) || !Array.isArray(requestPlan.policyExceptions)) {
    return [];
  }
  return requestPlan.policyExceptions.filter(isObjectRecord).map((exception) => ({
    source: exception.source,
    ...(typeof exception.recordId === "string"
      ? { recordId: exception.recordId }
      : {}),
    exceptionCode: exception.exceptionCode,
    explanation: exception.explanation,
  }));
}

async function evaluatePreconditions(
  request: PrivacyRequestDocument,
  now: Date,
): Promise<{ unmet: UnmetPrecondition[]; inventoryVersion: number | null }> {
  const unmet: UnmetPrecondition[] = [];
  const requestId = request.requestId;

  try {
    assertVerified(request);
  } catch (error: unknown) {
    if (!(error instanceof VerificationRequiredError)) {
      throw error;
    }
    unmet.push({
      code: "VERIFICATION_REQUIRED",
      message: "Identity verification must be passed before finalization.",
    });
  }

  if (!request.plan || !request.planHash) {
    unmet.push({
      code: "PLAN_REQUIRED",
      message: "A versioned, hashed plan must exist before finalization.",
    });
  } else {
    const currentPlanHash = sha256Json(request.plan);
    if (currentPlanHash !== request.planHash) {
      unmet.push({
        code: "PLAN_HASH_MISMATCH",
        message: "The saved plan does not match its stored hash; replan before finalization.",
      });
    } else {
      let planApprovalHash: string | null = null;
      try {
        planApprovalHash = await getApprovalActionSetHash(request, "PLAN");
      } catch (error: unknown) {
        if (!(error instanceof ValidationError)) {
          throw error;
        }
      }
      const planApproval = planApprovalHash
        ? await Approval.findOne({
            requestId,
            kind: "PLAN",
            actionSetHash: planApprovalHash,
            status: "APPROVED",
            expiresAt: { $gt: now },
            decidedBy: { $exists: true },
            decidedAt: { $exists: true },
          })
            .sort({ decidedAt: -1 })
            .lean()
        : null;
      if (!planApproval) {
        unmet.push({
          code: "PLAN_NOT_APPROVED",
          message: "A current approval for the exact saved plan is required.",
          details: { expectedPlanHash: request.planHash },
        });
      }
    }
  }

  const pendingApprovals = await Approval.find({
    requestId,
    status: "PENDING",
  }).lean();
  for (const approval of pendingApprovals) {
    if (approval.expiresAt.getTime() <= now.getTime()) {
      const expired = await Approval.updateOne(
        {
          _id: approval._id,
          status: "PENDING",
          expiresAt: { $lte: now },
        },
        { $set: { status: "EXPIRED" } },
      );
      if (expired.modifiedCount > 0) {
        await appendAudit({
          requestId,
          actorType: "system",
          actorId: "fulfilment-service",
          eventType: "APPROVAL_EXPIRED",
          input: { approvalId: approval.approvalId, kind: approval.kind },
          status: "error",
        });
      }
      continue;
    }
    unmet.push({
      code: "APPROVAL_PENDING",
      message: `${approval.kind} approval ${approval.approvalId} has not been decided.`,
      details: {
        approvalId: approval.approvalId,
        kind: approval.kind,
        expiresAt: approval.expiresAt.toISOString(),
      },
    });
  }

  const actionKinds = planActionKinds(request.plan);
  for (const kind of actionKinds) {
    let actionSetHash: string | null = null;
    try {
      actionSetHash = await getApprovalActionSetHash(request, kind);
    } catch (error: unknown) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }
      unmet.push({
        code: `${kind}_ACTION_SET_INVALID`,
        message: `The current ${kind.toLowerCase()} action set cannot be approved.`,
      });
      continue;
    }
    const actionApproval = await Approval.findOne({
      requestId,
      kind,
      actionSetHash,
      status: { $in: ["APPROVED", "CONSUMED"] },
      decidedBy: { $exists: true },
      decidedAt: { $exists: true },
    })
      .sort({ decidedAt: -1 })
      .lean();
    if (!actionApproval) {
      const rejected = await Approval.exists({
        requestId,
        kind,
        actionSetHash,
        status: { $in: ["REJECTED", "EXPIRED"] },
      });
      unmet.push({
        code: `${kind}_APPROVAL_REQUIRED`,
        message: rejected
          ? `The current ${kind.toLowerCase()} action set was rejected or expired and needs a new decision.`
          : `A resolved approval for the current ${kind.toLowerCase()} action set is required.`,
        details: { actionSetHash },
      });
    } else if (
      actionApproval.status === "APPROVED" &&
      actionApproval.expiresAt.getTime() <= now.getTime()
    ) {
      unmet.push({
        code: `${kind}_APPROVAL_EXPIRED`,
        message: `The approved ${kind.toLowerCase()} action set has expired.`,
        details: { approvalId: actionApproval.approvalId },
      });
    }
  }

  const [activeActions, inventory] = await Promise.all([
    ActionExecution.find({
      requestId,
      status: { $in: ["PENDING", "EXECUTING"] },
    })
      .select("requestId actionType target status")
      .lean(),
    DataInventory.findOne({ requestId }).sort({ version: -1 }).lean(),
  ]);
  for (const action of activeActions) {
    unmet.push({
      code: "ACTION_NOT_TERMINAL",
      message: `Action ${action._id.toString()} is still ${action.status.toLowerCase()}.`,
      details: {
        actionId: action._id.toString(),
        actionType: action.actionType,
        source: action.target.source,
        recordId: action.target.recordId,
        status: action.status,
      },
    });
  }

  if (!inventory) {
    unmet.push({
      code: "INVENTORY_REQUIRED",
      message: "A generated inventory is required before finalization.",
    });
  } else if (inventory.status !== "REVIEWED") {
    unmet.push({
      code: "INVENTORY_NOT_REVIEWED",
      message: "The latest inventory must be reviewed before finalization.",
      details: { inventoryVersion: inventory.version, status: inventory.status },
    });
  }

  if (request.type === "ACCESS") {
    const exportEvent = await AuditEvent.findOne({
      requestId,
      eventType: "EXPORT_GENERATED",
      status: "ok",
    })
      .sort({ seq: -1 })
      .lean();
    if (!exportEvent || typeof exportEvent.output?.contentHash !== "string") {
      unmet.push({
        code: "EXPORT_REQUIRED",
        message: "An approved export must be generated before finalizing an ACCESS request.",
      });
    }
  }

  if (!["INVENTORY_READY", "AWAITING_CORRECTION_APPROVAL",
    "AWAITING_DELETION_APPROVAL", "EXECUTING", "EXPORT_READY", "COMPLETED"].includes(request.status)) {
    unmet.push({
      code: "REQUEST_NOT_READY",
      message: `Request status ${request.status} is not ready for finalization.`,
      details: { status: request.status },
    });
  }

  return {
    unmet,
    inventoryVersion: inventory?.status === "REVIEWED" ? inventory.version : null,
  };
}

function actionHistory(actions: Array<Record<string, unknown>>): JsonRecord[] {
  return actions.map((action) => {
    const beforeSnapshot = isObjectRecord(action.beforeSnapshot)
      ? action.beforeSnapshot
      : {};
    const afterSnapshot = isObjectRecord(action.afterSnapshot)
      ? action.afterSnapshot
      : {};
    const target = isObjectRecord(action.target) ? action.target : {};
    const error = isObjectRecord(action.error) ? action.error : {};
    return {
      actionId: String(action._id),
      actionType: action.actionType,
      source: target.source,
      recordId: target.recordId,
      ...(typeof target.field === "string" ? { field: target.field } : {}),
      status: action.status,
      attempts: action.attempts,
      beforeFieldNames: Object.keys(beforeSnapshot),
      afterFieldNames: Object.keys(afterSnapshot),
      ...(typeof error.code === "string" ? { errorCode: error.code } : {}),
      ...(typeof action.approvalId === "string"
        ? { approvalId: action.approvalId }
        : {}),
    };
  });
}

function approvalHistory(approvals: Array<Record<string, unknown>>): JsonRecord[] {
  return approvals.map((approval) => ({
    approvalId: approval.approvalId,
    kind: approval.kind,
    status: approval.status,
    requestedBy: approval.requestedBy,
    decidedBy: approval.decidedBy ?? null,
    decidedByRole: approval.decidedByRole ?? null,
    decidedAt: approval.decidedAt ?? null,
    expiresAt: approval.expiresAt,
    comment: approval.comment ?? null,
    actionSetHash: approval.actionSetHash,
  }));
}

function renderHtml(record: FulfilmentRecordDocument): string {
  const escapeHtml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const serialized = escapeHtml(JSON.stringify(record, null, 2));
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fulfilment record ${escapeHtml(record.recordId)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#172033}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f7f9;padding:1rem;border-radius:.5rem}.disclaimer{border-left:4px solid #64748b;padding:.75rem 1rem;background:#f8fafc}</style>
</head>
<body><h1>Privacy request fulfilment record</h1>
<p class="disclaimer">${escapeHtml(fulfilmentStatement)}</p>
<pre>${serialized}</pre>
</body></html>`;
}

export async function finalizeRequest(
  requestId: string,
  actor: FulfilmentActor = { actorId: "fulfilment-service", actorType: "system" },
): Promise<FinalizeResult> {
  await connectDB();
  const existingRecord = await FulfilmentRecord.findOne({ requestId }).lean();
  if (existingRecord) {
    const replay = idempotentResult(existingRecord as unknown as StoredRecord);
    const request = (await PrivacyRequest.findOne({
      requestId,
    })) as unknown as PrivacyRequestDocument | null;
    if (request && request.status !== "COMPLETED") {
      await transitionRequestStatus(requestId, "COMPLETED", actor);
    }
    return replay;
  }

  const request = (await PrivacyRequest.findOne({
    requestId,
  })) as unknown as PrivacyRequestDocument | null;
  if (!request) {
    throw new NotFoundError(`Request ${requestId} was not found.`);
  }
  const finalizedAt = new Date();
  const { unmet, inventoryVersion } = await evaluatePreconditions(request, finalizedAt);
  if (unmet.length > 0 || inventoryVersion === null) {
    await appendAudit({
      requestId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      eventType: "RECORD_FINALIZED",
      input: {
        blocked: true,
        unmetPreconditions: unmet.map(({ code }) => code),
      },
      status: "denied",
      error: { code: "FINALIZATION_PRECONDITIONS_UNMET" },
    });
    return {
      finalized: false,
      requestId,
      unmetPreconditions: unmet,
    };
  }

  const [approvals, actions, auditEvents] = await Promise.all([
    Approval.find({ requestId }).sort({ createdAt: 1 }).lean(),
    ActionExecution.find({ requestId })
      .select("+beforeSnapshot +afterSnapshot")
      .sort({ createdAt: 1 })
      .lean(),
    AuditEvent.find({ requestId }).sort({ seq: 1 }).lean(),
  ]);
  const exportEvent = await AuditEvent.findOne({
    requestId,
    eventType: "EXPORT_GENERATED",
    status: "ok",
  })
    .sort({ seq: -1 })
    .lean();
  const exportOutput = exportEvent?.output ?? {};
  const exportManifest = {
    generated: Boolean(exportEvent),
    ...(typeof exportOutput.contentHash === "string"
      ? { contentHash: exportOutput.contentHash }
      : {}),
    ...(typeof exportOutput.manifestHash === "string"
      ? { manifestHash: exportOutput.manifestHash }
      : {}),
    ...(typeof exportOutput.redactionCount === "number"
      ? { redactionCount: exportOutput.redactionCount }
      : {}),
    ...(typeof exportOutput.recordCount === "number"
      ? { recordCount: exportOutput.recordCount }
      : {}),
  };
  const auditChain = await verifyAuditChain(requestId);
  const actionItems = actionHistory(actions as unknown as Array<Record<string, unknown>>);
  const failedActions = actions.filter((action) => action.status === "FAILED");
  const details: JsonRecord = {
    request: {
      requestId: request.requestId,
      type: request.type,
      requesterName: request.requesterName,
      receivedAt: request.receivedAt,
      dueAt: request.dueAt,
      assignee: request.assignee ?? null,
      statusBeforeFinalization: request.status,
      finalStatus: "COMPLETED",
    },
    deadline: {
      met: finalizedAt.getTime() <= request.dueAt.getTime(),
      extended: request.extension.applied,
      originalDueAt: request.extension.applied
        ? new Date(
            request.dueAt.getTime() -
              orgPolicy.requestTypes[request.type].extensionDays *
                24 *
                60 *
                60 *
                1000,
          )
        : request.dueAt,
      effectiveDueAt: request.extension.applied
        ? request.extension.newDueAt ?? request.dueAt
        : request.dueAt,
      stateAtFinalization: getDeadlineInfo(request, finalizedAt).state,
    },
    verification: {
      status: request.verification.status,
      attempts: request.verification.attempts,
      score: request.verification.score,
      verifiedAt: request.verification.verifiedAt ?? null,
      verifiedBy: request.verification.verifiedBy ?? null,
      factorsProvided: request.verification.factorsSubmitted.map((factor) => factor.factor),
    },
    plan: {
      version: request.planVersion ?? null,
      hash: request.planHash ?? null,
      generatedBy: planGeneratedBy(request.plan),
    },
    policyExceptions: [
      ...planExceptions(request.plan),
      ...actions.flatMap((action) => {
        if (action.status !== "SKIPPED" || !isObjectRecord(action.result)) {
          return [];
        }
        return [
          {
            source: action.target.source,
            recordId: action.target.recordId,
            exceptionCode:
              typeof action.result.exceptionCode === "string"
                ? action.result.exceptionCode
                : "ACTION_SKIPPED",
            explanation:
              typeof action.result.reason === "string"
                ? action.result.reason
                : "The action was skipped under organizational policy.",
          },
        ];
      }),
    ],
    failuresAndRetries: {
      actionCount: actions.length,
      failedCount: failedActions.length,
      retryCount: actions.reduce(
        (count, action) => count + Math.max(0, action.attempts - 1),
        0,
      ),
      failures: failedActions.map((action) => ({
        actionId: String(action._id),
        attempts: action.attempts,
        errorCode:
          isObjectRecord(action.error) && typeof action.error.code === "string"
            ? action.error.code
            : "ACTION_FAILED",
      })),
    },
    auditChain,
  };
  const timeline = auditEvents.map((event) => ({
    seq: event.seq,
    eventType: event.eventType,
    at: event.at,
    actorType: event.actorType,
    actorId: event.actorId,
    status: event.status,
  }));
  const baseRecord: Omit<FulfilmentRecordDocument, "contentHash"> = {
    requestId,
    recordId: `FUL-${requestId}`,
    summary: `${request.type} request ${requestId} finalized under organizational policy.`,
    timeline,
    approvals: approvalHistory(
      approvals as unknown as Array<Record<string, unknown>>,
    ),
    actions: actionItems,
    inventoryVersion,
    exportManifest,
    details,
    disclaimers: [orgPolicy.disclaimers.finalRecord, fulfilmentStatement],
    finalizedAt,
  };
  const contentHash = sha256Json(baseRecord);
  const record = {
    ...baseRecord,
    contentHash,
  } satisfies FulfilmentRecordDocument;

  let persisted: FulfilmentRecordDocument;
  try {
    persisted = await FulfilmentRecord.create(record);
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    const concurrentRecord = await FulfilmentRecord.findOne({ requestId }).lean();
    if (!concurrentRecord) {
      throw error;
    }
    const replay = idempotentResult(
      concurrentRecord as unknown as StoredRecord,
    );
    const latestRequest = await PrivacyRequest.findOne({ requestId });
    if (latestRequest && latestRequest.status !== "COMPLETED") {
      await transitionRequestStatus(requestId, "COMPLETED", actor);
    }
    return replay;
  }

  if (request.status !== "COMPLETED") {
    await transitionRequestStatus(requestId, "COMPLETED", actor);
  }
  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "RECORD_FINALIZED",
    input: {
      recordId: persisted.recordId,
      contentHash: persisted.contentHash,
      inventoryVersion: persisted.inventoryVersion,
    },
    output: { status: "COMPLETED" },
    status: "ok",
  });
  const finalRecord = persisted as unknown as FulfilmentRecordDocument;
  if (!verifyFulfilmentRecordHash(finalRecord)) {
    throw new PolicyViolationError(
      "The finalized fulfilment record failed its content-hash verification.",
      409,
    );
  }
  return {
    finalized: true,
    record: finalRecord,
    hashValid: true,
    idempotentReplay: false,
  };
}

export async function getFulfilmentRecord(requestId: string) {
  await connectDB();
  const record = await FulfilmentRecord.findOne({ requestId }).lean();
  if (!record) {
    throw new NotFoundError(`No fulfilment record exists for ${requestId}.`);
  }
  const document = record as unknown as FulfilmentRecordDocument;
  return {
    record: document,
    hashValid: verifyFulfilmentRecordHash(document),
    html: renderHtml(document),
  };
}
