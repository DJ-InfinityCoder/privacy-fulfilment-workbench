import { appendAudit, type AuditActorType } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import {
  ApprovalRequiredError,
  NotFoundError,
  ToolExecutionError,
  VerificationRequiredError,
} from "@/lib/errors";
import { sha256Json } from "@/lib/hash";
import { Approval } from "@/models/Approval";
import { DataInventory, type DataInventoryDocument, type InventoryItem } from "@/models/DataInventory";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import type { DataSourceName, JsonRecord } from "@/models/model-types";
import { orgPolicy } from "@/policy/org-policy";
import { classifyField } from "@/policy/policy-engine";
import {
  isClassificationBlockedFromExport,
  redactRecord,
  type RedactionManifestEntry,
} from "@/services/redaction-service";
import { invokeTool } from "@/tools/registry";

export type ExportActor = {
  actorId: string;
  actorType: AuditActorType;
};

export type ExportRecord = {
  source: DataSourceName;
  data: JsonRecord;
};

export type PrivacyExport = {
  requestId: string;
  policyVersion: string;
  inventoryVersion: number;
  generatedAt: string;
  includedData: ExportRecord[];
  redactionManifest: RedactionManifestEntry[];
  disclaimer: string;
  contentHash: string;
};

export type GeneratedExport = {
  json: PrivacyExport;
  html: string;
};

