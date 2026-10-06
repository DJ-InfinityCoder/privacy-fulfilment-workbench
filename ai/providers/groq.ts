import Groq from "groq-sdk";
import { AIProviderError } from "@/lib/errors";
import { mapProviderError, normalizeToolCall } from "@/ai/providers/shared";
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from "@/ai/types";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";

function messagesForGroq(request: LLMRequest): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: request.system },
  ];

  for (const message of request.messages) {
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId ?? "missing_tool_call_id",
      });
    } else if (message.role === "assistant" && message.toolCalls?.length) {
      messages.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.args),
          },
        })),
      });
    } else {
      messages.push({
        role: message.role,
        content: message.content,
      });
    }
  }
  return messages;
}

function numericUsage(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export class GroqProvider implements LLMProvider {
  readonly name = "groq";

  isConfigured(): boolean {
    return Boolean(process.env.GROQ_API_KEY?.trim());
  }

  async generate(req: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new AIProviderError("Groq provider is not configured.", false, "GROQ_NOT_CONFIGURED");
    }
    const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
    const client = new Groq({
      apiKey,
      maxRetries: 0,
      timeout: req.timeoutMs,
    });
    const startedAt = Date.now();
    const tools = req.tools?.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    try {
      const response = await client.chat.completions.create(
        {
          model,
          messages: messagesForGroq(req),
          max_completion_tokens: req.maxOutputTokens,
          temperature: req.temperature,
          ...(tools?.length ? { tools, parallel_tool_calls: true } : {}),
          ...(req.jsonMode && !tools?.length ? { response_format: { type: "json_object" as const } } : {}),
        },
        signal ? { signal } : undefined,
      );
      const choice = response.choices[0];
      const message = choice?.message;
      const toolCalls =
        message?.tool_calls?.flatMap((call, index) =>
          call.type === "function"
            ? [
                normalizeToolCall(this.name, response.model || model, index, {
                  id: call.id,
                  name: call.function.name,
                  args: call.function.arguments,
                }),
              ]
            : [],
        ) ?? [];

      return {
        text: typeof message?.content === "string" ? message.content : "",
        toolCalls,
        provider: this.name,
        model: response.model || model,
        latencyMs: Date.now() - startedAt,
        ...(response.usage
          ? {
              usage: {
                inputTokens: numericUsage(response.usage.prompt_tokens),
                outputTokens: numericUsage(response.usage.completion_tokens),
              },
            }
          : {}),
      };
    } catch (error: unknown) {
      if (error instanceof AIProviderError) {
        throw error;
      }
      throw mapProviderError(this.name, error);
    }
  }
}

export const groqProvider = new GroqProvider();
