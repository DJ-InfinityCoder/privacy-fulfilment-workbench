import { isValidObjectId } from "mongoose";
import { maybeFailForChaos } from "@/lib/chaos";
import { appendAudit, type AuditActorType } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import {
  ApprovalRequiredError,
  IdempotencyConflictError,
  NotFoundError,
  PolicyViolationError,
  ToolExecutionError,
  ValidationError,
} from "@/lib/errors";
import { sha256, sha256Json } from "@/lib/hash";
import { ActionExecution, type ActionExecutionDocument } from "@/models/ActionExecution";
import { ActivityLog } from "@/models/ActivityLog";
import { Approval } from "@/models/Approval";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { SupportTicket } from "@/models/SupportTicket";
import { UserProfile } from "@/models/UserProfile";
import type { DataSourceName, JsonRecord } from "@/models/model-types";
import { orgPolicy } from "@/policy/org-policy";
import { evaluateDeletionEligibility } from "@/policy/policy-engine";
import {
  findValidActionApproval,
  getApprovalActions,
  getApprovalActionSetHash,
} from "@/services/approval-service";
import { assertVerified } from "@/services/verification-service";
import { transitionRequestStatus } from "@/services/state-machine";

type ActionKind = "CORRECTION" | "DELETION";
type ActionActor = { actorId: string; actorType: AuditActorType };

const leaseDurationMs = 60_000;
const maxAttempts = 4;
const blockedCorrectionFields: Record<DataSourceName, ReadonlySet<string>> = {
  user_profiles: new Set([
    "fullName",
    "email",
    "phone",
    "address",
    "preferences",
    "marketingConsent",
  ]),
  support_tickets: new Set(["subject", "category"]),
  activity_logs: new Set(),
};

type PlannedAction = ReturnType<typeof getApprovalActions>[number];
type ActionOutcome = {
  actionId: string;
  idempotencyKey: string;
  status: "SUCCEEDED" | "SKIPPED" | "IN_PROGRESS";
  result: JsonRecord;
};
type TargetRecord = Record<string, unknown>;

function actionPayloadHash(action: PlannedAction): string {
  return action.type === "CORRECTION"
    ? sha256Json(action.newValue)
    : sha256Json({ action: "DELETION" });
}

