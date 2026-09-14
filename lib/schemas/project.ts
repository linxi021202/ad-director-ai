import { z } from "zod";
import { DEFAULT_SHOT_DURATION_SEC, MAX_SHOT_COUNT, MAX_SHOT_DURATION_SEC, MAX_TARGET_DURATION_SEC, MIN_SHOT_COUNT, MIN_SHOT_DURATION_SEC, MIN_TARGET_DURATION_SEC } from "../video/shotConfig";

export const platformSchema = z.enum(["douyin", "xiaohongshu", "ecommerce"]);
export const aspectRatioSchema = z.enum(["9:16", "1:1", "16:9"]);
export const productImageRoleSchema = z.preprocess(
  (value) => value === "main" ? "main-product" : value,
  z.enum(["main-product", "logo", "reference"])
);
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
  role: productImageRoleSchema,
  multiViewWarning: z.boolean().optional()
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
  primaryProductAssetId: z.string().uuid().optional(),
  productAssetIds: z.array(z.string().uuid()).max(3).optional(),
  verifiedClaims: z.array(z.string().trim().min(1).max(160)).max(20).optional()
});

export const projectPlanningConstraintsSchema = z.object({
  shotCount: z.number().int().min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT),
  targetDurationSec: z.number().int().min(MIN_TARGET_DURATION_SEC).max(MAX_TARGET_DURATION_SEC),
  aspectRatio: aspectRatioSchema,
  platform: platformSchema
}).strict();

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

const creativeText = (minimum: number) => z.string().trim().min(minimum);

export const creativeDirectionSchema = z.object({
  id: z.string().min(1),
  title: creativeText(2).max(36),
  oneLineIdea: creativeText(6).max(120),
  audienceTension: creativeText(6),
  coreInsight: creativeText(6),
  bigIdea: creativeText(6),
  creativeMechanism: creativeText(6),
  visualMetaphor: creativeText(6),
  storyArc: creativeText(6),
  openingHook: creativeText(6),
  productEntrance: creativeText(6),
  visualHook: creativeText(6),
  productRole: creativeText(6),
  emotionalTurn: creativeText(6),
  heroMoment: creativeText(6),
  endingIdea: creativeText(6),
  visualStyle: creativeText(6),
  cameraLanguage: creativeText(6),
  pacingStrategy: creativeText(6),
  whyItWorks: creativeText(6),
  differenceFromBrief: creativeText(6),
  executionRisk: creativeText(4),
  continuityStrategy: creativeText(6)
}).strict();

const creativeDirectionSetBaseSchema = z.object({
  candidates: z.array(creativeDirectionSchema).length(3),
  recommendedCandidateId: z.string().min(1)
}).strict();

function validateCreativeDirectionSet(
  set: z.infer<typeof creativeDirectionSetBaseSchema>,
  context: z.RefinementCtx
) {
  if (!set.candidates.some((candidate) => candidate.id === set.recommendedCandidateId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["recommendedCandidateId"], message: "推荐项必须来自候选列表。" });
  }
}

export const creativeDirectionSetPayloadSchema = creativeDirectionSetBaseSchema.superRefine(validateCreativeDirectionSet);

export const creativeCandidateSetSchema = creativeDirectionSetBaseSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  selectedCandidateId: z.string().min(1).optional(),
  confirmedCandidateId: z.string().min(1).optional(),
  createdAt: z.string().datetime()
}).strict().superRefine(validateCreativeDirectionSet);

