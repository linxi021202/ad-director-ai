import { z } from "zod";

import { DEFAULT_SHOT_DURATION_SEC, MAX_SHOT_DURATION_SEC, MIN_SHOT_DURATION_SEC } from "../../video/shotConfig";

export const STORYBOARD_SCHEMA_VERSION = 2 as const;

export const CHARACTER_SCENE_STATE_FIELDS = [
  "characterId", "position", "pose", "gaze", "expression", "emotion", "energyLevel",
  "handState", "productInteraction", "wardrobeState", "continuityNotes"
] as const;

export const SCENE_STATE_FIELDS = [
  "shotId", "sceneId", "timeOfDay", "lightingState", "atmosphere", "characterStates",
  "productStates", "propStates", "environmentChanges", "continuityNotes"
] as const;

export const STORYBOARD_SHOT_OUTPUT_FIELDS = [
  "id", "index", "durationSec", "goal", "title", "narrativePurpose", "commercialPurpose",
  "previousState", "newInformation", "resultingState", "visualDescription", "visualSummary",
  "compositionIntent", "emotionalIntent", "productVisibilityIntent", "transitionIn", "transitionOut",
  "cameraAngle", "cameraMovement", "subtitle", "imagePromptCn", "imagePromptEn", "videoPromptCn",
  "recommendedModel", "fallbackPlan", "continuityGroupId", "sceneGroupId", "sceneId", "characterIds",
  "productIds", "containsProduct", "productFidelityMode", "productShotType", "sceneStateBefore",
  "sceneStateAfter", "continuityConstraints", "shotDirection", "motionComplexityScore", "textSafeZone",
  "microBeats", "continuityNotes", "riskNotes"
] as const;

const characterAliasMap = {
  mood: "emotion",
  characterEmotion: "emotion",
  emotionalState: "emotion",
  energy: "energyLevel",
  hand: "handState",
  clothingState: "wardrobeState",
  productHandling: "productInteraction"
} as const;

const shotAliasMap = {
  cameraMove: "cameraMovement",
  shotPurpose: "narrativePurpose",
  visualSummaryText: "visualSummary"
} as const;

export const STORYBOARD_ALIAS_MAP = { characterState: characterAliasMap, shot: shotAliasMap } as const;

function normalizeLegacyCharacterState(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = { ...(value as Record<string, unknown>) };
  for (const [alias, canonical] of Object.entries(characterAliasMap)) {
    if (source[canonical] === undefined && source[alias] !== undefined) source[canonical] = source[alias];
    delete source[alias];
  }
  if (source.handState === undefined && source.holdingHand !== undefined) {
    source.handState = `${source.holdingHand === "left" ? "左手" : "右手"}持握`;
  }
  if (source.productInteraction === undefined && source.holding !== undefined) {
    source.productInteraction = `持有 ${String(source.holding)}`;
  }
  delete source.holding;
  delete source.holdingHand;
  return source;
}

export const characterSceneStateSchema = z.preprocess(normalizeLegacyCharacterState, z.object({
  characterId: z.string().min(1),
  position: z.string().min(1).optional(),
  pose: z.string().min(1).optional(),
  gaze: z.string().min(1).optional(),
  expression: z.string().min(1).optional(),
  emotion: z.string().min(1).optional(),
  energyLevel: z.string().min(1).optional(),
  handState: z.string().min(1).optional(),
  productInteraction: z.string().min(1).optional(),
  wardrobeState: z.string().min(1).optional(),
  continuityNotes: z.array(z.string().min(1)).max(20).optional()
}).strict());

export const productSceneStateSchema = z.object({
  productId: z.string().min(1),
  position: z.string().min(1).optional(),
  orientation: z.string().min(1).optional(),
  opened: z.boolean().optional(),
  liquidLevel: z.string().min(1).optional(),
  interactionState: z.string().min(1).optional(),
  continuityNotes: z.array(z.string().min(1)).max(20).optional()
}).strict();

export const propSceneStateSchema = z.object({
  propId: z.string().min(1),
  position: z.string().min(1).optional(),
  state: z.string().min(1).optional()
}).strict();

