import { z } from "zod";

import { getDeepSeekRuntimeConfig } from "../config/ai";
import { createDeepSeekClient } from "../llm/deepseekClient";
import { resolveProviderSecret } from "../secrets/resolver";
import { estimateDeepSeekCost } from "../llm/costEstimate";
import type { LLMMessage, LLMTokenUsage } from "../llm/types";
import {
  buildAdScorePrompt,
  buildPromptGenerationPrompt,
  buildStoryboardPrompt,
  buildStrategyPrompt
} from "../prompts";
import {
  adStrategySchema,
  storyboardShotSchema,
  type AdStrategy,
  type ProductBrief,
  type StoryboardShot
} from "../schemas/project";
import type { OptimizedCopy, ProviderRequestContext, RealTextProviderResponse, TextProvider } from "./types";
import { resolveShotPlan, validateShotConfiguration } from "../video/shotConfig";

const allowedModelSchema = z.enum(["deepseek-v4-flash", "qwen-image", "happyhorse-1.0-r2v", "remotion"]);

const routedShotSchema = storyboardShotSchema.extend({
  recommendedModel: allowedModelSchema
});

const subtitleSafeShotSchema = routedShotSchema.refine((shot) => [...shot.subtitle].length <= 16, {
  message: "subtitle must be no more than 16 Chinese characters"
});

function createShotsPayloadSchema(shotDurationPlan: number[]): z.ZodType<StoryboardShot[]> {
  const expectedShotCount = shotDurationPlan.length;
  const base = z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && "shots" in value) {
      return (value as { shots?: unknown }).shots;
    }
    return value;
  }, z.array(subtitleSafeShotSchema).length(expectedShotCount).transform((shots) => shots.map((shot, index) => ({
    ...shot,
    index: index + 1,
    durationSec: shotDurationPlan[index]!
  })))) as z.ZodType<StoryboardShot[]>;

  return base.refine(
    (shots) => validateShotConfiguration(expectedShotCount, shots, shotDurationPlan).valid,
    { message: `storyboard must contain exactly ${expectedShotCount} shots using the requested duration plan` }
  );
}
const adScoreSchema = z.object({
  overallScore: z.number().min(0).max(100),
  dimensionScores: z.object({
    strategyClarity: z.number().min(0).max(20),
    storyboardExecution: z.number().min(0).max(20),
    promptQuality: z.number().min(0).max(20),
    costControl: z.number().min(0).max(20),
    brandSafety: z.number().min(0).max(20)
  }),
  passed: z.boolean(),
  summary: z.string().min(1),
  risks: z.array(z.string().min(1)),
  fixSuggestions: z.array(z.string().min(1)),
  modelRouteCheck: z.object({
    allowedOnly: z.boolean(),
    usedModels: z.array(allowedModelSchema),
    forbiddenModelsFound: z.array(z.string())
  }),
  videoGenerationStrategyCheck: z.object({
    heroShotOnly: z.boolean(),
    realVideoShots: z.number().int().min(0).max(1),
    fallbackReady: z.boolean()
  })
});

export type AdScoreResult = z.infer<typeof adScoreSchema>;

function addTokenUsage(current: LLMTokenUsage | undefined, next: LLMTokenUsage | undefined): LLMTokenUsage | undefined {
  if (!current && !next) {
    return undefined;
  }

  return {
    promptTokens: (current?.promptTokens ?? 0) + (next?.promptTokens ?? 0),
    completionTokens: (current?.completionTokens ?? 0) + (next?.completionTokens ?? 0),
    totalTokens: (current?.totalTokens ?? 0) + (next?.totalTokens ?? 0)
  };
}

function successResponse<TData>(
  data: TData,
  model: string,
  latencyMs: number,
  tokenUsage: LLMTokenUsage | undefined
): RealTextProviderResponse<TData> {
  return {
    success: true,
    data,
    provider: "deepseek",
    model,
    latencyMs,
    tokenUsage,
    costEstimate: estimateDeepSeekCost(model, tokenUsage),
    fallbackUsed: false,
    error: null
  };
}

function failureResponse<TData>(
  model: string,
  latencyMs: number,
  error: string,
  tokenUsage?: LLMTokenUsage
): RealTextProviderResponse<TData> {
  return {
    success: false,
    data: null,
    provider: "deepseek",
    model,
    latencyMs,
    tokenUsage,
    costEstimate: estimateDeepSeekCost(model, tokenUsage),
    fallbackUsed: false,
    error
  };
}

