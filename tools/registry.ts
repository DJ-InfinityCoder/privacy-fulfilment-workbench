import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendAudit, type AuditActorType } from "@/lib/audit";
import { maybeFailForChaos, TransientChaosError } from "@/lib/chaos";
import {
  ApprovalRequiredError,
  AppError,
  IdempotencyConflictError,
  NotFoundError,
  PolicyViolationError,
  ToolNotPermittedError,
  ValidationError,
  VerificationRequiredError,
} from "@/lib/errors";
import { connectDB } from "@/lib/db";
import { sha256Json } from "@/lib/hash";
import { ActionExecution } from "@/models/ActionExecution";
import { ActivityLog } from "@/models/ActivityLog";
import { Approval } from "@/models/Approval";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import { SupportTicket } from "@/models/SupportTicket";
import { UserProfile } from "@/models/UserProfile";
import type { JsonRecord } from "@/models/model-types";
import { orgPolicy, type DataSourceName, type PolicyActor } from "@/policy/org-policy";
import {
  canToolRun,
  classifyField,
  evaluateDeletionEligibility,
} from "@/policy/policy-engine";
import {
  assertVerified,
} from "@/services/verification-service";

export type ToolContext = {
  requestId: string;
  actor: PolicyActor & {
    actorId: string;
    actorType: AuditActorType;
  };
  timeoutMs?: number;
};

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };

export type LlmToolDefinition = {
  name: string;
  description: string;
  parameters: z.core.JSONSchema.BaseSchema;
};

export type RegisteredTool<TSchema extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  type: "read" | "write" | "propose";
  inputSchema: TSchema;
  jsonSchema: z.core.JSONSchema.BaseSchema;
  execute: (ctx: ToolContext, input: unknown) => Promise<unknown>;
};

const searchSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const getRecordSchema = z.object({
  source: z.enum(["user_profiles", "support_tickets", "activity_logs"]),
  recordId: z.string().trim().min(1).max(160),
});

const proposeCorrectionSchema = z.object({
  source: z.enum(["user_profiles", "support_tickets"]),
  recordId: z.string().trim().min(1).max(160),
  field: z.string().trim().min(1).max(120),
  value: z.unknown().refine((value) => value !== undefined),
  rationale: z.string().trim().min(1).max(2000),
});

const proposeDeletionSchema = z.object({
  source: z.enum(["user_profiles", "support_tickets", "activity_logs"]),
  recordId: z.string().trim().min(1).max(160),
  rationale: z.string().trim().min(1).max(2000),
});

const correctionApprovalSchema = z.object({
  approvalId: z.string().trim().min(1).max(160),
  idempotencyKey: z.string().trim().min(8).max(200),
  source: z.enum(["user_profiles", "support_tickets"]),
  recordId: z.string().trim().min(1).max(160),
  field: z.string().trim().min(1).max(120),
  value: z.unknown().refine((value) => value !== undefined),
});

const deletionApprovalSchema = z.object({
  approvalId: z.string().trim().min(1).max(160),
  idempotencyKey: z.string().trim().min(8).max(200),
  source: z.enum(["user_profiles", "support_tickets", "activity_logs"]),
  recordId: z.string().trim().min(1).max(160),
});

const profileCorrectionFields = new Set([
  "fullName",
  "email",
  "phone",
  "address",
  "preferences",
  "marketingConsent",
]);
const ticketCorrectionFields = new Set(["subject", "category"]);