export const sceneStateSchema = z.object({
  shotId: z.string().min(1),
  sceneId: z.string().min(1).optional(),
  timeOfDay: z.string().min(1).optional(),
  lightingState: z.string().min(1).optional(),
  atmosphere: z.string().min(1).optional(),
  characterStates: z.array(characterSceneStateSchema).max(12),
  productStates: z.array(productSceneStateSchema).max(12),
  propStates: z.array(propSceneStateSchema).max(20),
  environmentChanges: z.array(z.string().min(1)).max(20).optional(),
  continuityNotes: z.array(z.string().min(1)).max(30).optional()
}).strict();

export const productFidelityModeSchema = z.enum(["exact", "reference", "not-visible"]);
export const productShotTypeSchema = z.enum(["packshot", "product-in-scene", "human-product-interaction", "not-visible"]);
export const shotGenerationModeSchema = z.enum(["r2v", "i2v", "i2v-first-frame", "first-last-frame", "i2v-first-last", "continuation", "remotion-motion"]);
export const textSafeZoneSchema = z.enum(["top-left", "top-center", "bottom-left", "none"]);
export const shotFrameRoleSchema = z.enum(["start", "setup", "action", "product", "reaction", "transition", "end"]);
export const shotFrameStatusSchema = z.enum(["pending", "generating", "qa-review", "ready", "needs-review", "failed"]);

export const shotFrameSchema = z.object({
  id: z.string().min(1), shotId: z.string().min(1), index: z.number().int().nonnegative(),
  role: shotFrameRoleSchema, timestampSec: z.number().nonnegative(), description: z.string().min(1),
  imagePromptCn: z.string().min(1), imagePromptEn: z.string().min(1),
  negativePromptCn: z.string().min(1).optional(), negativePromptEn: z.string().min(1).optional(),
  assetId: z.string().uuid().optional(), status: shotFrameStatusSchema.default("pending"), isLocked: z.boolean().default(false),
  sceneStateBefore: sceneStateSchema.optional(), sceneStateAfter: sceneStateSchema.optional(),
  keyframeMoment: z.object({
    timestampSec: z.number().nonnegative(), microBeatId: z.string().optional(), narrativePurpose: z.string().min(1),
    momentDescription: z.string().min(1), continuityFromPreviousFrame: z.string().min(1),
    characterPose: z.string().min(1), handState: z.string().min(1), gazeDirection: z.string().min(1),
    facialExpression: z.string().min(1), productPosition: z.string().min(1), productOrientation: z.string().min(1),
    cameraAngle: z.string().min(1), environment: z.string().min(1)
  }).strict().optional()
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
  id: z.string().min(1), index: z.number().int().positive(),
  durationSec: z.number().int().min(MIN_SHOT_DURATION_SEC).max(MAX_SHOT_DURATION_SEC).default(DEFAULT_SHOT_DURATION_SEC),
  goal: z.string().min(1), title: z.string().min(1).optional(), narrativePurpose: z.string().min(1).optional(),
  commercialPurpose: z.string().min(1).optional(), previousState: z.string().min(1).optional(), newInformation: z.string().min(1).optional(),
  resultingState: z.string().min(1).optional(), visualDescription: z.string().min(1), visualSummary: z.string().min(1).optional(),
  compositionIntent: z.string().min(1).optional(), emotionalIntent: z.string().min(1).optional(), productVisibilityIntent: z.string().min(1).optional(),
  transitionIn: z.string().min(1).optional(), transitionOut: z.string().min(1).optional(), continuityNotes: z.array(z.string().min(1)).max(30).optional(),
  riskNotes: z.array(z.string().min(1)).max(20).optional(), cameraAngle: z.string().min(1), cameraMovement: z.string().min(1),
  subtitle: z.string().min(1), imagePromptCn: z.string().min(1), imagePromptEn: z.string().min(1), videoPromptCn: z.string().min(1),
  videoPromptEn: z.string().min(1).optional(), negativePromptCn: z.string().min(1).optional(), negativePromptEn: z.string().min(1).optional(),
  recommendedModel: z.string().min(1), fallbackPlan: z.string().min(1), sceneGroupId: z.string().min(1).optional(),
  continuityGroupId: z.string().min(1).optional(), generationMode: shotGenerationModeSchema.optional(), characterIds: z.array(z.string().min(1)).max(12).optional(),
  productIds: z.array(z.string().min(1)).max(12).optional(), containsProduct: z.boolean().optional(), exactProductShot: z.boolean().optional(),
  productFidelityMode: productFidelityModeSchema.optional(), productShotType: productShotTypeSchema.optional(), lowRiskProductFallback: z.boolean().optional(),
  sceneId: z.string().min(1).optional(), sceneStateId: z.string().min(1).optional(), sceneTransitionReason: z.string().min(1).optional(),
  referenceImageAssetIds: z.array(z.string().uuid()).max(12).optional(), referenceVideoAssetIds: z.array(z.string().uuid()).max(12).optional(),
  sceneStateBefore: sceneStateSchema.optional(), sceneStateAfter: sceneStateSchema.optional(),
  continuityConstraints: z.array(z.string().min(1)).min(1).max(30).optional(), shotDirection: z.array(z.string().min(1)).min(1).max(20).optional(),
  motionComplexityScore: z.number().int().min(0).max(10).optional(), textSafeZone: textSafeZoneSchema.optional(),
  frames: z.array(shotFrameSchema).min(1).max(5).optional(), microBeats: z.array(microBeatSchema).min(1).max(9).optional(),
  subclips: z.array(shotSubclipSchema).max(2).optional(), narrativeProgression: narrativeProgressionSchema.optional(),
  primaryKeyframeAssetId: z.string().uuid().optional(), keyframeAssetId: z.string().uuid().optional()
}).strict();

