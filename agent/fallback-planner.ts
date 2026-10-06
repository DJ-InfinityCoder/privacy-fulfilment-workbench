import { orgPolicy } from "@/policy/org-policy";
import type { PrivacyRequestDocument } from "@/models/PrivacyRequest";
import type { Plan } from "@/agent/prompts";

export function createFallbackPlan(
  request: {
    type: PrivacyRequestDocument["type"];
    rawText: string;
    verification: {
      status: PrivacyRequestDocument["verification"]["status"];
      attempts: number;
    };
    subjectUserId?: string;
  },
): Plan {
  const text = request.rawText.toLowerCase();
  const requestType = request.type;
  const summaryByType = {
    ACCESS: "Locate the verified subject's mock records and prepare a policy-redacted access export.",
    CORRECTION: "Clarify and validate the requested field correction before seeking separate human approval.",
    DELETION: "Identify eligible records for a deletion proposal and preserve policy exceptions.",
  } as const;
  const selectedField =
    /\bemail\b/.test(text)
      ? "email"
      : /\bphone\b/.test(text)
        ? "phone"
        : /\baddress\b/.test(text)
          ? "address"
          : undefined;
  const ambiguousCorrection =
    requestType === "CORRECTION" && selectedField === undefined;

  const proposedActions: Plan["proposedActions"] =
    requestType === "DELETION" && request.subjectUserId
      ? [
          {
            type: "DELETION",
            source: "user_profiles",
            recordId: request.subjectUserId,
            rationale:
              "A profile deletion may be proposed for policy review; policy requires anonymization and a tombstone.",
            reversible: false,
            risk: "HIGH",
          },
        ]
      : [];

  const missingInformation: Plan["missingInformation"] = [];
  if (ambiguousCorrection) {
    missingInformation.push({
      item: "The profile field to correct and its intended value",
      whyNeeded: "The request does not identify one supported profile field and replacement value.",
      blocking: true,
    });
  }
  if (!request.subjectUserId) {
    missingInformation.push({
      item: "Verified subject user ID",
      whyNeeded: "Search tools are restricted to the verified subject record.",
      blocking: true,
    });
  }
  if (request.verification.status !== "PASSED") {
    missingInformation.push({
      item: "Identity verification",
      whyNeeded: "Searches and action proposals require completed verification.",
      blocking: true,
    });
  }

  const approvalKind =
    requestType === "CORRECTION" || requestType === "DELETION"
      ? requestType
      : undefined;
  const steps: Plan["steps"] = [
    {
      order: 1,
      description:
        request.verification.status === "PASSED"
          ? "Search the verified subject's permitted mock-data sources."
          : "Complete identity verification before any search.",
      toolsUsed:
        request.verification.status === "PASSED"
          ? [
              "search_user_profiles",
              "search_support_tickets",
              "search_activity_logs",
            ]
          : [],
      isReadOnly: true,
      requiresApproval: false,
    },
  ];
  if (approvalKind) {
    steps.push({
      order: 2,
      description: `Present any ${approvalKind.toLowerCase()} proposal for separate human approval; do not execute it.`,
      toolsUsed: [
        approvalKind === "CORRECTION"
          ? "propose_correction"
          : "propose_deletion",
      ],
      isReadOnly: false,
      requiresApproval: true,
      approvalKind,
    });
  }

  return {
    interpretation: {
      requestType,
      confidence: 0.7,
      summary: summaryByType[requestType],
      ambiguities: [
        "This deterministic fallback uses request type and keywords only; staff should review the interpretation.",
      ],
    },
    missingInformation,
    verificationAssessment: {
      status: request.verification.status,
      missingFactors:
        request.verification.status === "PASSED"
          ? []
          : [
              "email_match",
              "account_id_or_phone_last4",
              "knowledge_factor",
            ],
    },
    likelySources: (
      Object.keys(orgPolicy.dataSources) as Array<
        keyof typeof orgPolicy.dataSources
      >
    ).map((source) => ({
      source,
      rationale: `Search this policy-approved source only for records scoped to the verified subject.`,
      expectedRecordTypes: [source],
    })),
    steps,
    proposedActions,
    risks: [
      {
        description:
          "Automated interpretation may be incomplete; this plan is a decision-support draft.",
        severity: "MEDIUM",
        mitigation: "An authorized staff member reviews this plan and its evidence.",
        policyRef: `POLICY-${orgPolicy.version}`,
      },
      ...(requestType === "DELETION"
        ? [
            {
              description:
                "Deletion is subject to retention exceptions; profile deletion means anonymization rather than hard deletion.",
              severity: "HIGH" as const,
              mitigation:
                "Check each record's deletion eligibility and preserve the required exception reason.",
              policyRef: "R-PRF-1",
            },
          ]
        : []),
    ],
    policyExceptions: [],
    estimatedDeadlineImpact: `Target completion within ${orgPolicy.requestTypes[requestType].slaDays} days of receipt; staff must review the applicable deadline.`,
    disclaimer: orgPolicy.disclaimers.plan,
    generatedBy: {
      provider: "deterministic",
      model: "fallback-planner",
      usedFallbackPlanner: true,
    },
  };
}
