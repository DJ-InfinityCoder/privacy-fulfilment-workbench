import { connectDB } from "@/lib/db";
import { NotFoundError, PolicyViolationError, ToolExecutionError } from "@/lib/errors";
import { PrivacyRequest } from "@/models/PrivacyRequest";
import type { DataSourceName, JsonRecord } from "@/models/model-types";
import { transitionRequestStatus } from "@/services/state-machine";
import { assertVerified } from "@/services/verification-service";
import {
  createInventory,
  getAllowedInventorySources,
  type InventoryActor,
  type InventorySearchRecord,
} from "@/services/inventory-service";
import { invokeTool } from "@/tools/registry";

const sourceTools: Record<DataSourceName, string> = {
  user_profiles: "search_user_profiles",
  support_tickets: "search_support_tickets",
  activity_logs: "search_activity_logs",
};

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolRecords(value: unknown): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(isJsonRecord)) {
    throw new ToolExecutionError("A source search returned an invalid result.");
  }
  return value;
}

export async function runSearch(
  requestId: string,
  actor: InventoryActor = { actorId: "search-service", actorType: "system" },
) {
  await connectDB();
  let request = await PrivacyRequest.findOne({ requestId });
  if (!request) {
    throw new NotFoundError("The request was not found.");
  }
  const requestStatus = request.status;
  const requestType = request.type;
  assertVerified(request);

  if (requestStatus === "PLAN_APPROVED" || requestStatus === "VERIFIED") {
    await transitionRequestStatus(requestId, "SEARCHING", actor);
    request = await PrivacyRequest.findOne({ requestId });
    if (!request) {
      throw new NotFoundError("The request was not found.");
    }
  } else if (
    requestStatus !== "SEARCHING" &&
    requestStatus !== "INVENTORY_READY"
  ) {
    throw new PolicyViolationError(
      `Search cannot run while the request is ${requestStatus}.`,
      409,
    );
  }

  const context = {
    requestId,
    actor: {
      role: "system",
      actorId: actor.actorId,
      actorType: actor.actorType,
    },
  };
  const records: InventorySearchRecord[] = [];
  const allowedSources = searchSourcesForRequestType(requestType);
  for (const source of allowedSources) {
    const toolResult = await invokeTool(context, sourceTools[source], { limit: 100 });
    if (!toolResult.ok) {
      throw new ToolExecutionError(
        `Search failed for a permitted data source (${toolResult.error.code}).`,
      );
    }
    for (const record of parseToolRecords(toolResult.data)) {
      records.push({ source, record });
    }
  }

  const inventory = await createInventory(requestId, records, actor);
  const latestRequest = await PrivacyRequest.findOne({ requestId });
  if (!latestRequest) {
    throw new NotFoundError("The request was not found.");
  }
  if (latestRequest.status === "SEARCHING") {
    await transitionRequestStatus(requestId, "INVENTORY_READY", actor);
  } else if (latestRequest.status !== "INVENTORY_READY") {
    throw new PolicyViolationError(
      "The request changed state before inventory generation completed.",
      409,
    );
  }

  return inventory;
}

export function searchSourcesForRequestType(
  _requestType: "ACCESS" | "CORRECTION" | "DELETION",
): DataSourceName[] {
  switch (_requestType) {
    case "ACCESS":
    case "CORRECTION":
    case "DELETION":
      return getAllowedInventorySources();
  }
}