export function getActionIdempotencyKey(
  requestId: string,
  action: PlannedAction,
): string {
  const payloadHash = actionPayloadHash(action);
  return sha256(
    `${requestId}${action.type}${action.source}${action.recordId}${action.type === "CORRECTION" ? action.field : ""}${payloadHash}`,
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

async function findTarget(
  source: DataSourceName,
  recordId: string,
  subjectUserId: string,
): Promise<TargetRecord | null> {
  if (source === "user_profiles") {
    if (recordId !== subjectUserId) {
      return null;
    }
    const record = await UserProfile.findOne({ userId: subjectUserId })
      .select("+internalRiskScore +internalRiskDetails")
      .lean();
    return record ? (record as unknown as TargetRecord) : null;
  }
  if (source === "support_tickets") {
    const record = await SupportTicket.findOne({
      ticketId: recordId,
      userId: subjectUserId,
    })
      .select("+internalNotes")
      .lean();
    return record ? (record as unknown as TargetRecord) : null;
  }
  const record = await ActivityLog.findOne({
    logId: recordId,
    userId: subjectUserId,
  }).lean();
  return record ? (record as unknown as TargetRecord) : null;
}

function validateCorrection(action: PlannedAction): asserts action is Extract<
  PlannedAction,
  { type: "CORRECTION" }
> {
  if (action.type !== "CORRECTION" || !action.field) {
    throw new ValidationError("The correction action is incomplete.");
  }
  const allowedOperation =
    orgPolicy.dataSources[action.source].allowedOperations.includes("correct");
  if (!allowedOperation || !blockedCorrectionFields[action.source].has(action.field)) {
    throw new PolicyViolationError("Correction of this field is not permitted.");
  }

  const value = action.newValue;
  const valid =
    (action.source === "user_profiles" &&
      action.field === "marketingConsent" &&
      typeof value === "boolean") ||
    (action.source === "user_profiles" &&
      action.field === "preferences" &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)) ||
    (action.source === "user_profiles" &&
      action.field === "email" &&
      typeof value === "string" &&
      zEmail(value)) ||
    ((action.field === "fullName" ||
      action.field === "phone" ||
      action.field === "address" ||
      action.field === "subject" ||
      action.field === "category") &&
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 500);
  if (!valid) {
    throw new ValidationError("The correction value does not match the selected field.");
  }
}

function zEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashFields(record: TargetRecord, fields: readonly string[]): JsonRecord {
  return Object.fromEntries(
    fields.map((field) => [field, sha256Json(record[field] ?? null)]),
  );
}

async function applyCorrection(
  subjectUserId: string,
  action: PlannedAction,
): Promise<{ result: JsonRecord; beforeSnapshot: JsonRecord; afterSnapshot: JsonRecord }> {
  validateCorrection(action);
  const record = await findTarget(action.source, action.recordId, subjectUserId);
  if (!record) {
    throw new NotFoundError("The correction target was not found for this subject.");
  }
  const field = action.field;
  const beforeSnapshot = hashFields(record, [field]);

  let update;
  if (action.source === "user_profiles") {
    update = await UserProfile.updateOne(
      { userId: subjectUserId },
      { $set: { [field]: action.newValue } },
      { runValidators: true },
    );
  } else if (action.source === "support_tickets") {
    update = await SupportTicket.updateOne(
      { ticketId: action.recordId, userId: subjectUserId },
      { $set: { [field]: action.newValue } },
      { runValidators: true },
    );
  } else {
    throw new PolicyViolationError("Activity logs cannot be corrected.");
  }
  if (update.matchedCount !== 1) {
    throw new NotFoundError("The correction target no longer exists.");
  }

  const after = await findTarget(action.source, action.recordId, subjectUserId);
  const afterSnapshot = after ? hashFields(after, [field]) : {};
  return {
    beforeSnapshot,
    afterSnapshot,
    result: {
      applied: true,
      actionType: action.type,
      source: action.source,
      recordId: action.recordId,
      field,
      valueHash: sha256Json(action.newValue),
    },
  };
}

async function applyDeletion(
  subjectUserId: string,
  action: PlannedAction,
  attempt: number,
): Promise<{
  status: "SUCCEEDED" | "SKIPPED";
  result: JsonRecord;
  beforeSnapshot: JsonRecord;
  afterSnapshot: JsonRecord;
}> {
  const record = await findTarget(action.source, action.recordId, subjectUserId);
  if (!record) {
    if (action.source === "activity_logs" && attempt > 1) {
      return {
        status: "SUCCEEDED",
        beforeSnapshot: { alreadyAbsent: true },
        afterSnapshot: { deleted: true },
        result: {
          applied: false,
          alreadyAbsent: true,
          source: action.source,
          recordId: action.recordId,
          method: "deleted",
        },
      };
    }
    throw new NotFoundError("The deletion target was not found for this subject.");
  }
  const eligibility = evaluateDeletionEligibility(action.source, record);
  if (!eligibility.allowed) {
    return {
      status: "SKIPPED",
      beforeSnapshot: { recordHash: sha256Json(record) },
      afterSnapshot: { unchanged: true },
      result: {
        applied: false,
        skipped: true,
        source: action.source,
        recordId: action.recordId,
        reason: eligibility.reason,
        exceptionCode: eligibility.exceptionCode,
      },
    };
  }

  if (action.source === "user_profiles") {
    const profile = record;
    const beforeSnapshot = hashFields(profile, [
      "fullName",
      "email",
      "phone",
      "dateOfBirth",
      "address",
      "preferences",
      "marketingConsent",
      "accountStatus",
      "internalRiskScore",
    ]);
    if (profile.accountStatus === "anonymized" || profile.anonymizedAt) {
      return {
        status: "SUCCEEDED",
        beforeSnapshot,
        afterSnapshot: { alreadyTombstoned: true },
        result: {
          applied: false,
          alreadyTombstoned: true,
          source: action.source,
          recordId: action.recordId,
          method: "anonymized",
          exceptionCode: eligibility.exceptionCode,
        },
      };
    }
    const anonymizedEmail = `anonymized-${sha256(action.recordId).slice(0, 16)}@example.invalid`;
    const now = new Date();
    const update = await UserProfile.updateOne(
      { userId: subjectUserId, accountStatus: { $ne: "anonymized" } },
      {
        $set: {
          fullName: "Anonymized User",
          email: anonymizedEmail,
          phone: "0000000000",
          dateOfBirth: new Date("1970-01-01T00:00:00.000Z"),
          address: "REDACTED",
          preferences: {},
          marketingConsent: false,
          accountStatus: "anonymized",
          anonymizedAt: now,
          internalRiskScore: 0,
        },
        $unset: { internalRiskDetails: 1, lastOrderCity: 1 },
      },
    );
    if (update.matchedCount === 0) {
      const current = await UserProfile.findOne({ userId: subjectUserId }).lean();
      if (!current) {
        throw new NotFoundError("The deletion target no longer exists.");
      }
    }
    return {
      status: "SUCCEEDED",
      beforeSnapshot,
      afterSnapshot: {
        accountStatus: "anonymized",
        anonymizedAt: now.toISOString(),
      },
      result: {
        applied: update.modifiedCount > 0,
        source: action.source,
        recordId: action.recordId,
        method: "anonymized",
        exceptionCode: eligibility.exceptionCode,
      },
    };
  }

  if (action.source === "support_tickets") {
    const messages = Array.isArray(record.messages) ? record.messages : [];
    const beforeSnapshot = {
      subjectHash: sha256Json(record.subject ?? null),
      customerMessageHashes: messages.flatMap((message) => {
        if (
          typeof message === "object" &&
          message !== null &&
          "authorType" in message &&
          message.authorType === "customer" &&
          "text" in message
        ) {
          return [sha256Json(message.text)];
        }
        return [];
      }),
    };
    const scrubbedMessages = messages.map((message) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "authorType" in message &&
        message.authorType === "customer"
      ) {
        return { ...message, text: "[REDACTED: customer data deleted]" };
      }
      return message;
    });
    const update = await SupportTicket.updateOne(
      { ticketId: action.recordId, userId: subjectUserId },
      {
        $set: {
          subject: "[REDACTED: customer data deleted]",
          messages: scrubbedMessages,
        },
      },
      { runValidators: true },
    );
    if (update.matchedCount !== 1) {
      throw new NotFoundError("The deletion target no longer exists.");
    }
    return {
      status: "SUCCEEDED",
      beforeSnapshot,
      afterSnapshot: { subject: "redacted", customerMessages: "redacted" },
      result: {
        applied: update.modifiedCount > 0,
        source: action.source,
        recordId: action.recordId,
        method: "customer-fields-redacted",
        exceptionCode: eligibility.exceptionCode,
      },
    };
  }

  const beforeSnapshot = { recordHash: sha256Json(record) };
  const deletion = await ActivityLog.deleteOne({
    logId: action.recordId,
    userId: subjectUserId,
  });
  if (deletion.deletedCount !== 1) {
    throw new NotFoundError("The deletion target no longer exists.");
  }
  return {
    status: "SUCCEEDED",
    beforeSnapshot,
    afterSnapshot: { deleted: true },
    result: {
      applied: true,
      source: action.source,
      recordId: action.recordId,
      method: "deleted",
      exceptionCode: eligibility.exceptionCode,
    },
  };
}