export const creativeWorkspaceSchema = z.object({
  sets: z.array(creativeCandidateSetSchema).max(12),
  currentSetId: z.string().uuid(),
  updatedAt: z.string().datetime()
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

export const productContainerTypeSchema = z.enum([
  "bottle", "carton", "can", "pouch", "jar", "tube", "box", "cup", "other"
]);
export const productFidelityModeSchema = z.enum(["exact", "reference", "not-visible"]);
export const productShotTypeSchema = z.enum(["packshot", "product-in-scene", "human-product-interaction", "not-visible"]);
export const productVisualSpecSchema = z.object({
  sourceAssetId: z.string().uuid(),
  containerType: productContainerTypeSchema,
  shape: z.string().min(1),
  proportions: z.string().min(1),
  capStructure: z.string().min(1),
  materials: z.array(z.string().min(1)).min(1).max(12),
  colors: z.array(z.object({
    name: z.string().min(1),
    hex: z.string().regex(/^#[0-9a-f]{6}$/i).optional()
  }).strict()).min(1).max(12),
  labelLayout: z.string().min(1),
  logoPosition: z.string().min(1),
  readablePackagingText: z.array(z.string().min(1).max(120)).max(20),
  heroAngle: z.string().min(1),
  forbiddenContainerTypes: z.array(productContainerTypeSchema).max(8),
  forbiddenVariations: z.array(z.string().min(1)).min(1).max(30),
  inspectorModel: z.string().min(1),
  inspectedAt: z.string().datetime()
}).strict();

export const visualAnchorCandidateKindSchema = z.enum(["character", "scene"]);
export const visualAnchorCandidateStatusSchema = z.enum(["ready", "selected", "outdated"]);
export const visualAnchorCandidateSchema = z.object({
  id: z.string().uuid(),
  kind: visualAnchorCandidateKindSchema,
  targetId: z.string().min(1),
  assetId: z.string().uuid(),
  label: z.string().min(1).max(120),
  prompt: z.string().min(1),
  status: visualAnchorCandidateStatusSchema,
  recommended: z.boolean().optional(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime()
}).strict();

export const characterAnchorStateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1)
}).strict();

export const characterAnchorBriefSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  apparentAgeRange: z.string().min(1),
  faceAppearance: z.string().min(1),
  hairstyle: z.string().min(1),
  hairColor: z.string().min(1),
  skinTone: z.string().min(1),
  wardrobe: z.string().min(1),
  accessories: z.array(z.string().min(1)).max(12),
  bodyBuild: z.string().min(1),
  immutableTraits: z.array(z.string().min(1)).min(1).max(20),
  states: z.array(characterAnchorStateSchema).min(1).max(8)
}).strict();

export const sceneLayoutSchema = z.object({
  anchors: z.array(z.object({
    id: z.string().min(1),
    semanticPosition: z.string().min(1)
  }).strict()).min(1).max(20)
}).strict();

export const sceneAnchorStateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  timeOfDay: z.string().min(1),
  lighting: z.string().min(1),
  mood: z.string().min(1),
  allowedChanges: z.array(z.string().min(1)).max(12)
}).strict();

export const characterVisualSpecSchema = z.object({
  id: z.string().min(1),
  masterAssetId: z.string().uuid().optional(),
  masterAssetIds: z.array(z.string().uuid()).max(3).optional(),
  apparentAgeRange: z.string().min(1).optional(),
  faceAppearance: z.string().min(1).optional(),
  role: z.string().min(1),
  faceDescription: z.string().min(1),
  hairstyle: z.string().min(1),
  hairColor: z.string().min(1),
  skinTone: z.string().min(1),
  wardrobe: z.array(z.string().min(1)).max(12),
  accessories: z.array(z.string().min(1)).max(12),
  bodyBuild: z.string().min(1),
  immutableTraits: z.array(z.string().min(1)).min(1).max(20),
  states: z.array(characterAnchorStateSchema).max(8).optional(),
  version: z.number().int().positive().optional(),
  locked: z.boolean(),
  lockedAt: z.string().datetime().optional()
}).strict();

