import { getAIConfig } from "../config/ai";
import { resolveProviderApiKey } from "../secrets/resolver";
import { coldBrewDemo } from "../mock/coldBrewDemo";
import type { AdStrategy, ProductBrief, StoryboardShot, TaskType } from "../schemas/project";
import { deepseekProvider } from "./deepseekProvider";
import { mockImageProvider } from "./mockImageProvider";
import { mockTextProvider } from "./mockTextProvider";
import { qwenImageProvider, QWEN_IMAGE_PLACEHOLDER_URL } from "./qwenImageProvider";
import type { LLMTokenUsage } from "../llm/types";
import type {
  ImageGenerationOptions,
  ProviderModelSelection,
  ProviderResponse,
  ProviderRouterInput,
  ShotImageGenerationResult,
  TextProviderResponse,
  ProviderRequestContext
} from "./types";

export type TextRouteTaskType = "strategy" | "storyboard" | "prompt" | "scoring";

export type RoutedTextResult<TData> = {
  success: boolean;
  data: TData | null;
  provider: string;
  model: string;
  latencyMs: number;
  tokenUsage?: LLMTokenUsage;
  costEstimate?: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  error?: string | null;
};

export type RunTextTaskInput =
  | { taskType: "strategy"; brief: ProductBrief }
  | { taskType: "storyboard"; brief: ProductBrief; strategy: AdStrategy }
  | { taskType: "prompt"; brief: ProductBrief; strategy: AdStrategy; shots: StoryboardShot[] }
  | { taskType: "scoring"; brief: ProductBrief; strategy: AdStrategy; shots: StoryboardShot[] };

function getEnvFlag(name: string): boolean {
  return process.env[name] === "true";
}

function getDeepSeekModel(): string {
  return process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";
}

function getQwenImageModel(): string {
  return process.env.QWEN_IMAGE_MODEL || "qwen-image";
}

function getQwenImageSize(): string {
  return process.env.QWEN_IMAGE_SIZE || "1152*2048";
}

function shouldUseRealText(): boolean {
  return process.env.AI_MODE === "real" && getEnvFlag("ENABLE_REAL_TEXT");
}

function shouldUseRealImage(): boolean {
  return process.env.AI_MODE === "real" && getEnvFlag("ENABLE_REAL_IMAGE");
}

function isMockMode(): boolean {
  return process.env.AI_MODE !== "real";
}

function textRoute(taskType: ProviderRouterInput["taskType"]): ProviderModelSelection {
  const realText = shouldUseRealText();

  return {
    taskType,
    provider: realText ? "deepseek" : "mockTextProvider",
    model: realText ? getDeepSeekModel() : "coldBrewDemo",
    backupModel: "mockTextProvider",
    reason: realText
      ? "AI_MODE=real and ENABLE_REAL_TEXT=true. Text generation is handled by DeepSeek; mock fallback is available."
      : "AI_MODE=mock. Text generation uses coldBrewDemo through mockTextProvider.",
    costEstimate: realText ? 0.6 : 0,
    latencyEstimate: realText ? "real text call" : "mock",
    fallbackMode: "If DeepSeek fails, providerRouter falls back to mockTextProvider with fallbackUsed=true."
  };
}

function imageRoute(): ProviderModelSelection {
  const realImage = shouldUseRealImage();

  return {
    taskType: "image",
    provider: realImage ? "qwenImageProvider" : "mockImageProvider",
    model: realImage ? getQwenImageModel() : "mock-keyframe-placeholder",
    backupModel: QWEN_IMAGE_PLACEHOLDER_URL,
    reason: realImage
      ? "AI_MODE=real and ENABLE_REAL_IMAGE=true. Qwen-Image generates keyframes through the server-side provider."
      : "Real image generation is disabled. Keyframes use mockImageProvider placeholders for the MVP demo.",
    costEstimate: realImage ? 4.8 : 0,
    latencyEstimate: realImage ? "real image call" : "mock",
    fallbackMode: "If Qwen-Image fails, providerRouter returns a placeholder keyframe with fallbackUsed=true."
  };
}

