import { z } from "zod";
import { appendAudit, type AuditActorType } from "@/lib/audit";
import { ValidationError, NotFoundError, PolicyViolationError } from "@/lib/errors";
import { connectDB } from "@/lib/db";
import { Counter } from "@/models/Counter";
import { PrivacyRequest, type PrivacyRequestDocument } from "@/models/PrivacyRequest";
import { orgPolicy } from "@/policy/org-policy";
import { computeDueDate } from "@/policy/policy-engine";
import {
  requestStatuses,
  requestTypes,
  type RequestType,
} from "@/models/model-types";

const createRequestSchema = z.object({
  type: z.enum(requestTypes),
  requesterName: z.string().trim().min(1).max(200),
  requesterEmail: z.string().trim().email().max(320),
  rawText: z.string().trim().min(1).max(10_000),
  subjectUserId: z.string().trim().min(1).max(120).optional(),
  assignee: z.string().trim().min(1).max(120).optional(),
  receivedAt: z.coerce.date().optional(),
});

export type CreateRequestInput = z.input<typeof createRequestSchema>;

export type RequestActor = {
  actorId: string;
  actorType: AuditActorType;
};

export type DeadlineState = "ON_TRACK" | "AT_RISK" | "OVERDUE";
export type DeadlineInfo = {
  daysRemaining: number;
  state: DeadlineState;
  percentElapsed: number;
};

export type RequestFilters = {
  status?: string;
  type?: RequestType;
  deadlineState?: DeadlineState;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type RequestListResult = {
  requests: Array<{
    request: PrivacyRequestDocument;
    deadline: DeadlineInfo;
  }>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const millisecondsPerDay = 24 * 60 * 60 * 1000;
const requestIdCounterPrefix = "privacyRequest";

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

function isRequestStatus(value: string): value is (typeof requestStatuses)[number] {
  return requestStatuses.some((status) => status === value);
}

async function generateRequestId(receivedAt: Date): Promise<string> {
  const year = receivedAt.getUTCFullYear();
  const counter = await Counter.findOneAndUpdate(
    { _id: `${requestIdCounterPrefix}:${year}` },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).lean();

  if (!counter) {
    throw new Error("Failed to allocate a request identifier.");
  }

  return `PRQ-${year}-${String(counter.value).padStart(4, "0")}`;
}

export async function createRequest(
  input: unknown,
  actor: RequestActor = { actorId: "privacy-ops", actorType: "human" },
): Promise<PrivacyRequestDocument> {
  const validated = parseInput(createRequestSchema, input);
  await connectDB();

  const receivedAt = validated.receivedAt ?? new Date();
  const requestId = await generateRequestId(receivedAt);
  const request = await PrivacyRequest.create({
    requestId,
    type: validated.type,
    status: "RECEIVED",
    requesterName: validated.requesterName,
    requesterEmail: validated.requesterEmail,
    rawText: validated.rawText,
    ...(validated.subjectUserId === undefined
      ? {}
      : { subjectUserId: validated.subjectUserId }),
    receivedAt,
    dueAt: computeDueDate(receivedAt, validated.type, false),
    extension: { applied: false },
    assignee: validated.assignee ?? "u-analyst",
    verification: {
      status: "PENDING",
      attempts: 0,
      factorsSubmitted: [],
      score: 0,
    },
  });

  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "REQUEST_CREATED",
    input: {
      type: request.type,
      requesterEmail: request.requesterEmail,
      subjectUserId: request.subjectUserId,
      receivedAt: request.receivedAt,
      dueAt: request.dueAt,
    },
    output: { requestId, status: request.status },
    status: "ok",
  });

  return request;
}

function effectiveDeadline(request: {
  dueAt: Date | string;
  extension?: { applied?: boolean; newDueAt?: Date | string };
}): Date {
  if (request.extension?.applied && request.extension.newDueAt) {
    return new Date(request.extension.newDueAt);
  }
  return new Date(request.dueAt);
}

export function getDeadlineInfo(
  request: Pick<PrivacyRequestDocument, "receivedAt" | "dueAt" | "extension">,
  now: Date = new Date(),
): DeadlineInfo {
  const receivedAt = new Date(request.receivedAt);
  const dueAt = effectiveDeadline(request);

  if (Number.isNaN(receivedAt.getTime()) || Number.isNaN(dueAt.getTime())) {
    throw new TypeError("Request deadline dates must be valid.");
  }

  const millisecondsRemaining = dueAt.getTime() - now.getTime();
  const daysRemaining = Math.ceil(millisecondsRemaining / millisecondsPerDay);
  const totalDuration = dueAt.getTime() - receivedAt.getTime();
  const elapsedDuration = now.getTime() - receivedAt.getTime();
  const percentElapsed =
    totalDuration <= 0
      ? 100
      : Math.min(100, Math.max(0, (elapsedDuration / totalDuration) * 100));

  return {
    daysRemaining,
    state:
      millisecondsRemaining < 0
        ? "OVERDUE"
        : daysRemaining <= 7
          ? "AT_RISK"
          : "ON_TRACK",
    percentElapsed,
  };
}

