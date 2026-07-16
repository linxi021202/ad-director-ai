import { getDeepSeekRuntimeConfig } from "../config/ai";
import { currentModelSessionId, resolveProviderSecret } from "../secrets/resolver";
import { assertServerOnly } from "../server-only";
import { estimateDeepSeekCost } from "./costEstimate";
import { ensureJsonPromptHint, parseJsonResponse } from "./jsonUtils";
import type { LLMRequest, LLMResult, LLMTokenUsage, OpenAICompatibleChatCompletion } from "./types";

assertServerOnly("DeepSeek client");

const CHAT_COMPLETIONS_PATH = "/chat/completions";

export type DeepSeekClientConfig = { apiKey: string; baseUrl: string; model: string; timeoutMs?: number };

function tokenUsage(usage: OpenAICompatibleChatCompletion["usage"]): LLMTokenUsage | undefined {
  return usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens } : undefined;
}

function failure(model: string, startedAt: number, error: string): LLMResult {
  return { success: false, provider: "deepseek", model, latencyMs: Date.now() - startedAt, error };
}

export function createDeepSeekClient(config: DeepSeekClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  return {
    async call(input: LLMRequest): Promise<LLMResult> {
      const startedAt = Date.now();
      const model = input.model ?? config.model;
      const messages = input.responseFormat === "json" ? ensureJsonPromptHint(input.messages) : input.messages;
      try {
        const response = await fetch(`${baseUrl}${CHAT_COMPLETIONS_PATH}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            temperature: input.temperature ?? 0.7,
            max_tokens: input.maxTokens,
            ...(input.responseFormat === "json" ? { response_format: { type: "json_object" } } : {})
          }),
          signal: AbortSignal.timeout(config.timeoutMs ?? 30_000)
        });

        const raw = (await response.json().catch(() => null)) as OpenAICompatibleChatCompletion | null;
        if (!response.ok) return failure(model, startedAt, "DeepSeek调用失败，请检查密钥、额度或服务状态。");
        const content = raw?.choices?.[0]?.message?.content?.trim();
        if (!content) return failure(model, startedAt, "DeepSeek调用失败，请检查密钥、额度或服务状态。");

        const usage = tokenUsage(raw?.usage);
        const base = { provider: "deepseek" as const, model, latencyMs: Date.now() - startedAt, tokenUsage: usage, costEstimate: estimateDeepSeekCost(model, usage) };
        if (input.responseFormat === "json") {
          const parsed = parseJsonResponse(content);
          return parsed.success
            ? { success: true, content, json: parsed.json, ...base }
            : { success: false, content, ...base, error: "DeepSeek返回的JSON格式无效。" };
        }
        return { success: true, content, ...base };
      } catch {
        return failure(model, startedAt, "DeepSeek调用失败，请检查密钥、额度或服务状态。");
      }
    }
  };
}

export async function callDeepSeekLLM(input: LLMRequest): Promise<LLMResult> {
  const runtime = getDeepSeekRuntimeConfig();
  const sessionId = (await currentModelSessionId()) ?? "";
  const secret = await resolveProviderSecret("deepseek", sessionId);
  if (!secret.value) return failure(input.model ?? runtime.model, Date.now(), "DeepSeek尚未配置。");
  return createDeepSeekClient({ apiKey: secret.value, baseUrl: runtime.baseUrl, model: runtime.model, timeoutMs: runtime.timeoutMs }).call(input);
}