function jsonSchemaFor<TSchema extends z.ZodType>(
  schema: TSchema,
): z.core.JSONSchema.BaseSchema {
  return z.toJSONSchema(schema, { target: "draft-7" });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskIpAddress(value: string): string {
  if (value.includes(".")) {
    const octets = value.split(".");
    if (octets.length === 4) {
      return `${octets[0]}.${octets[1]}.x.x`;
    }
  }

  if (value.includes(":")) {
    const segments = value.split(":");
    return `${segments.slice(0, 2).join(":")}:…`;
  }

  return "[masked]";
}

function sanitizeProfile(profile: Record<string, unknown>): JsonRecord {
  const safe = { ...profile };
  const withheldFields: Array<{ name: string; classification: string }> = [];
  for (const field of ["internalRiskScore", "internalRiskDetails", "dateOfBirth"]) {
    if (safe[field] !== undefined) {
      withheldFields.push({
        name: field,
        classification: classifyField("user_profiles", field) ?? "RESTRICTED",
      });
    }
  }
  delete safe.internalRiskScore;
  delete safe.internalRiskDetails;
  delete safe.dateOfBirth;
  safe._withheldFields = withheldFields;
  return safe;
}

function sanitizeTicket(ticket: Record<string, unknown>): JsonRecord {
  const safe = { ...ticket };
  const messages = safe.messages;
  const withheldFields: Array<{ name: string; classification: string }> = [];
  if (Array.isArray(safe.internalNotes) && safe.internalNotes.length > 0) {
    withheldFields.push({ name: "internalNotes", classification: "INTERNAL" });
  }
  if (
    Array.isArray(messages) &&
    messages.some(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "authorType" in message &&
        message.authorType !== "customer",
    )
  ) {
    withheldFields.push({
      name: "thirdPartyMessages",
      classification: "THIRD_PARTY",
    });
  }
  delete safe.internalNotes;
  delete safe.messages;
  safe._withheldFields = withheldFields;
  return {
    ...safe,
    messages: Array.isArray(messages)
      ? messages.filter(
          (message): message is Record<string, unknown> =>
            typeof message === "object" &&
            message !== null &&
            "authorType" in message &&
            message.authorType === "customer",
        )
      : [],
  };
}

function sanitizeActivityLog(log: Record<string, unknown>): JsonRecord {
  const safe = { ...log };
  const ip = safe.ip;
  const withheldFields: Array<{ name: string; classification: string }> = [];
  if (safe.metadata !== undefined) {
    withheldFields.push({
      name: "metadata",
      classification: classifyField("activity_logs", "metadata") ?? "SENSITIVE",
    });
  }
  delete safe.metadata;
  delete safe.ip;
  return {
    ...safe,
    ...(typeof ip === "string" ? { ip: maskIpAddress(ip) } : {}),
    _withheldFields: withheldFields,
  };
}

function sanitizeDataRecord(
  source: DataSourceName,
  record: Record<string, unknown>,
): JsonRecord {
  const sanitized =
    source === "user_profiles"
      ? sanitizeProfile(record)
      : source === "support_tickets"
        ? sanitizeTicket(record)
        : sanitizeActivityLog(record);
  const retainedIdentifiers = new Set([
    "userId",
    "ticketId",
    "logId",
  ]);
  const withheldFields = Array.isArray(sanitized._withheldFields)
    ? [...sanitized._withheldFields]
    : [];
  const withheldNames = new Set(
    withheldFields.flatMap((field) =>
      typeof field === "object" &&
      field !== null &&
      "name" in field &&
      typeof field.name === "string"
        ? [field.name]
        : [],
    ),
  );

  for (const field of Object.keys(record)) {
    const classification = classifyField(source, field);
    if (
      classification === "RESTRICTED" ||
      classification === "THIRD_PARTY" ||
      classification === "INTERNAL"
    ) {
      if (!retainedIdentifiers.has(field)) {
        delete sanitized[field];
        if (field !== "_id" && field !== "__v" && !withheldNames.has(field)) {
          withheldFields.push({ name: field, classification });
          withheldNames.add(field);
        }
      }
    }
  }
  sanitized._withheldFields = withheldFields;
  return sanitized;
}

async function findScopedRecord(
  source: DataSourceName,
  recordId: string,
  subjectUserId: string,
): Promise<Record<string, unknown> | null> {
  if (source === "user_profiles") {
    if (recordId !== subjectUserId) {
      return null;
    }
    const record = await UserProfile.findOne({ userId: subjectUserId })
      .select("+internalRiskScore +internalRiskDetails")
      .lean();
    return record as Record<string, unknown> | null;
  }

  if (source === "support_tickets") {
    const record = await SupportTicket.findOne({
      ticketId: recordId,
      userId: subjectUserId,
    })
      .select("+internalNotes")
      .lean();
    return record as Record<string, unknown> | null;
  }

  const record = await ActivityLog.findOne({
    logId: recordId,
    userId: subjectUserId,
  }).lean();
  return record as Record<string, unknown> | null;
}

function requestJsonRecord(plan: unknown): JsonRecord {
  if (typeof plan === "object" && plan !== null && !Array.isArray(plan)) {
    return plan as JsonRecord;
  }
  return {};
}

function assertCorrectionValue(
  source: "user_profiles" | "support_tickets",
  field: string,
  value: unknown,
): void {
  let valid = false;
  if (source === "user_profiles" && field === "marketingConsent") {
    valid = typeof value === "boolean";
  } else if (source === "user_profiles" && field === "preferences") {
    valid =
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value);
  } else if (field === "email" && source === "user_profiles") {
    valid = z.string().email().safeParse(value).success;
  } else if (
    field === "fullName" ||
    field === "phone" ||
    field === "address" ||
    field === "subject" ||
    field === "category"
  ) {
    valid = z.string().trim().min(1).max(500).safeParse(value).success;
  }

  if (!valid) {
    throw new ValidationError("The correction value does not match the selected field.");
  }
}