export const sceneVisualSpecSchema = z.object({
  id: z.string().min(1),
  masterAssetId: z.string().uuid().optional(),
  masterAssetIds: z.array(z.string().uuid()).max(3).optional(),
  name: z.string().min(1),
  architecture: z.string().min(1),
  furniture: z.array(z.string().min(1)).max(20),
  heroProps: z.array(z.string().min(1)).max(20),
  timeOfDay: z.string().min(1),
  lightingDirection: z.string().min(1),
  lightingQuality: z.string().min(1),
  palette: z.array(z.string().min(1)).min(1).max(12),
  immutableTraits: z.array(z.string().min(1)).min(1).max(20),
  layout: sceneLayoutSchema.optional(),
  states: z.array(sceneAnchorStateSchema).max(12).optional(),
  version: z.number().int().positive().optional(),
  locked: z.boolean(),
  lockedAt: z.string().datetime().optional()
}).strict();

export const productMasterStateSchema = z.object({
  assetId: z.string().uuid().optional(),
  referenceAssetIds: z.array(z.string().uuid()).max(2),
  fidelityMode: z.literal("exact"),
  version: z.number().int().positive(),
  locked: z.boolean(),
  lockedAt: z.string().datetime().optional()
}).strict();

export const visualAnchorWorkspaceSchema = z.object({
  productMaster: productMasterStateSchema,
  characterBriefs: z.array(characterAnchorBriefSchema).max(12),
  characterCandidates: z.array(visualAnchorCandidateSchema).max(36),
  sceneCandidates: z.array(visualAnchorCandidateSchema).max(36),
  requiredCharacterIds: z.array(z.string().min(1)).max(12),
  requiredSceneIds: z.array(z.string().min(1)).max(12),
  initializedAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

const visualQABaseSchema = z.object({
  id: z.string().uuid(),
  generationEventId: z.string().uuid().optional(),
  shotId: z.string().min(1),
  frameId: z.string().min(1).optional(),
  assetId: z.string().uuid().optional(),
  attempt: z.number().int().min(1).max(2),
  inspectorModel: z.string().min(1),
  checkedAt: z.string().datetime(),
  productMatchPassed: z.boolean(),
  containerTypeMatch: z.boolean().optional(),
  silhouetteMatch: z.boolean().optional(),
  lidTypeMatch: z.boolean().optional(),
  majorGeometryMatch: z.boolean().optional(),
  dominantColorMatch: z.boolean().optional(),
  characterMatchPassed: z.boolean(),
  sceneMatchPassed: z.boolean(),
  textSafetyPassed: z.boolean(),
  generatedTextDetected: z.boolean().optional(),
  sourceProductTextPreserved: z.boolean().optional(),
  overallPassed: z.boolean(),
  issues: z.array(z.string().min(1)).max(30),
  repairPrompt: z.string().min(1).optional()
});

export const keyframeQAResultSchema = visualQABaseSchema.extend({
  singleFramePassed: z.boolean(),
  singleFullFramePassed: z.boolean().optional(),
  panelCount: z.number().int().min(1).optional(),
  collageDetected: z.boolean().optional()
}).strict();

export const videoQAResultSchema = visualQABaseSchema.extend({
  singleContinuousShotPassed: z.boolean(),
  temporalConsistencyPassed: z.boolean()
}).strict();

export const shotGenerationModeSchema = z.enum([
  "r2v", "i2v", "i2v-first-frame", "first-last-frame", "i2v-first-last", "continuation", "remotion-motion"
]);
export const textSafeZoneSchema = z.enum(["top-left", "top-center", "bottom-left", "none"]);

export const shotFrameRoleSchema = z.enum(["start", "setup", "action", "product", "reaction", "transition", "end"]);
export const shotFrameStatusSchema = z.enum(["pending", "generating", "qa-review", "ready", "needs-review", "failed"]);
export const shotFrameSchema = z.object({
  id: z.string().min(1), shotId: z.string().min(1), index: z.number().int().nonnegative(),
  role: shotFrameRoleSchema, timestampSec: z.number().nonnegative(), description: z.string().min(1),
  imagePromptCn: z.string().min(1), imagePromptEn: z.string().min(1),
  negativePromptCn: z.string().min(1).optional(), negativePromptEn: z.string().min(1).optional(),
  assetId: z.string().uuid().optional(), status: shotFrameStatusSchema.default("pending"), isLocked: z.boolean().default(false),
  sceneStateBefore: sceneStateSchema.optional(), sceneStateAfter: sceneStateSchema.optional()
}).strict();
export const microBeatPurposeSchema = z.enum(["orient", "reveal", "demonstrate", "emphasize", "react", "transition", "resolve"]);
export const microBeatSchema = z.object({
  id: z.string().min(1), shotId: z.string().min(1), index: z.number().int().nonnegative(), purpose: microBeatPurposeSchema,
  startSec: z.number().nonnegative(), endSec: z.number().positive(), action: z.string().min(1), stateChange: z.string().min(1),
  characterAction: z.string().min(1).optional(), handAction: z.string().min(1).optional(), gazeAction: z.string().min(1).optional(),
  productAction: z.string().min(1).optional(), cameraAction: z.string().min(1).optional(), environmentAction: z.string().min(1).optional(),
  expressionChange: z.string().min(1).optional(), continuityConstraint: z.string().min(1).optional(),
  complexity: z.number().int().min(1).max(4), frameId: z.string().min(1).optional()
}).strict();
export const shotSubclipSchema = z.object({
  id: z.string().min(1), shotId: z.string().min(1), index: z.number().int().nonnegative(), startSec: z.number().nonnegative(),
  durationSec: z.number().positive(), startFrameId: z.string().min(1), endFrameId: z.string().min(1).optional(),
  assetId: z.string().uuid().optional(), status: z.enum(["pending", "generating", "ready", "needs-review", "failed"]).default("pending")
}).strict();
export const narrativeProgressionSchema = z.object({
  previousState: z.string().min(1), newInformation: z.string().min(1), resultingState: z.string().min(1)
}).strict();

export const storyboardShotSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().positive(),
  durationSec: z.number().int().min(MIN_SHOT_DURATION_SEC).max(MAX_SHOT_DURATION_SEC).default(DEFAULT_SHOT_DURATION_SEC),
  goal: z.string().min(1),
  title: z.string().min(1).optional(),
  narrativePurpose: z.string().min(1).optional(),
  commercialPurpose: z.string().min(1).optional(),
  previousState: z.string().min(1).optional(),
  newInformation: z.string().min(1).optional(),
  resultingState: z.string().min(1).optional(),
  visualDescription: z.string().min(1),
  visualSummary: z.string().min(1).optional(),
  compositionIntent: z.string().min(1).optional(),
  emotionalIntent: z.string().min(1).optional(),
  productVisibilityIntent: z.string().min(1).optional(),
  transitionIn: z.string().min(1).optional(),
  transitionOut: z.string().min(1).optional(),
  continuityNotes: z.array(z.string().min(1)).max(30).optional(),
  riskNotes: z.array(z.string().min(1)).max(20).optional(),
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
  containsProduct: z.boolean().optional(),
  exactProductShot: z.boolean().optional(),
  productFidelityMode: productFidelityModeSchema.optional(),
  productShotType: productShotTypeSchema.optional(),
  lowRiskProductFallback: z.boolean().optional(),
  sceneId: z.string().min(1).optional(),
  sceneStateId: z.string().min(1).optional(),
  sceneTransitionReason: z.string().min(1).optional(),
  referenceImageAssetIds: referenceAssetIdsSchema.optional(),
  referenceVideoAssetIds: referenceAssetIdsSchema.optional(),
  sceneStateBefore: sceneStateSchema.optional(),
  sceneStateAfter: sceneStateSchema.optional(),
  continuityConstraints: z.array(z.string().min(1)).min(1).max(30).optional(),
  shotDirection: z.array(z.string().min(1)).min(1).max(20).optional(),
  motionComplexityScore: z.number().int().min(0).max(10).optional(),
  textSafeZone: textSafeZoneSchema.optional(),
  frames: z.array(shotFrameSchema).min(1).max(5).optional(),
  microBeats: z.array(microBeatSchema).min(1).max(9).optional(),
  subclips: z.array(shotSubclipSchema).max(2).optional(),
  narrativeProgression: narrativeProgressionSchema.optional(),
  primaryKeyframeAssetId: z.string().uuid().optional(),
  keyframeAssetId: z.string().uuid().optional()
});

