export const requestTypes = ["ACCESS", "CORRECTION", "DELETION"] as const;
export type RequestType = (typeof requestTypes)[number];

export const requestStatuses = [
  "RECEIVED",
  "VERIFICATION_PENDING",
  "VERIFIED",
  "PLAN_PROPOSED",
  "PLAN_APPROVED",
  "SEARCHING",
  "INVENTORY_READY",
  "AWAITING_CORRECTION_APPROVAL",
  "AWAITING_DELETION_APPROVAL",
  "EXECUTING",
  "EXPORT_READY",
  "COMPLETED",
  "REJECTED",
  "FAILED",
] as const;
export type RequestStatus = (typeof requestStatuses)[number];

export const dataSourceNames = [
  "user_profiles",
  "support_tickets",
  "activity_logs",
] as const;
export type DataSourceName = (typeof dataSourceNames)[number];

export const classifications = [
  "PUBLIC",
  "PERSONAL",
  "SENSITIVE",
  "RESTRICTED",
  "THIRD_PARTY",
  "INTERNAL",
] as const;
export type Classification = (typeof classifications)[number];

export type JsonRecord = Record<string, unknown>;

export const auditEventTypes = [
  "REQUEST_CREATED",
  "VERIFICATION_ATTEMPT",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "VERIFICATION_LOCKED",
  "VERIFICATION_OVERRIDE",
  "STATUS_CHANGED",
  "AGENT_STARTED",
  "AGENT_PLAN_PROPOSED",
  "AGENT_FAILED",
  "AI_PROVIDER_CALL",
  "AI_PROVIDER_FAILOVER",
  "AI_PROVIDER_FALLBACK_PLANNER",
  "TOOL_CALL",
  "TOOL_RESULT",
  "TOOL_DENIED",
  "TOOL_FAILED",
  "APPROVAL_REQUESTED",
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
  "APPROVAL_EXPIRED",
  "ACTION_STARTED",
  "ACTION_SUCCEEDED",
  "ACTION_FAILED",
  "ACTION_SKIPPED",
  "ACTION_SKIPPED_DUPLICATE",
  "INVENTORY_GENERATED",
  "INVENTORY_REVIEWED",
  "EXPORT_GENERATED",
  "DEADLINE_EXTENDED",
  "RECORD_FINALIZED",
] as const;
export type AuditEventType = (typeof auditEventTypes)[number];
