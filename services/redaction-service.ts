import type { JsonRecord } from "@/models/model-types";
import type { DataSourceName } from "@/models/model-types";
import { orgPolicy } from "@/policy/org-policy";
import { classifyField } from "@/policy/policy-engine";

export type RedactionManifestEntry = {
  source: DataSourceName;
  field: string;
  ruleId: string;
  reason: string;
};

export type RedactRecordResult = {
  record: JsonRecord;
  manifest: RedactionManifestEntry[];
};

const redactionReasonByClassification = {
  RESTRICTED: "Restricted data is excluded from exports by organizational policy.",
  THIRD_PARTY: "Third-party data is excluded from exports by organizational policy.",
  INTERNAL: "Internal data is excluded from exports by organizational policy.",
} as const;

export function isClassificationBlockedFromExport(
  classification: string,
): boolean {
  return orgPolicy.redactionRules.some(
    (rule) =>
      rule.action === "remove_classification" &&
      "classification" in rule &&
      rule.classification === classification,
  );
}

function ruleIdForClassification(classification: string): string {
  const rule = orgPolicy.redactionRules.find(
    (candidate) =>
      candidate.action === "remove_classification" &&
      "classification" in candidate &&
      candidate.classification === classification,
  );
  return rule?.id ?? "REDACT-UNCLASSIFIED-FIELD";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskIp(value: string): string {
  if (value.includes(".")) {
    const segments = value.split(".");
    if (segments.length === 4 && segments.slice(0, 3).every((part) => /^\d+$/.test(part))) {
      return `${segments[0]}.${segments[1]}.${segments[2]}.xxx`;
    }
    if (segments.length === 4) {
      return `${segments[0]}.${segments[1]}.xxx.xxx`;
    }
  }
  return "[REDACTED: IP address]";
}

function containsMatch(value: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

export function redactFreeText(
  text: string,
  names: readonly string[] = [],
): { text: string; ruleIds: string[] } {
  const ruleIds: string[] = [];
  let redacted = text;

  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  if (containsMatch(redacted, emailPattern)) {
    redacted = redacted.replace(emailPattern, "[REDACTED: email]");
    ruleIds.push("REDACT-FREE-TEXT-EMAIL");
  }

  const phonePattern = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g;
  if (containsMatch(redacted, phonePattern)) {
    redacted = redacted.replace(phonePattern, "[REDACTED: phone]");
    ruleIds.push("REDACT-FREE-TEXT-PHONE");
  }

  const distinctNames = [...new Set(names)]
    .filter((name) => name.trim().length >= 2)
    .sort((left, right) => right.length - left.length);
  for (const name of distinctNames) {
    const namePattern = new RegExp(`\\b${escapeRegExp(name.trim())}\\b`, "gi");
    if (containsMatch(redacted, namePattern)) {
      redacted = redacted.replace(namePattern, "[REDACTED: name]");
      if (!ruleIds.includes("REDACT-FREE-TEXT-NAME")) {
        ruleIds.push("REDACT-FREE-TEXT-NAME");
      }
    }
  }

  return { text: redacted, ruleIds };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactRecord(
  source: DataSourceName,
  record: Readonly<Record<string, unknown>>,
  knownNames: readonly string[] = [],
): RedactRecordResult {
  const redacted: JsonRecord = {};
  const manifest: RedactionManifestEntry[] = [];

  for (const [field, value] of Object.entries(record)) {
    const classification = classifyField(source, field);
    if (!classification) {
      manifest.push({
        source,
        field,
        ruleId: "REDACT-UNCLASSIFIED-FIELD",
        reason: "The field has no organizational classification and was excluded.",
      });
      continue;
    }

    if (isClassificationBlockedFromExport(classification)) {
      const classKey = classification as keyof typeof redactionReasonByClassification;
      manifest.push({
        source,
        field,
        ruleId: ruleIdForClassification(classification),
        reason: redactionReasonByClassification[classKey],
      });
      continue;
    }

    if ((field === "ip" || field === "ip_address") && typeof value === "string") {
      redacted[field] = maskIp(value);
      manifest.push({
        source,
        field,
        ruleId: "MASK-IP-ADDRESS",
        reason: "The IP address was partially masked.",
      });
      continue;
    }

    if (source === "support_tickets" && field === "messages" && Array.isArray(value)) {
      redacted[field] = value.map((message, index) => {
        if (!isPlainRecord(message)) {
          manifest.push({
            source,
            field: `messages[${index}]`,
            ruleId: "REDACT-UNSTRUCTURED-MESSAGE",
            reason: "An unstructured message was excluded.",
          });
          return "[REDACTED: unstructured message]";
        }

        if (message.authorType !== "customer") {
          const text = typeof message.text === "string" ? message.text : "";
          const scanned = redactFreeText(text, knownNames);
          for (const ruleId of scanned.ruleIds) {
            manifest.push({
              source,
              field: `messages[${index}].text`,
              ruleId,
              reason: "Personal identifiers in non-customer text were redacted.",
            });
          }
          manifest.push({
            source,
            field: `messages[${index}].text`,
            ruleId: orgPolicy.redactionRules.find(
              (rule) => rule.id === "REDACT-THIRD-PARTY-MESSAGE",
            )?.id ?? "REDACT-THIRD-PARTY-MESSAGE",
            reason: "Non-customer message text is excluded from exports.",
          });
          return {
            authorType: message.authorType,
            text: "[REDACTED: third-party data]",
          };
        }

        return { ...message };
      });
      continue;
    }

    redacted[field] = value;
  }

  return { record: redacted, manifest };
}
