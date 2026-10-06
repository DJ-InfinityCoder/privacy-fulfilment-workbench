import { createHash } from "node:crypto";
import { AIProviderError } from "@/lib/errors";
import { stableStringify } from "@/lib/hash";
import type { ToolCall } from "@/ai/types";

export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}

export function mapProviderError(
  provider: string,
  error: unknown,
): AIProviderError {
  const status = errorStatus(error);
  const timeout =
    (error instanceof Error &&
      /timeout|timed out|abort/i.test(`${error.name} ${error.message}`)) ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      typeof error.name === "string" &&
      /timeout|abort/i.test(error.name));
  const retryable =
    timeout ||
    status === 429 ||
    status === 408 ||
    (status !== undefined && status >= 500 && status <= 503) ||
    status === undefined;
  const code = timeout
    ? `${provider.toUpperCase()}_TIMEOUT`
    : status
      ? `${provider.toUpperCase()}_HTTP_${status}`
      : `${provider.toUpperCase()}_REQUEST_FAILED`;

  return new AIProviderError(
    `${provider} provider request failed.`,
    retryable,
    code,
  );
}

export function normalizeArgs(value: unknown): Record<string, unknown> {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { __parseError: "Malformed tool arguments; regenerate this tool call." };
    }
  }
  return { __parseError: "Tool arguments must be a JSON object; regenerate this tool call." };
}

export function stableToolCallId(
  provider: string,
  model: string,
  index: number,
  name: string,
  args: Record<string, unknown>,
): string {
  const digest = createHash("sha256")
    .update(stableStringify({ provider, model, index, name, args }))
    .digest("hex")
    .slice(0, 24);
  return `call_${digest}`;
}

export function normalizeToolCall(
  provider: string,
  model: string,
  index: number,
  raw: { id?: string | null; name?: string; args?: unknown },
): ToolCall {
  const name = raw.name?.trim() || "unknown_tool";
  const args = normalizeArgs(raw.args);
  return {
    id:
      raw.id?.trim() ||
      stableToolCallId(provider, model, index, name, args),
    name,
    args,
  };
}
