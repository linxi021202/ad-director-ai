import type {
  CharacterAnchorBrief,
  CharacterVisualSpec,
  GenerationProject,
  SceneAnchorState,
  SceneLayout,
  SceneVisualSpec,
  StageStates,
  VisualAnchorCandidate,
  VisualAnchorCandidateKind,
  VisualAnchorSelectionState,
  VisualAnchorWorkspace
} from "@/lib/schemas/project";
import { getProjectProductAssets } from "@/lib/productImages";

export type VisualAnchorReadiness = {
  ready: boolean;
  productLocked: boolean;
  missingProductReason?: "PRODUCT_REFERENCE_REQUIRED" | "PRODUCT_VISUAL_SPEC_REQUIRED" | "PRODUCT_MASTER_NOT_LOCKED";
  missingCharacterIds: string[];
  missingSceneIds: string[];
};

export function ensureVisualAnchorWorkspace(project: GenerationProject, now = new Date().toISOString()): GenerationProject {
  const stageWasLocked = project.stageStates?.anchors.status === "locked";
  const previous = project.visualAnchorWorkspace;
  const lockedSceneIds = stageWasLocked
    ? (project.sceneVisualSpecs ?? []).filter((spec) => spec.locked && currentMasterAssetId(spec)).map((spec) => spec.id)
    : [];
  const preservedSceneIds = previous?.requiredSceneIds.filter((id) => lockedSceneIds.includes(id)) ?? [];
  const baseSceneIds = stageWasLocked ? (preservedSceneIds.length ? preservedSceneIds : lockedSceneIds) : [];
  const canonicalShots = project.shots.map((shot) => {
    const originalSceneId = shot.sceneId;
    if (!originalSceneId) return shot;
    const candidateId = canonicalSceneId(originalSceneId);
    const sceneId = baseSceneIds.length && !baseSceneIds.includes(candidateId) ? baseSceneIds[0]! : candidateId;
    return {
      ...shot,
      sceneId,
      sceneGroupId: sceneId,
      sceneStateId: remapSceneStateId(shot.sceneStateId ?? inferSceneStateId(shot, originalSceneId), sceneId)
    };
  });
  const characterBriefs = buildCharacterBriefs({ ...project, shots: canonicalShots });
  const characterVisualSpecs = buildCharacterSpecs(project, characterBriefs);
  const sceneVisualSpecs = buildSceneSpecs({ ...project, shots: canonicalShots });
  const requiredSceneSpecs = baseSceneIds.length
    ? baseSceneIds.map((id) => sceneVisualSpecs.find((spec) => spec.id === id)).filter((spec): spec is SceneVisualSpec => Boolean(spec))
    : selectRequiredSceneSpecs({ ...project, shots: canonicalShots }, sceneVisualSpecs);
  const requiredSceneIds = new Set(requiredSceneSpecs.map((spec) => spec.id));
  const mainSceneId = requiredSceneSpecs[0]?.id;
  const normalizedShots = canonicalShots.map((shot) => {
    if (!shot.sceneId || !mainSceneId) return shot;
    const sceneId = requiredSceneIds.has(shot.sceneId) ? shot.sceneId : mainSceneId;
    return { ...shot, sceneId, sceneGroupId: sceneId, sceneStateId: remapSceneStateId(shot.sceneStateId, sceneId) };
  });
  const usedCharacterIds = new Set(normalizedShots.flatMap((shot) => shot.characterIds ?? []));
  const mainProduct = getProjectProductAssets(project).primaryAsset;
  const referenceAssetIds = getProjectProductAssets(project).assets
    .filter((image) => image.assetId && image.assetId !== mainProduct?.assetId)
    .map((image) => image.assetId!)
    .slice(0, 2);
  const productMaster = {
    assetId: mainProduct?.assetId,
    referenceAssetIds,
    fidelityMode: "exact" as const,
    version: resourceVersion(project, "product-master") || previous?.productMaster.version || 1,
    locked: Boolean(
      mainProduct?.assetId
      && (previous?.productMaster.locked || stageWasLocked)
      && (!previous?.productMaster.assetId || previous.productMaster.assetId === mainProduct.assetId)
    ),
    ...((previous?.productMaster.lockedAt || stageWasLocked) ? { lockedAt: previous?.productMaster.lockedAt ?? now } : {})
  };
  const workspace: VisualAnchorWorkspace = {
    productMaster,
    characterBriefs,
    characterCandidates: previous?.characterCandidates ?? [],
    sceneCandidates: previous?.sceneCandidates ?? [],
    characterSelections: buildSelectionStates("character", previous?.characterSelections, previous?.characterCandidates ?? [], characterVisualSpecs, now),
    sceneSelections: buildSelectionStates("scene", previous?.sceneSelections, previous?.sceneCandidates ?? [], sceneVisualSpecs, now),
    requiredCharacterIds: characterVisualSpecs.filter((spec) => usedCharacterIds.has(spec.id)).map((spec) => spec.id),
    requiredSceneIds: requiredSceneSpecs.map((spec) => spec.id),
    initializedAt: previous?.initializedAt ?? now,
    updatedAt: now
  };
  const next = {
    ...project,
    shots: normalizedShots,
    characterVisualSpecs,
    sceneVisualSpecs,
    visualAnchorWorkspace: workspace
  };
  return applyVisualAnchorReadiness(next, now);
}

