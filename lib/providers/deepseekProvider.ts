import { z } from "zod";

import { getDeepSeekRuntimeConfig } from "../config/ai";
import { createDeepSeekClient } from "../llm/deepseekClient";
import { resolveProviderSecret } from "../secrets/resolver";
import { estimateDeepSeekCost } from "../llm/costEstimate";
import type { LLMMessage, LLMResult, LLMTokenUsage } from "../llm/types";
import {
  buildAdScorePrompt,
  buildPromptGenerationPrompt,
  buildStoryboardChunkPrompt,
  buildStrategyPrompt
} from "../prompts";
import {
  adStrategySchema,
  characterAnchorBriefSchema,
  characterCandidateDirectionSchema,
  narrationPlanSchema,
  sceneCandidateDirectionSchema,
  storyboardShotSchema,
  type AdStrategy,
  type CharacterAnchorBrief,
  type CharacterCandidateDirection,
  type CreativeBible,
  type ProductBrief,
  type ProductVisualSpec,
  type SceneCandidateDirection,
  type SceneVisualSpec,
  type NarrationPlan,
  type StoryboardShot
} from "../schemas/project";
import { inferProductShotType, shotContainsProduct } from "../continuity/projectContinuity";
import { repairShotProductTerminology } from "../visual/productTerminology";
import type { OptimizedCopy, ProviderRequestContext, RealTextProviderResponse, TextProvider } from "./types";
import { resolveShotPlan, validateShotConfiguration } from "../video/shotConfig";
import { ensureShotArchitecture, ensureStoryboardArchitecture } from "../storyboard/shotArchitecture";
import {
  buildStoryboardRepairPrompt,
  mergeStoryboardChunks,
  normalizeStoryboardOutput,
  validateStateContinuity,
  validateStoryboardGlobalConstraints
} from "../ai/contracts/storyboard";
import { buildCreativeDirectionsPrompt, buildDeepenCreativeDirectionsPrompt, validateCreativeDirectionSetQuality } from "../creative/creativeDirections";
import {
  buildShotPromptFoundationPrompt,
  buildSingleFramePromptExpansionPrompt,
  type ShotPromptExpansionInput
} from "../prompts/detailedDirectorPrompts";
import {
  creativeDirectionSetPayloadSchema,
  detailedFramePromptSchema,
  detailedShotPromptPackageSchema,
  detailedShotPromptFoundationSchema,
  type CreativeDirectionSetPayload,
  type DetailedShotPromptPackage,
  type ProjectPlanningConstraints
} from "../schemas/project";

const allowedModelSchema = z.enum(["deepseek-v4-pro", "qwen-image", "wan2.7-i2v", "remotion"]);

const routedShotSchema = storyboardShotSchema.extend({
  recommendedModel: allowedModelSchema
});

const subtitleSafeShotSchema = routedShotSchema.refine((shot) => [...shot.subtitle].length <= 16, {
  message: "subtitle must be no more than 16 Chinese characters"
});

export const TEXT_OUTPUT_BUDGETS = {
  strategy: 1800,
  storyboardChunk: 3600,
  narration: 1400,
  visualDirection: 2200,
  creativeDirections: 7600,
  promptExpansion: 5000,
  shotPromptExpansion: 7200,
  shotPromptFoundation: 3200,
  shotPromptFrame: 3000,
  scoring: 1800,
  copyShortening: 240
} as const;

