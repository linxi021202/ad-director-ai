import { z } from "zod";
import { DEFAULT_SHOT_DURATION_SEC, MAX_SHOT_COUNT, MAX_SHOT_DURATION_SEC, MAX_TARGET_DURATION_SEC, MIN_SHOT_COUNT, MIN_SHOT_DURATION_SEC, MIN_TARGET_DURATION_SEC } from "../video/shotConfig";

export const platformSchema = z.enum(["douyin", "xiaohongshu", "ecommerce"]);
export const aspectRatioSchema = z.enum(["9:16", "1:1", "16:9"]);
export const productImageRoleSchema = z.enum(["main-product", "logo", "reference"]);
export const productImageSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().uuid().optional(),
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
  productImages: z.array(productImageSchema).max(3).optional(),
  verifiedClaims: z.array(z.string().trim().min(1).max(160)).max(20).optional()
});

export const commercialStructureSchema = z.object({
  hook: z.string().min(1),
  problem: z.string().min(1).optional(),
  productReveal: z.string().min(1),
  benefit: z.string().min(1),
  proof: z.string().min(1).optional(),
  emotionalPayoff: z.string().min(1),
  cta: z.string().min(1)
}).strict();

export const adStrategySchema = z.object({
  audienceInsight: z.string().min(1),
  painPoint: z.string().min(1),
  coreMessage: z.string().min(1),
  emotionalHook: z.string().min(1),
  bigIdea: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  cta: z.string().min(1),
  emotionalArc: z.string().min(1).optional(),
  narrativeArc: z.string().min(1).optional(),
  visualMetaphor: z.string().min(1).optional(),
  visualStyle: z.string().min(1).optional(),
  cameraLanguage: z.string().min(1).optional(),
  pacing: z.string().min(1).optional(),
  productImportance: z.enum(["hero", "strong", "supporting"]).optional(),
  commercialStructure: commercialStructureSchema.optional(),
  forbiddenConcepts: z.array(z.string().min(1)).max(30).optional()
});

export const creativeBibleSchema = z.object({
  bigIdea: z.string().min(1),
  audienceInsight: z.string().min(1),
  brandPromise: z.string().min(1),
  emotionalArc: z.string().min(1),
  narrativeArc: z.string().min(1),
  visualMetaphor: z.string().min(1),
  visualStyle: z.string().min(1),
  cameraLanguage: z.string().min(1),
  pacing: z.string().min(1),
  productImportance: z.enum(["hero", "strong", "supporting"]),
  commercialStructure: commercialStructureSchema,
  forbiddenConcepts: z.array(z.string().min(1)).max(30)
}).strict();

const referenceAssetIdsSchema = z.array(z.string().uuid()).max(12);

export const characterIdentitySchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  ageRange: z.string().min(1),
  genderPresentation: z.string().min(1).optional(),
  faceDescription: z.string().min(1),
  hairstyle: z.string().min(1),
  hairColor: z.string().min(1),
  skinTone: z.string().min(1),
  wardrobe: z.array(z.string().min(1)).max(12),
  accessories: z.array(z.string().min(1)).max(12),
  bodyBuild: z.string().min(1),
  referenceAssetIds: referenceAssetIdsSchema,
  immutableTraits: z.array(z.string().min(1)).min(1).max(20),
  allowedChanges: z.array(z.string().min(1)).max(20)
}).strict();

export const productIdentitySchema = z.object({
  id: z.string().min(1),
  referenceAssetIds: referenceAssetIdsSchema,
  geometry: z.string().min(1),
  proportions: z.string().min(1),
  dominantColors: z.array(z.string().min(1)).min(1).max(12),
  materials: z.array(z.string().min(1)).min(1).max(12),
  capShape: z.string().min(1).optional(),
  labelRegion: z.string().min(1).optional(),
  immutableTraits: z.array(z.string().min(1)).min(1).max(20),
  readablePackagingTextPolicy: z.enum(["preserve-original-only", "blank-generated-label"])
}).strict();

export const sceneIdentitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  architecture: z.string().min(1),
  furniture: z.array(z.string().min(1)).max(20),
  heroProps: z.array(z.string().min(1)).max(20),
  timeOfDay: z.string().min(1),
  lightingDirection: z.string().min(1),
  lightingQuality: z.string().min(1),
  palette: z.array(z.string().min(1)).min(1).max(12),
  referenceAssetIds: referenceAssetIdsSchema,
  immutableTraits: z.array(z.string().min(1)).min(1).max(20),
  allowedChanges: z.array(z.string().min(1)).max(20)
}).strict();