export const detailedStoryboardShotSchema = storyboardShotSchema.extend({
  title: z.string().trim().min(4),
  narrativePurpose: z.string().trim().min(60),
  commercialPurpose: z.string().trim().min(30),
  previousState: z.string().trim().min(20),
  newInformation: z.string().trim().min(20),
  resultingState: z.string().trim().min(20),
  visualSummary: z.string().trim().min(120),
  compositionIntent: z.string().trim().min(30),
  emotionalIntent: z.string().trim().min(20),
  productVisibilityIntent: z.string().trim().min(20),
  transitionIn: z.string().trim().min(12),
  transitionOut: z.string().trim().min(12),
  microBeats: z.array(microBeatSchema.extend({
    characterAction: z.string().trim().min(12),
    continuityConstraint: z.string().trim().min(12)
  })).min(2).max(9),
  continuityNotes: z.array(z.string().trim().min(8)).min(4).max(30),
  riskNotes: z.array(z.string().trim().min(6)).min(1).max(20)
});

const detailedFramePromptSchema = z.object({
  frameId: z.string().min(1), timestampSec: z.number().nonnegative(), role: z.string().min(1), frozenMoment: z.string().min(20),
  subject: z.string().min(12), subjectPosition: z.string().min(8), characterPose: z.string().min(8), facialExpression: z.string().min(6),
  gazeDirection: z.string().min(5), handState: z.string().min(8), productPosition: z.string().min(8), productOrientation: z.string().min(8),
  productScale: z.string().min(5), environment: z.string().min(12), foreground: z.string().min(6), middleGround: z.string().min(6),
  background: z.string().min(6), composition: z.string().min(12), cameraHeight: z.string().min(5), cameraAngle: z.string().min(5),
  lens: z.string().min(3), focalLength: z.string().min(3), aperture: z.string().min(3), depthOfField: z.string().min(6),
  lightingDirection: z.string().min(6), lightingQuality: z.string().min(6), keyLight: z.string().min(6), fillLight: z.string().min(6),
  practicalLights: z.string().min(6), shadowBehavior: z.string().min(6), reflections: z.string().min(6), materialDetails: z.string().min(12),
  colorDesign: z.string().min(8), atmosphere: z.string().min(8), spatialDepth: z.string().min(8),
  continuityConstraints: z.array(z.string().min(6)).min(3), forbiddenChanges: z.array(z.string().min(6)).min(3),
  imagePromptCn: z.string().trim().min(350), imagePromptEn: z.string().trim().min(120),
  negativePromptCn: z.string().trim().min(40), negativePromptEn: z.string().trim().min(20)
}).strict();