export async function extendDeadline(
  requestId: string,
  reason: string,
  actor: RequestActor,
): Promise<PrivacyRequestDocument> {
  await connectDB();
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new ValidationError("A reason is required to extend a deadline.");
  }
  if (trimmedReason.length > 2_000) {
    throw new ValidationError("The extension reason must be 2000 characters or fewer.");
  }

  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError(`Request ${requestId} was not found.`);
  }
  if (request.extension.applied) {
    await appendAudit({
      requestId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      eventType: "DEADLINE_EXTENDED",
      input: { applied: true, attemptedAgain: true, reason: trimmedReason },
      status: "denied",
      error: { code: "EXTENSION_ALREADY_APPLIED" },
    });
    throw new PolicyViolationError(
      "The request deadline has already been extended.",
      409,
    );
  }

  const requestType = requestTypes.find((type) => type === request.type);
  if (!requestType) {
    throw new PolicyViolationError("The request has an unsupported type.");
  }
  const requestPolicy = orgPolicy.requestTypes[requestType];
  if (requestPolicy.maxExtensions < 1 || !requestPolicy.extensionReasonRequired) {
    throw new PolicyViolationError("Deadline extensions are not allowed for this request.");
  }

  const newDueAt = new Date(
    request.dueAt.getTime() + requestPolicy.extensionDays * millisecondsPerDay,
  );
  const updatedRequest = await PrivacyRequest.findOneAndUpdate(
    { requestId, "extension.applied": false },
    {
      $set: {
        dueAt: newDueAt,
        "extension.applied": true,
        "extension.reason": trimmedReason,
        "extension.newDueAt": newDueAt,
      },
    },
    { returnDocument: "after", runValidators: true },
  );

  if (!updatedRequest) {
    await appendAudit({
      requestId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      eventType: "DEADLINE_EXTENDED",
      input: { attemptedAgain: true, reason: trimmedReason },
      status: "denied",
      error: { code: "EXTENSION_ALREADY_APPLIED" },
    });
    throw new PolicyViolationError(
      "The request deadline has already been extended.",
      409,
    );
  }

  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "DEADLINE_EXTENDED",
    input: {
      extensionDays: requestPolicy.extensionDays,
      reason: trimmedReason,
      newDueAt,
    },
    output: { dueAt: updatedRequest.dueAt, extensionApplied: true },
    status: "ok",
  });

  return updatedRequest;
}

const requestFilterSchema = z.object({
  status: z.string().optional(),
  type: z.enum(requestTypes).optional(),
  deadlineState: z.enum(["ON_TRACK", "AT_RISK", "OVERDUE"]).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listRequests(
  filters: unknown = {},
  now: Date = new Date(),
): Promise<RequestListResult> {
  const validated = parseInput(requestFilterSchema, filters);
  await connectDB();

  const query: Record<string, unknown> = {};
  if (validated.status) {
    const statuses = validated.status.split(",").map((status) => status.trim());
    const invalidStatus = statuses.find((status) => !isRequestStatus(status));
    if (invalidStatus) {
      throw new ValidationError(`Unknown request status: ${invalidStatus}.`);
    }
    query.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }
  if (validated.type) {
    query.type = validated.type;
  }
  if (validated.search) {
    const escapedSearch = validated.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escapedSearch, "i");
    query.$or = [
      { requestId: searchRegex },
      { requesterName: searchRegex },
      { requesterEmail: searchRegex },
      { rawText: searchRegex },
      { subjectUserId: searchRegex },
    ];
  }

  const [documents, total] = await Promise.all([
    PrivacyRequest.find(query)
      .sort({ dueAt: 1, requestId: 1 })
      .skip(
        validated.deadlineState === undefined
          ? (validated.page - 1) * validated.pageSize
          : 0,
      )
      .limit(
        validated.deadlineState === undefined
          ? validated.pageSize
          : 0,
      )
      .lean(),
    PrivacyRequest.countDocuments(query),
  ]);
  const requests = documents.map((request) => ({
    request,
    deadline: getDeadlineInfo(
      {
        receivedAt: request.receivedAt,
        dueAt: request.dueAt,
        extension: request.extension,
      },
      now,
    ),
  }));

  const deadlineFilteredRequests =
    validated.deadlineState === undefined
      ? requests
      : requests.filter(({ deadline }) => deadline.state === validated.deadlineState);
  const filteredRequests =
    validated.deadlineState === undefined
      ? deadlineFilteredRequests
      : deadlineFilteredRequests.slice(
          (validated.page - 1) * validated.pageSize,
          validated.page * validated.pageSize,
        );

  return {
    requests: filteredRequests,
    page: validated.page,
    pageSize: validated.pageSize,
    total:
      validated.deadlineState === undefined
        ? total
        : deadlineFilteredRequests.length,
    totalPages:
      validated.deadlineState === undefined
        ? Math.ceil(total / validated.pageSize)
        : Math.ceil(deadlineFilteredRequests.length / validated.pageSize),
  };
}

export async function getRequestById(
  requestId: string,
): Promise<{
  request: PrivacyRequestDocument;
  deadline: DeadlineInfo;
}> {
  await connectDB();
  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError(`Request ${requestId} was not found.`);
  }

  return { request, deadline: getDeadlineInfo(request) };
}