async function assertRequestVerified(requestId: string) {
  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError("The request was not found.");
  }
  assertRequestIsVerified(request);
  return request;
}

function assertRequestIsVerified(
  request: Parameters<typeof assertVerified>[0],
): void {
  assertVerified(request);
}

async function searchProfiles(ctx: ToolContext, input: z.output<typeof searchSchema>) {
  const request = await assertRequestVerified(ctx.requestId);
  const query: Record<string, unknown> = { userId: request.subjectUserId };
  if (input.query) {
    const pattern = new RegExp(escapeRegex(input.query), "i");
    query.$or = [{ fullName: pattern }, { email: pattern }];
  }
  const records = await UserProfile.find(query)
    .limit(input.limit)
    .select("+internalRiskScore +internalRiskDetails")
    .lean();
  return records.map((record) => ({
    ...sanitizeDataRecord("user_profiles", record),
    _deletionEligibility: evaluateDeletionEligibility("user_profiles", record),
  }));
}

async function searchTickets(ctx: ToolContext, input: z.output<typeof searchSchema>) {
  const request = await assertRequestVerified(ctx.requestId);
  const query: Record<string, unknown> = { userId: request.subjectUserId };
  if (input.query) {
    query.subject = new RegExp(escapeRegex(input.query), "i");
  }
  const records = await SupportTicket.find(query)
    .sort({ createdAt: -1 })
    .limit(input.limit)
    .select("+internalNotes")
    .lean();
  return records.map((record) => ({
    ...sanitizeDataRecord("support_tickets", record),
    _deletionEligibility: evaluateDeletionEligibility("support_tickets", record),
  }));
}

async function searchActivityLogs(ctx: ToolContext, input: z.output<typeof searchSchema>) {
  const request = await assertRequestVerified(ctx.requestId);
  const query: Record<string, unknown> = { userId: request.subjectUserId };
  if (input.query) {
    query.event = new RegExp(escapeRegex(input.query), "i");
  }
  const records = await ActivityLog.find(query)
    .sort({ at: -1 })
    .limit(input.limit)
    .lean();
  return records.map((record) => ({
    ...sanitizeDataRecord("activity_logs", record),
    _deletionEligibility: evaluateDeletionEligibility("activity_logs", record),
  }));
}

