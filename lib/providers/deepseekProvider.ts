import { z } from "zod";

import { getDeepSeekRuntimeConfig } from "../config/ai";
import { createDeepSeekClient } from "../llm/deepseekClient";
import { resolveProviderSecret } from "../secrets/resolver";
import { estimateDeepSeekCost } from "../llm/costEstimate";
import type { LLMMessage, LLMTokenUsage } from "../llm/types";
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
import { ensureStoryboardArchitecture } from "../storyboard/shotArchitecture";
import { buildCreativeDirectionsPrompt, buildDeepenCreativeDirectionsPrompt, validateCreativeDirectionSetQuality } from "../creative/creativeDirections";
import { buildShotPromptExpansionPrompt, type ShotPromptExpansionInput } from "../prompts/detailedDirectorPrompts";
import {
  creativeDirectionSetPayloadSchema,
  detailedShotPromptPackageSchema,
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

function createStoryboardChunkSchema(shotDurationPlan: number[], shotIndexOffset: number): z.ZodType<StoryboardShot[]> {
  return z.preprocess((value) => value && typeof value === "object" && !Array.isArray(value) && "shots" in value
    ? (value as { shots?: unknown }).shots
    : value,
  z.array(storyboardStructureShotSchema).length(shotDurationPlan.length).transform((shots) => shots.map((shot, index) => ({
    ...shot,
    index: shotIndexOffset + index + 1,
    durationSec: shotDurationPlan[index]!
  })))) as z.ZodType<StoryboardShot[]>;
}

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
      lastError = result.error ?? "DeepSeek LLM call failed.";
      if (isOutputTruncated(lastError)) break;
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
    const generated: StoryboardShot[] = [];
    let tokenUsage: LLMTokenUsage | undefined;
    let lastError = "分镜生成失败，请稍后重试。";

    const generateChunk = async (shotIndexOffset: number, shotDurationPlan: number[], splitRetry = false): Promise<boolean> => {
      const response = await callAndValidate(
        buildStoryboardChunkPrompt(brief, strategy, {
          shotDurationPlan,
          shotIndexOffset,
          totalShotCount: timeline.shotCount,
          totalDurationSec: timeline.totalDurationSec,
          productVisualSpec: context?.productVisualSpec,
          previousShot: generated.at(-1)
        }),
        createStoryboardChunkSchema(shotDurationPlan, shotIndexOffset),
        { temperature: 0.42, maxTokens: TEXT_OUTPUT_BUDGETS.storyboardChunk },
        context
      );
      tokenUsage = addTokenUsage(tokenUsage, response.tokenUsage);
      if (response.success && response.data) {
        const normalized = applyProductLockRules(response.data, context?.productVisualSpec);
        generated.push(...normalized);
        await context?.onStoryboardChunk?.(normalized, {
          completed: generated.length,
          total: timeline.shotCount,
          splitRetry
        });
        return true;
      }

      lastError = response.error ?? lastError;
      if (isOutputTruncated(lastError) && shotDurationPlan.length > 1) {
        const midpoint = Math.ceil(shotDurationPlan.length / 2);
        return await generateChunk(shotIndexOffset, shotDurationPlan.slice(0, midpoint), true)
          && await generateChunk(shotIndexOffset + midpoint, shotDurationPlan.slice(midpoint), true);
      }
      return false;
    };

    for (let offset = 0; offset < timeline.shotCount; offset += 4) {
      const completed = await generateChunk(offset, timeline.shotDurationPlan.slice(offset, offset + 4));
      if (!completed) return failureResponse(model, Date.now() - startedAt, lastError, tokenUsage);
    }

    const storyboard = ensureStoryboardArchitecture(applyProductLockRules(
      generated.sort((left, right) => left.index - right.index),
      context?.productVisualSpec
    ));
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
  const schema = detailedShotPromptPackageSchema.superRefine((value, refinement) => {
    if (value.shotId !== input.shot.id) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["shotId"], message: "SHOT_ID_MISMATCH" });
    }
    const requiredCn = ["单一完整", "可读文字"];
    for (const frame of value.framePrompts) {
      if (frame.imagePromptCn.length < 400 || requiredCn.some((term) => !frame.imagePromptCn.includes(term))) {
        refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["framePrompts"], message: "PROMPT_DEPTH_VALIDATION_FAILED：图片提示词缺少单帧或零文字硬约束。" });
      }
    }
    const concreteTerms = ["机位", "焦段", "前景", "中景", "背景", "主光", "材质", "产品"];
    if (concreteTerms.filter((term) => value.directingNotesCn.includes(term) || value.framePrompts.some((frame) => frame.imagePromptCn.includes(term))).length < 6) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["directingNotesCn"], message: "VAGUE_PROMPT：缺少可执行摄影信息。" });
    }
    if (!/[0-9]+(?:\.[0-9]+)?s/i.test(value.videoPromptCn) || !/Start State|开始状态/i.test(value.videoPromptCn) || !/End State|结束状态/i.test(value.videoPromptCn)) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: ["videoPromptCn"], message: "VIDEO_TIMELINE_REQUIRED" });
    }
  });
  return callAndValidate(
    buildShotPromptExpansionPrompt(input),
    schema,
    { temperature: 0.35, maxTokens: TEXT_OUTPUT_BUDGETS.shotPromptExpansion },
    { ...context, maxProviderAttempts: 2 }
  );
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




