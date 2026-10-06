import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIProviderError, AllProvidersFailedError } from "@/lib/errors";
import { AuditEvent } from "@/models/AuditEvent";
import { Counter } from "@/models/Counter";
import {
  generateWithFailover,
  recordFallbackPlannerUse,
  resetProviderCircuitBreakers,
} from "@/ai/router";
import { normalizeArgs, normalizeToolCall } from "@/ai/providers/shared";
import type {
  ChatMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from "@/ai/types";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri("privacy_ai_router_test");
  await mongoose.connect(process.env.MONGODB_URI);
});

beforeEach(async () => {
  resetProviderCircuitBreakers();
  process.env.AI_PRIMARY_PROVIDER = "gemini";
  process.env.AI_MAX_RETRIES_PER_PROVIDER = "0";
  process.env.AI_CIRCUIT_BREAKER_COOLDOWN_SEC = "60";
  await Promise.all([
    AuditEvent.collection.deleteMany({}),
    Counter.collection.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

function request(messages: ChatMessage[] = []): LLMRequest {
  return {
    system: "Operate only within the approved mock-data policy.",
    messages,
    tools: [
      {
        name: "search_mock",
        description: "Search mock records",
        parameters: { type: "object", properties: {} },
      },
    ],
    maxOutputTokens: 512,
    temperature: 0,
    timeoutMs: 500,
  };
}

function successfulResponse(provider: string): LLMResponse {
  return {
    text: `response from ${provider}`,
    toolCalls: [],
    provider,
    model: "mock-model",
    latencyMs: 7,
    usage: { inputTokens: 11, outputTokens: 5 },
  };
}

function mockProvider(
  name: string,
  generate: LLMProvider["generate"],
  configured = true,
): LLMProvider {
  return {
    name,
    isConfigured: () => configured,
    generate,
  };
}

function failWith(message: string, retryable = false) {
  return new AIProviderError(message, retryable, "MOCK_PROVIDER_ERROR");
}

describe("AI provider router", () => {
  it("recovers malformed tool arguments and generates a stable tool-call id", () => {
    const malformed = normalizeArgs("{not-json");
    const first = normalizeToolCall("gemini", "mock-model", 0, {
      name: "lookup",
      args: { query: "synthetic" },
    });
    const second = normalizeToolCall("gemini", "mock-model", 0, {
      name: "lookup",
      args: { query: "synthetic" },
    });

    expect(malformed).toMatchObject({ __parseError: expect.any(String) });
    expect(first.id).toBe(second.id);
    expect(first.args).toEqual({ query: "synthetic" });
  });

  it("fails over from the primary provider to the secondary", async () => {
    const primaryCalls: number[] = [];
    const secondaryCalls: number[] = [];
    const primary = mockProvider("gemini", async () => {
      primaryCalls.push(1);
      throw failWith("primary failed");
    });
    const secondary = mockProvider("groq", async () => {
      secondaryCalls.push(1);
      return successfulResponse("groq");
    });

    const response = await generateWithFailover(request(), {}, {
      providers: [primary, secondary],
      sleep: async () => {},
      random: () => 0,
    });

    expect(response.provider).toBe("groq");
    expect(primaryCalls).toHaveLength(1);
    expect(secondaryCalls).toHaveLength(1);
    const events = await AuditEvent.find({
      eventType: { $in: ["AI_PROVIDER_CALL", "AI_PROVIDER_FAILOVER"] },
    }).lean();
    expect(events.some((event) => event.eventType === "AI_PROVIDER_FAILOVER")).toBe(
      true,
    );
  });

  it("fails over on a non-retryable credential error without retrying it", async () => {
    let primaryCalls = 0;
    const primary = mockProvider("gemini", async () => {
      primaryCalls += 1;
      throw new AIProviderError(
        "gemini provider request failed.",
        false,
        "GEMINI_HTTP_401",
      );
    });
    const secondary = mockProvider("groq", async () => successfulResponse("groq"));

    const response = await generateWithFailover(request(), {}, {
      providers: [primary, secondary],
      sleep: async () => {},
    });

    expect(response.provider).toBe("groq");
    expect(primaryCalls).toBe(1);
  });

  it("throws AllProvidersFailedError when both providers fail", async () => {
    const providers = ["gemini", "groq"].map((name) =>
      mockProvider(name, async () => {
        throw failWith(`${name} failed`);
      }),
    );

    await expect(
      generateWithFailover(request(), {}, {
        providers,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(
      await AuditEvent.countDocuments({ eventType: "AI_PROVIDER_CALL", status: "error" }),
    ).toBe(2);
  });

  it("retries a retryable provider error once with backoff", async () => {
    process.env.AI_MAX_RETRIES_PER_PROVIDER = "1";
    const delays: number[] = [];
    let calls = 0;
    const provider = mockProvider("gemini", async () => {
      calls += 1;
      if (calls === 1) {
        throw failWith("temporarily unavailable", true);
      }
      return successfulResponse("gemini");
    });

    const response = await generateWithFailover(request(), {}, {
      providers: [provider],
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      random: () => 0,
    });

    expect(response.provider).toBe("gemini");
    expect(calls).toBe(2);
    expect(delays).toEqual([1000]);
    expect(
      await AuditEvent.countDocuments({ eventType: "AI_PROVIDER_CALL" }),
    ).toBe(2);
  });

  it("opens the failing provider circuit and skips it until cooldown", async () => {
    const primaryCalls: number[] = [];
    const primary = mockProvider("gemini", async () => {
      primaryCalls.push(1);
      throw failWith("primary unavailable");
    });
    const secondary = mockProvider("groq", async () => successfulResponse("groq"));
    const options = {
      providers: [primary, secondary] as const,
      now: () => 100_000,
      sleep: async () => {},
    };

    await generateWithFailover(request(), {}, options);
    await generateWithFailover(request(), {}, options);

    expect(primaryCalls).toHaveLength(1);
  });

  it("skips providers without an API key", async () => {
    const unconfigured = mockProvider("gemini", async () => {
      throw new Error("This provider should not be called.");
    }, false);
    const configured = mockProvider("groq", async () => successfulResponse("groq"));

    const response = await generateWithFailover(request(), {}, {
      providers: [unconfigured, configured],
      sleep: async () => {},
    });

    expect(response.provider).toBe("groq");
  });

  it("preserves the neutral conversation when failing over mid-loop", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Find my mock profile." },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-existing-1",
            name: "search_mock",
            args: { subjectUserId: "USR-MOCK-1" },
          },
        ],
      },
      {
        role: "tool",
        content: '{"found":true}',
        toolCallId: "call-existing-1",
        toolName: "search_mock",
      },
    ];
    let secondaryMessages: ChatMessage[] | undefined;
    const primary = mockProvider("gemini", async () => {
      throw failWith("mid-loop failure");
    });
    const secondary = mockProvider("groq", async (received) => {
      secondaryMessages = received.messages;
      return successfulResponse("groq");
    });

    await generateWithFailover(request(messages), { requestId: "PRQ-AI-1" }, {
      providers: [primary, secondary],
      sleep: async () => {},
    });

    expect(secondaryMessages).toEqual(messages);
    expect(secondaryMessages?.[2]).toMatchObject({
      role: "tool",
      toolCallId: "call-existing-1",
      toolName: "search_mock",
    });
  });

  it("audits deterministic fallback planner use", async () => {
    await recordFallbackPlannerUse({ requestId: "PRQ-AI-FALLBACK" });
    const event = await AuditEvent.findOne({
      requestId: "PRQ-AI-FALLBACK",
      eventType: "AI_PROVIDER_FALLBACK_PLANNER",
    }).lean();
    expect(event?.status).toBe("ok");
  });
});
