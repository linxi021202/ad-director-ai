export type LLMRole = "system" | "user" | "assistant";

export type LLMMessage = {
  role: LLMRole;
  content: string;
};

export type LLMResponseFormat = "json" | "text";

export type LLMRequest = {
  model?: string;
  messages: LLMMessage[];
  responseFormat: LLMResponseFormat;
  temperature?: number;
  maxTokens?: number;
};

export type LLMTokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LLMResult = {
  success: boolean;
  content?: string;
  json?: unknown;
  provider: "deepseek";
  model: string;
  latencyMs: number;
  tokenUsage?: LLMTokenUsage;
  costEstimate?: string;
  error?: string;
};

export type OpenAICompatibleChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
};