export const promptQualityScoresSchema = z.object({
  creativeDepth: z.number().min(0).max(10), visualSpecificity: z.number().min(0).max(10), productConsistency: z.number().min(0).max(10),
  characterContinuity: z.number().min(0).max(10), sceneContinuity: z.number().min(0).max(10), actionExecutability: z.number().min(0).max(10),
  textRisk: z.number().min(0).max(10), deformationRisk: z.number().min(0).max(10)
}).strict();

export const detailedShotPromptPackageSchema = z.object({
  shotId: z.string().min(1),
  continuityContext: z.object({
    product: z.string().min(10), character: z.string().min(10), wardrobe: z.string().min(8), scene: z.string().min(10), sceneState: z.string().min(8),
    majorProps: z.array(z.string().min(1)), previousShotState: z.string().min(8), immutableElements: z.array(z.string().min(4)).min(3), allowedChanges: z.array(z.string().min(4)).min(1)
  }).strict(),
  directingNotesCn: z.string().trim().min(120), directingNotesEn: z.string().trim().min(60),
  framePrompts: z.array(detailedFramePromptSchema).min(1).max(5),
  videoPromptCn: z.string().trim().min(300), videoPromptEn: z.string().trim().min(120),
  negativePromptCn: z.string().trim().min(60), negativePromptEn: z.string().trim().min(30),
  narrationDirection: z.string().min(1).optional(), textSafeZone: z.string().min(1), qaChecklist: z.array(z.string().min(6)).min(6),
  qualityScores: promptQualityScoresSchema
}).strict().superRefine((value, context) => {
  const scores = value.qualityScores;
  if (scores.creativeDepth < 8 || scores.visualSpecificity < 8 || scores.actionExecutability < 8 || scores.textRisk > 2 || scores.deformationRisk > 3) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["qualityScores"], message: "PROMPT_DEPTH_VALIDATION_FAILED" });
  }
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
  "generated",
  "qa-review",
  "ready",
  "needs-review",
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
  "qa-review",
  "completed",
  "needs-review",
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