const storyboardStructureShotSchema = routedShotSchema.extend({
  narrativePurpose: z.string().trim().min(24),
  commercialPurpose: z.string().trim().min(16),
  previousState: z.string().trim().min(12),
  newInformation: z.string().trim().min(12),
  resultingState: z.string().trim().min(12),
  visualDescription: z.string().trim().min(40),
  compositionIntent: z.string().trim().min(12),
  emotionalIntent: z.string().trim().min(8),
  productVisibilityIntent: z.string().trim().min(10),
  transitionIn: z.string().trim().min(6),
  transitionOut: z.string().trim().min(6),
  containsProduct: z.boolean(),
  continuityConstraints: z.array(z.string().trim().min(4)).min(2),
  shotDirection: z.array(z.string().trim().min(4)).min(1)
}).refine((shot) => [...shot.subtitle].length <= 16, {
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
const partialNarrationSchema = narrationPlanSchema.extend({
  mode: z.literal("partial"),
  beats: narrationPlanSchema.shape.beats.min(2).max(4)
}).refine((plan) => plan.beats.some((beat) => beat.role === "problem") && plan.beats.some((beat) => beat.role === "brand-payoff"), {
  message: "partial narration requires problem and brand-payoff beats"
});
const shortenedNarrationSchema = z.object({ text: z.string().trim().min(1).max(80) }).strict();

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

async function reportModelCall(context: ProviderRequestContext | undefined, result: LLMResult, attempt: number, validation: {
  success?: boolean; error?: string; schemaValid?: boolean; validationPath?: string; normalized?: boolean; repaired?: boolean;
} = {}) {
  try {
    await context?.onModelCall?.({
    pass: context.modelCallPass, shotId: context.modelCallShotId, frameId: context.modelCallFrameId,
    chunkIndex: context.modelCallChunkIndex, mode: context.modelCallMode, attempt, model: result.model, latencyMs: result.latencyMs,
    success: validation.success ?? result.success,
    error: validation.error ?? result.error ?? undefined,
    httpStatus: result.httpStatus, providerRequestId: result.providerRequestId,
    inputTokens: result.tokenUsage?.promptTokens, outputTokens: result.tokenUsage?.completionTokens,
    outputLength: result.outputLength, finishReason: result.finishReason ?? undefined,
    jsonParsed: result.json !== undefined, schemaValid: validation.schemaValid,
    validationPath: validation.validationPath, normalized: validation.normalized, repaired: validation.repaired
    });
  } catch {
    // A diagnostics write must never turn a valid model result into a failed generation.
  }
}

function retryMessage(error: string): LLMMessage {
  return {
    role: "user",
    content: `The previous JSON output failed validation: ${error}. Regenerate the full response as valid JSON only. Preserve all requested detail; do not summarize or shorten fields.`
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
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: "你是 AdDirector AI 的资深商业广告导演。严格执行当前阶段，只输出完整合法 JSON；保持字段细节与连续性约束，不摘要、不省略、不用占位语句。若输出空间紧张，优先保留完整结构和可执行导演细节。"
    },
    { role: "user", content: prompt }
  ];
  const secret = await resolveProviderSecret("deepseek", context?.sessionId ?? "");
  if (!secret.value) return failureResponse(model, Date.now() - startedAt, "DeepSeek尚未配置。" );
  const timeoutMs = Math.max(5_000, Math.min(runtime.timeoutMs, context?.providerTimeoutMs ?? runtime.timeoutMs));
  const maxAttempts = Math.max(1, Math.min(runtime.maxRetries + 1, context?.maxProviderAttempts ?? runtime.maxRetries + 1));
  const client = createDeepSeekClient({ apiKey: secret.value, baseUrl: runtime.baseUrl, model, timeoutMs });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await client.call({
      model,
      messages,
      responseFormat: "json",
      temperature: options?.temperature ?? 0.4,
      maxTokens: Math.min(options?.maxTokens ?? 2600, runtime.maxOutputTokens)
    });

    tokenUsage = addTokenUsage(tokenUsage, result.tokenUsage);

    if (!result.success) {
      await reportModelCall(context, result, attempt + 1);
      lastError = result.error ?? "DeepSeek LLM call failed.";
      if (isOutputTruncated(lastError)) break;
      messages.push(retryMessage(lastError));
      continue;
    }

    const parsed = schema.safeParse(result.json);
    await reportModelCall(context, result, attempt + 1, parsed.success
      ? { schemaValid: true }
      : { success: false, error: parsed.error.message, schemaValid: false, validationPath: parsed.error.issues[0]?.path.join(".") });

    if (parsed.success) {
      return successResponse(parsed.data, model, Date.now() - startedAt, tokenUsage);
    }

    lastError = parsed.error.message;
    messages.push(retryMessage(lastError));
  }

  return failureResponse(model, Date.now() - startedAt, lastError, tokenUsage);
}

type StoryboardChunkResponse = RealTextProviderResponse<StoryboardShot[]> & { normalizationWarnings?: string[] };