export const continuityGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shotIds: z.array(z.string().min(1)).min(1).max(MAX_SHOT_COUNT),
  characterIds: z.array(z.string().min(1)).max(12),
  productIds: z.array(z.string().min(1)).max(12),
  sceneId: z.string().min(1).optional(),
  immutableTraits: z.array(z.string().min(1)).min(1).max(30)
}).strict();

const characterSceneStateSchema = z.object({
  characterId: z.string().min(1),
  position: z.string().min(1).optional(),
  pose: z.string().min(1).optional(),
  holding: z.string().min(1).optional(),
  holdingHand: z.enum(["left", "right"]).optional(),
  wardrobeState: z.string().min(1).optional()
}).strict();

const productSceneStateSchema = z.object({
  productId: z.string().min(1),
  position: z.string().min(1).optional(),
  orientation: z.string().min(1).optional(),
  opened: z.boolean().optional(),
  liquidLevel: z.string().min(1).optional()
}).strict();

const propSceneStateSchema = z.object({
  propId: z.string().min(1),
  position: z.string().min(1).optional(),
  state: z.string().min(1).optional()
}).strict();

export const sceneStateSchema = z.object({
  shotId: z.string().min(1),
  characterStates: z.array(characterSceneStateSchema).max(12),
  productStates: z.array(productSceneStateSchema).max(12),
  propStates: z.array(propSceneStateSchema).max(20)
}).strict();

export const visualContinuityBibleSchema = z.object({
  characters: z.array(characterIdentitySchema).max(12),
  products: z.array(productIdentitySchema).min(1).max(12),
  scenes: z.array(sceneIdentitySchema).min(1).max(MAX_SHOT_COUNT),
  wardrobeRules: z.array(z.string().min(1)).max(20),
  propRules: z.array(z.string().min(1)).max(20),
  colorPalette: z.array(z.string().min(1)).min(1).max(12),
  lightingRules: z.array(z.string().min(1)).max(20),
  cameraRules: z.array(z.string().min(1)).max(20),
  continuityGroups: z.array(continuityGroupSchema).min(1).max(MAX_SHOT_COUNT),
  forbiddenVisualChanges: z.array(z.string().min(1)).min(1).max(30),
  textRenderingPolicy: z.object({
    generatedReadableTextAllowed: z.literal(false),
    brandTextViaRemotion: z.literal(true),
    subtitleViaRemotion: z.literal(true),
    ctaViaRemotion: z.literal(true),
    numericContentViaRemotion: z.literal(true)
  }).strict()
}).strict();

export const referencePackSchema = z.object({
  productMasters: referenceAssetIdsSchema,
  characterMasters: referenceAssetIdsSchema,
  sceneMasters: referenceAssetIdsSchema,
  continuityAnchors: z.array(z.object({
    continuityGroupId: z.string().min(1),
    assetIds: referenceAssetIdsSchema
  }).strict()).max(MAX_SHOT_COUNT)
}).strict();

export const shotGenerationModeSchema = z.enum(["r2v", "i2v", "first-last-frame", "continuation", "remotion-motion"]);
export const textSafeZoneSchema = z.enum(["top-left", "top-center", "bottom-left", "none"]);