export const stageIdSchema = z.enum([
  "brief",
  "creative",
  "anchors",
  "storyboard",
  "keyframes",
  "video",
  "final"
]);

export const stageStatusSchema = z.enum([
  "draft",
  "running",
  "ready",
  "locked",
  "outdated",
  "failed",
  "blocked"
]);

export const stageStateSchema = z.object({
  status: stageStatusSchema,
  updatedAt: z.number().int().nonnegative(),
  lockedAt: z.number().int().nonnegative().optional(),
  lockedVersion: z.number().int().positive().optional(),
  errorCode: z.string().trim().min(1).max(80).optional()
}).strict();

export const stageStatesSchema = z.object({
  brief: stageStateSchema,
  creative: stageStateSchema,
  anchors: stageStateSchema,
  storyboard: stageStateSchema,
  keyframes: stageStateSchema,
  video: stageStateSchema,
  final: stageStateSchema
}).strict();

export const versionedResourceTypeSchema = z.enum([
  "brief",
  "creative-direction",
  "product-master",
  "character-master",
  "scene-master",
  "visual-anchors",
  "storyboard",
  "shot-frame",
  "shot-video",
  "narration",
  "ending",
  "final"
]);

export const versionedResourceSchema = z.object({
  id: z.string().min(1).max(180),
  resourceId: z.string().min(1).max(140),
  resourceType: versionedResourceTypeSchema,
  version: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  status: z.enum(["current", "outdated", "archived"]),
  label: z.string().trim().min(1).max(160).optional(),
  snapshot: z.unknown().optional()
}).strict();

export const dependencyRefSchema = z.object({
  resourceId: z.string().min(1).max(140),
  version: z.number().int().positive()
}).strict();

export const dependencyNodeSchema = z.object({
  resourceId: z.string().min(1).max(140),
  resourceType: versionedResourceTypeSchema,
  version: z.number().int().positive(),
  stageId: stageIdSchema,
  status: z.enum(["current", "outdated", "archived"]),
  dependsOn: z.array(dependencyRefSchema).max(32),
  shotId: z.string().min(1).optional(),
  frameId: z.string().min(1).optional(),
  videoId: z.string().min(1).optional(),
  narrationId: z.string().min(1).optional(),
  outdatedBecause: z.array(dependencyRefSchema).max(32).optional()
}).strict();

export const generationStageSchema = z.enum([
  "brief",
  "creative",
  "anchors",
  "strategy",
  "storyboard",
  "prompts",
  "keyframes",
  "video",
  "hero-shot",
  "narration",
  "final",
  "composition"
]);

export const generationProviderSchema = z.enum([
  "system",
  "deepseek",
  "qwen-image",
  "happyhorse",
  "wan",
  "remotion"
]);