export function selectProviderModel(input: ProviderRouterInput): ProviderModelSelection {
  switch (input.taskType) {
    case "strategy":
    case "storyboard":
    case "prompt":
    case "scoring":
    case "copywriting":
      return textRoute(input.taskType);
    case "image":
      return imageRoute();
    case "video": {
      return {
        taskType: "video",
        provider: "wan",
        model: process.env.WAN_VIDEO_MODEL || "wan2.7-i2v",
        backupModel: "qwen-image + remotion-motion",
        reason: "Wan 2.7 I2V 通过百炼接收一张已融合真实产品的完整关键帧，并与 Qwen-Image 共用当前会话的 DashScope API Key。",
        costEstimate: 12,
        latencyEstimate: "provider-async",
        fallbackMode: "If Wan 2.7 video is unavailable, use Qwen-Image keyframes plus Remotion image motion."
      };
    }
    case "tts":
      return {
        taskType: "tts",
        provider: "not-in-mvp",
        model: "subtitle-only",
        backupModel: "subtitle-only",
        reason: "TTS is not part of the third-stage MVP main route.",
        costEstimate: 0,
        latencyEstimate: "not used",
        fallbackMode: "Show subtitles only."
      };
    case "render":
      return {
        taskType: "render",
        provider: "planned",
        model: "remotion",
        backupModel: "static-mock-renderer",
        reason: "Stage 4 does not perform real rendering. Remotion is a Stage 5 planned composition node only.",
        costEstimate: 1.4,
        latencyEstimate: "planned",
        fallbackMode: "Return static preview or image-motion fallback video."
      };
    default: {
      const exhaustiveCheck: never = input.taskType;
      return exhaustiveCheck;
    }
  }
}

function fromLegacyResponse<TData>(response: ProviderResponse<TData>, fallback?: string): RoutedTextResult<TData> {
  return {
    success: response.success,
    data: response.data,
    provider: response.provider,
    model: response.model,
    latencyMs: 0,
    costEstimate: `estimated ¥${response.costEstimate.toFixed(2)}`,
    fallbackUsed: Boolean(fallback),
    fallbackReason: fallback,
    error: response.error
  };
}

function fromTextResponse<TData>(response: TextProviderResponse<TData>): RoutedTextResult<TData> {
  if ("latencyMs" in response) {
    return {
      success: response.success,
      data: response.data,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      tokenUsage: response.tokenUsage,
      costEstimate: response.costEstimate,
      fallbackUsed: response.fallbackUsed,
      error: response.error
    };
  }

  return fromLegacyResponse(response);
}

async function runMockTextTask(input: RunTextTaskInput, fallbackReason?: string, context?: ProviderRequestContext): Promise<RoutedTextResult<unknown>> {
  switch (input.taskType) {
    case "strategy":
      return { ...fromTextResponse(await mockTextProvider.generateStrategy(input.brief, context)), fallbackUsed: Boolean(fallbackReason), fallbackReason };
    case "storyboard":
      return { ...fromTextResponse(await mockTextProvider.generateStoryboard(input.brief, input.strategy, context)), fallbackUsed: Boolean(fallbackReason), fallbackReason };
    case "prompt": {
      if (mockTextProvider.generatePrompts) {
        const response = await mockTextProvider.generatePrompts(input.brief, input.strategy, input.shots, context);
        return { ...fromTextResponse(response), fallbackUsed: Boolean(fallbackReason), fallbackReason };
      }

      return { ...fromTextResponse(await mockTextProvider.generateStoryboard(input.brief, input.strategy, context)), fallbackUsed: Boolean(fallbackReason), fallbackReason };
    }
    case "scoring": {
      if (mockTextProvider.scoreAdPlan) {
        const response = await mockTextProvider.scoreAdPlan(input.brief, input.strategy, input.shots, context);
        return { ...fromTextResponse(response), fallbackUsed: Boolean(fallbackReason), fallbackReason };
      }

      return {
        success: true,
        data: {
          overallScore: 86,
          summary: "Mock score from coldBrewDemo fallback.",
          fallbackReady: true,
          projectId: coldBrewDemo.id
        },
        provider: "mockTextProvider",
        model: "coldBrewDemo",
        latencyMs: 0,
        costEstimate: "estimated ¥0.00",
        fallbackUsed: Boolean(fallbackReason),
        fallbackReason,
        error: null
      };
    }
  }
}

