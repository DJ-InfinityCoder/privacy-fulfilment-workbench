import { appendAudit } from "@/lib/audit";
import {
  AIProviderError,
  AllProvidersFailedError,
} from "@/lib/errors";
import { geminiProvider } from "@/ai/providers/gemini";
import { groqProvider } from "@/ai/providers/groq";
import type {
  AIRequestContext,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ProviderHealth,
} from "@/ai/types";

type CircuitState = {
  openUntil: number;
  lastError: { code: string; at: string } | null;
  lastSuccessAt: string | null;
};

type RouterOptions = {
  providers?: readonly LLMProvider[];
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

const circuitStates = new Map<string, CircuitState>();
const defaultProviders: readonly LLMProvider[] = [geminiProvider, groqProvider];

function envInteger(name: string, fallback: number, minimum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function preferredProvider(): string {
  return process.env.AI_PRIMARY_PROVIDER?.trim().toLowerCase() === "groq"
    ? "groq"
    : "gemini";
}

function providerOrder(
  providers: readonly LLMProvider[],
  context: AIRequestContext,
): LLMProvider[] {
  const preferred = context.preferredProvider ?? preferredProvider();
  const excluded = new Set(context.excludeProviders ?? []);
  return [...providers]
    .filter((provider) => !excluded.has(provider.name))
    .sort((left, right) => {
    if (left.name === preferred) return -1;
    if (right.name === preferred) return 1;
    return 0;
    });
}

function circuitState(provider: string): CircuitState {
  let state = circuitStates.get(provider);
  if (!state) {
    state = {
      openUntil: 0,
      lastError: null,
      lastSuccessAt: null,
    };
    circuitStates.set(provider, state);
  }
  return state;
}

function isCircuitOpen(provider: string, now: number): boolean {
  const state = circuitState(provider);
  if (state.openUntil <= now) {
    state.openUntil = 0;
    return false;
  }
  return true;
}

function isRetryable(error: unknown): boolean {
  return error instanceof AIProviderError && error.retryable;
}

function safeError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) {
    return error;
  }
  return new AIProviderError("AI provider request failed.", true);
}

async function auditProviderCall(
  ctx: AIRequestContext,
  provider: string,
  model: string,
  latencyMs: number,
  success: boolean,
  error?: AIProviderError,
  usage?: LLMResponse["usage"],
): Promise<void> {
  await appendAudit({
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    actorType: ctx.actorType ?? "system",
    actorId: ctx.actorId ?? "ai-router",
    eventType: "AI_PROVIDER_CALL",
    input: { provider, model },
    output: {
      success,
      latencyMs,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    },
    status: success ? "ok" : "error",
    ...(error ? { error: { code: error.code } } : {}),
  });
}

async function auditFailover(
  ctx: AIRequestContext,
  provider: string,
  error: AIProviderError,
): Promise<void> {
  await appendAudit({
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    actorType: ctx.actorType ?? "system",
    actorId: ctx.actorId ?? "ai-router",
    eventType: "AI_PROVIDER_FAILOVER",
    input: { provider, errorCode: error.code },
    status: "error",
    error: { code: error.code },
  });
}

function withTimeout(
  provider: LLMProvider,
  request: LLMRequest,
  timeoutMs: number,
): Promise<LLMResponse> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const providerPromise = provider.generate(
    { ...request, timeoutMs },
    controller.signal,
  );

  return Promise.race([
    providerPromise,
    new Promise<LLMResponse>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(
          new AIProviderError(
            "AI provider request exceeded its timeout.",
            true,
            `${provider.name.toUpperCase()}_TIMEOUT`,
          ),
        );
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  });
}

export async function generateWithFailover(
  request: LLMRequest,
  ctx: AIRequestContext = {},
  options: RouterOptions = {},
): Promise<LLMResponse> {
  const providers = providerOrder(options.providers ?? defaultProviders, ctx);
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const maxRetries = envInteger("AI_MAX_RETRIES_PER_PROVIDER", 1, 0);
  const cooldownMs =
    envInteger("AI_CIRCUIT_BREAKER_COOLDOWN_SEC", 60, 1) * 1000;
  const timeoutMs = Math.max(
    1,
    request.timeoutMs || envInteger("AI_TIMEOUT_MS", 25_000, 1),
  );

  let configuredProviders = 0;
  let lastFailure: AIProviderError | undefined;

  for (const provider of providers) {
    if (!provider.isConfigured()) {
      continue;
    }
    configuredProviders += 1;
    if (isCircuitOpen(provider.name, now())) {
      continue;
    }

    let finalError: AIProviderError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const attemptStartedAt = now();
      let response: LLMResponse;
      try {
        response = await withTimeout(provider, request, timeoutMs);
      } catch (caught: unknown) {
        const failure = safeError(caught);
        const elapsedMs = Math.max(0, now() - attemptStartedAt);
        await auditProviderCall(
          ctx,
          provider.name,
          process.env[provider.name === "gemini" ? "GEMINI_MODEL" : "GROQ_MODEL"] ??
            "configured-model",
          elapsedMs,
          false,
          failure,
        );

        if (isRetryable(failure) && attempt < maxRetries) {
          const backoffMs = Math.min(1000 * 2 ** attempt, 10_000);
          const jitterMs = Math.floor(random() * Math.max(1, backoffMs * 0.25));
          await sleep(backoffMs + jitterMs);
          continue;
        }
        finalError = failure;
        break;
      }

      const latencyMs = Math.max(0, response.latencyMs || now() - attemptStartedAt);
      const normalizedResponse = {
        ...response,
        provider: provider.name,
        latencyMs,
      };
      await auditProviderCall(
        ctx,
        provider.name,
        response.model,
        latencyMs,
        true,
        undefined,
        response.usage,
      );
      const state = circuitState(provider.name);
      state.openUntil = 0;
      state.lastError = null;
      state.lastSuccessAt = new Date(now()).toISOString();
      return normalizedResponse;
    }

    if (finalError) {
      lastFailure = finalError;
      const state = circuitState(provider.name);
      state.openUntil = now() + cooldownMs;
      state.lastError = {
        code: finalError.code,
        at: new Date(now()).toISOString(),
      };
      await auditFailover(ctx, provider.name, finalError);
    }
  }

  if (configuredProviders === 0) {
    throw new AllProvidersFailedError("No AI provider is configured.");
  }
  if (!lastFailure) {
    throw new AllProvidersFailedError(
      "All configured AI providers are temporarily unavailable.",
    );
  }
  throw new AllProvidersFailedError();
}

export function getProviderHealth(
  providers: readonly LLMProvider[] = defaultProviders,
  now = Date.now(),
): Record<string, ProviderHealth> {
  return Object.fromEntries(
    providers.map((provider) => {
      const state = circuitState(provider.name);
      const circuitOpen = state.openUntil > now;
      if (!circuitOpen) {
        state.openUntil = 0;
      }
      return [
        provider.name,
        {
          configured: provider.isConfigured(),
          circuitOpen,
          lastError: state.lastError,
          lastSuccessAt: state.lastSuccessAt,
        } satisfies ProviderHealth,
      ];
    }),
  );
}

export function resetProviderCircuitBreakers(): void {
  circuitStates.clear();
}

export async function recordFallbackPlannerUse(
  ctx: AIRequestContext = {},
): Promise<void> {
  await appendAudit({
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    actorType: ctx.actorType ?? "system",
    actorId: ctx.actorId ?? "ai-fallback-planner",
    eventType: "AI_PROVIDER_FALLBACK_PLANNER",
    input: { provider: "deterministic" },
    output: { used: true },
    status: "ok",
  });
}
