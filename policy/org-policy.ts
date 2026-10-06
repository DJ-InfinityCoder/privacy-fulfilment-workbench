export type RequestType = "ACCESS" | "CORRECTION" | "DELETION";
export type DataSourceName =
  | "user_profiles"
  | "support_tickets"
  | "activity_logs";
export type Operation = "read" | "correct" | "delete";
export type Classification =
  | "PUBLIC"
  | "PERSONAL"
  | "SENSITIVE"
  | "RESTRICTED"
  | "THIRD_PARTY"
  | "INTERNAL";
export type ApprovalKind = "CORRECTION" | "DELETION";
export type HumanRole = "analyst" | "approver";
export type AgentRole =
  | "agent"
  | "analyst"
  | "approver"
  | "system";
export type PolicyToolType = "read" | "write" | "propose";
export type VerificationFactor =
  | "email_match"
  | "account_id_or_phone_last4"
  | "knowledge_factor";

type RequestTypePolicy = {
  slaDays: number;
  extensionDays: number;
  maxExtensions: number;
  extensionReasonRequired: boolean;
  requiresVerification: boolean;
  requiresSeparateApproval: boolean;
};

type DataSourcePolicy = {
  allowedOperations: readonly Operation[];
  fields: Readonly<Record<string, Classification>>;
};

type ToolPermission = {
  type: PolicyToolType;
  allowedRoles: readonly AgentRole[];
  approvalKind?: ApprovalKind;
};

const disclaimer =
  "This tool follows internal organizational policy only. It does not provide legal advice or guarantee compliance with any law or regulation. Final decisions rest with authorized staff.";

