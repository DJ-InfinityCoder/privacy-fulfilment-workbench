import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import { AIProviderError } from "@/lib/errors";
import { normalizeToolCall, mapProviderError } from "@/ai/providers/shared";
import type {
  ChatMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from "@/ai/types";

function messageToGeminiContent(message: ChatMessage): Content {
  if (message.role === "tool") {
    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            id: message.toolCallId,
            name: message.toolName ?? "unknown_tool",
            response: { output: message.content },
          },
        },
      ],
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "model",
      parts: [
        ...(message.content ? [{ text: message.content }] : []),
        ...message.toolCalls.map((toolCall) => ({
          functionCall: {
            id: toolCall.id,
            name: toolCall.name,
            args: toolCall.args,
          },
        })),
      ],
    };
  }

  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  };
}

function toolDeclaration(
  tool: NonNullable<LLMRequest["tools"]>[number],
): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  };
}

function numericUsage(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
  }

  async generate(req: LLMRequest, signal?: AbortSignal): Promise<LLMResponse> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      throw new AIProviderError("Gemini provider is not configured.", false, "GEMINI_NOT_CONFIGURED");
    }
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: req.timeoutMs,
        retryOptions: { attempts: 1 },
      },
    });
    const startedAt = Date.now();

    try {
      const response = await client.models.generateContent({
        model,
        contents: req.messages.map(messageToGeminiContent),
        config: {
          systemInstruction: req.system,
          temperature: req.temperature,
          maxOutputTokens: req.maxOutputTokens,
          ...(req.jsonMode ? { responseMimeType: "application/json" } : {}),
          ...(signal ? { abortSignal: signal } : {}),
          ...(req.tools?.length
            ? { tools: [{ functionDeclarations: req.tools.map(toolDeclaration) }] }
            : {}),
        },
      });

      const responseParts = response.candidates?.[0]?.content?.parts ?? [];
      const toolCalls = responseParts.flatMap((part, index) =>
        part.functionCall
          ? [
              normalizeToolCall(this.name, model, index, {
                id: part.functionCall.id,
                name: part.functionCall.name,
                args: part.functionCall.args,
              }),
            ]
          : [],
      );
      const text = responseParts
        .map((part) => part.text ?? "")
        .filter(Boolean)
        .join("");
      const usage = response.usageMetadata
        ? {
            inputTokens: numericUsage(response.usageMetadata.promptTokenCount),
            outputTokens: numericUsage(response.usageMetadata.candidatesTokenCount),
          }
        : undefined;

      return {
        text,
        toolCalls,
        provider: this.name,
        model,
        latencyMs: Date.now() - startedAt,
        ...(usage ? { usage } : {}),
      };
    } catch (error: unknown) {
      if (error instanceof AIProviderError) {
        throw error;
      }
      throw mapProviderError(this.name, error);
    }
  }
}

export const geminiProvider = new GeminiProvider();
