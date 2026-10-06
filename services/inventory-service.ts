import { z } from "zod";
import { appendAudit, type AuditActorType } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { NotFoundError, PolicyViolationError, ValidationError } from "@/lib/errors";
import {
  DataInventory,
  type DataInventoryDocument,
  type InventoryField,
  type InventoryItem,
} from "@/models/DataInventory";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import type {
  Classification,
  DataSourceName,
  JsonRecord,
} from "@/models/model-types";
import { orgPolicy } from "@/policy/org-policy";
import { classifyField } from "@/policy/policy-engine";
import { assertVerified } from "@/services/verification-service";

export type InventoryActor = {
  actorId: string;
  actorType: AuditActorType;
};

const reviewSchema = z.object({
  inventoryVersion: z.number().int().positive(),
  comment: z.string().trim().min(1).max(2000),
  fields: z
    .array(
      z.object({
        source: z.enum(["user_profiles", "support_tickets", "activity_logs"]),
        recordId: z.string().trim().min(1).max(160),
        fieldName: z.string().trim().min(1).max(200),
        includeInExport: z.boolean(),
      }),
    )
    .max(10_000),
});

const exportBlockedClassifications = new Set<Classification>([
  "RESTRICTED",
  "THIRD_PARTY",
  "INTERNAL",
]);

const sourceIdFields: Record<DataSourceName, string> = {
  user_profiles: "userId",
  support_tickets: "ticketId",
  activity_logs: "logId",
};

const redactionReasons: Partial<Record<Classification, string>> = {
  RESTRICTED: "RESTRICTED fields are excluded from exports by policy.",
  THIRD_PARTY: "THIRD_PARTY content is excluded from exports by policy.",
  INTERNAL: "INTERNAL fields are excluded from exports by policy.",
};

type WithheldField = {
  name: string;
  classification: Classification;
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWithheldFields(value: unknown): WithheldField[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !isJsonRecord(entry) ||
      typeof entry.name !== "string" ||
      typeof entry.classification !== "string" ||
      !["PUBLIC", "PERSONAL", "SENSITIVE", "RESTRICTED", "THIRD_PARTY", "INTERNAL"].includes(
        entry.classification,
      )
    ) {
      return [];
    }
    return [
      {
        name: entry.name,
        classification: entry.classification as Classification,
      },
    ];
  });
}

function maskString(value: string, fieldName: string): string {
  const field = fieldName.toLowerCase();
  if (field.includes("email") && value.includes("@")) {
    const [localPart, domain] = value.split("@");
    return `${localPart.slice(0, 1)}•••@${domain}`;
  }
  if (field.includes("phone")) {
    const digits = value.replace(/\D/g, "");
    return digits.length > 4 ? `••••${digits.slice(-4)}` : "[masked]";
  }
  if (field === "ip") {
    const octets = value.split(".");
    return octets.length === 4
      ? `${octets[0]}.${octets[1]}.x.x`
      : "[masked]";
  }
  if (value.length < 2) {
    return "•••";
  }
  return `${value.slice(0, 1)}${"•".repeat(Math.min(value.length - 1, 12))}`;
}

