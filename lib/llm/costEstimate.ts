import type { LLMTokenUsage } from "./types";

const CNY_PER_USD = 7.2;

const deepSeekRatesUsdPerMillionTokens: Record<string, { input: number; output: number }> = {
  // Conservative peak, cache-miss rates. Actual off-peak/cache-hit billing can be lower.
  "deepseek-v4-flash": { input: 0.44, output: 1.32 },
  "deepseek-v4-pro": { input: 1.32, output: 3.96 },
  "deepseek-chat": { input: 0.44, output: 1.32 }
};

export function estimateDeepSeekCost(model: string, usage?: LLMTokenUsage): string | undefined {
  if (!usage) {
    return undefined;
  }

  const rates = deepSeekRatesUsdPerMillionTokens[model] ?? deepSeekRatesUsdPerMillionTokens["deepseek-chat"];
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  const usdCost = (promptTokens / 1_000_000) * rates.input + (completionTokens / 1_000_000) * rates.output;
  const cnyCost = usdCost * CNY_PER_USD;

  if (cnyCost <= 0) {
    return "estimated < CNY 0.001";
  }

  return `estimated CNY ${Math.max(cnyCost, 0.001).toFixed(4)}`;
}