export const detailedStoryboardShotSchema = storyboardShotSchema.extend({
  title: z.string().trim().min(4), narrativePurpose: z.string().trim().min(60), commercialPurpose: z.string().trim().min(30),
  previousState: z.string().trim().min(20), newInformation: z.string().trim().min(20), resultingState: z.string().trim().min(20),
  visualSummary: z.string().trim().min(120), compositionIntent: z.string().trim().min(30), emotionalIntent: z.string().trim().min(20),
  productVisibilityIntent: z.string().trim().min(20), transitionIn: z.string().trim().min(12), transitionOut: z.string().trim().min(12),
  microBeats: z.array(microBeatSchema.extend({ characterAction: z.string().trim().min(12), continuityConstraint: z.string().trim().min(12) })).min(2).max(9),
  continuityNotes: z.array(z.string().trim().min(8)).min(4).max(30), riskNotes: z.array(z.string().trim().min(6)).min(1).max(20)
}).strict();

export type StoryboardNormalizationWarning = { path: string; alias: string; canonical: string };

export function normalizeStoryboardOutput(raw: unknown): { value: unknown; warnings: StoryboardNormalizationWarning[] } {
  const value = structuredCloneSafe(raw);
  const warnings: StoryboardNormalizationWarning[] = [];
  const envelope = Array.isArray(value) ? value : value && typeof value === "object" ? (value as Record<string, unknown>).shots : undefined;
  if (!Array.isArray(envelope)) return { value, warnings };
  envelope.forEach((entry, shotIndex) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    applyAliases(entry as Record<string, unknown>, shotAliasMap, `[${shotIndex}]`, warnings);
    for (const stateKey of ["sceneStateBefore", "sceneStateAfter"] as const) {
      const state = (entry as Record<string, unknown>)[stateKey];
      if (!state || typeof state !== "object" || Array.isArray(state)) continue;
      const characters = (state as Record<string, unknown>).characterStates;
      if (!Array.isArray(characters)) continue;
      characters.forEach((character, characterIndex) => {
        if (!character || typeof character !== "object" || Array.isArray(character)) return;
        applyAliases(character as Record<string, unknown>, characterAliasMap, `[${shotIndex}].${stateKey}.characterStates[${characterIndex}]`, warnings);
      });
    }
  });
  return { value, warnings };
}

function applyAliases(
  target: Record<string, unknown>,
  aliases: Record<string, string>,
  path: string,
  warnings: StoryboardNormalizationWarning[]
) {
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (target[alias] === undefined) continue;
    if (target[canonical] === undefined) target[canonical] = target[alias];
    delete target[alias];
    warnings.push({ path, alias, canonical });
  }
}

function structuredCloneSafe<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

