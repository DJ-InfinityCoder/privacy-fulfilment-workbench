import { PayloadTooLargeError, RateLimitError } from "@/lib/errors";

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitRecord>();

export const DEFAULT_RATE_LIMIT = 120; // 120 requests per minute
export const DEFAULT_WINDOW_MS = 60_000; // 1 minute
export const MAX_BODY_SIZE_BYTES = 1024 * 1024; // 1 MB

export function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "anonymous";
}

export function checkRateLimit(
  key: string,
  limit = DEFAULT_RATE_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetMs: windowMs };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  const resetMs = Math.max(0, existing.resetAt - now);

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, resetMs };
  }

  return { allowed: true, remaining, resetMs };
}

export function resetRateLimits(): void {
  store.clear();
}

export function enforceBodySizeLimit(
  request: Request,
  maxBytes = MAX_BODY_SIZE_BYTES,
): void {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const bytes = Number.parseInt(contentLength, 10);
    if (!Number.isNaN(bytes) && bytes > maxBytes) {
      throw new PayloadTooLargeError(
        `Request body exceeds maximum permitted size of ${maxBytes} bytes.`,
      );
    }
  }
}

export function enforceRateLimit(
  request: Request,
  limit = DEFAULT_RATE_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): void {
  if (process.env.DISABLE_RATE_LIMIT === "true") {
    return;
  }
  const clientKey = getClientIdentifier(request);
  const result = checkRateLimit(clientKey, limit, windowMs);
  if (!result.allowed) {
    throw new RateLimitError(
      `Rate limit exceeded. Try again in ${Math.ceil(result.resetMs / 1000)} seconds.`,
    );
  }
}
