import { NO_READABLE_TEXT_CN, NO_READABLE_TEXT_EN } from "../prompts/noReadableText";
import type {
  AdStrategy,
  CreativeBible,
  GenerationProject,
  ProductBrief,
  ReferencePack,
  SceneState,
  StoryboardShot,
  VisualContinuityBible
} from "../schemas/project";

type ContinuityInput = {
  brief: ProductBrief;
  strategy: AdStrategy;
  shots: StoryboardShot[];
  previousBible?: VisualContinuityBible;
  previousReferencePack?: ReferencePack;
};

export type ProjectContinuityArchitecture = {
  creativeBible: CreativeBible;
  visualContinuityBible: VisualContinuityBible;
  referencePack: ReferencePack;
  shots: StoryboardShot[];
};

export function buildCreativeBible(
  brief: ProductBrief,
  strategy: AdStrategy
): CreativeBible {
  return {
    bigIdea: strategy.bigIdea,
    audienceInsight: strategy.audienceInsight,
    brandPromise: strategy.coreMessage,
    emotionalArc: strategy.emotionalArc ?? strategy.emotionalHook,
    narrativeArc: strategy.narrativeArc ?? `${strategy.painPoint} → ${strategy.coreMessage} → ${strategy.cta}`,
    visualMetaphor: strategy.visualMetaphor ?? strategy.bigIdea,
    visualStyle: strategy.visualStyle ?? brief.style,
    cameraLanguage: strategy.cameraLanguage ?? "稳定商业摄影语言，镜头运动克制且服务于产品表达。",
    pacing: strategy.pacing ?? "开场快速建立问题，中段清晰呈现产品，结尾稳定收束。",
    productImportance: strategy.productImportance ?? "hero",
    commercialStructure: strategy.commercialStructure ?? {
      hook: strategy.emotionalHook,
      problem: strategy.painPoint,
      productReveal: `清晰展示${brief.productName}及其真实外观。`,
      benefit: strategy.coreMessage,
      emotionalPayoff: strategy.emotionalHook,
      cta: strategy.cta
    },
    forbiddenConcepts: unique([
      ...(strategy.forbiddenConcepts ?? []),
      "改变真实产品的颜色、比例或几何结构",
      "生成虚假品牌、Logo、价格、功效数字或认证",
      "在生成画面中制作可读字幕或 CTA"
    ])
  };
}

