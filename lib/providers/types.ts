import type { LLMTokenUsage } from "../llm/types";
import type { QwenImageCacheStatus } from "../image/types";
import type {
  AdStrategy,
  DetailedFramePrompt,
  DetailedShotPromptDraft,
  DetailedShotPromptFoundation,
  GenerationProject,
  ProductBrief,
  ProductImage,
  ProductVisualSpec,
  StoryboardShot,
  TaskType
} from "../schemas/project";

export type CostMode = "lowCost" | "qualityFirst";
export type QualityMode = "standard" | "highQuality";

export type ProviderResponse<TData> = {
  success: boolean;
  data: TData | null;
  provider: string;
  model: string;
  costEstimate: number;
  latencyEstimate: string;
  error: string | null;
};

export type RealTextProviderResponse<TData> = {
  success: boolean;
  data: TData | null;
  provider: "deepseek";
  model: string;
  latencyMs: number;
  tokenUsage?: LLMTokenUsage;
  costEstimate?: string;
  fallbackUsed: false;
  error?: string | null;
};

export type TextProviderResponse<TData> = ProviderResponse<TData> | RealTextProviderResponse<TData>;

export type ImageGenerationOptions = {
  aspectRatio: "9:16" | "1:1" | "16:9";
  hasChineseText?: boolean;
  costMode?: CostMode;
  qualityMode?: QualityMode;
  sessionId?: string;
  productImage?: ProductImage;
  productImages?: ProductImage[];
  continuityImageAssetId?: string;
  masterReferenceAssetIds?: string[];
  masterReferenceAssetIdsByShot?: Record<string, string[]>;
  productVisualSpec?: ProductVisualSpec;
  onModelAttempt?: (attempt: {
    model: string; attempt: number; status: "completed" | "failed" | "blocked";
    startedAt: number; completedAt: number; errorCode?: string; error?: string;
    providerErrorCode?: string; httpStatus?: number; requestId?: string; taskId?: string;
    referenceCount: number; size: string; assetId?: string; mode: string;
    promptExtend: boolean; watermark: boolean;
  }) => Promise<void>;
};

export type VideoGenerationOptions = {
  aspectRatio: "9:16" | "1:1" | "16:9";
  durationSec: number;
  costMode: CostMode;
  qualityMode?: QualityMode;
  isHeroShot?: boolean;
};

export type TTSGenerationOptions = {
  voice: string;
  speed?: number;
};

export type RenderOptions = {
  aspectRatio: "9:16" | "1:1" | "16:9";
  durationSec: number;
  fallbackMode?: boolean;
};

export type ImageGenerationResult = {
  imageUrl: string;
  prompt: string;
};

export type ShotImageGenerationResult = {
  shotId: string;
  frameId?: string;
  imageUrl: string;
  assetId?: string;
  localUrl?: string;
  prompt: string;
  provider: string;
  model: string;
  latencyMs: number;
  requestId?: string;
  size: string;
  cacheStatus: QwenImageCacheStatus;
  fallbackUsed: boolean;
  fallbackReason?: string;
  costEstimate?: string;
  referenceUsed?: boolean;
  errorCode?: string;
  error?: string | null;
};

export type VideoGenerationResult = {
  taskId: string;
  videoUrl: string;
  status: "queued" | "running" | "completed" | "failed" | "not-implemented";
};

export type HeroVideoFromImageInput = {
  imageUrl: string;
  heroImageAssetId?: string;
  lastImageAssetId?: string;
  productImages?: ProductImage[];
  prompt: string;
  durationSec: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
  projectId?: string;
  shotId?: string;
  sessionId?: string;
  assetBaseUrl?: string;
};

export type ReservedVideoProviderResponse = {
  success: false;
  provider: "happyhorse" | "wan";
  capability: "api-available" | "manual-import" | "not-configured";
  apiAvailable: boolean;
  manualImportAvailable: boolean;
  status: "ready" | "blocked" | "waiting-manual-import";
  error: string;
};

export type TTSGenerationResult = {
  audioUrl: string;
  text: string;
};

export type RenderResult = {
  videoUrl: string;
  fallbackVideoUrl?: string;
};

export type OptimizedCopy = Array<{
  shotId: string;
  subtitle: string;
}>;

export type ProviderModelSelection = {
  taskType: TaskType;
  provider: string;
  model: string;
  backupModel: string;
  reason: string;
  costEstimate: number;
  latencyEstimate: string;
  fallbackMode: string;
};