export function getVisualAnchorReadiness(project: GenerationProject): VisualAnchorReadiness {
  const workspace = project.visualAnchorWorkspace;
  const mainProduct = getProjectProductAssets(project).primaryAsset;
  const productLocked = Boolean(
    workspace?.productMaster.locked
    && mainProduct?.assetId
    && workspace.productMaster.assetId === mainProduct.assetId
  );
  const requiredCharacterIds = workspace?.requiredCharacterIds ?? project.characterVisualSpecs?.map((item) => item.id) ?? [];
  const requiredSceneIds = workspace?.requiredSceneIds ?? project.sceneVisualSpecs?.map((item) => item.id) ?? [];
  const lockedCharacters = new Set((project.characterVisualSpecs ?? []).filter((item) => {
    const state = workspace?.characterSelections?.find((entry) => entry.targetId === item.id);
    return item.locked && currentMasterAssetId(item) && (state?.status === "confirmed" || (!state?.selectedCandidateId && !state?.confirmedCandidateId));
  }).map((item) => item.id));
  const lockedScenes = new Set((project.sceneVisualSpecs ?? []).filter((item) => {
    const state = workspace?.sceneSelections?.find((entry) => entry.targetId === item.id);
    return item.locked && currentMasterAssetId(item) && (state?.status === "confirmed" || (!state?.selectedCandidateId && !state?.confirmedCandidateId));
  }).map((item) => item.id));
  return {
    ready: productLocked
      && requiredCharacterIds.every((id) => lockedCharacters.has(id))
      && requiredSceneIds.every((id) => lockedScenes.has(id)),
    productLocked,
    ...(!mainProduct?.assetId
      ? { missingProductReason: "PRODUCT_REFERENCE_REQUIRED" as const }
      : !productLocked
          ? { missingProductReason: "PRODUCT_MASTER_NOT_LOCKED" as const }
          : {}),
    missingCharacterIds: requiredCharacterIds.filter((id) => !lockedCharacters.has(id)),
    missingSceneIds: requiredSceneIds.filter((id) => !lockedScenes.has(id))
  };
}