export function buildProjectContinuity(input: ContinuityInput): ProjectContinuityArchitecture {
  const productMasterIds = unique([
    ...(input.brief.productImages ?? [])
      .filter((image) => image.role !== "logo")
      .map((image) => image.assetId)
      .filter(isAssetId),
    ...(input.previousReferencePack?.productMasters ?? [])
  ]).slice(0, 3);
  const hasCharacter = input.shots.some(shotContainsCharacter);
  const previousCharacter = input.previousBible?.characters[0];
  const characters = hasCharacter ? [{
    id: previousCharacter?.id ?? "character-main",
    role: previousCharacter?.role ?? "广告主角",
    ageRange: previousCharacter?.ageRange ?? "由首个已确认人物锚点确定",
    genderPresentation: previousCharacter?.genderPresentation,
    faceDescription: previousCharacter?.faceDescription ?? "保持同一人物面部身份与年龄观感",
    hairstyle: previousCharacter?.hairstyle ?? "保持人物锚点发型",
    hairColor: previousCharacter?.hairColor ?? "保持人物锚点发色",
    skinTone: previousCharacter?.skinTone ?? "保持人物锚点肤色",
    wardrobe: previousCharacter?.wardrobe ?? ["全片同一服装造型"],
    accessories: previousCharacter?.accessories ?? [],
    bodyBuild: previousCharacter?.bodyBuild ?? "保持稳定身体比例",
    referenceAssetIds: unique([
      ...(previousCharacter?.referenceAssetIds ?? []),
      ...(input.previousReferencePack?.characterMasters ?? [])
    ]).slice(0, 3),
    immutableTraits: unique([
      ...(previousCharacter?.immutableTraits ?? []),
      "same facial identity",
      "same hairstyle and hair color",
      "same apparent age and skin tone",
      "same wardrobe and accessories",
      "stable body proportions"
    ]),
    allowedChanges: previousCharacter?.allowedChanges ?? ["expression", "pose", "gaze", "hand position", "body orientation"]
  }] : [];

  const productId = input.previousBible?.products[0]?.id ?? "product-master";
  const product = {
    id: productId,
    referenceAssetIds: productMasterIds,
    geometry: input.previousBible?.products[0]?.geometry ?? `严格遵循${input.brief.productName}真实产品主图的几何结构`,
    proportions: input.previousBible?.products[0]?.proportions ?? "保持真实产品主图的长宽比例和部件相对尺寸",
    dominantColors: input.previousBible?.products[0]?.dominantColors ?? ["真实产品主图颜色", "项目统一辅助色"],
    materials: input.previousBible?.products[0]?.materials ?? ["遵循真实产品材质", "不发明新包装材质"],
    capShape: input.previousBible?.products[0]?.capShape ?? "遵循真实产品主图",
    labelRegion: input.previousBible?.products[0]?.labelRegion ?? "保留原包装标签区域，不重新生成可读小字",
    immutableTraits: unique([
      ...(input.previousBible?.products[0]?.immutableTraits ?? []),
      "same product geometry and proportions",
      "same dominant colors and materials",
      "same cap, label region and package silhouette",
      "no invented logo, label, button or product structure"
    ]),
    readablePackagingTextPolicy: productMasterIds.length > 0
      ? "preserve-original-only" as const
      : "blank-generated-label" as const
  };

  const grouped = new Map<string, StoryboardShot[]>();
  input.shots.forEach((shot) => {
    const groupId = shot.continuityGroupId ?? inferContinuityGroup(shot, input.shots.length);
    grouped.set(groupId, [...(grouped.get(groupId) ?? []), shot]);
  });
  const previousScenes = new Map((input.previousBible?.scenes ?? []).map((scene) => [scene.id, scene]));
  const scenes = Array.from(grouped.entries()).map(([groupId, shots]) => {
    const sceneId = shots[0]?.sceneId ?? `scene-${groupId}`;
    const previous = previousScenes.get(sceneId);
    return {
      id: sceneId,
      name: previous?.name ?? groupName(groupId),
      architecture: previous?.architecture ?? compact(shots[0]?.visualDescription ?? "统一商业广告场景"),
      furniture: previous?.furniture ?? [],
      heroProps: previous?.heroProps ?? [input.brief.productName],
      timeOfDay: previous?.timeOfDay ?? "保持同组镜头时间连续",
      lightingDirection: previous?.lightingDirection ?? "保持同组主光方向一致",
      lightingQuality: previous?.lightingQuality ?? "商业摄影质感，光线变化连续",
      palette: previous?.palette ?? ["遵循项目主色", "同组镜头综合色调一致"],
      referenceAssetIds: previous?.referenceAssetIds ?? [],
      immutableTraits: unique([
        ...(previous?.immutableTraits ?? []),
        "same architecture and major props",
        "same lighting direction and palette within the continuity group"
      ]),
      allowedChanges: previous?.allowedChanges ?? ["camera position", "lens", "depth of field", "character position"]
    };
  });

  const sceneByGroup = new Map(Array.from(grouped.keys()).map((groupId, index) => [groupId, scenes[index]!]));
  const previousStateByGroup = new Map<string, SceneState>();
  const enrichedShots = input.shots.map((shot) => {
    const continuityGroupId = shot.continuityGroupId ?? inferContinuityGroup(shot, input.shots.length);
    const scene = sceneByGroup.get(continuityGroupId)!;
    const characterIds = shot.characterIds ?? (shotContainsCharacter(shot) && characters[0] ? [characters[0].id] : []);
    const productIds = shot.productIds ?? [productId];
    const defaultState: SceneState = {
      shotId: shot.id,
      characterStates: characterIds.map((characterId) => ({ characterId, wardrobeState: "保持人物 Master 造型" })),
      productStates: productIds.map((id) => ({ productId: id, orientation: "保持上一镜连续朝向" })),
      propStates: []
    };
    const inheritedBefore = inheritSceneState(
      previousStateByGroup.get(continuityGroupId),
      shot.sceneStateBefore ?? defaultState,
      shot.id
    );
    const after = inheritSceneState(inheritedBefore, shot.sceneStateAfter ?? inheritedBefore, shot.id);
    previousStateByGroup.set(continuityGroupId, after);
    const permanentReferences = unique([
      ...productMasterIds,
      ...characterIds.flatMap((id) => characters.find((character) => character.id === id)?.referenceAssetIds ?? []),
      ...scene.referenceAssetIds
    ]).slice(0, 3);
    return {
      ...shot,
      continuityGroupId,
      sceneGroupId: shot.sceneGroupId ?? continuityGroupId,
      sceneId: scene.id,
      characterIds,
      productIds,
      referenceImageAssetIds: shot.referenceImageAssetIds?.length ? shot.referenceImageAssetIds : permanentReferences,
      referenceVideoAssetIds: shot.referenceVideoAssetIds ?? [],
      sceneStateBefore: inheritedBefore,
      sceneStateAfter: after,
      generationMode: shot.generationMode ?? inferGenerationMode(shot, input.shots.length),
      continuityConstraints: unique([
        ...(shot.continuityConstraints ?? []),
        "保持 Product Master 的产品几何、比例、颜色、材质与包装轮廓",
        ...(characterIds.length ? ["保持 Character Master 的人物身份、发型、服装和配饰"] : []),
        "保持同一 Continuity Group 的场景、主光方向、主要道具和综合色调",
        "Previous Shot 只作为动作状态辅助，不得替代 Master References",
        "生成画面不得包含任何可读文字、数字、Logo、字幕、CTA 或伪文字"
      ]),
      shotDirection: shot.shotDirection ?? [shot.visualDescription, `${shot.cameraAngle}；${shot.cameraMovement}`],
      videoPromptEn: shot.videoPromptEn ?? `${shot.imagePromptEn} Motion is limited to one primary action and one camera move. ${NO_READABLE_TEXT_EN}`,
      negativePromptCn: shot.negativePromptCn ?? NO_READABLE_TEXT_CN,
      negativePromptEn: shot.negativePromptEn ?? NO_READABLE_TEXT_EN,
      motionComplexityScore: Math.min(6, shot.motionComplexityScore ?? estimateMotionComplexity(shot)),
      textSafeZone: shot.textSafeZone ?? (shot.index === input.shots.length ? "top-center" : "bottom-left")
    } satisfies StoryboardShot;
  });

  const continuityGroups = Array.from(grouped.entries()).map(([groupId, shots]) => {
    const enrichedGroupShots = enrichedShots.filter((shot) => shot.continuityGroupId === groupId);
    return {
      id: groupId,
      name: groupName(groupId),
      shotIds: shots.map((shot) => shot.id),
      characterIds: unique(enrichedGroupShots.flatMap((shot) => shot.characterIds ?? [])),
      productIds: unique(enrichedGroupShots.flatMap((shot) => shot.productIds ?? [])),
      sceneId: sceneByGroup.get(groupId)?.id,
      immutableTraits: ["产品身份", "人物身份与服装", "场景结构与主要道具", "主光方向与综合色调"]
    };
  });
  const referencePack: ReferencePack = {
    productMasters: productMasterIds,
    characterMasters: unique([
      ...(input.previousReferencePack?.characterMasters ?? []),
      ...characters.flatMap((character) => character.referenceAssetIds)
    ]).slice(0, 3),
    sceneMasters: unique([
      ...(input.previousReferencePack?.sceneMasters ?? []),
      ...scenes.flatMap((scene) => scene.referenceAssetIds)
    ]).slice(0, 3),
    continuityAnchors: continuityGroups.map((group) => ({
      continuityGroupId: group.id,
      assetIds: unique([
        ...productMasterIds,
        ...scenes.find((scene) => scene.id === group.sceneId)?.referenceAssetIds ?? []
      ]).slice(0, 3)
    }))
  };
  const visualContinuityBible: VisualContinuityBible = {
    characters,
    products: [product],
    scenes,
    wardrobeRules: ["同一人物在同一 Continuity Group 中保持服装、发型与配饰不变"],
    propRules: ["主要道具的位置和状态必须继承上一镜 Scene State"],
    colorPalette: ["真实产品主色优先", "同组镜头综合色调一致", "跨组变化必须服务叙事"],
    lightingRules: ["同组保持主光方向和光质连续", "只允许叙事明确要求的渐进式光线变化"],
    cameraRules: ["每镜只使用一个主要镜头运动", "镜头运动不得破坏产品可辨识度"],
    continuityGroups,
    forbiddenVisualChanges: [
      "改变产品瓶型、瓶盖、颜色、包装比例或标签区域",
      "改变人物面部身份、年龄观感、发型、服装或配饰",
      "无剧情依据地切换左右手、产品开合状态、液位或主要道具位置",
      "生成新的 Logo、标签、价格、数字、字幕、CTA 或随机字符"
    ],
    textRenderingPolicy: {
      generatedReadableTextAllowed: false,
      brandTextViaRemotion: true,
      subtitleViaRemotion: true,
      ctaViaRemotion: true,
      numericContentViaRemotion: true
    }
  };
  return {
    creativeBible: buildCreativeBible(input.brief, input.strategy),
    visualContinuityBible,
    referencePack,
    shots: enrichedShots
  };
}