const sourceTools: Record<DataSourceName, string> = {
  user_profiles: "search_user_profiles",
  support_tickets: "search_support_tickets",
  activity_logs: "search_activity_logs",
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordIdField(source: DataSourceName): string {
  return {
    user_profiles: "userId",
    support_tickets: "ticketId",
    activity_logs: "logId",
  }[source];
}

function itemIncludedFields(item: InventoryItem): Set<string> {
  return new Set(
    item.fields
      .filter(
        (field) =>
          field.includeInExport &&
          !isClassificationBlockedFromExport(field.classification),
      )
      .map((field) => field.name),
  );
}

function sortedExportActionSet(inventory: DataInventoryDocument): JsonRecord {
  return {
    inventoryVersion: inventory.version,
    records: inventory.items
      .map((item) => ({
        source: item.source,
        recordId: item.recordId,
        fields: [...itemIncludedFields(item)].sort(),
      }))
      .sort((left, right) =>
        `${left.source}:${left.recordId}`.localeCompare(
          `${right.source}:${right.recordId}`,
        ),
      ),
  };
}

export function getExportApprovalHash(inventory: DataInventoryDocument): string {
  return sha256Json(sortedExportActionSet(inventory));
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHtml(data: PrivacyExport): string {
  const manifestRows = data.redactionManifest
    .map(
      (entry) =>
        `<tr><td>${htmlEscape(entry.source)}</td><td>${htmlEscape(entry.field)}</td><td>${htmlEscape(entry.ruleId)}</td><td>${htmlEscape(entry.reason)}</td></tr>`,
    )
    .join("");
  const includedJson = htmlEscape(
    JSON.stringify(data.includedData, null, 2),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy request export ${htmlEscape(data.requestId)}</title>
<style>
body{font-family:system-ui,sans-serif;line-height:1.5;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#172033}
h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #d5dbe5;padding:.5rem;text-align:left;vertical-align:top}th{background:#f2f5f9}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f8fa;padding:1rem;border-radius:.5rem}.disclaimer{border-left:4px solid #64748b;padding:.75rem 1rem;background:#f8fafc}
</style>
</head>
<body>
<h1>Privacy request export</h1>
<p>Request ${htmlEscape(data.requestId)} · Inventory version ${data.inventoryVersion} · Generated ${htmlEscape(data.generatedAt)}</p>
<h2>Included data</h2>
<pre>${includedJson}</pre>
<h2>Redaction manifest</h2>
<table><thead><tr><th>Source</th><th>Field</th><th>Rule</th><th>Reason</th></tr></thead><tbody>${manifestRows}</tbody></table>
<h2>Content hash</h2>
<code>${htmlEscape(data.contentHash)}</code>
<p class="disclaimer">${htmlEscape(data.disclaimer)}</p>
</body>
</html>`;
}

function addInventoryExclusions(
  item: InventoryItem,
  manifest: RedactionManifestEntry[],
): void {
  for (const field of item.fields) {
    if (
      field.includeInExport &&
      !isClassificationBlockedFromExport(field.classification)
    ) {
      continue;
    }
    const ruleId = field.includeInExport
      ? `REDACT-CLASS-${field.classification.replaceAll("_", "-")}`
      : "REDACT-NOT-SELECTED";
    manifest.push({
      source: item.source,
      field: field.name,
      ruleId,
      reason: field.includeInExport
        ? `${field.classification} data is excluded by organizational policy.`
        : "The field was not selected for export during human inventory review.",
    });
  }
}

async function assertExportApproval(
  requestId: string,
  inventory: DataInventoryDocument,
): Promise<void> {
  const approval = await Approval.findOne({
    requestId,
    kind: "EXPORT",
    status: "APPROVED",
    actionSetHash: getExportApprovalHash(inventory),
    expiresAt: { $gt: new Date() },
  }).lean();

  if (
    !approval ||
    !approval.decidedBy ||
    !approval.decidedAt ||
    !approval.decidedByRole ||
    !orgPolicy.approvalRules.allowedApproverRoles.some(
      (role) => role === approval.decidedByRole,
    )
  ) {
    throw new ApprovalRequiredError(
      "A current human EXPORT approval for this reviewed inventory is required.",
    );
  }
}

async function loadSourceRecords(
  requestId: string,
  actorId: string,
  source: DataSourceName,
): Promise<JsonRecord[]> {
  const result = await invokeTool(
    {
      requestId,
      actor: {
        role: "system",
        actorId,
        actorType: "system",
      },
    },
    sourceTools[source],
    { limit: 100 },
  );
  if (!result.ok) {
    throw new ToolExecutionError(
      `The approved export could not read ${source} (${result.error.code}).`,
    );
  }
  if (!Array.isArray(result.data) || !result.data.every(isJsonRecord)) {
    throw new ToolExecutionError("A source returned an invalid export record.");
  }
  return result.data;
}

export async function generateExport(
  requestId: string,
  actor: ExportActor = { actorId: "export-service", actorType: "system" },
): Promise<GeneratedExport> {
  await connectDB();
  const request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError("The request was not found.");
  }
  if (request.verification.status !== "PASSED" || !request.subjectUserId) {
    throw new VerificationRequiredError();
  }

  const inventory = await DataInventory.findOne({ requestId })
    .sort({ version: -1 })
    .lean();
  if (!inventory || inventory.status !== "REVIEWED") {
    throw new ApprovalRequiredError(
      "A reviewed inventory is required before export generation.",
    );
  }
  await assertExportApproval(requestId, inventory);

  const inventoryItems: InventoryItem[] = inventory.items as InventoryItem[];
  const sourceNames = [
    ...new Set(inventoryItems.map((item: InventoryItem) => item.source)),
  ];
  const sourceRecords = new Map<DataSourceName, JsonRecord[]>();
  for (const source of sourceNames) {
    sourceRecords.set(
      source,
      await loadSourceRecords(requestId, actor.actorId, source),
    );
  }

  const includedData: ExportRecord[] = [];
  const redactionManifest: RedactionManifestEntry[] = [];
  const knownNames = sourceRecords
    .get("user_profiles")
    ?.map((record) => record.fullName)
    .filter((name): name is string => typeof name === "string") ?? [];

  for (const item of inventoryItems) {
    addInventoryExclusions(item, redactionManifest);
    const sourceRows = sourceRecords.get(item.source) ?? [];
    const sourceRecord = sourceRows.find(
      (record) => record[recordIdField(item.source)] === item.recordId,
    );
    if (!sourceRecord) {
      redactionManifest.push({
        source: item.source,
        field: "*",
        ruleId: "REDACT-RECORD-NO-LONGER-AVAILABLE",
        reason: "The source record was no longer available at export time.",
      });
      continue;
    }

    const approvedFieldNames = itemIncludedFields(item);
    const selectedRecord: JsonRecord = {};
    for (const fieldName of approvedFieldNames) {
      const classification = classifyField(item.source, fieldName);
      if (
        classification &&
        !isClassificationBlockedFromExport(classification) &&
        Object.hasOwn(sourceRecord, fieldName)
      ) {
        selectedRecord[fieldName] = sourceRecord[fieldName];
      }
    }
    const redacted = redactRecord(item.source, selectedRecord, knownNames);
    redactionManifest.push(...redacted.manifest);
    includedData.push({ source: item.source, data: redacted.record });
  }

  const exportContent = {
    requestId,
    policyVersion: orgPolicy.version,
    inventoryVersion: inventory.version,
    generatedAt: new Date().toISOString(),
    includedData,
    redactionManifest,
    disclaimer: orgPolicy.disclaimers.export,
  };
  const contentHash = sha256Json(exportContent);
  const json: PrivacyExport = { ...exportContent, contentHash };
  const html = renderHtml(json);

  await appendAudit({
    requestId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    eventType: "EXPORT_GENERATED",
    input: {
      inventoryVersion: inventory.version,
      format: "JSON_AND_HTML",
    },
    output: {
      recordCount: includedData.length,
      redactionCount: redactionManifest.length,
      contentHash,
      manifestHash: sha256Json(redactionManifest),
    },
    status: "ok",
  });

  return { json, html };
}
