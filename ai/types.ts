export type JSONSchema = Record<string, unknown>;

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ChatMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: JSONSchema;
};

export type LLMRequest = {
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  jsonMode?: boolean;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
};

export type LLMResponse = {
  text: string;
  toolCalls: ToolCall[];
  provider: string;
  model: string;
  latencyMs: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export interface LLMProvider {
  readonly name: string;
  isConfigured(): boolean;
  generate(req: LLMRequest, signal?: AbortSignal): Promise<LLMResponse>;
}

export type AIRequestContext = {
  requestId?: string;
  actorId?: string;
  actorType?: "agent" | "system";
  preferredProvider?: string;
  excludeProviders?: string[];
};

export type ProviderHealth = {
  configured: boolean;
  circuitOpen: boolean;
  lastError: { code: string; at: string } | null;
  lastSuccessAt: string | null;
};