export const orgPolicy = {
  version: "2025.1",
  requestTypes: {
    ACCESS: {
      slaDays: 30,
      extensionDays: 30,
      maxExtensions: 1,
      extensionReasonRequired: true,
      requiresVerification: true,
      requiresSeparateApproval: false,
    },
    CORRECTION: {
      slaDays: 30,
      extensionDays: 30,
      maxExtensions: 1,
      extensionReasonRequired: true,
      requiresVerification: true,
      requiresSeparateApproval: true,
    },
    DELETION: {
      slaDays: 30,
      extensionDays: 30,
      maxExtensions: 1,
      extensionReasonRequired: true,
      requiresVerification: true,
      requiresSeparateApproval: true,
    },
  } satisfies Record<RequestType, RequestTypePolicy>,
  verification: {
    factors: [
      "email_match",
      "account_id_or_phone_last4",
      "knowledge_factor",
    ] as const satisfies readonly VerificationFactor[],
    minimumFactors: 2,
    requiredFactor: "email_match" as const,
    maxAttempts: 3,
    overrideAllowedRoles: ["approver"] as const,
  },
  dataSources: {
    user_profiles: {
      allowedOperations: ["read", "correct", "delete"],
      fields: {
        profile_id: "INTERNAL",
        userId: "INTERNAL",
        fullName: "PERSONAL",
        display_name: "PERSONAL",
        email: "PERSONAL",
        phone: "SENSITIVE",
        phone_last4: "SENSITIVE",
        dateOfBirth: "RESTRICTED",
        lastOrderCity: "SENSITIVE",
        mailing_address: "SENSITIVE",
        address: "SENSITIVE",
        date_of_birth: "RESTRICTED",
        preferences: "PERSONAL",
        marketingConsent: "PERSONAL",
        internalRiskScore: "RESTRICTED",
        internalRiskDetails: "RESTRICTED",
        status: "INTERNAL",
        accountStatus: "INTERNAL",
        created_at: "INTERNAL",
        updated_at: "INTERNAL",
        anonymizedAt: "INTERNAL",
        _id: "INTERNAL",
        __v: "INTERNAL",
        createdAt: "INTERNAL",
        updatedAt: "INTERNAL",
      },
    },
    support_tickets: {
      allowedOperations: ["read", "correct", "delete"],
      fields: {
        ticket_id: "INTERNAL",
        ticketId: "INTERNAL",
        subject: "PERSONAL",
        requester_text: "PERSONAL",
        messages: "PERSONAL",
        internalNotes: "INTERNAL",
        thirdPartyMessages: "THIRD_PARTY",
        other_customers_text: "THIRD_PARTY",
        agent_text: "THIRD_PARTY",
        assigned_agent_id: "THIRD_PARTY",
        status: "INTERNAL",
        legal_hold: "INTERNAL",
        created_at: "INTERNAL",
        attachments: "RESTRICTED",
        userId: "INTERNAL",
        _id: "INTERNAL",
        __v: "INTERNAL",
        category: "PERSONAL",
        createdAt: "INTERNAL",
        updatedAt: "INTERNAL",
      },
    },
    activity_logs: {
      allowedOperations: ["read", "delete"],
      fields: {
        log_id: "INTERNAL",
        logId: "INTERNAL",
        event_type: "INTERNAL",
        source_name: "PUBLIC",
        occurred_at: "INTERNAL",
        at: "INTERNAL",
        created_at: "INTERNAL",
        ip: "SENSITIVE",
        userAgent: "PERSONAL",
        securityFlag: "RESTRICTED",
        metadata: "SENSITIVE",
        ip_address: "SENSITIVE",
        security_flagged: "RESTRICTED",
        actor_id: "THIRD_PARTY",
        details: "SENSITIVE",
        event: "INTERNAL",
        userId: "INTERNAL",
        createdAt: "INTERNAL",
        updatedAt: "INTERNAL",
        _id: "INTERNAL",
        __v: "INTERNAL",
      },
    },
  } satisfies Record<DataSourceName, DataSourcePolicy>,
  retentionDeletionExceptions: {
    activityLogs: {
      retentionDays: 365,
      recordDateField: "created_at",
      securityFlagField: "security_flagged",
      exceptionCode: "R-LOG-1",
    },
    supportTickets: {
      blockedStatuses: {
        open: "R-TKT-1",
        legal_hold: "R-TKT-2",
      },
    },
    userProfiles: {
      deletionMethod: "anonymize",
      tombstone: true,
      exceptionCode: "R-PRF-1",
    },
  },
  redactionRules: [
    {
      id: "REDACT-CLASS-RESTRICTED",
      action: "remove_classification",
      classification: "RESTRICTED",
    },
    {
      id: "REDACT-CLASS-THIRD-PARTY",
      action: "remove_classification",
      classification: "THIRD_PARTY",
    },
    {
      id: "REDACT-CLASS-INTERNAL",
      action: "remove_classification",
      classification: "INTERNAL",
    },
    {
      id: "MASK-IP-ADDRESS",
      action: "mask_field",
      field: "ip_address",
      strategy: "partial_ip",
    },
    {
      id: "REDACT-THIRD-PARTY-MESSAGE",
      action: "replace_non_customer_message",
      field: "messages",
      replacement: "[REDACTED: third-party data]",
    },
    {
      id: "REDACT-FREE-TEXT-EMAIL",
      action: "mask_pattern",
      pattern: "email",
      field: "messages",
    },
    {
      id: "REDACT-FREE-TEXT-PHONE",
      action: "mask_pattern",
      pattern: "phone",
      field: "messages",
    },
    {
      id: "REDACT-FREE-TEXT-NAME",
      action: "mask_known_names",
      field: "messages",
    },
    {
      id: "REDACT-UNCLASSIFIED-FIELD",
      action: "remove_unclassified_field",
    },
  ] as const,
  agentPermissions: {
    read_request: {
      type: "read",
      allowedRoles: ["agent", "analyst", "approver", "system"],
    },
    search_records: {
      type: "read",
      allowedRoles: ["agent", "analyst", "approver", "system"],
    },
    get_data_inventory: {
      type: "read",
      allowedRoles: ["agent", "analyst", "approver", "system"],
    },
    search_user_profiles: {
      type: "read",
      allowedRoles: ["agent", "analyst", "approver", "system"],
    },
    search_support_tickets: {
      type: "read",
      allowedRoles: ["agent", "analyst", "approver", "system"],
    },
    search_activity_logs: {
      type: "read",
      allowedRoles: ["agent", "analyst", "approver", "system"],
    },
    get_record: {
      type: "read",
      allowedRoles: ["agent", "analyst", "approver", "system"],
    },
    propose_correction: {
      type: "propose",
      allowedRoles: ["agent", "analyst", "system"],
    },
    propose_deletion: {
      type: "propose",
      allowedRoles: ["agent", "analyst", "system"],
    },
    apply_correction: {
      type: "write",
      allowedRoles: ["system"],
      approvalKind: "CORRECTION",
    },
    apply_deletion: {
      type: "write",
      allowedRoles: ["system"],
      approvalKind: "DELETION",
    },
    execute_correction: {
      type: "write",
      allowedRoles: ["system"],
      approvalKind: "CORRECTION",
    },
    execute_deletion: {
      type: "write",
      allowedRoles: ["system"],
      approvalKind: "DELETION",
    },
  } satisfies Record<string, ToolPermission>,
  approvalRules: {
    deletionApproverMustDifferFromAssignee: true,
    allowedApproverRoles: ["approver"] as const,
    ttlMinutes: 60,
    bindTo: "exact_action_set_hash",
  },
  humanRoles: {
    analyst: {
      name: "Analyst",
      allowedActions: [
        "create_request",
        "run_verification",
        "trigger_agent_plan",
        "run_search",
        "review_inventory",
        "request_approvals",
        "trigger_execution",
        "finalize",
      ],
    },
    approver: {
      name: "Approver",
      allowedActions: [
        "decide_approval_plan",
        "decide_approval_correction",
        "decide_approval_deletion",
        "decide_approval_export",
        "verification_override",
        "deadline_extension",
      ],
    },
  },
  disclaimers: {
    footer: disclaimer,
    plan: disclaimer,
    export: disclaimer,
    finalRecord: disclaimer,
  },
} as const;

export type PolicyActor = {
  role: string;
  actionSetHash?: string;
  approval?: {
    valid: boolean;
    kind: ApprovalKind;
    actionSetHash: string;
  };
};