export const generationEventStatusSchema = z.enum([
  "queued",
  "running",
  "qa-review",
  "completed",
  "needs-review",
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
  frameId: z.string().min(1).optional(),
  providerTaskId: z.string().trim().min(1).max(200).optional(),
  providerRequestId: z.string().trim().min(1).max(200).optional(),
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
  frameId: z.string().min(1).optional(),
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
  status: z.enum(["pending", "generated", "text-qa", "product-qa", "character-qa", "scene-qa", "qa-review", "ready", "needs-review", "failed", "fallback"]).default("pending"),
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

export const narrationBeatRoleSchema = z.enum(["problem", "transition", "benefit", "brand-payoff", "cta"]);
export const narrationBeatSchema = z.object({
  id: z.string().min(1),
  shotId: z.string().min(1),
  role: narrationBeatRoleSchema,
  text: z.string().min(1).max(120),
  displayText: z.string().min(1).max(120).optional(),
  tone: z.string().min(1),
  maxDurationSec: z.number().positive().max(MAX_SHOT_DURATION_SEC),
  subtitleEnabled: z.boolean(),
  assetId: z.string().uuid().optional(),
  actualDurationSec: z.number().positive().optional()
}).strict();
export const narrationPlanSchema = z.object({
  mode: z.enum(["none", "partial", "full"]).default("partial"),
  beats: z.array(narrationBeatSchema).max(MAX_SHOT_COUNT)
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
  planningConstraints: projectPlanningConstraintsSchema.optional(),
  shotCount: z.number().int().min(MIN_SHOT_COUNT).max(MAX_SHOT_COUNT).optional(),
  targetDurationSec: z.number().int().min(MIN_TARGET_DURATION_SEC).max(MAX_TARGET_DURATION_SEC).optional(),
  briefStatus: briefStatusSchema.optional(),
  briefSavedAt: z.number().int().nonnegative().optional(),
  briefRevision: z.number().int().nonnegative().optional(),
  brief: productBriefSchema,
  strategy: adStrategySchema,
  creativeWorkspace: creativeWorkspaceSchema.optional(),
  creativeBible: creativeBibleSchema.optional(),
  visualContinuityBible: visualContinuityBibleSchema.optional(),
  referencePack: referencePackSchema.optional(),
  productVisualSpec: productVisualSpecSchema.optional(),
  characterVisualSpecs: z.array(characterVisualSpecSchema).max(12).optional(),
  sceneVisualSpecs: z.array(sceneVisualSpecSchema).max(MAX_SHOT_COUNT).optional(),
  visualAnchorWorkspace: visualAnchorWorkspaceSchema.optional(),
  keyframeQAResults: z.array(keyframeQAResultSchema).max(120).optional(),
  videoQAResults: z.array(videoQAResultSchema).max(4).optional(),
  narrationPlan: narrationPlanSchema.optional(),
  shotPromptPackages: z.array(detailedShotPromptPackageSchema).max(MAX_SHOT_COUNT).optional(),
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
  stageStates: stageStatesSchema.optional(),
  resourceVersions: z.array(versionedResourceSchema).max(500).optional(),
  dependencyGraph: z.array(dependencyNodeSchema).max(1000).optional(),
  keyframes: z.array(keyframeMetadataSchema).max(60).optional(),
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
export type ProjectPlanningConstraints = z.infer<typeof projectPlanningConstraintsSchema>;
export type AdStrategy = z.infer<typeof adStrategySchema>;
export type CreativeBible = z.infer<typeof creativeBibleSchema>;
export type CreativeDirection = z.infer<typeof creativeDirectionSchema>;
export type CreativeDirectionSetPayload = z.infer<typeof creativeDirectionSetPayloadSchema>;
export type CreativeCandidateSet = z.infer<typeof creativeCandidateSetSchema>;
export type CreativeWorkspace = z.infer<typeof creativeWorkspaceSchema>;
export type DetailedStoryboardShot = z.infer<typeof detailedStoryboardShotSchema>;
export type DetailedShotPromptPackage = z.infer<typeof detailedShotPromptPackageSchema>;
export type PromptQualityScores = z.infer<typeof promptQualityScoresSchema>;
export type CharacterIdentity = z.infer<typeof characterIdentitySchema>;
export type ProductIdentity = z.infer<typeof productIdentitySchema>;
export type SceneIdentity = z.infer<typeof sceneIdentitySchema>;
export type ContinuityGroup = z.infer<typeof continuityGroupSchema>;
export type SceneState = z.infer<typeof sceneStateSchema>;
export type VisualContinuityBible = z.infer<typeof visualContinuityBibleSchema>;
export type ReferencePack = z.infer<typeof referencePackSchema>;
export type ProductContainerType = z.infer<typeof productContainerTypeSchema>;
export type ProductFidelityMode = z.infer<typeof productFidelityModeSchema>;
export type ProductShotType = z.infer<typeof productShotTypeSchema>;
export type ProductVisualSpec = z.infer<typeof productVisualSpecSchema>;
export type VisualAnchorCandidate = z.infer<typeof visualAnchorCandidateSchema>;
export type VisualAnchorCandidateKind = z.infer<typeof visualAnchorCandidateKindSchema>;
export type CharacterAnchorBrief = z.infer<typeof characterAnchorBriefSchema>;
export type CharacterAnchorState = z.infer<typeof characterAnchorStateSchema>;
export type SceneLayout = z.infer<typeof sceneLayoutSchema>;
export type SceneAnchorState = z.infer<typeof sceneAnchorStateSchema>;
export type CharacterVisualSpec = z.infer<typeof characterVisualSpecSchema>;
export type SceneVisualSpec = z.infer<typeof sceneVisualSpecSchema>;
export type ProductMasterState = z.infer<typeof productMasterStateSchema>;
export type VisualAnchorWorkspace = z.infer<typeof visualAnchorWorkspaceSchema>;
export type KeyframeQAResult = z.infer<typeof keyframeQAResultSchema>;
export type VideoQAResult = z.infer<typeof videoQAResultSchema>;
export type NarrationBeat = z.infer<typeof narrationBeatSchema>;
export type NarrationPlan = z.infer<typeof narrationPlanSchema>;
export type ShotGenerationMode = z.infer<typeof shotGenerationModeSchema>;
export type TextSafeZone = z.infer<typeof textSafeZoneSchema>;
export type StoryboardShot = z.infer<typeof storyboardShotSchema>;
export type ShotFrameRole = z.infer<typeof shotFrameRoleSchema>;
export type ShotFrame = z.infer<typeof shotFrameSchema>;
export type MicroBeat = z.infer<typeof microBeatSchema>;
export type ShotSubclip = z.infer<typeof shotSubclipSchema>;
export type NarrativeProgression = z.infer<typeof narrativeProgressionSchema>;
export type TaskType = z.infer<typeof taskTypeSchema>;
export type ModelRoute = z.infer<typeof modelRouteSchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type BriefStatus = z.infer<typeof briefStatusSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type CostModeEstimate = z.infer<typeof costModeEstimateSchema>;
export type WorkflowStepStatus = z.infer<typeof workflowStepStatusSchema>;
export type WorkflowSteps = z.infer<typeof workflowStepsSchema>;
export type StageId = z.infer<typeof stageIdSchema>;
export type StageStatus = z.infer<typeof stageStatusSchema>;
export type StageState = z.infer<typeof stageStateSchema>;
export type StageStates = z.infer<typeof stageStatesSchema>;
export type VersionedResourceType = z.infer<typeof versionedResourceTypeSchema>;
export type VersionedResource = z.infer<typeof versionedResourceSchema>;
export type DependencyRef = z.infer<typeof dependencyRefSchema>;
export type DependencyNode = z.infer<typeof dependencyNodeSchema>;
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