async function runDeepSeekTextTask(input: RunTextTaskInput, context?: ProviderRequestContext): Promise<RoutedTextResult<unknown>> {
  switch (input.taskType) {
    case "strategy":
      return fromTextResponse(await (context ? deepseekProvider.generateStrategy(input.brief, context) : deepseekProvider.generateStrategy(input.brief)));
    case "storyboard":
      return fromTextResponse(await (context ? deepseekProvider.generateStoryboard(input.brief, input.strategy, context) : deepseekProvider.generateStoryboard(input.brief, input.strategy)));
    case "prompt":
      return fromTextResponse(await (context ? deepseekProvider.generatePrompts(input.brief, input.strategy, input.shots, context) : deepseekProvider.generatePrompts(input.brief, input.strategy, input.shots)));
    case "scoring":
      return fromTextResponse(await (context ? deepseekProvider.scoreAdPlan(input.brief, input.strategy, input.shots, context) : deepseekProvider.scoreAdPlan(input.brief, input.strategy, input.shots)));
  }
}

export async function runTextTask(input: RunTextTaskInput, context?: ProviderRequestContext): Promise<RoutedTextResult<unknown>> {
  if (isMockMode() || !shouldUseRealText()) {
    return runMockTextTask(input, undefined, context);
  }

  const resolvedKey = await resolveProviderApiKey("deepseek", context?.sessionId);
  if (!resolvedKey) {
    return runMockTextTask(input, "DeepSeek 真实文本调用不可用：未配置 DEEPSEEK_API_KEY。", context);
  }

  try {
    getAIConfig({ allowSessionSecrets: true });
  } catch (error) {
    return runMockTextTask(
      input,
      `DeepSeek 真实文本调用不可用，AI 配置无效：${
        error instanceof Error ? error.message : "unknown config error"
      }`
    , context);
  }

  const primary = await runDeepSeekTextTask(input, context);

  if (primary.success) {
    return primary;
  }

  return runMockTextTask(
    input,
    `DeepSeek ${textTaskLabel(input.taskType)}失败：${primary.error ?? "原因未知"}。已使用与当前商品简报和时间轴一致的本地模板继续。`
  , context);
}

function textTaskLabel(taskType: RunTextTaskInput["taskType"]) {
  return ({ strategy: "广告策略", storyboard: "分镜脚本", prompt: "提示词", scoring: "广告评分" } as const)[taskType];
}

function mockShotImageResult(shot: StoryboardShot, response: ProviderResponse<{ imageUrl: string; prompt: string }>): ShotImageGenerationResult {
  const imageUrl = mockShotPlaceholder(shot);

  return {
    shotId: shot.id,
    imageUrl,
    localUrl: imageUrl,
    prompt: response.data?.prompt || shot.imagePromptCn || shot.imagePromptEn,
    provider: "mockImageProvider",
    model: response.model,
    latencyMs: 0,
    size: getQwenImageSize(),
    cacheStatus: "not-requested",
    fallbackUsed: false,
    costEstimate: `estimated ¥${response.costEstimate.toFixed(2)}`,
    error: response.error
  };
}