async function getRecord(ctx: ToolContext, input: z.output<typeof getRecordSchema>) {
  const request = await assertRequestVerified(ctx.requestId);
  const record = await findScopedRecord(
    input.source,
    input.recordId,
    request.subjectUserId,
  );
  if (!record) {
    throw new NotFoundError("The requested record was not found.");
  }
  return {
    ...sanitizeDataRecord(input.source, record),
    _deletionEligibility: evaluateDeletionEligibility(input.source, record),
  };
}

async function recordProposal(
  ctx: ToolContext,
  proposal: JsonRecord,
): Promise<JsonRecord> {
  const request = await assertRequestVerified(ctx.requestId);
  const currentPlan = request.plan;
  const currentStatus = request.status;
  const plan = requestJsonRecord(currentPlan);
  const existingActions = Array.isArray(plan.proposedActions)
    ? plan.proposedActions
    : [];
  const intent = {
    proposalId: randomUUID(),
    ...proposal,
    proposedBy: ctx.actor.actorId,
    proposedAt: new Date().toISOString(),
  };
  const proposedActions = [...existingActions, intent];

  const updated = await PrivacyRequest.findOneAndUpdate(
    {
      requestId: ctx.requestId,
      status: currentStatus,
      "verification.status": "PASSED",
    },
    { $set: { plan: { ...plan, proposedActions } } },
    { returnDocument: "after", runValidators: true },
  );
  if (!updated) {
    throw new PolicyViolationError("The request changed before the proposal was recorded.", 409);
  }

  return {
    recorded: true,
    proposalId: intent.proposalId,
    actionType: proposal.actionType,
  };
}

async function proposeCorrection(
  ctx: ToolContext,
  input: z.output<typeof proposeCorrectionSchema>,
) {
  const request = await assertRequestVerified(ctx.requestId);
  const allowedFields =
    input.source === "user_profiles"
      ? profileCorrectionFields
      : ticketCorrectionFields;
  if (!allowedFields.has(input.field)) {
    throw new PolicyViolationError("Correction of this field is not permitted.");
  }
  assertCorrectionValue(input.source, input.field, input.value);
  const record = await findScopedRecord(
    input.source,
    input.recordId,
    request.subjectUserId,
  );
  if (!record) {
    throw new NotFoundError("The requested record was not found.");
  }

  return recordProposal(ctx, {
    actionType: "CORRECTION",
    source: input.source,
    recordId: input.recordId,
    field: input.field,
    valueHash: sha256Json(input.value),
    rationale: input.rationale,
  });
}

async function proposeDeletion(
  ctx: ToolContext,
  input: z.output<typeof proposeDeletionSchema>,
) {
  const request = await assertRequestVerified(ctx.requestId);
  const record = await findScopedRecord(input.source, input.recordId, request.subjectUserId);
  if (!record) {
    throw new NotFoundError("The requested record was not found.");
  }

  const eligibility = evaluateDeletionEligibility(input.source, record);
  return recordProposal(ctx, {
    actionType: "DELETION",
    source: input.source,
    recordId: input.recordId,
    rationale: input.rationale,
    deletionEligible: eligibility.allowed,
    deletionReason: eligibility.reason,
    exceptionCode: eligibility.exceptionCode,
  });
}

function actionSetHash(action: JsonRecord): string {
  return sha256Json([action]);
}

function payloadHash(action: JsonRecord): string {
  return sha256Json(action);
}

