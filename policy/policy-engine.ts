import {
  orgPolicy,
  type ApprovalKind,
  type Classification,
  type DataSourceName,
  type PolicyActor,
  type RequestType,
  type VerificationFactor,
} from "@/policy/org-policy";

const millisecondsPerDay = 24 * 60 * 60 * 1000;

function isDataSourceName(source: string): source is DataSourceName {
  return Object.hasOwn(orgPolicy.dataSources, source);
}

function isPolicyToolName(
  toolName: string,
): toolName is keyof typeof orgPolicy.agentPermissions {
  return Object.hasOwn(orgPolicy.agentPermissions, toolName);
}

export function getSla(type: RequestType): number {
  return orgPolicy.requestTypes[type].slaDays;
}

export function computeDueDate(
  receivedAt: Date | string,
  type: RequestType,
  extended: boolean,
): Date {
  const receivedDate =
    receivedAt instanceof Date ? new Date(receivedAt.getTime()) : new Date(receivedAt);

  if (Number.isNaN(receivedDate.getTime())) {
    throw new TypeError("receivedAt must be a valid date.");
  }

  const policy = orgPolicy.requestTypes[type];
  const days = policy.slaDays + (extended ? policy.extensionDays : 0);
  return new Date(receivedDate.getTime() + days * millisecondsPerDay);
}

export function evaluateVerification(
  factors: readonly VerificationFactor[],
): { passed: boolean; score: number; missing: VerificationFactor[] } {
  const passedFactors = new Set(factors);
  const missing = orgPolicy.verification.factors.filter(
    (factor) => !passedFactors.has(factor),
  );
  const score = orgPolicy.verification.factors.length - missing.length;

  return {
    passed:
      score >= orgPolicy.verification.minimumFactors &&
      passedFactors.has(orgPolicy.verification.requiredFactor),
    score,
    missing: [...missing],
  };
}

export function canToolRun(toolName: string, actor: PolicyActor): boolean {
  if (!isPolicyToolName(toolName)) {
    return false;
  }

  const permission = orgPolicy.agentPermissions[toolName];
  if (!permission.allowedRoles.some((role) => role === actor.role)) {
    return false;
  }

  if (permission.type !== "write") {
    return true;
  }

  return (
    actor.role === "system" &&
    permission.approvalKind !== undefined &&
    actor.approval?.valid === true &&
    actor.approval.kind === permission.approvalKind &&
    typeof actor.actionSetHash === "string" &&
    actor.actionSetHash.length > 0 &&
    actor.approval.actionSetHash === actor.actionSetHash
  );
}

export type DeletionEligibility = {
  allowed: boolean;
  reason: string;
  exceptionCode: string | null;
};

function parseRecordDate(value: unknown): Date | null {
  if (!(value instanceof Date || typeof value === "string" || typeof value === "number")) {
    return null;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function evaluateDeletionEligibility(
  source: string,
  record: Readonly<Record<string, unknown>>,
  now: Date = new Date(),
): DeletionEligibility {
  if (!isDataSourceName(source)) {
    return {
      allowed: false,
      reason: "The data source is not covered by organizational policy.",
      exceptionCode: null,
    };
  }

  if (!orgPolicy.dataSources[source].allowedOperations.includes("delete")) {
    return {
      allowed: false,
      reason: "Deletion is not an allowed operation for this data source.",
      exceptionCode: null,
    };
  }

  if (source === "activity_logs") {
    const retention = orgPolicy.retentionDeletionExceptions.activityLogs;
    if (
      record[retention.securityFlagField] === true ||
      record.securityFlag === true
    ) {
      const createdAt =
        parseRecordDate(record[retention.recordDateField]) ??
        parseRecordDate(record.at) ??
        parseRecordDate(record.occurred_at);

      if (
        createdAt === null ||
        now.getTime() - createdAt.getTime() <
          retention.retentionDays * millisecondsPerDay
      ) {
        return {
          allowed: false,
          reason:
            createdAt === null
              ? "Security-flagged activity logs cannot be deleted until their age is verified."
              : "Security-flagged activity logs must be retained for 365 days.",
          exceptionCode: retention.exceptionCode,
        };
      }
    }
  }

  if (source === "support_tickets") {
    const status =
      typeof record.status === "string" ? record.status.toLowerCase() : "";
    const exceptionCode = Object.entries(
      orgPolicy.retentionDeletionExceptions.supportTickets.blockedStatuses,
    ).find(([blockedStatus]) => blockedStatus === status)?.[1];

    if (exceptionCode !== undefined) {
      return {
        allowed: false,
        reason:
          status === "legal_hold"
            ? "Support tickets under legal hold cannot be deleted."
            : "Open support tickets cannot be deleted.",
        exceptionCode,
      };
    }
  }

  if (source === "user_profiles") {
    return {
      allowed: true,
      reason: "Delete by anonymizing the profile and retaining a tombstone; do not hard-delete.",
      exceptionCode: orgPolicy.retentionDeletionExceptions.userProfiles.exceptionCode,
    };
  }

  return {
    allowed: true,
    reason: "No deletion exception applies to this record.",
    exceptionCode: null,
  };
}

export function classifyField(
  source: string,
  field: string,
): Classification | null {
  if (!isDataSourceName(source)) {
    return null;
  }

  const fields = orgPolicy.dataSources[source].fields;
  return Object.entries(fields).find(([fieldName]) => fieldName === field)?.[1] ?? null;
}

export type PolicyAction =
  | RequestType
  | {
      type: RequestType;
    };

function getActionType(action: PolicyAction): RequestType {
  return typeof action === "string" ? action : action.type;
}

export function requiresApproval(action: PolicyAction): boolean {
  return orgPolicy.requestTypes[getActionType(action)].requiresSeparateApproval;
}

export function approvalKind(
  action: "CORRECTION" | "DELETION" | { type: "CORRECTION" | "DELETION" },
): ApprovalKind {
  return typeof action === "string" ? action : action.type;
}