export const storyboardShotSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().positive(),
  durationSec: z.number().int().min(MIN_SHOT_DURATION_SEC).max(MAX_SHOT_DURATION_SEC).default(DEFAULT_SHOT_DURATION_SEC),
  goal: z.string().min(1),
  visualDescription: z.string().min(1),
  cameraAngle: z.string().min(1),
  cameraMovement: z.string().min(1),
  subtitle: z.string().min(1),
  imagePromptCn: z.string().min(1),
  imagePromptEn: z.string().min(1),
  videoPromptCn: z.string().min(1),
  videoPromptEn: z.string().min(1).optional(),
  negativePromptCn: z.string().min(1).optional(),
  negativePromptEn: z.string().min(1).optional(),
  recommendedModel: z.string().min(1),
  fallbackPlan: z.string().min(1),
  sceneGroupId: z.string().min(1).optional(),
  continuityGroupId: z.string().min(1).optional(),
  generationMode: shotGenerationModeSchema.optional(),
  characterIds: z.array(z.string().min(1)).max(12).optional(),
  productIds: z.array(z.string().min(1)).max(12).optional(),
  sceneId: z.string().min(1).optional(),
  referenceImageAssetIds: referenceAssetIdsSchema.optional(),
  referenceVideoAssetIds: referenceAssetIdsSchema.optional(),
  sceneStateBefore: sceneStateSchema.optional(),
  sceneStateAfter: sceneStateSchema.optional(),
  continuityConstraints: z.array(z.string().min(1)).min(1).max(30).optional(),
  shotDirection: z.array(z.string().min(1)).min(1).max(20).optional(),
  motionComplexityScore: z.number().int().min(0).max(10).optional(),
  textSafeZone: textSafeZoneSchema.optional()
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

export const briefStatusSchema = z.enum(["draft", "saved"]);

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

export const workflowStepStatusSchema = z.enum([
  "idle",
  "pending",
  "running",
  "completed",
  "failed",
  "fallback",
  "blocked"
]);

export const workflowStepsSchema = z.object({
  brief: workflowStepStatusSchema,
  strategy: workflowStepStatusSchema,
  storyboard: workflowStepStatusSchema,
  keyframes: workflowStepStatusSchema,
  heroShot: workflowStepStatusSchema,
  render: workflowStepStatusSchema
}).strict();

export const generationStageSchema = z.enum([
  "brief",
  "strategy",
  "storyboard",
  "prompts",
  "keyframes",
  "hero-shot",
  "narration",
  "composition"
]);

export const generationProviderSchema = z.enum([
  "system",
  "deepseek",
  "qwen-image",
  "happyhorse",
  "remotion"
]);

export const generationEventStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "fallback",
  "cancelled",
  "blocked",
  "interrupted"
]);

export const generationEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  projectId: z.string().min(1),
  stage: generationStageSchema,
  provider: generationProviderSchema,
  action: z.string().trim().min(1).max(120),
  status: generationEventStatusSchema,
  message: z.string().trim().min(1).max(500),
  shotId: z.string().min(1).optional(),
  progressCurrent: z.number().int().nonnegative().optional(),
  progressTotal: z.number().int().positive().optional(),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  errorCode: z.string().min(1).max(80).optional()
}).strict();
export const projectPromptSchema = z.object({
  shotId: z.string().min(1),
  imagePromptCn: z.string().min(1),
  imagePromptEn: z.string().min(1),
  videoPromptCn: z.string().min(1)
}).strict();

export const keyframeMetadataSchema = z.object({
  shotId: z.string().min(1),
  assetId: z.string().uuid().optional(),
  imageUrl: z.string().min(1).optional(),
  localUrl: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  latencyMs: z.number().nonnegative().optional(),
  requestId: z.string().min(1).optional(),
  cacheStatus: z.string().min(1).optional(),
  fallbackUsed: z.boolean().default(false),
  fallbackReason: z.string().min(1).optional(),
  status: z.enum(["pending", "ready", "failed", "fallback"]).default("pending"),
  storageTransition: z.enum(["LOCAL_PUBLIC_ASSET_TRANSITION", "PRIVATE_ASSET_V1"])
}).strict();

export const heroVideoMetadataSchema = z.object({
  shotId: z.string().min(1),
  assetId: z.string().uuid().optional(),
  source: z.string().min(1),
  status: z.string().min(1),
  url: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationSec: z.number().positive().optional(),
  aspectRatio: aspectRatioSchema.optional(),
  storageTransition: z.enum(["LOCAL_PUBLIC_ASSET_TRANSITION", "PRIVATE_ASSET_V1"])
}).strict();

export const finalVideoMetadataSchema = z.object({
  status: z.string().min(1),
  assetId: z.string().uuid().optional(),
  url: z.string().min(1).optional(),
  progress: z.number().min(0).max(1).optional(),
  fileName: z.string().min(1).optional(),
  durationSec: z.number().positive().optional(),
  storageTransition: z.enum(["LOCAL_PUBLIC_ASSET_TRANSITION", "PRIVATE_ASSET_V1"])
}).strict();