async function ensureApproval(
  ctx: ToolContext,
  approvalId: string,
  expectedKind: "CORRECTION" | "DELETION",
  exactActionSetHash: string,
): Promise<{ requestAssignee?: string }> {
  const approval = await Approval.findOne({
    approvalId,
    requestId: ctx.requestId,
  }).lean();
  if (
    !approval ||
    approval.kind !== expectedKind ||
    approval.status !== "APPROVED" ||
    approval.expiresAt.getTime() <= Date.now() ||
    approval.actionSetHash !== exactActionSetHash ||
    !approval.decidedBy ||
    !approval.decidedByRole ||
    !orgPolicy.approvalRules.allowedApproverRoles.some(
      (role) => role === approval.decidedByRole,
    )
  ) {
    throw new ApprovalRequiredError("A valid approval for this exact action is required.");
  }

  const request = await PrivacyRequest.findOne({ requestId: ctx.requestId }).lean();
  if (!request) {
    throw new NotFoundError("The request was not found.");
  }
  if (
    expectedKind === "DELETION" &&
    orgPolicy.approvalRules.deletionApproverMustDifferFromAssignee &&
    approval.decidedBy === request.assignee
  ) {
    throw new PolicyViolationError("Deletion approval must come from someone other than the assignee.");
  }

  return { requestAssignee: request.assignee };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

async function reserveAction(
  ctx: ToolContext,
  actionType: "CORRECTION" | "DELETION",
  input: z.output<typeof correctionApprovalSchema> | z.output<typeof deletionApprovalSchema>,
  action: JsonRecord,
): Promise<{ executionId: string; replay?: unknown }> {
  const hash = payloadHash(action);
  try {
    const execution = await ActionExecution.create({
      requestId: ctx.requestId,
      actionType,
      target: {
        source: input.source,
        recordId: input.recordId,
        ...("field" in input ? { field: input.field } : {}),
      },
      payloadHash: hash,
      idempotencyKey: input.idempotencyKey,
      status: "PENDING",
      attempts: 0,
      approvalId: input.approvalId,
    });
    return { executionId: execution.id };
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    const previous = await ActionExecution.findOne({
      idempotencyKey: input.idempotencyKey,
    }).lean();
    if (!previous) {
      throw error;
    }
    if (
      previous.requestId !== ctx.requestId ||
      previous.payloadHash !== hash ||
      previous.actionType !== actionType
    ) {
      throw new IdempotencyConflictError();
    }
    if (previous.status === "SUCCEEDED") {
      await appendAudit({
        requestId: ctx.requestId,
        actorType: ctx.actor.actorType,
        actorId: ctx.actor.actorId,
        eventType: "ACTION_SKIPPED_DUPLICATE",
        input: { actionId: previous.id, idempotencyKey: input.idempotencyKey },
        status: "ok",
      });
      return { executionId: previous.id, replay: previous.result };
    }
    throw new IdempotencyConflictError(
      "An action with this idempotency key is already in progress or has failed.",
    );
  }
}

async function consumeApproval(
  ctx: ToolContext,
  approvalId: string,
  actionHash: string,
  kind: "CORRECTION" | "DELETION",
): Promise<void> {
  const approval = await Approval.findOneAndUpdate(
    {
      approvalId,
      requestId: ctx.requestId,
      kind,
      status: "APPROVED",
      actionSetHash: actionHash,
      expiresAt: { $gt: new Date() },
    },
    { $set: { status: "CONSUMED" } },
    { returnDocument: "after" },
  );
  if (!approval) {
    throw new ApprovalRequiredError(
      "Approval expired, was consumed, or does not match the action.",
    );
  }
}

async function updateExecution(
  executionId: string,
  update: Record<string, unknown>,
): Promise<void> {
  await ActionExecution.updateOne({ _id: executionId }, { $set: update });
}

async function applyCorrection(
  ctx: ToolContext,
  input: z.output<typeof correctionApprovalSchema>,
) {
  const request = await assertRequestVerified(ctx.requestId);
  const allowedFields =
    input.source === "user_profiles"
      ? profileCorrectionFields
      : ticketCorrectionFields;
  if (!allowedFields.has(input.field)) {
    throw new PolicyViolationError("Correction of this field is not permitted.");
  }
  assertCorrectionValue(input.source, input.field, input.value);

  const action = {
    actionType: "CORRECTION",
    source: input.source,
    recordId: input.recordId,
    field: input.field,
    valueHash: sha256Json(input.value),
  };
  const exactHash = actionSetHash(action);
  const reservation = await reserveAction(ctx, "CORRECTION", input, action);
  if (reservation.replay !== undefined) {
    return reservation.replay;
  }

  try {
    const target = await findScopedRecord(
      input.source,
      input.recordId,
      request.subjectUserId,
    );
    if (!target) {
      throw new NotFoundError("The requested record was not found.");
    }
    const beforeValue = target[input.field];
    await ensureApproval(ctx, input.approvalId, "CORRECTION", exactHash);
    await consumeApproval(ctx, input.approvalId, exactHash, "CORRECTION");

    const update = { $set: { [input.field]: input.value } };
    if (input.source === "user_profiles") {
      await UserProfile.updateOne(
        { userId: request.subjectUserId },
        update,
        { runValidators: true },
      );
    } else {
      await SupportTicket.updateOne(
        { ticketId: input.recordId, userId: request.subjectUserId },
        update,
        { runValidators: true },
      );
    }

    const result = {
      applied: true,
      source: input.source,
      recordId: input.recordId,
      field: input.field,
      valueHash: sha256Json(input.value),
    };
    await updateExecution(reservation.executionId, {
      status: "SUCCEEDED",
      attempts: 1,
      beforeSnapshot: { [input.field]: sha256Json(beforeValue) },
      afterSnapshot: { [input.field]: sha256Json(input.value) },
      result,
    });
    return result;
  } catch (error: unknown) {
    await updateExecution(reservation.executionId, {
      status: "FAILED",
      attempts: 1,
      error: { code: error instanceof AppError ? error.code : "TOOL_EXECUTION_FAILED" },
    });
    throw error;
  }
}

async function applyDeletion(
  ctx: ToolContext,
  input: z.output<typeof deletionApprovalSchema>,
) {
  const request = await assertRequestVerified(ctx.requestId);
  const target = await findScopedRecord(
    input.source,
    input.recordId,
    request.subjectUserId,
  );
  if (!target) {
    throw new NotFoundError("The requested record was not found.");
  }
  const eligibility = evaluateDeletionEligibility(input.source, target);
  if (!eligibility.allowed) {
    throw new PolicyViolationError(eligibility.reason);
  }

  const action = {
    actionType: "DELETION",
    source: input.source,
    recordId: input.recordId,
  };
  const exactHash = actionSetHash(action);
  const reservation = await reserveAction(ctx, "DELETION", input, action);
  if (reservation.replay !== undefined) {
    return reservation.replay;
  }

  try {
    await ensureApproval(ctx, input.approvalId, "DELETION", exactHash);
    await consumeApproval(ctx, input.approvalId, exactHash, "DELETION");

    if (input.source === "user_profiles") {
      await UserProfile.updateOne(
        { userId: request.subjectUserId },
        {
          $set: {
            fullName: "Anonymized User",
            email: `anonymized-${sha256Json(input.recordId).slice(0, 16)}@example.invalid`,
            phone: "0000000000",
            address: "REDACTED",
            preferences: {},
            marketingConsent: false,
            accountStatus: "anonymized",
            anonymizedAt: new Date(),
          },
        },
      );
    } else if (input.source === "support_tickets") {
      await SupportTicket.deleteOne({
        ticketId: input.recordId,
        userId: request.subjectUserId,
      });
    } else {
      await ActivityLog.deleteOne({ logId: input.recordId, userId: request.subjectUserId });
    }

    const result = {
      applied: true,
      source: input.source,
      recordId: input.recordId,
      method:
        input.source === "user_profiles"
          ? "anonymized"
          : "deleted",
      exceptionCode: eligibility.exceptionCode,
    };
    await updateExecution(reservation.executionId, {
      status: "SUCCEEDED",
      attempts: 1,
      beforeSnapshot: sanitizeDataRecord(input.source, target),
      afterSnapshot: result,
      result,
    });
    return result;
  } catch (error: unknown) {
    await updateExecution(reservation.executionId, {
      status: "FAILED",
      attempts: 1,
      error: { code: error instanceof AppError ? error.code : "TOOL_EXECUTION_FAILED" },
    });
    throw error;
  }
}

function defineTool<TSchema extends z.ZodType>(tool: {
  name: string;
  description: string;
  type: "read" | "write" | "propose";
  inputSchema: TSchema;
  execute: (ctx: ToolContext, input: z.output<TSchema>) => Promise<unknown>;
}): RegisteredTool<TSchema> {
  return {
    ...tool,
    jsonSchema: jsonSchemaFor(tool.inputSchema),
    execute: (ctx, input) => tool.execute(ctx, tool.inputSchema.parse(input)),
  };
}

const toolRegistry = {
  search_user_profiles: defineTool({
    name: "search_user_profiles",
    description: "Search profile records belonging only to the verified subject.",
    type: "read",
    inputSchema: searchSchema,
    execute: searchProfiles,
  }),
  search_support_tickets: defineTool({
    name: "search_support_tickets",
    description: "Search support tickets belonging only to the verified subject.",
    type: "read",
    inputSchema: searchSchema,
    execute: searchTickets,
  }),
  search_activity_logs: defineTool({
    name: "search_activity_logs",
    description: "Search activity logs belonging only to the verified subject.",
    type: "read",
    inputSchema: searchSchema,
    execute: searchActivityLogs,
  }),
  get_record: defineTool({
    name: "get_record",
    description: "Fetch one record only when it belongs to the verified subject.",
    type: "read",
    inputSchema: getRecordSchema,
    execute: getRecord,
  }),
  propose_correction: defineTool({
    name: "propose_correction",
    description: "Add a correction proposal to the verified request plan; does not change data.",
    type: "propose",
    inputSchema: proposeCorrectionSchema,
    execute: proposeCorrection,
  }),
  propose_deletion: defineTool({
    name: "propose_deletion",
    description: "Add a deletion proposal to the verified request plan; does not change data.",
    type: "propose",
    inputSchema: proposeDeletionSchema,
    execute: proposeDeletion,
  }),
  apply_correction: defineTool({
    name: "apply_correction",
    description: "Apply an approved, idempotent correction action.",
    type: "write",
    inputSchema: correctionApprovalSchema,
    execute: applyCorrection,
  }),
  apply_deletion: defineTool({
    name: "apply_deletion",
    description: "Apply an approved, idempotent deletion action.",
    type: "write",
    inputSchema: deletionApprovalSchema,
    execute: applyDeletion,
  }),
} satisfies Record<string, RegisteredTool>;

const toolTimeoutMs = 25_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("TOOL_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function errorResult(error: unknown): ToolResult {
  if (error instanceof AppError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Tool input is invalid." },
    };
  }
  if (error instanceof TransientChaosError) {
    return {
      ok: false,
      error: { code: error.code, message: "A transient tool failure occurred." },
    };
  }
  return {
    ok: false,
    error: {
      code:
        error instanceof Error && error.message === "TOOL_TIMEOUT"
          ? "TOOL_TIMEOUT"
          : "TOOL_EXECUTION_FAILED",
      message:
        error instanceof Error && error.message === "TOOL_TIMEOUT"
          ? "The tool exceeded its execution time limit."
          : "The tool could not complete the requested operation.",
    },
  };
}