export function replaceVisualAnchorCandidates(
  project: GenerationProject,
  kind: VisualAnchorCandidateKind,
  targetId: string,
  candidates: VisualAnchorCandidate[],
  now = new Date().toISOString(),
  preserveUnreplaced = false
): GenerationProject {
  const normalized = ensureVisualAnchorWorkspace(project, now);
  const workspace = normalized.visualAnchorWorkspace!;
  const key = kind === "character" ? "characterCandidates" : "sceneCandidates";
  const replacedIndexes = new Set(candidates.map((candidate) => candidate.candidateIndex ?? Number(candidate.label.match(/方案\s*(\d+)/)?.[1])));
  const previous = workspace[key].map((candidate) => candidate.targetId === targetId
    && (!preserveUnreplaced || replacedIndexes.has(candidate.candidateIndex ?? Number(candidate.label.match(/方案\s*(\d+)/)?.[1])))
    ? { ...candidate, status: "outdated" as const }
    : candidate);
  const selectionKey = kind === "character" ? "characterSelections" : "sceneSelections";
  const setVersion = Math.max(...candidates.map((candidate) => candidate.setVersion ?? candidate.version));
  const priorSelection = workspace[selectionKey]?.find((item) => item.targetId === targetId);
  const selectedStillActive = preserveUnreplaced && previous.some((item) => item.id === priorSelection?.selectedCandidateId && item.status !== "outdated");
  const selections = upsertSelection(workspace[selectionKey] ?? [], {
    kind,
    targetId,
    status: selectedStillActive ? priorSelection!.status : "generated",
    setVersion,
    ...(selectedStillActive ? { selectedCandidateId: priorSelection!.selectedCandidateId } : {}),
    confirmedCandidateId: priorSelection?.confirmedCandidateId,
    updatedAt: now
  });
  return applyVisualAnchorReadiness({
    ...normalized,
    visualAnchorWorkspace: { ...workspace, [key]: [...previous, ...candidates], [selectionKey]: selections, updatedAt: now }
  }, now);
}

export function selectVisualAnchorCandidate(
  project: GenerationProject,
  kind: VisualAnchorCandidateKind,
  targetId: string,
  candidateId: string,
  now = new Date().toISOString()
): GenerationProject {
  const normalized = ensureVisualAnchorWorkspace(project, now);
  const workspace = normalized.visualAnchorWorkspace!;
  const key = kind === "character" ? "characterCandidates" : "sceneCandidates";
  const candidate = workspace[key].find((item) => item.id === candidateId && item.targetId === targetId && item.status !== "outdated");
  if (!candidate) throw new Error("VISUAL_ANCHOR_CANDIDATE_NOT_FOUND");
  const candidates = workspace[key].map((item) => {
    if (item.targetId !== targetId || item.status === "outdated") return item;
    return { ...item, status: item.id === candidateId ? "selected" as const : "ready" as const };
  });
  const selectionKey = kind === "character" ? "characterSelections" : "sceneSelections";
  const previousSelection = workspace[selectionKey]?.find((item) => item.targetId === targetId);
  const selections = upsertSelection(workspace[selectionKey] ?? [], {
    kind,
    targetId,
    status: "selected",
    setVersion: candidate.setVersion ?? candidate.version,
    selectedCandidateId: candidate.id,
    confirmedCandidateId: previousSelection?.confirmedCandidateId,
    updatedAt: now
  });
  return applyVisualAnchorReadiness({
    ...normalized,
    visualAnchorWorkspace: { ...workspace, [key]: candidates, [selectionKey]: selections, updatedAt: now }
  }, now);
}