export const generationProjectSchema = z.object({
  id: z.string().min(1),
  shotCount: z.number().int().min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT).optional(),
  targetDurationSec: z.number().int().min(MIN_TARGET_DURATION_SEC).max(MAX_TARGET_DURATION_SEC).optional(),
  briefStatus: briefStatusSchema.optional(),
  briefSavedAt: z.number().int().nonnegative().optional(),
  briefRevision: z.number().int().nonnegative().optional(),
  brief: productBriefSchema,
  strategy: adStrategySchema,
  creativeBible: creativeBibleSchema.optional(),
  visualContinuityBible: visualContinuityBibleSchema.optional(),
  referencePack: referencePackSchema.optional(),
  shots: z.array(storyboardShotSchema).min(1),
  modelRoutes: z.array(modelRouteSchema).min(1),
  costEstimates: z.array(costModeEstimateSchema).min(1),
  heroShotId: z.string().min(1).optional(),
  status: generationStatusSchema,
  assets: z.array(assetSchema),
  finalVideoUrl: z.string().min(1).nullable(),
  prompts: z.array(projectPromptSchema).optional(),
  aspectRatio: aspectRatioSchema.optional(),
  durationSec: z.number().int().positive().optional(),
  platform: platformSchema.optional(),
  workflowSteps: workflowStepsSchema.optional(),
  keyframes: z.array(keyframeMetadataSchema).optional(),
  heroVideo: heroVideoMetadataSchema.optional(),
  finalVideo: finalVideoMetadataSchema.optional(),
  narrationAssetId: z.string().uuid().optional(),
  backgroundMusicAssetId: z.string().uuid().optional(),
  finalVideoAssetId: z.string().uuid().optional(),
  generationEvents: z.array(generationEventSchema).max(200).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict().superRefine((project, context) => {
  if (project.shotCount !== undefined && project.shots.length !== project.shotCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["shots"],
      message: "镜头数组长度必须与 shotCount 一致。"
    });
  }
});

export type Platform = z.infer<typeof platformSchema>;
export type AspectRatio = z.infer<typeof aspectRatioSchema>;
export type ProductImageRole = z.infer<typeof productImageRoleSchema>;
export type ProductImage = z.infer<typeof productImageSchema>;
export type ProductBrief = z.infer<typeof productBriefSchema>;
export type AdStrategy = z.infer<typeof adStrategySchema>;
export type CreativeBible = z.infer<typeof creativeBibleSchema>;
export type CharacterIdentity = z.infer<typeof characterIdentitySchema>;
export type ProductIdentity = z.infer<typeof productIdentitySchema>;
export type SceneIdentity = z.infer<typeof sceneIdentitySchema>;
export type ContinuityGroup = z.infer<typeof continuityGroupSchema>;
export type SceneState = z.infer<typeof sceneStateSchema>;
export type VisualContinuityBible = z.infer<typeof visualContinuityBibleSchema>;
export type ReferencePack = z.infer<typeof referencePackSchema>;
export type ShotGenerationMode = z.infer<typeof shotGenerationModeSchema>;
export type TextSafeZone = z.infer<typeof textSafeZoneSchema>;
export type StoryboardShot = z.infer<typeof storyboardShotSchema>;
export type TaskType = z.infer<typeof taskTypeSchema>;
export type ModelRoute = z.infer<typeof modelRouteSchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type BriefStatus = z.infer<typeof briefStatusSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type CostModeEstimate = z.infer<typeof costModeEstimateSchema>;
export type WorkflowStepStatus = z.infer<typeof workflowStepStatusSchema>;
export type WorkflowSteps = z.infer<typeof workflowStepsSchema>;
export type GenerationStage = z.infer<typeof generationStageSchema>;
export type GenerationProvider = z.infer<typeof generationProviderSchema>;
export type GenerationEventStatus = z.infer<typeof generationEventStatusSchema>;
export type GenerationEvent = z.infer<typeof generationEventSchema>;
export type ProjectPrompt = z.infer<typeof projectPromptSchema>;
export type KeyframeMetadata = z.infer<typeof keyframeMetadataSchema>;
export type HeroVideoMetadata = z.infer<typeof heroVideoMetadataSchema>;
export type FinalVideoMetadata = z.infer<typeof finalVideoMetadataSchema>;
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
