import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  const json = JSON.stringify(value, (_key: string, currentValue: unknown) => {
    if (
      currentValue !== null &&
      typeof currentValue === "object" &&
      !Array.isArray(currentValue)
    ) {
      return Object.fromEntries(
        Object.entries(currentValue).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      );
    }

    return currentValue;
  });

  if (json === undefined) {
    throw new TypeError("Value cannot be represented as JSON.");
  }

  return json;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256(stableStringify(value));
}