function valuePreview(
  value: unknown,
  fieldName: string,
  classification: Classification,
): string {
  if (exportBlockedClassifications.has(classification)) {
    return "[REDACTED]";
  }
  if (value instanceof Date) {
    return "[date masked]";
  }
  if (typeof value === "string") {
    return maskString(value, fieldName);
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items; values masked]`;
  }
  if (isJsonRecord(value)) {
    return "[structured values masked]";
  }
  return "[value masked]";
}

function buildField(
  name: string,
  value: unknown,
  classification: Classification,
  deletionEligible: boolean,
  deletionReason: string,
): InventoryField {
  const blocked = exportBlockedClassifications.has(classification);
  const redactionReason = redactionReasons[classification];
  return {
    name,
    classification,
    valuePreview: valuePreview(value, name, classification),
    includeInExport: !blocked,
    ...(redactionReason ? { redactionReason } : {}),
    deletionEligible,
    deletionReason,
  };
}

function buildInventoryItem(
  source: DataSourceName,
  record: JsonRecord,
): InventoryItem {
  const recordId = record[sourceIdFields[source]];
  if (typeof recordId !== "string" || recordId.length === 0) {
    throw new ValidationError("A source record is missing its policy-scoped identifier.");
  }

  const withheldFields = parseWithheldFields(record._withheldFields);
  const deletionEligibility = record._deletionEligibility;
  if (!isJsonRecord(deletionEligibility) || typeof deletionEligibility.allowed !== "boolean") {
    throw new ValidationError("A source tool returned no deletion eligibility result.");
  }
  const deletionEligible = deletionEligibility.allowed;
  const deletionReason =
    typeof deletionEligibility.reason === "string"
      ? deletionEligibility.reason
      : "Deletion eligibility could not be determined.";
  const itemFields: InventoryField[] = [];
  const names = new Set<string>();

  for (const [name, value] of Object.entries(record)) {
    if (name.startsWith("_") || name === "__v") {
      continue;
    }
    const classification = classifyField(source, name);
    if (!classification) {
      throw new ValidationError(
        `The policy does not classify ${source}.${name}; inventory generation stopped.`,
      );
    }
    itemFields.push(
      buildField(name, value, classification, deletionEligible, deletionReason),
    );
    names.add(name);
  }

  for (const withheld of withheldFields) {
    if (names.has(withheld.name)) {
      continue;
    }
    itemFields.push(
      buildField(
        withheld.name,
        undefined,
        withheld.classification,
        deletionEligible,
        deletionReason,
      ),
    );
    names.add(withheld.name);
  }

  const hasThirdParty = withheldFields.some(
    (field) => field.classification === "THIRD_PARTY",
  );

  return {
    source,
    recordId,
    fields: itemFields,
    relevance: hasThirdParty ? "POSSIBLE" : "DIRECT",
    ...(hasThirdParty
      ? { notes: "Possible third-party content was withheld from the search result." }
      : {}),
  };
}

export type InventorySearchRecord = {
  source: DataSourceName;
  record: JsonRecord;
};

export async function createInventory(
  requestId: string,
  records: readonly InventorySearchRecord[],
  actor: InventoryActor,
): Promise<DataInventoryDocument> {
  await connectDB();
  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError("The request was not found.");
  }
  const requestStatus = request.status;
  assertVerified(request);
  if (requestStatus !== "SEARCHING" && requestStatus !== "INVENTORY_READY") {
    throw new PolicyViolationError(
      `Inventory cannot be generated while the request is ${requestStatus}.`,
      409,
    );
  }

  const items = records.map(({ source, record }) => buildInventoryItem(source, record));
  let created: DataInventoryDocument | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const latest = await DataInventory.findOne({ requestId })
      .sort({ version: -1 })
      .select("version")
      .lean();
    const version = (latest?.version ?? 0) + 1;
    try {
      created = await DataInventory.create({
        requestId,
        version,
        status: "DRAFT",
        items,
        generatedAt: new Date(),
      });
    } catch (error: unknown) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== 11000 ||
        attempt === 2
      ) {
        throw error;
      }
    }
  }

  if (!created) {
    throw new PolicyViolationError(
      "A new inventory version could not be allocated; retry the search.",
      409,
    );
  }

  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "INVENTORY_GENERATED",
    input: { inventoryVersion: created.version },
    output: {
      recordCount: created.items.length,
      fieldCount: created.items.reduce((count, item) => count + item.fields.length, 0),
      sources: [...new Set(created.items.map((item) => item.source))],
    },
    status: "ok",
  });

  return created;
}

export async function getLatestInventory(
  requestId: string,
): Promise<DataInventoryDocument | null> {
  await connectDB();
  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError("The request was not found.");
  }
  assertVerified(request);
  return DataInventory.findOne({ requestId }).sort({ version: -1 }).lean();
}

export async function reviewInventory(
  requestId: string,
  input: unknown,
  actor: InventoryActor,
): Promise<DataInventoryDocument> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  await connectDB();

  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError("The request was not found.");
  }
  const requestStatus = request.status;
  assertVerified(request);
  if (requestStatus !== "INVENTORY_READY") {
    throw new PolicyViolationError(
      "Inventory can only be reviewed after search is complete.",
      409,
    );
  }

  const inventory = await DataInventory.findOne({
    requestId,
    version: parsed.data.inventoryVersion,
  });
  if (!inventory) {
    throw new NotFoundError("The requested inventory version was not found.");
  }
  if (inventory.status !== "DRAFT") {
    throw new PolicyViolationError("Only a draft inventory can be reviewed.", 409);
  }

  for (const selection of parsed.data.fields) {
    const item = inventory.items.find(
      (candidate: InventoryItem) =>
        candidate.source === selection.source &&
        candidate.recordId === selection.recordId,
    );
    const field = item?.fields.find(
      (candidate: InventoryField) => candidate.name === selection.fieldName,
    );
    if (!field) {
      throw new ValidationError("A selected inventory field was not found.");
    }
    if (
      selection.includeInExport &&
      exportBlockedClassifications.has(field.classification)
    ) {
      await appendAudit({
        requestId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        eventType: "INVENTORY_REVIEWED",
        input: {
          inventoryVersion: inventory.version,
          source: selection.source,
          recordId: selection.recordId,
          fieldName: selection.fieldName,
          includeInExport: true,
        },
        status: "denied",
        error: { code: "POLICY_BLOCKED_EXPORT_FIELD" },
      });
      throw new PolicyViolationError(
        `${field.classification} fields cannot be included in an export.`,
        409,
      );
    }
  }

  for (const selection of parsed.data.fields) {
    const item = inventory.items.find(
      (candidate: InventoryItem) =>
        candidate.source === selection.source &&
        candidate.recordId === selection.recordId,
    );
    const field = item?.fields.find(
      (candidate: InventoryField) => candidate.name === selection.fieldName,
    );
    if (field) {
      field.includeInExport = selection.includeInExport;
    }
  }

  inventory.status = "REVIEWED";
  inventory.reviewedBy = actor.actorId;
  inventory.reviewedAt = new Date();
  inventory.comment = parsed.data.comment;
  await inventory.save();

  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "INVENTORY_REVIEWED",
    input: {
      inventoryVersion: inventory.version,
      reviewedFieldCount: parsed.data.fields.length,
    },
    status: "ok",
  });
  return inventory;
}

export function canIncludeInExport(classification: Classification): boolean {
  return !exportBlockedClassifications.has(classification);
}

export function getRedactionReason(classification: Classification): string | undefined {
  return redactionReasons[classification];
}

export function getAllowedInventorySources(): DataSourceName[] {
  return (Object.keys(orgPolicy.dataSources) as DataSourceName[]).filter((source) =>
    orgPolicy.dataSources[source].allowedOperations.includes("read"),
  );
}