function mockShotPlaceholder(shot: StoryboardShot): string {
  const colors = ["#1d4ed8", "#0891b2", "#7c3aed", "#0f766e"];
  const color = colors[(shot.index - 1) % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600" viewBox="0 0 900 1600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06101f"/><stop offset="0.48" stop-color="${color}"/><stop offset="1" stop-color="#171225"/></linearGradient></defs><rect width="900" height="1600" fill="url(#g)"/><circle cx="680" cy="360" r="240" fill="#ffffff" opacity="0.1"/><circle cx="190" cy="1180" r="220" fill="#67e8f9" opacity="0.14"/><rect x="84" y="1040" width="732" height="270" rx="48" fill="#030712" opacity="0.42"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function imageFallbackResult(shot: StoryboardShot, fallbackReason: string): ShotImageGenerationResult {
  return {
    shotId: shot.id,
    imageUrl: mockShotPlaceholder(shot),
    localUrl: mockShotPlaceholder(shot),
    prompt: shot.imagePromptCn || shot.imagePromptEn,
    provider: "placeholder",
    model: getQwenImageModel(),
    latencyMs: 0,
    size: getQwenImageSize(),
    cacheStatus: "not-requested",
    fallbackUsed: true,
    fallbackReason,
    costEstimate: "estimated ¥0.00",
    error: fallbackReason
  };
}

export async function generateShotImage(
  projectId: string,
  shot: StoryboardShot,
  options: ImageGenerationOptions = { aspectRatio: "9:16", hasChineseText: true }
): Promise<ShotImageGenerationResult> {
  if (shouldUseRealImage()) {
    try {
      if (!qwenImageProvider.generateShotImage) {
        return imageFallbackResult(shot, "qwenImageProvider.generateShotImage is unavailable. Used placeholder image fallback.");
      }

      return await qwenImageProvider.generateShotImage(projectId, shot, options);
    } catch (error) {
      return imageFallbackResult(
        shot,
        `Qwen-Image route failed unexpectedly: ${error instanceof Error ? error.message : "unknown error"}. Used placeholder image fallback.`
      );
    }
  }

  const response = await mockImageProvider.generateImage(shot.imagePromptCn || shot.imagePromptEn, options);
  return mockShotImageResult(shot, response);
}

export async function generateBatchShotImages(
  projectId: string,
  shots: StoryboardShot[],
  options: ImageGenerationOptions = { aspectRatio: "9:16", hasChineseText: true },
  onResult?: (result: ShotImageGenerationResult) => void | Promise<void>
): Promise<ShotImageGenerationResult[]> {
  const results: ShotImageGenerationResult[] = [];
  const previousAssetByGroup = new Map<string, string>();
  for (const shot of shots) {
    const groupId = shot.continuityGroupId ?? shot.sceneGroupId;
    const result = await generateShotImage(projectId, shot, {
      ...options,
      masterReferenceAssetIds: options.masterReferenceAssetIdsByShot?.[shot.id] ?? options.masterReferenceAssetIds,
      continuityImageAssetId: shouldUseRealImage() && groupId
        ? previousAssetByGroup.get(groupId) ?? options.continuityImageAssetId
        : undefined
    });
    results.push(result);
    if (groupId && result.assetId && !result.fallbackUsed) previousAssetByGroup.set(groupId, result.assetId);
    await onResult?.(result);
  }

  return results;
}

export async function generateStrategy(brief: ProductBrief, context?: ProviderRequestContext): Promise<RoutedTextResult<AdStrategy>> {
  return runTextTask({ taskType: "strategy", brief }, context) as Promise<RoutedTextResult<AdStrategy>>;
}

export async function generateStoryboard(
  brief: ProductBrief,
  strategy: AdStrategy,
  context?: ProviderRequestContext
): Promise<RoutedTextResult<StoryboardShot[]>> {
  return runTextTask({ taskType: "storyboard", brief, strategy }, context) as Promise<RoutedTextResult<StoryboardShot[]>>;
}

export async function generatePrompts(
  brief: ProductBrief,
  strategy: AdStrategy,
  shots: StoryboardShot[],
  context?: ProviderRequestContext
): Promise<RoutedTextResult<StoryboardShot[]>> {
  return runTextTask({ taskType: "prompt", brief, strategy, shots }, context) as Promise<RoutedTextResult<StoryboardShot[]>>;
}

export async function scoreAdPlan(
  brief: ProductBrief,
  strategy: AdStrategy,
  shots: StoryboardShot[],
  context?: ProviderRequestContext
): Promise<RoutedTextResult<unknown>> {
  return runTextTask({ taskType: "scoring", brief, strategy, shots }, context);
}






