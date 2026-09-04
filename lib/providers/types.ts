import type { LLMTokenUsage } from "../llm/types";
import type { QwenImageCacheStatus } from "../image/types";
import type {
  AdStrategy,
  GenerationProject,
  ProductBrief,
  ProductImage,
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
  productImages?: ProductImage[];
  prompt: string;
  durationSec: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
  projectId?: string;
  shotId?: string;
  sessionId?: string;
};

export type ReservedVideoProviderResponse = {
  success: false;
  provider: "happyhorse";
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
  requestedShotCount?: number;
  targetDurationSec?: number;
  shotDurationPlan?: number[];
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
  generateHeroVideoFromImage?: (input: HeroVideoFromImageInput) => Promise<ReservedVideoProviderResponse | import("../video/types").HappyHorseVideoResult>;
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