async function ensureExecution(
  requestId: string,
  kind: ActionKind,
  action: PlannedAction,
  approvalId: string,
): Promise<ActionExecutionDocument & { _id: unknown }> {
  const payloadHash = actionPayloadHash(action);
  const idempotencyKey = getActionIdempotencyKey(requestId, action);
  const target = {
    source: action.source,
    recordId: action.recordId,
    ...(action.type === "CORRECTION" ? { field: action.field } : {}),
  };
  try {
    const execution = await ActionExecution.findOneAndUpdate(
      { idempotencyKey },
      {
        $setOnInsert: {
          requestId,
          actionType: kind,
          target,
          payloadHash,
          idempotencyKey,
          status: "PENDING",
          attempts: 0,
          approvalId,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        setDefaultsOnInsert: true,
      },
    );
    if (!execution) {
      throw new ToolExecutionError("Could not reserve this action for execution.");
    }
    return execution as unknown as ActionExecutionDocument & { _id: unknown };
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    const existing = await ActionExecution.findOne({ idempotencyKey }).lean();
    if (!existing) {
      throw error;
    }
    if (
      existing.requestId !== requestId ||
      existing.payloadHash !== payloadHash ||
      existing.actionType !== kind ||
      existing.target.source !== action.source ||
      existing.target.recordId !== action.recordId ||
      existing.target.field !==
        (action.type === "CORRECTION" ? action.field : undefined)
    ) {
      throw new IdempotencyConflictError();
    }
    return existing as unknown as ActionExecutionDocument & { _id: unknown };
  }
}

async function auditAction(
  requestId: string,
  actor: ActionActor,
  eventType: "ACTION_STARTED" | "ACTION_SUCCEEDED" | "ACTION_FAILED" | "ACTION_SKIPPED" | "ACTION_SKIPPED_DUPLICATE",
  execution: ActionExecutionDocument,
  extra: JsonRecord = {},
  status: "ok" | "error" = "ok",
): Promise<void> {
  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType,
    input: {
      actionId: String((execution as ActionExecutionDocument & { _id?: unknown })._id ?? ""),
      idempotencyKey: execution.idempotencyKey,
      actionType: execution.actionType,
      source: execution.target.source,
      recordId: execution.target.recordId,
      ...(execution.target.field ? { field: execution.target.field } : {}),
    },
    ...(Object.keys(extra).length > 0 ? { output: extra } : {}),
    status,
  });
}