export function lockVisualAnchorMaster(
  project: GenerationProject,
  kind: "product" | VisualAnchorCandidateKind,
  targetId?: string,
  now = new Date().toISOString()
): GenerationProject {
  const normalized = ensureVisualAnchorWorkspace(project, now);
  const workspace = normalized.visualAnchorWorkspace!;
  if (kind === "product") {
    const mainProduct = getProjectProductAssets(normalized).primaryAsset;
    if (!mainProduct?.assetId) throw new Error("PRODUCT_REFERENCE_REQUIRED");
    return applyVisualAnchorReadiness({
      ...normalized,
      referencePack: {
        ...(normalized.referencePack ?? emptyReferencePack()),
        productMasters: unique([mainProduct.assetId, ...(normalized.referencePack?.productMasters ?? [])]).slice(0, 3)
      },
      visualAnchorWorkspace: {
        ...workspace,
        productMaster: { ...workspace.productMaster, assetId: mainProduct.assetId, locked: true, lockedAt: now },
        updatedAt: now
      }
    }, now);
  }
  if (!targetId) throw new Error("VISUAL_ANCHOR_TARGET_REQUIRED");
  const selectionKey = kind === "character" ? "characterSelections" : "sceneSelections";
  const candidateKey = kind === "character" ? "characterCandidates" : "sceneCandidates";
  const selection = workspace[selectionKey]?.find((item) => item.targetId === targetId);
  const candidate = selection?.selectedCandidateId
    ? workspace[candidateKey].find((item) => item.id === selection.selectedCandidateId && item.targetId === targetId && item.status !== "outdated")
    : undefined;
  if (!candidate) throw new Error(kind === "character" ? "CHARACTER_MASTER_REQUIRED" : "SCENE_MASTER_REQUIRED");
  const confirmedSelections = upsertSelection(workspace[selectionKey] ?? [], {
    kind,
    targetId,
    status: "confirmed",
    setVersion: candidate.setVersion ?? candidate.version,
    selectedCandidateId: candidate.id,
    confirmedCandidateId: candidate.id,
    updatedAt: now
  });
  if (kind === "character") {
    const spec = normalized.characterVisualSpecs?.find((item) => item.id === targetId);
    if (!spec) throw new Error("CHARACTER_MASTER_REQUIRED");
    const assetId = candidate.assetId;
    return applyVisualAnchorReadiness(syncLockedReferences({
      ...normalized,
      characterVisualSpecs: normalized.characterVisualSpecs?.map((item) => item.id === targetId
        ? { ...item, masterAssetId: assetId, masterAssetIds: [assetId], locked: true, lockedAt: now }
        : item),
      visualAnchorWorkspace: { ...workspace, [selectionKey]: confirmedSelections, updatedAt: now }
    }), now);
  }
  const spec = normalized.sceneVisualSpecs?.find((item) => item.id === targetId);
  if (!spec) throw new Error("SCENE_MASTER_REQUIRED");
  const assetId = candidate.assetId;
  return applyVisualAnchorReadiness(syncLockedReferences({
    ...normalized,
    sceneVisualSpecs: normalized.sceneVisualSpecs?.map((item) => item.id === targetId
      ? { ...item, masterAssetId: assetId, masterAssetIds: [assetId], locked: true, lockedAt: now }
      : item),
    visualAnchorWorkspace: { ...workspace, [selectionKey]: confirmedSelections, updatedAt: now }
  }), now);
}

export function getVisualAnchorSelection(project: GenerationProject, kind: VisualAnchorCandidateKind, targetId: string) {
  const workspace = project.visualAnchorWorkspace;
  return workspace?.[kind === "character" ? "characterSelections" : "sceneSelections"]?.find((item) => item.targetId === targetId);
}

export function getVisualAnchorResourceId(kind: "product" | VisualAnchorCandidateKind, targetId?: string) {
  if (kind === "product") return "product-master";
  if (!targetId) throw new Error("VISUAL_ANCHOR_TARGET_REQUIRED");
  return `${kind}-master:${targetId}`;
}

export function currentMasterAssetId(spec: { masterAssetId?: string; masterAssetIds?: string[] }) {
  return spec.masterAssetId ?? spec.masterAssetIds?.[0];
}

export function canonicalSceneId(value: string) {
  return value.replace(/-(?:night|day|bright|fresh|recovery|fatigue)$/i, "");
}

function applyVisualAnchorReadiness(project: GenerationProject, now: string): GenerationProject {
  if (!project.visualAnchorWorkspace || !project.stageStates) return project;
  const readiness = getVisualAnchorReadiness(project);
  const current = project.stageStates.anchors;
  if (current.status === "blocked" || current.status === "locked" || current.status === "outdated") return project;
  const anchors = { status: readiness.ready ? "ready" as const : "draft" as const, updatedAt: Date.parse(now) };
  const stageStates: StageStates = { ...project.stageStates, anchors };
  return { ...project, stageStates };
}

