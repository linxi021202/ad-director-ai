import { z } from "zod";

export const platformSchema = z.enum(["douyin", "xiaohongshu", "ecommerce"]);
export const aspectRatioSchema = z.enum(["9:16", "1:1", "16:9"]);
export const productImageRoleSchema = z.enum(["main-product", "logo", "reference"]);
export const productImageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["image/png", "image/jpeg", "image/webp"]),
  size: z.number().int().positive().max(5 * 1024 * 1024),
  localUrl: z.string().optional(),
  previewUrl: z.string().optional(),
  remoteUrl: z.string().optional(),
  url: z.string().optional(),
  role: productImageRoleSchema
});

export const productBriefSchema = z.object({
  productName: z.string().min(1),
  category: z.string().min(1),
  sellingPoints: z.array(z.string().min(1)).min(1),
  targetAudience: z.string().min(1),
  platform: platformSchema,
  style: z.string().min(1),
  aspectRatio: aspectRatioSchema,
  durationSec: z.number().int().positive(),
  productImages: z.array(productImageSchema).max(3).optional()
});

export const adStrategySchema = z.object({
  audienceInsight: z.string().min(1),
  painPoint: z.string().min(1),
  coreMessage: z.string().min(1),
  emotionalHook: z.string().min(1),
  bigIdea: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  cta: z.string().min(1)
});

export const storyboardShotSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().positive(),
  durationSec: z.number().int().positive(),
  goal: z.string().min(1),
  visualDescription: z.string().min(1),
  cameraAngle: z.string().min(1),
  cameraMovement: z.string().min(1),
  subtitle: z.string().min(1),
  imagePromptCn: z.string().min(1),
  imagePromptEn: z.string().min(1),
  videoPromptCn: z.string().min(1),
  recommendedModel: z.string().min(1),
  fallbackPlan: z.string().min(1)
});

export const taskTypeSchema = z.enum([
  "strategy",
  "storyboard",
  "prompt",
  "scoring",
  "copywriting",
  "image",
  "video",
  "tts",
  "render"
]);

export const modelRouteSchema = z.object({
  taskType: taskTypeSchema,
  primaryModel: z.string().min(1),
  backupModel: z.string().min(1),
  reason: z.string().min(1),
  estimatedCost: z.number().nonnegative(),
  estimatedLatency: z.string().min(1),
  fallbackMode: z.string().min(1)
});

export const generationStatusSchema = z.enum([
  "draft",
  "ready",
  "generating",
  "completed",
  "failed",
  "fallback"
]);

export const assetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["image", "video", "audio", "render", "subtitle"]),
  name: z.string().min(1),
  url: z.string().min(1),
  status: z.enum(["mock", "pending", "ready", "failed"])
});

export const costModeEstimateSchema = z.object({
  mode: z.enum(["lowCost", "qualityFirst"]),
  label: z.string().min(1),
  minCny: z.number().nonnegative(),
  maxCny: z.number().nonnegative(),
  explanation: z.string().min(1)
});

export const generationProjectSchema = z.object({
  id: z.string().min(1),
  brief: productBriefSchema,
  strategy: adStrategySchema,
  shots: z.array(storyboardShotSchema).min(1),
  modelRoutes: z.array(modelRouteSchema).min(1),
  costEstimates: z.array(costModeEstimateSchema).min(1),
  heroShotId: z.string().min(1).default("shot-3"),
  status: generationStatusSchema,
  assets: z.array(assetSchema),
  finalVideoUrl: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type Platform = z.infer<typeof platformSchema>;
export type AspectRatio = z.infer<typeof aspectRatioSchema>;
export type ProductImageRole = z.infer<typeof productImageRoleSchema>;
export type ProductImage = z.infer<typeof productImageSchema>;
export type ProductBrief = z.infer<typeof productBriefSchema>;
export type AdStrategy = z.infer<typeof adStrategySchema>;
export type StoryboardShot = z.infer<typeof storyboardShotSchema>;
export type TaskType = z.infer<typeof taskTypeSchema>;
export type ModelRoute = z.infer<typeof modelRouteSchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type CostModeEstimate = z.infer<typeof costModeEstimateSchema>;
export type GenerationProject = z.infer<typeof generationProjectSchema>;

export type PromptSet = {
  imagePrompt: string;
  videoPrompt: string;
  reasoning: string;
};

export type CostEstimate = {
  totalCny: number;
  items: Array<{
    name: string;
    costCny: number;
  }>;
};

export type GenerationStep = {
  name: string;
  status: "done" | "running" | "pending" | "fallback";
  description: string;
};

export type VideoPreviewState = {
  title: string;
  description: string;
  aspectRatio: "9:16";
  durationSec: number;
};