async function callStoryboardChunk(
  prompt: string,
  shotDurationPlan: number[],
  shotIndexOffset: number,
  context?: ProviderRequestContext
): Promise<StoryboardChunkResponse> {
  const startedAt = Date.now();
  const runtime = getDeepSeekRuntimeConfig();
  const model = runtime.model;
  const secret = await resolveProviderSecret("deepseek", context?.sessionId ?? "");
  if (!secret.value) return failureResponse(model, Date.now() - startedAt, "DeepSeek尚未配置。");
  const timeoutMs = Math.max(5_000, Math.min(runtime.timeoutMs, context?.providerTimeoutMs ?? runtime.timeoutMs));
  const client = createDeepSeekClient({ apiKey: secret.value, baseUrl: runtime.baseUrl, model, timeoutMs });
  const first = await client.call({
    model,
    messages: [
      { role: "system", content: "你是 AdDirector AI 的文字分镜导演。严格遵守正式 JSON 契约，只输出合法 JSON，不创造字段。" },
      { role: "user", content: prompt }
    ],
    responseFormat: "json",
    temperature: 0.42,
    maxTokens: Math.min(TEXT_OUTPUT_BUDGETS.storyboardChunk, runtime.maxOutputTokens)
  });
  let tokenUsage = first.tokenUsage;
  if (!first.success) {
    await reportModelCall(context, first, 1);
    return failureResponse(model, Date.now() - startedAt, first.error ?? "DeepSeek 文字分镜调用失败。", tokenUsage);
  }

  const normalized = normalizeStoryboardOutput(first.json);
  const rawShots = storyboardEnvelopeShots(normalized.value, shotDurationPlan.length);
  if (!rawShots || rawShots.length !== shotDurationPlan.length) {
    await reportModelCall(context, first, 1, { success: false, error: "分镜段数量与计划不一致", schemaValid: false, validationPath: "shots.length" });
    return failureResponse(model, Date.now() - startedAt, "MODEL_SCHEMA_DRIFT：模型返回的分镜段数量与正式契约不一致。", tokenUsage);
  }

  const firstInvalid = rawShots.map((shot, index) => parseStoryboardShot(shot, shotIndexOffset + index + 1, shotDurationPlan[index]!))
    .find((parsed) => !parsed.success);
  await reportModelCall(context, first, 1, {
    success: !firstInvalid,
    ...(!firstInvalid || firstInvalid.success ? {} : { error: firstInvalid.error.message }),
    schemaValid: !firstInvalid,
    normalized: normalized.warnings.length > 0,
    ...(firstInvalid && !firstInvalid.success ? { validationPath: firstInvalid.error.issues[0]?.path.join(".") } : {})
  });

  const warnings = normalized.warnings.map((warning) => `${warning.path}：${warning.alias} 已归一化为 ${warning.canonical}`);
  const shots: StoryboardShot[] = [];
  for (let localIndex = 0; localIndex < rawShots.length; localIndex += 1) {
    const globalIndex = shotIndexOffset + localIndex + 1;
    const durationSec = shotDurationPlan[localIndex]!;
    const initial = parseStoryboardShot(rawShots[localIndex], globalIndex, durationSec);
    if (initial.success) {
      shots.push(initial.data);
      continue;
    }

    const diagnostic = storyboardValidationDiagnostic(initial.error, globalIndex);
    await context?.onStoryboardRepair?.({ shotIndex: globalIndex, location: diagnostic.location, unknownFields: diagnostic.unknownFields });
    const repaired = await client.call({
      model,
      messages: [
        { role: "system", content: "你只修复 JSON 结构。不得改变、删减或概括原分镜内容，只输出合法 JSON。" },
        { role: "user", content: buildStoryboardRepairPrompt(rawShots[localIndex], diagnostic.technicalSummary) }
      ],
      responseFormat: "json",
      temperature: 0.1,
      maxTokens: Math.min(TEXT_OUTPUT_BUDGETS.storyboardChunk, runtime.maxOutputTokens)
    });
    tokenUsage = addTokenUsage(tokenUsage, repaired.tokenUsage);
    if (!repaired.success) {
      await reportModelCall(context, repaired, 1, { repaired: true });
      return failureResponse(model, Date.now() - startedAt, repaired.error ?? "MODEL_SCHEMA_DRIFT：单镜头结构修复失败。", tokenUsage);
    }
    const repairValue = repaired.json && typeof repaired.json === "object" && !Array.isArray(repaired.json) && "shot" in repaired.json
      ? (repaired.json as { shot?: unknown }).shot
      : repaired.json;
    const repairNormalized = normalizeStoryboardOutput({ shots: [repairValue] });
    warnings.push(...repairNormalized.warnings.map((warning) => `第 ${globalIndex} 镜 ${warning.path}：${warning.alias} 已归一化为 ${warning.canonical}`));
    const repairedShot = storyboardEnvelopeShots(repairNormalized.value, 1)?.[0];
    const final = parseStoryboardShot(repairedShot, globalIndex, durationSec);
    await reportModelCall(context, repaired, 1, final.success
      ? { schemaValid: true, repaired: true, normalized: repairNormalized.warnings.length > 0 }
      : { success: false, error: final.error.message, schemaValid: false, repaired: true, validationPath: final.error.issues[0]?.path.join(".") });
    if (!final.success) {
      const reason = storyboardValidationDiagnostic(final.error, globalIndex).technicalSummary;
      return failureResponse(model, Date.now() - startedAt, `MODEL_SCHEMA_DRIFT：第 ${globalIndex} 镜自动修复后仍未通过：${reason.slice(0, 500)}`, tokenUsage);
    }
    shots.push(final.data);
  }

  return { ...successResponse(shots, model, Date.now() - startedAt, tokenUsage), normalizationWarnings: warnings };
}

function storyboardEnvelopeShots(value: unknown, expectedShotCount: number): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const shots = (value as { shots?: unknown }).shots;
  if (Array.isArray(shots)) return shots;
  if (expectedShotCount !== 1) return null;
  const shot = (value as { shot?: unknown }).shot;
  if (shot && typeof shot === "object" && !Array.isArray(shot)) return [shot];
  return "goal" in value && "visualDescription" in value ? [value] : null;
}