function buildSelectionStates(
  kind: VisualAnchorCandidateKind,
  stored: VisualAnchorSelectionState[] | undefined,
  candidates: VisualAnchorCandidate[],
  specs: Array<{ id: string; masterAssetId?: string; masterAssetIds?: string[]; locked: boolean }>,
  now: string
) {
  return specs.map((spec) => {
    const existing = stored?.find((item) => item.targetId === spec.id);
    if (existing) return existing;
    const matching = candidates.filter((item) => item.targetId === spec.id);
    const active = matching.filter((item) => item.status !== "outdated");
    const selected = active.find((item) => item.status === "selected");
    const master = currentMasterAssetId(spec);
    const confirmed = spec.locked && master ? matching.find((item) => item.assetId === master) : undefined;
    const legacyConfirmed = Boolean(spec.locked && master);
    return {
      kind,
      targetId: spec.id,
      status: legacyConfirmed ? "confirmed" as const : selected ? "selected" as const : "generated" as const,
      setVersion: Math.max(1, ...active.map((item) => item.setVersion ?? item.version)),
      ...(selected ? { selectedCandidateId: selected.id } : {}),
      ...(confirmed ? { confirmedCandidateId: confirmed.id } : {}),
      updatedAt: now
    };
  });
}

function upsertSelection(states: VisualAnchorSelectionState[], next: VisualAnchorSelectionState) {
  return [...states.filter((item) => item.targetId !== next.targetId), next];
}

function buildCharacterBriefs(project: GenerationProject): CharacterAnchorBrief[] {
  const existing = new Map((project.visualAnchorWorkspace?.characterBriefs ?? []).map((brief) => [brief.id, brief]));
  return (project.visualContinuityBible?.characters ?? []).map((identity) => existing.get(identity.id) ?? {
    id: identity.id,
    role: identity.role,
    apparentAgeRange: identity.ageRange,
    faceAppearance: identity.faceDescription,
    hairstyle: identity.hairstyle,
    hairColor: identity.hairColor,
    skinTone: identity.skinTone,
    wardrobe: identity.wardrobe.join("、") || "保持同一服装造型",
    accessories: identity.accessories,
    bodyBuild: identity.bodyBuild,
    immutableTraits: identity.immutableTraits,
    states: inferCharacterStates(project, identity.id)
  });
}

function buildCharacterSpecs(project: GenerationProject, briefs: CharacterAnchorBrief[]): CharacterVisualSpec[] {
  const existing = new Map((project.characterVisualSpecs ?? []).map((spec) => [spec.id, spec]));
  return briefs.map((brief) => {
    const spec = existing.get(brief.id);
    return {
      id: brief.id,
      masterAssetId: currentMasterAssetId(spec ?? {}),
      masterAssetIds: currentMasterAssetId(spec ?? {}) ? [currentMasterAssetId(spec ?? {})!] : [],
      apparentAgeRange: brief.apparentAgeRange,
      faceAppearance: brief.faceAppearance,
      role: brief.role,
      faceDescription: brief.faceAppearance,
      hairstyle: brief.hairstyle,
      hairColor: brief.hairColor,
      skinTone: brief.skinTone,
      wardrobe: spec?.wardrobe ?? [brief.wardrobe],
      accessories: brief.accessories,
      bodyBuild: brief.bodyBuild,
      immutableTraits: brief.immutableTraits,
      states: brief.states,
      version: spec?.version ?? (resourceVersion(project, `character-master:${brief.id}`) || 1),
      locked: Boolean(spec?.locked && currentMasterAssetId(spec)),
      ...(spec?.lockedAt ? { lockedAt: spec.lockedAt } : {})
    };
  });
}