async function runOneAction(
  requestId: string,
  subjectUserId: string,
  approvalId: string,
  action: PlannedAction,
  actor: ActionActor,
): Promise<ActionOutcome> {
  const execution = await ensureExecution(requestId, action.type, action, approvalId);
  const idempotencyKey = getActionIdempotencyKey(requestId, action);

  if (execution.status === "SUCCEEDED" || execution.status === "SKIPPED") {
    await auditAction(
      requestId,
      actor,
      "ACTION_SKIPPED_DUPLICATE",
      execution,
      { status: execution.status },
    );
    return {
      actionId: String(execution._id),
      idempotencyKey,
      status: execution.status,
      result: execution.result ?? { applied: false },
    };
  }
  if (execution.status === "FAILED" && execution.attempts >= maxAttempts) {
    throw new ToolExecutionError(
      "This action reached its initial attempt plus three retries.",
    );
  }

  const now = new Date();
  const lease = await ActionExecution.findOneAndUpdate(
    {
      _id: execution._id,
      $or: [
        { status: "PENDING" },
        { status: "FAILED", attempts: { $lt: maxAttempts } },
        {
          status: "EXECUTING",
          leaseUntil: { $lte: now },
          attempts: { $lt: maxAttempts },
        },
      ],
    },
    {
      $set: {
        status: "EXECUTING",
        leaseUntil: new Date(now.getTime() + leaseDurationMs),
        approvalId,
      },
      $inc: { attempts: 1 },
      $unset: { error: 1 },
    },
    { returnDocument: "after" },
  );
  if (!lease) {
    const current = await ActionExecution.findById(execution._id).lean();
    if (!current) {
      throw new NotFoundError("The action execution record disappeared.");
    }
    if (current.status === "EXECUTING") {
      if (
        current.leaseUntil &&
        current.leaseUntil.getTime() <= Date.now() &&
        current.attempts >= maxAttempts
      ) {
        await ActionExecution.updateOne(
          { _id: current._id, status: "EXECUTING", attempts: { $gte: maxAttempts } },
          { $set: { status: "FAILED", error: { code: "RETRY_LIMIT_REACHED" } }, $unset: { leaseUntil: 1 } },
        );
        await auditAction(
          requestId,
          actor,
          "ACTION_FAILED",
          current as unknown as ActionExecutionDocument,
          { code: "RETRY_LIMIT_REACHED", attempt: current.attempts },
          "error",
        );
        throw new ToolExecutionError(
          "This action reached its initial attempt plus three retries.",
        );
      }
      await auditAction(
        requestId,
        actor,
        "ACTION_SKIPPED_DUPLICATE",
        current as unknown as ActionExecutionDocument,
        { reason: "ACTIVE_LEASE" },
      );
      return {
        actionId: String(current._id),
        idempotencyKey,
        status: "IN_PROGRESS",
        result: { skipped: true, reason: "ACTIVE_LEASE" },
      };
    }
    if (current.status === "SUCCEEDED" || current.status === "SKIPPED") {
      await auditAction(
        requestId,
        actor,
        "ACTION_SKIPPED_DUPLICATE",
        current as unknown as ActionExecutionDocument,
        { status: current.status },
      );
      return {
        actionId: String(current._id),
        idempotencyKey,
        status: current.status,
        result: current.result ?? { applied: false },
      };
    }
    throw new ToolExecutionError("Could not acquire the action execution lease.");
  }

  await auditAction(requestId, actor, "ACTION_STARTED", lease, {
    attempt: lease.attempts,
  });
  try {
    maybeFailForChaos();
    const result =
      action.type === "CORRECTION"
        ? {
            status: "SUCCEEDED" as const,
          ...(await applyCorrection(subjectUserId, action)),
          }
        : await applyDeletion(subjectUserId, action, lease.attempts);

    await ActionExecution.updateOne(
      { _id: lease._id, status: "EXECUTING" },
      {
        $set: {
          status: result.status,
          beforeSnapshot: result.beforeSnapshot,
          afterSnapshot: result.afterSnapshot,
          result: result.result,
        },
        $unset: { leaseUntil: 1 },
      },
    );
    await auditAction(
      requestId,
      actor,
      result.status === "SKIPPED" ? "ACTION_SKIPPED" : "ACTION_SUCCEEDED",
      lease,
      result.result,
    );
    return {
      actionId: String(lease._id),
      idempotencyKey,
      status: result.status,
      result: result.result,
    };
  } catch (error: unknown) {
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "ACTION_FAILED";
    await ActionExecution.updateOne(
      { _id: lease._id, status: "EXECUTING" },
      {
        $set: { status: "FAILED", error: { code } },
        $unset: { leaseUntil: 1 },
      },
    );
    await auditAction(
      requestId,
      actor,
      "ACTION_FAILED",
      lease,
      { code, attempt: lease.attempts },
      "error",
    );
    throw new ToolExecutionError(
      `Action execution failed on attempt ${lease.attempts}; retry with the same idempotency key.`,
    );
  }
}