function parseStoryboardShot(value: unknown, index: number, durationSec: number) {
  const plannedValue = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value, index, durationSec }
    : value;
  const parsed = storyboardStructureShotSchema.safeParse(plannedValue);
  return parsed.success
    ? { success: true as const, data: { ...parsed.data, index, durationSec } as StoryboardShot }
    : { success: false as const, error: parsed.error };
}

function storyboardValidationDiagnostic(error: z.ZodError, shotIndex: number) {
  const unknownFields = error.issues.flatMap((issue) => issue.code === "unrecognized_keys" ? issue.keys : []);
  const first = error.issues[0];
  const location = `第 ${shotIndex} 个镜头${first?.path.length ? ` → ${first.path.map(chinesePathSegment).join(" → ")}` : ""}`;
  const technicalSummary = error.issues.map((issue) => `${issue.path.join(".") || "镜头"}: ${issue.message}`).join("；");
  return { unknownFields: Array.from(new Set(unknownFields)), location, technicalSummary };
}

function chinesePathSegment(segment: string | number) {
  if (typeof segment === "number") return `第 ${segment + 1} 项`;
  return ({ sceneStateBefore: "场景开始状态", sceneStateAfter: "场景结束状态", characterStates: "人物状态", productStates: "产品状态", microBeats: "动作节拍" } as Record<string, string>)[segment] ?? segment;
}