function buildSceneSpecs(project: GenerationProject): SceneVisualSpec[] {
  const existing = new Map((project.sceneVisualSpecs ?? []).map((spec) => [canonicalSceneId(spec.id), spec]));
  const groups = new Map<string, NonNullable<GenerationProject["visualContinuityBible"]>["scenes"]>();
  for (const scene of project.visualContinuityBible?.scenes ?? []) {
    const id = canonicalSceneId(scene.id);
    groups.set(id, [...(groups.get(id) ?? []), scene]);
  }
  return [...groups.entries()].map(([id, identities]) => {
    const identity = identities[0]!;
    const spec = existing.get(id);
    const masterAssetId = currentMasterAssetId(spec ?? {});
    return {
      id,
      masterAssetId,
      masterAssetIds: masterAssetId ? [masterAssetId] : [],
      name: spec?.name ?? identity.name,
      architecture: spec?.architecture ?? identity.architecture,
      furniture: spec?.furniture ?? unique(identities.flatMap((item) => item.furniture)),
      heroProps: spec?.heroProps ?? unique(identities.flatMap((item) => item.heroProps)),
      timeOfDay: spec?.timeOfDay ?? unique(identities.map((item) => item.timeOfDay)).join(" → "),
      lightingDirection: spec?.lightingDirection ?? identity.lightingDirection,
      lightingQuality: spec?.lightingQuality ?? identity.lightingQuality,
      palette: spec?.palette ?? unique(identities.flatMap((item) => item.palette)),
      immutableTraits: spec?.immutableTraits ?? unique(identities.flatMap((item) => item.immutableTraits)),
      layout: spec?.layout ?? inferSceneLayout(identity),
      states: spec?.states ?? inferSceneStates(project, id, identities),
      version: spec?.version ?? (resourceVersion(project, `scene-master:${id}`) || 1),
      locked: Boolean(spec?.locked && masterAssetId),
      ...(spec?.lockedAt ? { lockedAt: spec.lockedAt } : {})
    };
  });
}

function selectRequiredSceneSpecs(project: GenerationProject, specs: SceneVisualSpec[]): SceneVisualSpec[] {
  if (specs.length <= 1) return specs;
  const frequency = new Map<string, number>();
  for (const shot of project.shots) {
    const id = canonicalSceneId(shot.sceneId ?? "");
    if (id) frequency.set(id, (frequency.get(id) ?? 0) + 1);
  }
  const ordered = [...specs].sort((left, right) => (frequency.get(right.id) ?? 0) - (frequency.get(left.id) ?? 0));
  const main = ordered[0]!;
  const productDisplay = ordered.slice(1).find((spec) => {
    const related = project.shots.filter((shot) => canonicalSceneId(shot.sceneId ?? "") === spec.id);
    const text = [spec.name, spec.architecture, ...spec.heroProps, ...related.flatMap((shot) => [shot.goal, shot.visualDescription])].join(" ");
    return /产品展示|商品展示|包装展示|静物台|陈列台|packshot|product display|hero product/i.test(text);
  });
  return productDisplay ? [main, productDisplay] : [main];
}

function syncLockedReferences(project: GenerationProject): GenerationProject {
  const characterAssets = new Map((project.characterVisualSpecs ?? []).flatMap((spec) => spec.locked && currentMasterAssetId(spec)
    ? [[spec.id, currentMasterAssetId(spec)!] as const]
    : []));
  const sceneAssets = new Map((project.sceneVisualSpecs ?? []).flatMap((spec) => spec.locked && currentMasterAssetId(spec)
    ? [[spec.id, currentMasterAssetId(spec)!] as const]
    : []));
  return {
    ...project,
    referencePack: {
      ...(project.referencePack ?? emptyReferencePack()),
      characterMasters: unique([...characterAssets.values()]).slice(0, 12),
      sceneMasters: unique([...sceneAssets.values()]).slice(0, 12)
    },
    visualContinuityBible: project.visualContinuityBible ? {
      ...project.visualContinuityBible,
      characters: project.visualContinuityBible.characters.map((identity) => {
        const assetId = characterAssets.get(identity.id);
        return assetId ? { ...identity, referenceAssetIds: unique([assetId, ...identity.referenceAssetIds]).slice(0, 3) } : identity;
      }),
      scenes: project.visualContinuityBible.scenes.map((identity) => {
        const assetId = sceneAssets.get(canonicalSceneId(identity.id));
        return assetId ? { ...identity, referenceAssetIds: unique([assetId, ...identity.referenceAssetIds]).slice(0, 3) } : identity;
      })
    } : undefined,
    shots: project.shots.map((shot) => {
      const masterIds = unique([
        ...(shot.characterIds ?? []).flatMap((id) => characterAssets.get(id) ?? []),
        ...(shot.sceneId && sceneAssets.get(canonicalSceneId(shot.sceneId)) ? [sceneAssets.get(canonicalSceneId(shot.sceneId))!] : [])
      ]);
      return { ...shot, referenceImageAssetIds: unique([...(shot.referenceImageAssetIds ?? []), ...masterIds]).slice(0, 12) };
    })
  };
}