async function consumeApproval(
  requestId: string,
  approvalId: string,
  actionSetHash: string,
): Promise<void> {
  const approval = await Approval.findOne({ approvalId, requestId }).lean();
  if (approval?.status === "CONSUMED") {
    return;
  }
  const consumed = await Approval.findOneAndUpdate(
    {
      approvalId,
      requestId,
      kind: { $in: ["CORRECTION", "DELETION"] },
      status: "APPROVED",
      actionSetHash,
    },
    { $set: { status: "CONSUMED" } },
    { returnDocument: "after" },
  );
  if (!consumed) {
    throw new ApprovalRequiredError("The approval could not be consumed.");
  }
}

export async function executeApprovedActions(
  requestId: string,
  kind: ActionKind,
  actor: ActionActor = { actorId: "action-service", actorType: "system" },
) {
  await connectDB();
  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError(`Request ${requestId} was not found.`);
  }
  assertRequestVerified(request);
  const approval = await findValidActionApproval(request, kind, {
    allowConsumedReplay: true,
  });
  const actions = getApprovalActions(request, kind);
  const actionSetHash = await getApprovalActionSetHash(request, kind);

  if (approval.status === "CONSUMED") {
    const priorExecutions = await ActionExecution.find({
      requestId,
      actionType: kind,
    }).lean();
    const priorKeys = new Set(priorExecutions.map((item) => item.idempotencyKey));
    if (
      actions.some(
        (action) => !priorKeys.has(getActionIdempotencyKey(requestId, action)),
      ) ||
      priorExecutions.some(
        (item) => item.status !== "SUCCEEDED" && item.status !== "SKIPPED",
      )
    ) {
      throw new ApprovalRequiredError(
        "A consumed approval can only be used to replay completed actions.",
      );
    }
  }

  if (
    request.status === "AWAITING_DELETION_APPROVAL" ||
    request.status === "AWAITING_CORRECTION_APPROVAL"
  ) {
    await transitionRequestStatus(requestId, "EXECUTING", {
      actorId: actor.actorId,
      actorType: actor.actorType,
    });
  }

  const outcomes: ActionOutcome[] = [];
  for (const action of actions) {
    outcomes.push(
      await runOneAction(requestId, request.subjectUserId ?? "", approval.approvalId, action, actor),
    );
  }

  const allActionsTerminal = outcomes.every(
    (outcome) => outcome.status === "SUCCEEDED" || outcome.status === "SKIPPED",
  );
  if (allActionsTerminal && approval.status !== "CONSUMED") {
    const stored = await ActionExecution.find({
      requestId,
      actionType: kind,
      idempotencyKey: { $in: actions.map((action) => getActionIdempotencyKey(requestId, action)) },
    }).lean();
    const allStoredTerminal =
      stored.length === actions.length &&
      stored.every(
        (item) => item.status === "SUCCEEDED" || item.status === "SKIPPED",
      );
    if (allStoredTerminal) {
      await consumeApproval(requestId, approval.approvalId, actionSetHash);
    }
  }
  return { requestId, kind, approvalId: approval.approvalId, outcomes };
}

function assertRequestVerified(
  request: Parameters<typeof assertVerified>[0],
): void {
  assertVerified(request);
}

export async function retryAction(actionId: string, actor: ActionActor) {
  await connectDB();
  const execution = isValidObjectId(actionId)
    ? await ActionExecution.findById(actionId).lean()
    : await ActionExecution.findOne({ idempotencyKey: actionId }).lean();
  if (!execution) {
    throw new NotFoundError(`Action ${actionId} was not found.`);
  }
  if (execution.status !== "FAILED") {
    const leaseExpired =
      execution.status === "EXECUTING" &&
      execution.leaseUntil !== undefined &&
      execution.leaseUntil.getTime() <= Date.now();
    if (!leaseExpired) {
      throw new PolicyViolationError("Only failed actions or expired leases can be retried.", 409);
    }
  }
  if (execution.attempts >= maxAttempts) {
    throw new ToolExecutionError(
      "This action reached its initial attempt plus three retries.",
    );
  }
  return executeApprovedActions(
    execution.requestId,
    execution.actionType,
    { actorId: `action-service:${actor.actorId}`, actorType: "system" },
  );
}