export function storyboardContractExample(index = 1, durationSec = 5) {
  const shotId = `shot-${String(index).padStart(2, "0")}`;
  const state = {
    shotId, sceneId: "scene-main", timeOfDay: "白天", lightingState: "柔和侧光", atmosphere: "克制、清晰",
    characterStates: [{ characterId: "character-main", position: "桌边", pose: "坐姿微前倾", gaze: "看向产品", expression: "眉眼略放松", emotion: "疲惫但开始恢复", energyLevel: "逐步提升", handState: "右手靠近产品", productInteraction: "准备拿起产品", wardrobeState: "保持主造型", continuityNotes: ["人物身份与服装不变"] }],
    productStates: [{ productId: "product-master", position: "桌面右前方", orientation: "正面略偏三分之二", opened: false, interactionState: "静置", continuityNotes: ["包装与比例不变"] }],
    propStates: [], environmentChanges: ["背景光线轻微增强"], continuityNotes: ["空间轴线不变"]
  };
  return {
    id: shotId, index, durationSec, goal: "推进一个清晰叙事目标", title: "状态转折", narrativePurpose: "承接上一镜的人物与产品状态，只增加一项明确的新信息，并为下一镜建立可继承的动作结果。",
    commercialPurpose: "通过人物注意力变化建立清晰可信的产品记忆。", previousState: "人物仍专注屏幕，尚未与产品互动。", newInformation: "人物注意到桌面的真实产品并转移视线。", resultingState: "人物已经看向产品，右手准备靠近产品。",
    visualDescription: "一个完整单帧画面中，人物坐在桌边看向右前方的真实产品，保持稳定空间轴线、柔和侧光和清晰前中后景。", visualSummary: "人物、产品和环境保持在同一完整画面中，身份、包装、光线和空间关系连续。",
    compositionIntent: "人物与产品形成稳定视觉关系，视线自然引导到产品。", emotionalIntent: "人物内部情绪由疲惫转为注意，表情变化克制可见。", productVisibilityIntent: "产品无遮挡且保持真实比例、颜色、包装和朝向。",
    transitionIn: "承接上一镜人物注意力分散的状态。", transitionOut: "以人物右手停在产品旁的动作连接下一镜。", cameraAngle: "中景平视", cameraMovement: "缓慢推近", subtitle: "找回节奏",
    imagePromptCn: "完整单帧画面摘要。", imagePromptEn: "One complete frame summary.", videoPromptCn: "单一动作与克制运镜摘要。", recommendedModel: "qwen-image",
    fallbackPlan: "使用关键帧动效完成。", continuityGroupId: "narrative-main", sceneGroupId: "scene-main", sceneId: "scene-main", characterIds: ["character-main"],
    productIds: ["product-master"], containsProduct: true, productFidelityMode: "exact", productShotType: "human-product-interaction",
    sceneStateBefore: state, sceneStateAfter: { ...state, characterStates: [{ ...state.characterStates[0], handState: "右手轻触产品", productInteraction: "轻触产品" }] },
    continuityConstraints: ["人物身份不变", "产品身份不变"], shotDirection: ["只执行一个主要动作"], motionComplexityScore: 2, textSafeZone: "bottom-left",
    microBeats: [{ id: `${shotId}-beat-1`, shotId, index: 0, purpose: "transition", startSec: 0, endSec: durationSec, action: "人物看向产品并轻触", stateChange: "从注意到准备互动", handAction: "右手靠近并轻触产品", gazeAction: "视线由屏幕转向产品", expressionChange: "眉眼放松", complexity: 2, continuityConstraint: "人物、产品和空间关系保持一致" }],
    continuityNotes: ["人物身份不变", "服装不变", "产品外观不变", "空间轴线不变"], riskNotes: ["避免手部遮挡产品"]
  };
}

export const STORYBOARD_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: `AdDirector Storyboard Contract v${STORYBOARD_SCHEMA_VERSION}`,
  type: "object",
  required: ["shots"],
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: Object.fromEntries(STORYBOARD_SHOT_OUTPUT_FIELDS.map((field) => [field, {}])),
        additionalProperties: false
      }
    }
  },
  $defs: {
    sceneState: { type: "object", properties: Object.fromEntries(SCENE_STATE_FIELDS.map((field) => [field, {}])), additionalProperties: false },
    characterSceneState: { type: "object", properties: Object.fromEntries(CHARACTER_SCENE_STATE_FIELDS.map((field) => [field, {}])), additionalProperties: false }
  },
  additionalProperties: false
} as const;