function inferCharacterStates(project: GenerationProject, characterId: string) {
  const relevant = project.shots.filter((shot) => shot.characterIds?.includes(characterId));
  const text = relevant.map((shot) => `${shot.goal} ${shot.visualDescription}`).join(" ");
  const states: CharacterAnchorBrief["states"] = [];
  if (/疲惫|压力|困倦|fatigue|tired/i.test(text)) {
    states.push({ id: `${characterId}:fatigue`, label: "疲惫", description: "低能量、轻疲惫；人物身份、发型与服装不变。" });
  }
  if (/恢复|清醒|自信|fresh|recover|confident/i.test(text)) {
    states.push({ id: `${characterId}:recovery`, label: "恢复", description: "逐渐清醒自信；只改变表情与姿态，不改变人物身份。" });
  }
  return states.length ? states : [{ id: `${characterId}:base`, label: "基础状态", description: "身份、发型、服装与配饰保持固定。" }];
}

function inferSceneStates(
  project: GenerationProject,
  sceneId: string,
  identities: NonNullable<GenerationProject["visualContinuityBible"]>["scenes"]
): SceneAnchorState[] {
  const stateIds = unique(project.shots.filter((shot) => canonicalSceneId(shot.sceneId ?? "") === sceneId)
    .map((shot) => shot.sceneStateId ?? inferSceneStateId(shot, shot.sceneId ?? sceneId)));
  const values = stateIds.length ? stateIds : identities.map((identity) => identity.id);
  return values.map((id, index) => {
    const identity = identities.find((item) => item.id === id) ?? identities[index] ?? identities[0]!;
    const timeOfDay = /night/i.test(id) ? "night" : /day|bright|fresh/i.test(id) ? "day" : identity.timeOfDay;
    return {
      id,
      label: timeOfDay === "night" ? "Night / Cold / Fatigue" : timeOfDay === "day" ? "Bright / Fresh / Recovery" : identity.timeOfDay,
      timeOfDay,
      lighting: `${identity.lightingDirection}；${identity.lightingQuality}`,
      mood: timeOfDay === "night" ? "低能量、冷静、轻压力" : timeOfDay === "day" ? "清晰、明亮、恢复" : "服从叙事状态",
      allowedChanges: ["lighting", "weather", "small prop state", "character position"]
    };
  });
}

function inferSceneLayout(scene: NonNullable<GenerationProject["visualContinuityBible"]>["scenes"][number]): SceneLayout {
  const named = unique([...scene.furniture, ...scene.heroProps]).slice(0, 5);
  const anchors = named.map((name, index) => ({
    id: slug(name, `anchor-${index + 1}`),
    semanticPosition: ["foreground-center", "background-right", "desk-left", "desk-right", "center-left"][index] ?? "fixed-relative-position"
  }));
  return { anchors: anchors.length ? anchors : [{ id: "scene-center", semanticPosition: "foreground-center" }] };
}

function inferSceneStateId(shot: GenerationProject["shots"][number], sourceId: string) {
  const text = `${sourceId} ${shot.goal} ${shot.visualDescription}`;
  const base = canonicalSceneId(sourceId);
  if (/深夜|夜间|夜景|night/i.test(text)) return `${base}-night`;
  if (/白天|日间|晨光|明亮|daylight|daytime|bright/i.test(text)) return `${base}-day`;
  return base;
}

function remapSceneStateId(stateId: string | undefined, sceneId: string) {
  if (!stateId) return sceneId;
  if (/-night$/i.test(stateId)) return `${sceneId}-night`;
  if (/-day|-bright|-fresh|-recovery$/i.test(stateId)) return `${sceneId}-day`;
  return sceneId;
}


function resourceVersion(project: GenerationProject, resourceId: string) {
  return Math.max(0, ...(project.resourceVersions ?? []).filter((item) => item.resourceId === resourceId && item.status === "current").map((item) => item.version));
}

function emptyReferencePack() {
  return { productMasters: [], characterMasters: [], sceneMasters: [], continuityAnchors: [] };
}

function slug(value: string, fallback: string) {
  const result = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
  return result || fallback;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