function retryMessage(error: string): LLMMessage {
  return {
    role: "user",
    content: `The previous json output failed validation: ${error}. Regenerate the full response as valid json only.`
  };
}

async function callAndValidate<TData>(
  prompt: string,
  schema: z.ZodType<TData>,
  options?: { temperature?: number; maxTokens?: number },
  context?: ProviderRequestContext
): Promise<RealTextProviderResponse<TData>> {
  const startedAt = Date.now();
  const runtime = getDeepSeekRuntimeConfig();
  const model = runtime.model;
  let tokenUsage: LLMTokenUsage | undefined;
  let lastError = "DeepSeek调用失败，请检查密钥、额度或服务状态。";
  const messages: LLMMessage[] = [{ role: "user", content: prompt }];
  const secret = await resolveProviderSecret("deepseek", context?.sessionId ?? "");
  if (!secret.value) return failureResponse(model, Date.now() - startedAt, "DeepSeek尚未配置。" );
  const client = createDeepSeekClient({ apiKey: secret.value, baseUrl: runtime.baseUrl, model, timeoutMs: runtime.timeoutMs });

  for (let attempt = 0; attempt <= runtime.maxRetries; attempt += 1) {
    const result = await client.call({
      model,
      messages,
      responseFormat: "json",
      temperature: options?.temperature ?? 0.4,
      maxTokens: options?.maxTokens ?? 2600
    });

    tokenUsage = addTokenUsage(tokenUsage, result.tokenUsage);

    if (!result.success) {
      lastError = result.error ?? "DeepSeek LLM call failed.";
      messages.push(retryMessage(lastError));
      continue;
    }

    const parsed = schema.safeParse(result.json);

    if (parsed.success) {
      return successResponse(parsed.data, model, Date.now() - startedAt, tokenUsage);
    }

    lastError = parsed.error.message;
    messages.push(retryMessage(lastError));
  }

  return failureResponse(model, Date.now() - startedAt, lastError, tokenUsage);
}

export const deepseekProvider = {
  provider: "deepseek",

  async generateStrategy(brief: ProductBrief, context?: ProviderRequestContext): Promise<RealTextProviderResponse<AdStrategy>> {
    return callAndValidate(buildStrategyPrompt(brief, context), adStrategySchema, {
      temperature: 0.35,
      maxTokens: 1800
    }, context);
  },

  async generateStoryboard(
    brief: ProductBrief,
    strategy: AdStrategy,
    context?: ProviderRequestContext
  ): Promise<RealTextProviderResponse<StoryboardShot[]>> {
    const timeline = resolveShotPlan(
      context?.requestedShotCount,
      context?.shotDurationPlan,
      context?.targetDurationSec ?? (context?.shotDurationPlan ? undefined : brief.durationSec)
    );
    return callAndValidate(buildStoryboardPrompt(brief, strategy, timeline), createShotsPayloadSchema(timeline.shotDurationPlan), {
      temperature: 0.45,
      maxTokens: Math.max(3600, timeline.shotCount * 650)
    }, context);
  },

  async optimizeCopy(storyboard: StoryboardShot[]): Promise<RealTextProviderResponse<OptimizedCopy>> {
    const model = getDeepSeekRuntimeConfig().model;

    return successResponse(
      storyboard.map((shot) => ({
        shotId: shot.id,
        subtitle: shot.subtitle
      })),
      model,
      0,
      undefined
    );
  },

  async generatePrompts(
    brief: ProductBrief,
    strategy: AdStrategy,
    shots: StoryboardShot[],
    context?: ProviderRequestContext
  ): Promise<RealTextProviderResponse<StoryboardShot[]>> {
    return callAndValidate(buildPromptGenerationPrompt(brief, strategy, shots), createShotsPayloadSchema(shots.map((shot) => shot.durationSec)), {
      temperature: 0.35,
      maxTokens: 4200
    }, context);
  },

  async scoreAdPlan(
    brief: ProductBrief,
    strategy: AdStrategy,
    shots: StoryboardShot[],
    context?: ProviderRequestContext
  ): Promise<RealTextProviderResponse<AdScoreResult>> {
    return callAndValidate(buildAdScorePrompt(brief, strategy, shots), adScoreSchema, {
      temperature: 0.2,
      maxTokens: 1800
    }, context);
  }
} satisfies TextProvider;