export function ensureProjectContinuity(project: GenerationProject): ProjectContinuityArchitecture {
  return buildProjectContinuity({
    brief: project.brief,
    strategy: project.strategy,
    shots: project.shots,
    previousBible: project.visualContinuityBible,
    previousReferencePack: project.referencePack
  });
}

export function inheritSceneState(
  previous: SceneState | undefined,
  current: SceneState,
  shotId: string
): SceneState {
  return {
    shotId,
    characterStates: mergeStateItems(previous?.characterStates ?? [], current.characterStates, "characterId"),
    productStates: mergeStateItems(previous?.productStates ?? [], current.productStates, "productId"),
    propStates: mergeStateItems(previous?.propStates ?? [], current.propStates, "propId")
  };
}

export function selectShotReferences(
  project: GenerationProject,
  shot: StoryboardShot,
  previousShotAssetId?: string
) {
  const architecture = ensureProjectContinuity(project);
  const normalizedShot = architecture.shots.find((item) => item.id === shot.id) ?? shot;
  const permanentAssetIds = unique([
    ...architecture.referencePack.productMasters,
    ...architecture.referencePack.characterMasters,
    ...architecture.referencePack.sceneMasters,
    ...(normalizedShot.referenceImageAssetIds ?? [])
  ]).slice(0, 3);
  return {
    permanentAssetIds,
    auxiliaryAssetIds: previousShotAssetId && isAssetId(previousShotAssetId) ? [previousShotAssetId] : []
  };
}