export type ProviderRouterInput = {
  taskType: TaskType;
  costMode?: CostMode;
  qualityMode?: QualityMode;
  hasChineseText?: boolean;
  isHeroShot?: boolean;
};

export type ProviderRequestContext = {
  sessionId?: string;
  modelCallPass?: "A" | "B" | "C" | "D";
  modelCallShotId?: string;
  modelCallFrameId?: string;
  modelCallMode?: string;
  modelCallChunkIndex?: number;
  onModelCall?: (details: {
    pass?: "A" | "B" | "C" | "D";
    shotId?: string;
    frameId?: string;
    chunkIndex?: number;
    attempt: number;
    mode?: string;
    model: string;
    latencyMs: number;
    success: boolean;
    error?: string;
    errorCode?: string;
    providerErrorCode?: string;
    httpStatus?: number;
    providerRequestId?: string;
    inputTokens?: number;
    outputTokens?: number;
    outputLength?: number;
    finishReason?: string;
    jsonParsed: boolean;
    schemaValid?: boolean;
    normalized?: boolean;
    repaired?: boolean;
    validationPath?: string;
    validationIssues?: Array<{ path: string; code: string; message: string }>;
    requestOptions?: { temperature?: number; maxTokens?: number; responseFormat?: "json" | "text"; thinking?: string };
  }) => Promise<void>;
  requestedShotCount?: number;
  targetDurationSec?: number;
  shotDurationPlan?: number[];
  providerTimeoutMs?: number;
  maxProviderAttempts?: number;
  productVisualSpec?: ProductVisualSpec;
  resumeStoryboardShots?: StoryboardShot[];
  onStoryboardChunk?: (shots: StoryboardShot[], progress: { completed: number; total: number; splitRetry: boolean; normalizationWarnings: string[] }) => Promise<void>;
  onStoryboardRepair?: (details: { shotIndex: number; location: string; unknownFields: string[] }) => Promise<void>;
  resumeShotPromptDraft?: DetailedShotPromptDraft;
  onShotPromptFoundation?: (foundation: DetailedShotPromptFoundation) => Promise<void>;
  onShotPromptFrame?: (frame: DetailedFramePrompt) => Promise<void>;
};

export type TextProvider = {
  provider: string;
  generateStrategy: (brief: ProductBrief, context?: ProviderRequestContext) => Promise<TextProviderResponse<AdStrategy>>;
  generateStoryboard: (
    brief: ProductBrief,
    strategy: AdStrategy,
    context?: ProviderRequestContext
  ) => Promise<TextProviderResponse<StoryboardShot[]>>;
  optimizeCopy: (storyboard: StoryboardShot[]) => Promise<TextProviderResponse<OptimizedCopy>>;
  generatePrompts?: (
    brief: ProductBrief,
    strategy: AdStrategy,
    shots: StoryboardShot[],
    context?: ProviderRequestContext
  ) => Promise<TextProviderResponse<StoryboardShot[]>>;
  scoreAdPlan?: (
    brief: ProductBrief,
    strategy: AdStrategy,
    shots: StoryboardShot[],
    context?: ProviderRequestContext
  ) => Promise<TextProviderResponse<unknown>>;
};

export type ImageProvider = {
  provider: string;
  generateImage: (
    prompt: string,
    options: ImageGenerationOptions
  ) => Promise<ProviderResponse<ImageGenerationResult>>;
  generateShotImage?: (
    projectId: string,
    shot: StoryboardShot,
    options?: ImageGenerationOptions
  ) => Promise<ShotImageGenerationResult>;
  generateBatchShotImages?: (
    projectId: string,
    shots: StoryboardShot[],
    options?: ImageGenerationOptions
  ) => Promise<ShotImageGenerationResult[]>;
};

export type VideoProvider = {
  provider: string;
  generateVideo: (
    prompt: string,
    imageUrl: string,
    options: VideoGenerationOptions
  ) => Promise<ProviderResponse<VideoGenerationResult>>;
  generateHeroVideoFromImage?: (input: HeroVideoFromImageInput) => Promise<
    ReservedVideoProviderResponse
    | import("../video/types").HappyHorseVideoResult
    | import("../video/types").WanVideoResult
  >;
};

export type TTSProvider = {
  provider: string;
  synthesizeSpeech: (
    text: string,
    options: TTSGenerationOptions
  ) => Promise<ProviderResponse<TTSGenerationResult>>;
};

export type RenderProvider = {
  provider: string;
  renderVideo: (
    project: GenerationProject,
    options: RenderOptions
  ) => Promise<ProviderResponse<RenderResult>>;
};