export const deepseekProvider = {
  provider: "deepseek",

  async generateStrategy(brief: ProductBrief, context?: ProviderRequestContext): Promise<RealTextProviderResponse<AdStrategy>> {
    return callAndValidate(buildStrategyPrompt(brief, context), adStrategySchema, {
      temperature: 0.35,
      maxTokens: TEXT_OUTPUT_BUDGETS.strategy
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
    const startedAt = Date.now();
    const model = getDeepSeekRuntimeConfig().model;
    const generated: StoryboardShot[] = (context?.resumeStoryboardShots ?? [])
      .filter((shot) => shot.index >= 1 && shot.index <= timeline.shotCount)
      .map((shot) => ({ ...shot, durationSec: timeline.shotDurationPlan[shot.index - 1]! }))
      .sort((left, right) => left.index - right.index);
    let tokenUsage: LLMTokenUsage | undefined;
    let lastError = "分镜生成失败，请稍后重试。";

    const generateChunk = async (shotIndexOffset: number, shotDurationPlan: number[], splitRetry = false, singleRetry = false): Promise<boolean> => {
      const prompt = buildStoryboardChunkPrompt(brief, strategy, {
        shotDurationPlan,
        shotIndexOffset,
        totalShotCount: timeline.shotCount,
        totalDurationSec: timeline.totalDurationSec,
        productVisualSpec: context?.productVisualSpec,
        previousShot: generated.find((shot) => shot.index === shotIndexOffset)
      });
      const response = await callStoryboardChunk(
        singleRetry ? `${prompt}\n上次单镜头结构校验未通过，请重新输出完整的单镜头 JSON，不省略必填字段。校验位置：${lastError.slice(0, 500)}` : prompt,
        shotDurationPlan,
        shotIndexOffset,
        { ...context, modelCallPass: "B", modelCallMode: singleRetry ? "storyboard-single-retry" : splitRetry ? "storyboard-split" : "storyboard-chunk", modelCallShotId: shotDurationPlan.length === 1 ? `镜头 ${shotIndexOffset + 1}` : undefined, modelCallChunkIndex: shotIndexOffset + 1 }
      );
      tokenUsage = addTokenUsage(tokenUsage, response.tokenUsage);
      if (response.success && response.data) {
        const normalized = applyProductLockRules(response.data, context?.productVisualSpec);
        generated.push(...normalized);
        await context?.onStoryboardChunk?.(normalized, {
          completed: generated.length,
          total: timeline.shotCount,
          splitRetry,
          normalizationWarnings: response.normalizationWarnings ?? []
        });
        return true;
      }

      lastError = response.error ?? lastError;
      if ((isOutputTruncated(lastError) || isStoryboardSchemaDrift(lastError)) && shotDurationPlan.length > 1) {
        const midpoint = Math.ceil(shotDurationPlan.length / 2);
        return await generateChunk(shotIndexOffset, shotDurationPlan.slice(0, midpoint), true)
          && await generateChunk(shotIndexOffset + midpoint, shotDurationPlan.slice(midpoint), true);
      }
      if (isStoryboardSchemaDrift(lastError) && shotDurationPlan.length === 1 && !singleRetry) {
        return generateChunk(shotIndexOffset, shotDurationPlan, true, true);
      }
      return false;
    };

    for (let offset = 0; offset < timeline.shotCount;) {
      if (generated.some((shot) => shot.index === offset + 1)) {
        offset += 1;
        continue;
      }
      const start = offset;
      const durations: number[] = [];
      while (offset < timeline.shotCount && durations.length < 2 && !generated.some((shot) => shot.index === offset + 1)) {
        durations.push(timeline.shotDurationPlan[offset]!);
        offset += 1;
      }
      const completed = await generateChunk(start, durations);
      if (!completed) return failureResponse(model, Date.now() - startedAt, lastError, tokenUsage);
    }

    const storyboard = mergeStoryboardChunks(ensureStoryboardArchitecture(applyProductLockRules(
      generated.sort((left, right) => left.index - right.index),
      context?.productVisualSpec
    )));
    const globalValidation = validateStoryboardGlobalConstraints(storyboard, timeline.shotCount, timeline.totalDurationSec, timeline.shotDurationPlan);
    if (!globalValidation.valid) {
      return failureResponse(model, Date.now() - startedAt, `MODEL_SCHEMA_DRIFT：${globalValidation.issues.join("；")}`, tokenUsage);
    }
    const continuity = validateStateContinuity(storyboard);
    if (!continuity.valid) {
      return failureResponse(model, Date.now() - startedAt, `MODEL_STATE_CONTINUITY：${continuity.issues.join("；")}`, tokenUsage);
    }
    return successResponse(storyboard, model, Date.now() - startedAt, tokenUsage);
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
    const startedAt = Date.now();
    const model = getDeepSeekRuntimeConfig().model;
    const generated: StoryboardShot[] = [];
    let tokenUsage: LLMTokenUsage | undefined;
    for (const shot of shots) {
      const response = await callAndValidate(
        buildPromptGenerationPrompt(brief, strategy, [shot], context?.productVisualSpec),
        createShotsPayloadSchema([shot.durationSec]),
        { temperature: 0.35, maxTokens: TEXT_OUTPUT_BUDGETS.promptExpansion },
        context
      );
      tokenUsage = addTokenUsage(tokenUsage, response.tokenUsage);
      if (!response.success || !response.data) {
        return failureResponse(model, Date.now() - startedAt, `镜头 ${shot.index} 提示词扩写失败：${response.error ?? "生成失败"}`, tokenUsage);
      }
      generated.push(response.data[0]!);
    }
    return successResponse(ensureStoryboardArchitecture(applyProductLockRules(generated, context?.productVisualSpec)), model, Date.now() - startedAt, tokenUsage);
  },

  async scoreAdPlan(
    brief: ProductBrief,
    strategy: AdStrategy,
    shots: StoryboardShot[],
    context?: ProviderRequestContext
  ): Promise<RealTextProviderResponse<AdScoreResult>> {
    return callAndValidate(buildAdScorePrompt(brief, strategy, shots), adScoreSchema, {
      temperature: 0.2,
      maxTokens: TEXT_OUTPUT_BUDGETS.scoring
    }, context);
  }
} satisfies TextProvider;

export async function generateNarrationPlan(
  brief: ProductBrief,
  strategy: AdStrategy,
  shots: StoryboardShot[],
  context?: ProviderRequestContext
): Promise<RealTextProviderResponse<NarrationPlan>> {
  const evidence = { productName: brief.productName, sellingPoints: brief.sellingPoints, verifiedClaims: brief.verifiedClaims ?? [], coreMessage: strategy.coreMessage, cta: strategy.cta };
  const prompt = `你是广告旁白导演。只输出合法 JSON。为 ${brief.durationSec} 秒广告生成 Partial Narration。
必须输出 mode="partial"，只安排 2-4 个 beats；必须包含开场 problem 和最后一镜 brand-payoff。中间多数镜头保持无旁白。
每个 beat 必须绑定真实 shotId，text 简短自然，maxDurationSec 不得超过该镜头 durationSec-0.4，subtitleEnabled=true。
旁白只能使用以下事实，不得发明功效数字、折扣、认证、价格、医学作用或排名：${JSON.stringify(evidence)}
Ending brand-payoff 必须动态使用产品名“${brief.productName}”，不得写死其他品牌。字幕与 TTS 均直接使用 beat.text；只有确需缩写时才提供不改变含义的 displayText。
镜头：${JSON.stringify(shots.map((shot) => ({ id: shot.id, index: shot.index, durationSec: shot.durationSec, goal: shot.goal, visualDescription: shot.visualDescription })))}
返回结构：{"mode":"partial","beats":[{"id":"narration-1","shotId":"shot-id","role":"problem|transition|benefit|brand-payoff|cta","text":"短句","tone":"语气","maxDurationSec":2.5,"subtitleEnabled":true}]}`;
  const response = await callAndValidate(prompt, partialNarrationSchema, { temperature: 0.25, maxTokens: TEXT_OUTPUT_BUDGETS.narration }, context);
  if (!response.success || !response.data) return response;
  return { ...response, data: normalizeNarrationPlan(response.data, brief, strategy, shots) };
}

function isOutputTruncated(error: string) {
  return error.includes("DEEPSEEK_OUTPUT_TRUNCATED");
}

function isStoryboardSchemaDrift(error: string) {
  return error.includes("MODEL_SCHEMA_DRIFT");
}

export async function generateCharacterAnchorBriefs(
  brief: ProductBrief,
  creativeBible: CreativeBible,
  defaults: CharacterAnchorBrief[],
  context?: ProviderRequestContext
): Promise<RealTextProviderResponse<CharacterAnchorBrief[]>> {
  if (defaults.length === 0) {
    return successResponse([], getDeepSeekRuntimeConfig().model, 0, undefined);
  }
  const schema = z.array(characterAnchorBriefSchema).length(defaults.length);
  const response = await callAndValidate(
    `你是广告选角导演。只输出合法 JSON 数组。根据已锁定的 Creative Direction，为每个 required character 生成可执行的 Character Brief。
必须保持输入 id 和 role，不得增加或删除人物。Identity 与 State 必须分离：年龄观感、脸部、发型、发色、肤色、服装、配饰和体型属于不可变身份；疲惫、恢复、清醒等只写入 states。
每个 states 项必须说明只改变表情、姿态或能量，不得改变人物身份、发型或服装。不得使用明星、IP 角色、品牌文字或可读文字。
商品：${brief.productName}
Creative Bible：${JSON.stringify(creativeBible)}
Required Characters：${JSON.stringify(defaults)}
返回与 Required Characters 等长的数组，字段严格为 id, role, apparentAgeRange, faceAppearance, hairstyle, hairColor, skinTone, wardrobe, accessories, bodyBuild, immutableTraits, states。`,
    schema,
    { temperature: 0.3, maxTokens: Math.min(TEXT_OUTPUT_BUDGETS.visualDirection, Math.max(1000, defaults.length * 850)) },
    context
  );
  if (!response.success || !response.data) return response;
  return {
    ...response,
    data: response.data.map((generated, index) => ({
      ...generated,
      id: defaults[index]!.id,
      role: defaults[index]!.role
    }))
  };
}

export async function generateCharacterCandidateDirections(
  brief: CharacterAnchorBrief,
  context?: ProviderRequestContext
): Promise<RealTextProviderResponse<CharacterCandidateDirection[]>> {
  return callAndValidate(
    `你是商业广告选角导演。只输出合法 JSON 数组，严格生成 3 个差异明显、都能承担同一角色功能的人物候选方向。
三案必须在脸型骨相、五官识别点、年龄质感、发型轮廓、服装气质和身体语言上可一眼区分；不得只替换同义词，不得改变角色、性别表达或剧情功能。每案都要易于跨镜头保持身份一致。按商业适配度与连续性稳定性从高到低排序，第一项是系统推荐。
人物简报：${JSON.stringify(brief)}
每项字段严格为 title, castingPositioning, ageTexture, faceStructure, facialFeatures, hairstyle, wardrobeMood, bodyLanguage, differentiation, continuityStability, recommendationReason。全部使用中文。`,
    z.array(characterCandidateDirectionSchema).length(3),
    { temperature: 0.72, maxTokens: TEXT_OUTPUT_BUDGETS.visualDirection },
    { ...context, maxProviderAttempts: 1 }
  );
}

export async function generateSceneCandidateDirections(
  spec: SceneVisualSpec,
  context?: ProviderRequestContext
): Promise<RealTextProviderResponse<SceneCandidateDirection[]>> {
  return callAndValidate(
    `你是商业广告场景设计导演。只输出合法 JSON 数组，严格生成 3 个差异明显、都服务同一叙事功能的空间方案。
三案必须在空间拓扑、机位入口、前中后景关系、主导材质、核心道具布局和光线组织上可一眼区分；不得仅更换装饰色，不得改变场景身份和必要功能。每案都要适合跨镜头连续拍摄。按商业适配度与连续性稳定性从高到低排序，第一项是系统推荐。
场景设定：${JSON.stringify(spec)}
每项字段严格为 title, spatialConcept, cameraPosition, depthStructure, dominantMaterials, heroPropArrangement, lightingDesign, differentiation, continuityStability, recommendationReason。全部使用中文。`,
    z.array(sceneCandidateDirectionSchema).length(3),
    { temperature: 0.72, maxTokens: TEXT_OUTPUT_BUDGETS.visualDirection },
    { ...context, maxProviderAttempts: 1 }
  );
}

export async function generateCreativeDirectionSet(
  brief: ProductBrief,
  constraints: ProjectPlanningConstraints,
  context?: ProviderRequestContext
): Promise<RealTextProviderResponse<CreativeDirectionSetPayload>> {
  const initial = await callAndValidate(
    buildCreativeDirectionsPrompt(brief, constraints),
    creativeDirectionSetPayloadSchema,
    { temperature: 0.72, maxTokens: TEXT_OUTPUT_BUDGETS.creativeDirections },
    { ...context, maxProviderAttempts: 2 }
  );
  if (!initial.success || !initial.data) return initial;

  const quality = validateCreativeDirectionSetQuality(initial.data.candidates, brief);
  if (quality.valid) return initial;

  const deepened = await callAndValidate(
    buildDeepenCreativeDirectionsPrompt(brief, constraints, initial.data, quality.issues),
    creativeDirectionSetPayloadSchema,
    { temperature: 0.55, maxTokens: TEXT_OUTPUT_BUDGETS.creativeDirections },
    { ...context, maxProviderAttempts: 1 }
  );
  return deepened.success && deepened.data ? deepened : initial;
}

export async function expandShotPrompts(
  input: ShotPromptExpansionInput,
  context?: ProviderRequestContext
): Promise<RealTextProviderResponse<DetailedShotPromptPackage>> {
  const startedAt = Date.now();
  const model = getDeepSeekRuntimeConfig().model;
  let tokenUsage: LLMTokenUsage | undefined;
  const foundationSchema = detailedShotPromptFoundationSchema.superRefine((value, refinement) => {
    if (value.shotId !== input.shot.id) refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["shotId"], message: "SHOT_ID_MISMATCH" });
    if (!/[0-9]+(?:\.[0-9]+)?s/i.test(value.videoPromptCn) || !/Start State|开始状态/i.test(value.videoPromptCn) || !/End State|结束状态/i.test(value.videoPromptCn)) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["videoPromptCn"], message: "VIDEO_TIMELINE_REQUIRED" });
    }
  });
  let foundationData = context?.resumeShotPromptDraft?.foundation;
  if (!foundationData) {
    const foundation = await callPromptSegment(
      buildShotPromptFoundationPrompt(input),
      buildShotPromptFoundationPrompt(input, true),
      foundationSchema,
      TEXT_OUTPUT_BUDGETS.shotPromptFoundation,
      { ...context, modelCallPass: "C", modelCallShotId: input.shot.id, modelCallMode: "foundation" }
    );
    tokenUsage = addTokenUsage(tokenUsage, foundation.tokenUsage);
    if (!foundation.success || !foundation.data) {
      return failureResponse(model, Date.now() - startedAt, foundation.error ?? "镜头导演基础信息生成失败。", tokenUsage);
    }
    foundationData = foundation.data;
    await context?.onShotPromptFoundation?.(foundationData);
  }

  const shot = ensureShotArchitecture(input.shot);
  const frames = shot.frames ?? [];
  const validFrameIds = new Set(frames.map((frame) => frame.id));
  const framePrompts: DetailedShotPromptPackage["framePrompts"] = (context?.resumeShotPromptDraft?.framePrompts ?? [])
    .filter((frame) => validFrameIds.has(frame.frameId));
  const completedFrameIds = new Set(framePrompts.map((frame) => frame.frameId));
  const pendingFrames = frames.filter((frame) => !completedFrameIds.has(frame.id));
  for (let frameOffset = 0; frameOffset < pendingFrames.length; frameOffset += 2) {
    const frameBatch = pendingFrames.slice(frameOffset, frameOffset + 2);
    const results = await Promise.all(frameBatch.map(async (frame) => {
      const frameSchema = detailedFramePromptSchema.superRefine((value, refinement) => {
        if (value.frameId !== frame.id || value.timestampSec !== frame.timestampSec || value.role !== frame.role) {
          refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["frameId"], message: "FRAME_IDENTITY_MISMATCH" });
        }
        if (!["单一完整", "可读文字"].every((term) => value.imagePromptCn.includes(term))) {
          refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["imagePromptCn"], message: "PROMPT_SAFETY_CONSTRAINT_MISSING" });
        }
      });
      return {
        frame,
        result: await callPromptSegment(
          buildSingleFramePromptExpansionPrompt(input, frame, foundationData),
          buildSingleFramePromptExpansionPrompt(input, frame, foundationData, true),
          frameSchema,
          TEXT_OUTPUT_BUDGETS.shotPromptFrame,
          { ...context, modelCallPass: "C", modelCallShotId: input.shot.id, modelCallFrameId: frame.id, modelCallMode: "frame" }
        )
      };
    }));
    let batchError: string | undefined;
    for (const { frame, result } of results) {
      tokenUsage = addTokenUsage(tokenUsage, result.tokenUsage);
      if (!result.success || !result.data) {
        batchError ??= result.error ?? `第 ${frame.index + 1} 帧提示词生成失败。`;
        continue;
      }
      framePrompts.push(result.data);
      await context?.onShotPromptFrame?.(result.data);
    }
    if (batchError) return failureResponse(model, Date.now() - startedAt, batchError, tokenUsage);
  }

  const orderedFramePrompts = frames.map((frame) => framePrompts.find((item) => item.frameId === frame.id)).filter((frame): frame is DetailedShotPromptPackage["framePrompts"][number] => Boolean(frame));
  const assembled = detailedShotPromptPackageSchema.safeParse({ ...foundationData, framePrompts: orderedFramePrompts });
  if (!assembled.success) {
    return failureResponse(model, Date.now() - startedAt, `MODEL_SCHEMA_DRIFT：${assembled.error.message}`, tokenUsage);
  }
  const concreteTerms = ["机位", "焦段", "前景", "中景", "背景", "主光", "材质", "产品"];
  if (concreteTerms.filter((term) => assembled.data.directingNotesCn.includes(term) || assembled.data.framePrompts.some((frame) => frame.imagePromptCn.includes(term))).length < 6) {
    return failureResponse(model, Date.now() - startedAt, "VAGUE_PROMPT：缺少可执行摄影信息。", tokenUsage);
  }
  return successResponse(assembled.data, model, Date.now() - startedAt, tokenUsage);
}

