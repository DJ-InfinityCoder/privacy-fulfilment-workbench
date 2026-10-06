import { describe, expect, it } from "vitest";
import {
  approvalKind,
  canToolRun,
  classifyField,
  computeDueDate,
  evaluateDeletionEligibility,
  evaluateVerification,
  getSla,
  requiresApproval,
} from "@/policy/policy-engine";
import {
  orgPolicy,
  type VerificationFactor,
} from "@/policy/org-policy";

const receivedAt = new Date("2025-01-01T12:00:00.000Z");
const factor = (value: VerificationFactor) => value;

describe("organizational policy", () => {
  it("is versioned and defines all request types", () => {
    expect(orgPolicy.version).toBe("2025.1");
    expect(Object.keys(orgPolicy.requestTypes)).toEqual([
      "ACCESS",
      "CORRECTION",
      "DELETION",
    ]);
  });

  it.each(["ACCESS", "CORRECTION", "DELETION"] as const)(
    "uses a 30-day SLA for %s",
    (type) => {
      expect(getSla(type)).toBe(30);
    },
  );

  it("adds exactly one configured extension period to the due date", () => {
    expect(computeDueDate(receivedAt, "ACCESS", false)).toEqual(
      new Date("2025-01-31T12:00:00.000Z"),
    );
    expect(computeDueDate(receivedAt, "ACCESS", true)).toEqual(
      new Date("2025-03-02T12:00:00.000Z"),
    );
  });

  it("rejects invalid received dates", () => {
    expect(() => computeDueDate("not-a-date", "ACCESS", false)).toThrow(
      "receivedAt must be a valid date.",
    );
  });

  it("allows verification with email and one additional factor", () => {
    expect(
      evaluateVerification([
        factor("email_match"),
        factor("knowledge_factor"),
      ]),
    ).toEqual({
      passed: true,
      score: 2,
      missing: ["account_id_or_phone_last4"],
    });
  });

  it("does not pass with two non-email factors", () => {
    expect(
      evaluateVerification([
        factor("account_id_or_phone_last4"),
        factor("knowledge_factor"),
      ]),
    ).toEqual({
      passed: false,
      score: 2,
      missing: ["email_match"],
    });
  });

  it("does not count duplicate verification factors more than once", () => {
    expect(
      evaluateVerification([
        factor("email_match"),
        factor("email_match"),
        factor("email_match"),
      ]),
    ).toEqual({
      passed: false,
      score: 1,
      missing: ["account_id_or_phone_last4", "knowledge_factor"],
    });
  });

  it("permits agent reads and proposals, but not writes", () => {
    expect(canToolRun("read_request", { role: "agent" })).toBe(true);
    expect(canToolRun("propose_deletion", { role: "agent" })).toBe(true);
    expect(
      canToolRun("execute_deletion", {
        role: "agent",
        approval: {
          valid: true,
          kind: "DELETION",
          actionSetHash: "deletion-hash",
        },
      }),
    ).toBe(false);
  });

  it("requires system role and matching valid approval for write tools", () => {
    expect(canToolRun("execute_correction", { role: "system" })).toBe(false);
    expect(
      canToolRun("execute_correction", {
        role: "system",
        actionSetHash: "correction-hash",
        approval: {
          valid: false,
          kind: "CORRECTION",
          actionSetHash: "correction-hash",
        },
      }),
    ).toBe(false);
    expect(
      canToolRun("execute_correction", {
        role: "system",
        actionSetHash: "correction-hash",
        approval: {
          valid: true,
          kind: "DELETION",
          actionSetHash: "correction-hash",
        },
      }),
    ).toBe(false);
    expect(
      canToolRun("execute_correction", {
        role: "system",
        actionSetHash: "correction-hash",
        approval: {
          valid: true,
          kind: "CORRECTION",
          actionSetHash: "correction-hash",
        },
      }),
    ).toBe(true);
    expect(
      canToolRun("execute_correction", {
        role: "system",
        actionSetHash: "changed-action-set",
        approval: {
          valid: true,
          kind: "CORRECTION",
          actionSetHash: "original-action-set",
        },
      }),
    ).toBe(false);
  });

  it("denies unknown tools and roles", () => {
    expect(canToolRun("unregistered_tool", { role: "agent" })).toBe(false);
    expect(canToolRun("read_request", { role: "unknown" })).toBe(false);
  });

  it("requires separate approval for correction and deletion only", () => {
    expect(requiresApproval("ACCESS")).toBe(false);
    expect(requiresApproval({ type: "CORRECTION" })).toBe(true);
    expect(requiresApproval("DELETION")).toBe(true);
  });

  it("keeps correction and deletion approvals distinct", () => {
    expect(approvalKind("CORRECTION")).toBe("CORRECTION");
    expect(approvalKind({ type: "DELETION" })).toBe("DELETION");
  });

  it("blocks deletion of open tickets with the open-ticket exception", () => {
    expect(evaluateDeletionEligibility("support_tickets", { status: "open" })).toEqual({
      allowed: false,
      reason: "Open support tickets cannot be deleted.",
      exceptionCode: "R-TKT-1",
    });
  });

  it("blocks deletion of legal-hold tickets with its own exception", () => {
    expect(
      evaluateDeletionEligibility("support_tickets", { status: "legal_hold" }),
    ).toEqual({
      allowed: false,
      reason: "Support tickets under legal hold cannot be deleted.",
      exceptionCode: "R-TKT-2",
    });
  });

  it("normalizes ticket status before checking deletion exceptions", () => {
    expect(
      evaluateDeletionEligibility("support_tickets", { status: "OPEN" }).exceptionCode,
    ).toBe("R-TKT-1");
  });

  it("allows deletion of other support tickets", () => {
    expect(
      evaluateDeletionEligibility("support_tickets", { status: "closed" }),
    ).toEqual({
      allowed: true,
      reason: "No deletion exception applies to this record.",
      exceptionCode: null,
    });
  });

  it("blocks recent security-flagged activity logs for the retention period", () => {
    expect(
      evaluateDeletionEligibility(
        "activity_logs",
        { security_flagged: true, created_at: "2025-01-01T00:00:00.000Z" },
        new Date("2025-12-31T23:59:59.999Z"),
      ),
    ).toEqual({
      allowed: false,
      reason: "Security-flagged activity logs must be retained for 365 days.",
      exceptionCode: "R-LOG-1",
    });
  });

  it("blocks flagged logs when their age cannot be established", () => {
    expect(
      evaluateDeletionEligibility("activity_logs", { security_flagged: true }),
    ).toEqual({
      allowed: false,
      reason:
        "Security-flagged activity logs cannot be deleted until their age is verified.",
      exceptionCode: "R-LOG-1",
    });
  });

  it("allows deletion of a security-flagged log after 365 days", () => {
    expect(
      evaluateDeletionEligibility(
        "activity_logs",
        { security_flagged: true, created_at: "2024-01-01T00:00:00.000Z" },
        new Date("2025-01-01T00:00:00.000Z"),
      ).allowed,
    ).toBe(true);
  });

  it("allows ordinary activity logs without a retention exception", () => {
    expect(
      evaluateDeletionEligibility("activity_logs", { security_flagged: false }).allowed,
    ).toBe(true);
  });

  it("allows profile deletion only as anonymization with a tombstone", () => {
    expect(evaluateDeletionEligibility("user_profiles", {})).toEqual({
      allowed: true,
      reason:
        "Delete by anonymizing the profile and retaining a tombstone; do not hard-delete.",
      exceptionCode: "R-PRF-1",
    });
  });

  it("returns field classifications and null for unknown fields", () => {
    expect(classifyField("user_profiles", "email")).toBe("PERSONAL");
    expect(classifyField("support_tickets", "agent_text")).toBe("THIRD_PARTY");
    expect(classifyField("activity_logs", "security_flagged")).toBe("RESTRICTED");
    expect(classifyField("activity_logs", "not_a_field")).toBeNull();
  });

  it("denies deletion for an unknown source", () => {
    expect(
      evaluateDeletionEligibility("unknown_source", {}),
    ).toEqual({
      allowed: false,
      reason: "The data source is not covered by organizational policy.",
      exceptionCode: null,
    });
  });

  it("sets verification, extension, retention, approval, and redaction safeguards", () => {
    expect(orgPolicy.requestTypes.CORRECTION.requiresVerification).toBe(true);
    expect(orgPolicy.requestTypes.DELETION.maxExtensions).toBe(1);
    expect(orgPolicy.requestTypes.DELETION.extensionReasonRequired).toBe(true);
    expect(orgPolicy.approvalRules.deletionApproverMustDifferFromAssignee).toBe(true);
    expect(orgPolicy.approvalRules.allowedApproverRoles).toEqual([
      "approver",
    ]);
    expect(orgPolicy.approvalRules.bindTo).toBe("exact_action_set_hash");
    expect(orgPolicy.redactionRules.map((rule) => rule.id)).toEqual([
      "REDACT-CLASS-RESTRICTED",
      "REDACT-CLASS-THIRD-PARTY",
      "REDACT-CLASS-INTERNAL",
      "MASK-IP-ADDRESS",
      "REDACT-THIRD-PARTY-MESSAGE",
      "REDACT-FREE-TEXT-EMAIL",
      "REDACT-FREE-TEXT-PHONE",
      "REDACT-FREE-TEXT-NAME",
      "REDACT-UNCLASSIFIED-FIELD",
    ]);
    expect(orgPolicy.disclaimers.footer).toContain(
      "does not provide legal advice or guarantee compliance",
    );
  });

  it("enforces role permissions: analyst cannot approve or override verification, approver can do both", () => {
    expect(
      orgPolicy.approvalRules.allowedApproverRoles.includes("analyst" as never),
    ).toBe(false);
    expect(
      orgPolicy.verification.overrideAllowedRoles.includes("analyst" as never),
    ).toBe(false);

    expect(orgPolicy.approvalRules.allowedApproverRoles.includes("approver")).toBe(true);
    expect(orgPolicy.verification.overrideAllowedRoles.includes("approver")).toBe(true);
  });

  it("ensures the AI agent can never invoke write tools", () => {
    const writeTools = [
      "apply_correction",
      "apply_deletion",
      "execute_correction",
      "execute_deletion",
    ];

    for (const tool of writeTools) {
      expect(canToolRun(tool, { role: "agent" })).toBe(false);
      expect(
        canToolRun(tool, {
          role: "agent",
          actionSetHash: "mock-hash",
          approval: {
            valid: true,
            kind: tool.includes("correction") ? "CORRECTION" : "DELETION",
            actionSetHash: "mock-hash",
          },
        }),
      ).toBe(false);
    }
  });
});