function mergeStateItems<T extends Record<string, unknown>>(
  previous: T[],
  current: T[],
  key: keyof T
): T[] {
  const merged = new Map(previous.map((item) => [String(item[key]), item]));
  current.forEach((item) => merged.set(String(item[key]), { ...(merged.get(String(item[key])) ?? {}), ...item } as T));
  return Array.from(merged.values());
}

function inferContinuityGroup(shot: StoryboardShot, shotCount: number) {
  if (shot.index === shotCount) return "ending";
  if (/产品|瓶身|包装|特写|packshot/i.test(`${shot.goal} ${shot.visualDescription}`)) return "product-world";
  return "narrative-main";
}

function groupName(groupId: string) {
  if (groupId === "ending") return "确定性产品收束";
  if (groupId === "product-world") return "产品视觉组";
  if (groupId === "narrative-main") return "人物场景主线";
  return groupId;
}

function inferGenerationMode(shot: StoryboardShot, shotCount: number) {
  if (shot.index === shotCount || /remotion/i.test(shot.recommendedModel)) return "remotion-motion" as const;
  if (/wan2\.7-r2v|happyhorse/i.test(shot.recommendedModel)) return "r2v" as const;
  return "remotion-motion" as const;
}

function estimateMotionComplexity(shot: StoryboardShot) {
  const actionCount = `${shot.visualDescription} ${shot.cameraMovement}`.split(/[，、；,;]/).filter(Boolean).length;
  return Math.max(1, Math.min(6, Math.ceil(actionCount / 2)));
}

function shotContainsCharacter(shot: StoryboardShot) {
  return /人物|主角|角色|上班族|人群|手持|伸手|face|person|character|worker/i.test(`${shot.goal} ${shot.visualDescription}`);
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function isAssetId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