async function callPromptSegment<TData>(
  prompt: string,
  compactPrompt: string,
  schema: z.ZodType<TData>,
  maxTokens: number,
  context?: ProviderRequestContext
) {
  const first = await callAndValidate(prompt, schema, { temperature: 0.3, maxTokens }, { ...context, maxProviderAttempts: 1 });
  if (first.success || !shouldCompactRetry(first.error)) return first;
  const retry = await callAndValidate(compactPrompt, schema, { temperature: 0.2, maxTokens }, { ...context, maxProviderAttempts: 1, modelCallMode: `${context?.modelCallMode ?? "prompt"}-compact-retry` });
  return { ...retry, tokenUsage: addTokenUsage(first.tokenUsage, retry.tokenUsage) };
}

function shouldCompactRetry(error?: string | null) {
  if (!error) return false;
  if (isOutputTruncated(error)) return true;
  return !/DEEPSEEK_(?:AUTH_FAILED|QUOTA_EXHAUSTED|RATE_LIMITED|NETWORK_ERROR|TIMEOUT|UPSTREAM_ERROR)/.test(error);
}

export async function shortenNarration(
  text: string,
  maxDurationSec: number,
  brief: ProductBrief,
  context?: ProviderRequestContext
) {
  return callAndValidate(
    `只输出 JSON。将旁白缩短到自然朗读不超过 ${maxDurationSec.toFixed(1)} 秒。保持原意，不添加原文和广告需求之外的事实、数字、价格、折扣、认证、医学作用或排名。商品：${brief.productName}。原文：${text}\n返回 {"text":"缩短后的旁白"}`,
    shortenedNarrationSchema,
    { temperature: 0.15, maxTokens: TEXT_OUTPUT_BUDGETS.copyShortening },
    context
  );
}