export function buildStoryboardRepairPrompt(rawShot: unknown, errorSummary: string) {
  return `你只负责修复一个文字分镜 JSON 的结构，不改变创意内容，不缩短任何文本，不新增创意事实。
正式契约版本：${STORYBOARD_SCHEMA_VERSION}。
只允许镜头字段：${STORYBOARD_SHOT_OUTPUT_FIELDS.join("、")}。
只允许场景状态字段：${SCENE_STATE_FIELDS.join("、")}。
只允许人物状态字段：${CHARACTER_SCENE_STATE_FIELDS.join("、")}。
emotion 表示内部整体情绪；expression 表示画面可见表情；gaze 表示视线目标；handState 表示双手状态。
不得返回未列出的字段。不得删除 visualDescription、visualSummary、microBeats、continuityNotes 或其他已有核心语义。
结构错误：${errorSummary}
待修复镜头：${JSON.stringify(rawShot)}
返回 {"shot":修复后的单个镜头}。完整字段参考：${JSON.stringify(storyboardContractExample())}`;
}

export function validateStateContinuity(shots: Array<z.infer<typeof storyboardShotSchema>>) {
  const issues: string[] = [];
  for (let index = 0; index < shots.length - 1; index += 1) {
    const after = shots[index]?.sceneStateAfter;
    const before = shots[index + 1]?.sceneStateBefore;
    if (!after || !before) continue;
    if (after.sceneId && before.sceneId && after.sceneId !== before.sceneId && shots[index + 1]?.sceneTransitionReason === undefined) {
      issues.push(`镜头 ${index + 1} 到 ${index + 2} 的场景发生变化，但没有转场说明。`);
    }
    compareStateIds(after.characterStates, before.characterStates, "characterId", index, "人物", issues);
    compareStateIds(after.productStates, before.productStates, "productId", index, "产品", issues);
  }
  return { valid: issues.length === 0, issues };
}

export function mergeStoryboardChunks(shots: Array<z.infer<typeof storyboardShotSchema>>) {
  const merged = [...shots].sort((left, right) => left.index - right.index).map((shot) => structuredCloneSafe(shot));
  for (let index = 1; index < merged.length; index += 1) {
    const previous = merged[index - 1]!;
    const current = merged[index]!;
    const sameContinuityGroup = Boolean(previous.continuityGroupId && previous.continuityGroupId === current.continuityGroupId);
    const sameScene = Boolean(previous.sceneId && previous.sceneId === current.sceneId);
    if (!previous.sceneStateAfter || current.sceneTransitionReason || (!sameContinuityGroup && !sameScene)) continue;
    current.sceneStateBefore = { ...structuredCloneSafe(previous.sceneStateAfter), shotId: current.id };
  }
  return merged;
}

export function validateStoryboardGlobalConstraints(
  shots: Array<z.infer<typeof storyboardShotSchema>>,
  expectedShotCount: number,
  expectedDurationSec: number,
  durationPlan: number[]
) {
  const issues: string[] = [];
  if (shots.length !== expectedShotCount) issues.push(`镜头数量应为 ${expectedShotCount}，实际为 ${shots.length}。`);
  const indices = shots.map((shot) => shot.index);
  if (indices.some((index, position) => index !== position + 1)) issues.push("镜头序号不是从 1 开始连续递增。");
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length) issues.push("镜头 ID 存在重复。");
  const duration = shots.reduce((total, shot) => total + shot.durationSec, 0);
  if (duration !== expectedDurationSec) issues.push(`总时长应为 ${expectedDurationSec} 秒，实际为 ${duration} 秒。`);
  if (shots.some((shot, index) => shot.durationSec !== durationPlan[index])) issues.push("单镜头时长与计划不一致。");
  return { valid: issues.length === 0, issues };
}

function compareStateIds<T extends Record<string, unknown>>(after: T[], before: T[], key: keyof T, index: number, label: string, issues: string[]) {
  const afterIds = new Set(after.map((item) => String(item[key])));
  const beforeIds = new Set(before.map((item) => String(item[key])));
  if (afterIds.size !== beforeIds.size || [...afterIds].some((id) => !beforeIds.has(id))) {
    issues.push(`镜头 ${index + 1} 到 ${index + 2} 的${label}状态未完整衔接。`);
  }
}

export type CharacterSceneState = z.infer<typeof characterSceneStateSchema>;
export type ProductSceneState = z.infer<typeof productSceneStateSchema>;
export type SceneState = z.infer<typeof sceneStateSchema>;
export type StoryboardShot = z.infer<typeof storyboardShotSchema>;
