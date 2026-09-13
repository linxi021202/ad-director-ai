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

function failure(model: string, startedAt: number, error: string, finishReason?: string | null): LLMResult {
  return { success: false, provider: "deepseek", model, latencyMs: Date.now() - startedAt, error, finishReason };
}

function parseResponse(raw: string): OpenAICompatibleChatCompletion | null {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as OpenAICompatibleChatCompletion;
  } catch {
    return null;
  }
}

function httpFailure(status: number) {
  if (status === 401 || status === 403) return `DEEPSEEK_AUTH_FAILED：DeepSeek HTTP ${status}，密钥无效或模型权限不足。`;
  if (status === 402) return "DEEPSEEK_QUOTA_EXHAUSTED：DeepSeek 账户余额或额度不足。";
  if (status === 429) return "DEEPSEEK_RATE_LIMITED：DeepSeek 请求过于频繁，请稍后重试。";
  if (status >= 500) return `DEEPSEEK_UPSTREAM_ERROR：DeepSeek 服务暂时异常（HTTP ${status}）。`;
  return `DEEPSEEK_HTTP_ERROR：DeepSeek 请求失败（HTTP ${status}）。`;
}

function transportFailure(error: unknown, timeoutMs: number) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/timeout|aborted due to timeout|aborterror/i.test(message)) {
    return `DEEPSEEK_TIMEOUT：DeepSeek 在 ${Math.round(timeoutMs / 1_000)} 秒内未响应。`;
  }
  return "DEEPSEEK_NETWORK_ERROR：无法连接 DeepSeek 服务。";
}

export function createDeepSeekClient(config: DeepSeekClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  return {
    async call(input: LLMRequest): Promise<LLMResult> {
      const startedAt = Date.now();
      const model = input.model ?? config.model;
      const messages = input.responseFormat === "json" ? ensureJsonPromptHint(input.messages) : input.messages;
      const timeoutMs = config.timeoutMs ?? 90_000;
      try {
        const response = await fetch(`${baseUrl}${CHAT_COMPLETIONS_PATH}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            temperature: input.temperature ?? 0.7,
            max_tokens: input.maxTokens,
            ...(input.responseFormat === "json" ? {
              response_format: { type: "json_object" },
              thinking: { type: "disabled" }
            } : {})
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });

        const responseText = await response.text();
        const raw = parseResponse(responseText);
        if (!response.ok) return failure(model, startedAt, httpFailure(response.status));
        if (!raw) return failure(model, startedAt, "DEEPSEEK_INVALID_RESPONSE：DeepSeek 返回了无法解析的响应。");
        const content = raw.choices?.[0]?.message?.content?.trim();
        const finishReason = raw.choices?.[0]?.finish_reason ?? null;
        if (!content) return failure(model, startedAt, "DEEPSEEK_EMPTY_RESPONSE：DeepSeek 没有返回可用内容。");
        if (finishReason === "length" || finishReason === "max_tokens") {
          return failure(model, startedAt, "DEEPSEEK_OUTPUT_TRUNCATED：DeepSeek 输出达到长度上限，未保存不完整结果。", finishReason);
        }

        const usage = tokenUsage(raw?.usage);
        const base = { provider: "deepseek" as const, model, latencyMs: Date.now() - startedAt, tokenUsage: usage, costEstimate: estimateDeepSeekCost(model, usage) };
        if (input.responseFormat === "json") {
          const parsed = parseJsonResponse(content);
          return parsed.success
            ? { success: true, content, json: parsed.json, finishReason, ...base }
            : { success: false, content, finishReason, ...base, error: "DeepSeek返回的JSON格式无效。" };
        }
        return { success: true, content, finishReason, ...base };
      } catch (error) {
        return failure(model, startedAt, transportFailure(error, timeoutMs));
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