function applyProductLockRules(shots: StoryboardShot[], spec?: ProductVisualSpec) {
  return shots.map((rawShot) => {
    const shot = repairShotProductTerminology(rawShot, spec);
    const containsProduct = shotContainsProduct(shot);
    const productShotType = containsProduct ? inferProductShotType(shot, shots.length) : "not-visible" as const;
    return {
      ...shot,
      containsProduct,
      productFidelityMode: containsProduct ? "exact" as const : "not-visible" as const,
      productShotType,
      exactProductShot: productShotType === "packshot",
      referenceImageAssetIds: containsProduct && spec
        ? Array.from(new Set([spec.sourceAssetId, ...(shot.referenceImageAssetIds ?? [])]))
        : shot.referenceImageAssetIds
    };
  });
}

function normalizeNarrationPlan(plan: NarrationPlan, brief: ProductBrief, strategy: AdStrategy, shots: StoryboardShot[]): NarrationPlan {
  const shotById = new Map(shots.map((shot) => [shot.id, shot]));
  const validBeats = plan.beats.filter((beat) => shotById.has(beat.shotId)).slice(0, 4).map((beat) => ({
    ...beat,
    maxDurationSec: Math.max(0.8, Math.min(beat.maxDurationSec, (shotById.get(beat.shotId)?.durationSec ?? 3) - 0.4)),
    subtitleEnabled: beat.subtitleEnabled !== false
  }));
  const ending = shots.at(-1)!;
  const withoutPayoff = validBeats.filter((beat) => beat.role !== "brand-payoff");
  const payoff = validBeats.find((beat) => beat.role === "brand-payoff");
  const brandPayoff = {
    ...(payoff ?? { id: "narration-brand-payoff", role: "brand-payoff" as const, tone: "清晰坚定", subtitleEnabled: true }),
    shotId: ending.id,
    text: payoff?.text.includes(brief.productName) ? payoff.text : `${brief.productName}，${strategy.cta}`,
    maxDurationSec: Math.max(0.8, ending.durationSec - 0.4),
    subtitleEnabled: true
  };
  return narrationPlanSchema.parse({ mode: "partial", beats: [...withoutPayoff.slice(0, 3), brandPayoff] });
}