async function auditDenied(
  ctx: ToolContext,
  name: string,
  code: string,
): Promise<void> {
  await appendAudit({
    requestId: ctx.requestId,
    actorType: ctx.actor.actorType,
    actorId: ctx.actor.actorId,
    eventType: "TOOL_DENIED",
    toolName: name,
    input: { toolName: name },
    status: "denied",
    error: { code },
  });
}

export async function invokeTool(
  ctx: ToolContext,
  name: string,
  rawInput: unknown,
): Promise<ToolResult> {
  await connectDB();
  const tool = Object.hasOwn(toolRegistry, name)
    ? toolRegistry[name as keyof typeof toolRegistry]
    : undefined;

  if (!tool) {
    await auditDenied(ctx, name, "TOOL_NOT_PERMITTED");
    return errorResult(new ToolNotPermittedError("Unknown tool."));
  }

  let parsedInput: unknown;
  try {
    if (!canToolRun(name, ctx.actor)) {
      throw new ToolNotPermittedError();
    }

    if (
      tool.type === "write" &&
      (ctx.actor.role === "agent" ||
        !["system"].includes(ctx.actor.role))
    ) {
      throw new ToolNotPermittedError("Write tools can only run as the system role.");
    }

    parsedInput = tool.inputSchema.parse(rawInput);

    const request = await PrivacyRequest.findOne({ requestId: ctx.requestId });
    if (!request) {
      throw new NotFoundError("The request was not found.");
    }

    if (tool.type === "read" || tool.type === "propose" || tool.type === "write") {
      assertVerified(request);
    }

    if (tool.type === "write") {
      const hasApproval = typeof parsedInput === "object" && parsedInput !== null &&
        "approvalId" in parsedInput && typeof parsedInput.approvalId === "string";
      const hasIdempotencyKey = typeof parsedInput === "object" && parsedInput !== null &&
        "idempotencyKey" in parsedInput && typeof parsedInput.idempotencyKey === "string";
      if (!hasApproval || !hasIdempotencyKey) {
        throw new ApprovalRequiredError("A valid approval and idempotency key are required.");
      }
    }
  } catch (error: unknown) {
    const result = errorResult(error);
    const denied =
      error instanceof ToolNotPermittedError ||
      error instanceof VerificationRequiredError ||
      error instanceof ApprovalRequiredError ||
      error instanceof PolicyViolationError;
    if (denied) {
      await auditDenied(ctx, name, result.ok ? "TOOL_NOT_PERMITTED" : result.error.code);
    } else {
      await appendAudit({
        requestId: ctx.requestId,
        actorType: ctx.actor.actorType,
        actorId: ctx.actor.actorId,
        eventType: "TOOL_FAILED",
        toolName: name,
        input: { toolName: name },
        status: "error",
        error: { code: result.ok ? "TOOL_EXECUTION_FAILED" : result.error.code },
      });
    }
    return result;
  }

  const startedAt = Date.now();
  await appendAudit({
    requestId: ctx.requestId,
    actorType: ctx.actor.actorType,
    actorId: ctx.actor.actorId,
    eventType: "TOOL_CALL",
    toolName: name,
    input: parsedInput,
    status: "ok",
  });

  try {
    maybeFailForChaos();
    const data = await withTimeout(
      tool.execute(ctx, parsedInput),
      ctx.timeoutMs ?? toolTimeoutMs,
    );
    await appendAudit({
      requestId: ctx.requestId,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      eventType: "TOOL_RESULT",
      toolName: name,
      input: { durationMs: Date.now() - startedAt },
      output: { completed: true },
      status: "ok",
    });
    return { ok: true, data };
  } catch (error: unknown) {
    const result = errorResult(error);
    await appendAudit({
      requestId: ctx.requestId,
      actorType: ctx.actor.actorType,
      actorId: ctx.actor.actorId,
      eventType: "TOOL_FAILED",
      toolName: name,
      input: { durationMs: Date.now() - startedAt },
      status: "error",
      error: { code: result.ok ? "TOOL_EXECUTION_FAILED" : result.error.code },
    });
    return result;
  }
}

export function getLlmToolDefinitions(): LlmToolDefinition[] {
  return Object.values(toolRegistry)
    .filter((tool) => tool.type === "read" || tool.type === "propose")
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema,
    }));
}

export function createToolActionSetHash(action: JsonRecord): string {
  return actionSetHash(action);
}
