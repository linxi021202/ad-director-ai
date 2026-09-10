import type {
  GenerationProject,
  ReferencePack,
  StoryboardShot,
  VisualContinuityBible
} from "../schemas/project";
import { canonicalSceneId, currentMasterAssetId, ensureVisualAnchorWorkspace } from "../visual/visualAnchors";

export function buildVisualMasterSpecs(project: GenerationProject) {
  const normalized = ensureVisualAnchorWorkspace(project);
  return {
    characterVisualSpecs: normalized.characterVisualSpecs ?? [],
    sceneVisualSpecs: normalized.sceneVisualSpecs ?? []
  };
}

export function selectLockedMasterAssetIds(project: GenerationProject, shot: StoryboardShot) {
  const characterIds = new Set(shot.characterIds ?? []);
  const ids = [
    ...(project.characterVisualSpecs ?? [])
      .filter((spec) => spec.locked && currentMasterAssetId(spec) && characterIds.has(spec.id))
      .map((spec) => currentMasterAssetId(spec)!),
    ...(project.sceneVisualSpecs ?? [])
      .filter((spec) => spec.locked && currentMasterAssetId(spec) && spec.id === canonicalSceneId(shot.sceneId ?? ""))
      .map((spec) => currentMasterAssetId(spec)!)
  ];
  return Array.from(new Set(ids));
}

export function lockShotVisualMasters(
  project: GenerationProject,
  shot: StoryboardShot,
  assetId: string,
  lockedAt = new Date().toISOString()
) {
  const base = buildVisualMasterSpecs(project);
  const characterIds = new Set(shot.characterIds ?? []);
  const characterVisualSpecs = base.characterVisualSpecs.map((spec) =>
    characterIds.has(spec.id) && !spec.locked
      ? { ...spec, masterAssetId: assetId, masterAssetIds: [assetId], locked: true, lockedAt }
      : spec
  );
  const sceneVisualSpecs = base.sceneVisualSpecs.map((spec) =>
    spec.id === canonicalSceneId(shot.sceneId ?? "") && !spec.locked
      ? { ...spec, masterAssetId: assetId, masterAssetIds: [assetId], locked: true, lockedAt }
      : spec
  );
  const characterMasterIds = characterVisualSpecs.flatMap((spec) => spec.locked && currentMasterAssetId(spec) ? [currentMasterAssetId(spec)!] : []);
  const sceneMasterIds = sceneVisualSpecs.flatMap((spec) => spec.locked && currentMasterAssetId(spec) ? [currentMasterAssetId(spec)!] : []);
  const referencePack: ReferencePack | undefined = project.referencePack ? {
    ...project.referencePack,
    characterMasters: unique([...project.referencePack.characterMasters, ...characterMasterIds]).slice(0, 3),
    sceneMasters: unique([...project.referencePack.sceneMasters, ...sceneMasterIds]).slice(0, 3)
  } : undefined;
  const visualContinuityBible: VisualContinuityBible | undefined = project.visualContinuityBible ? {
    ...project.visualContinuityBible,
    characters: project.visualContinuityBible.characters.map((identity) => characterIds.has(identity.id)
      ? { ...identity, referenceAssetIds: unique([...identity.referenceAssetIds, assetId]).slice(0, 3) }
      : identity),
    scenes: project.visualContinuityBible.scenes.map((identity) => canonicalSceneId(identity.id) === canonicalSceneId(shot.sceneId ?? "")
      ? { ...identity, referenceAssetIds: unique([...identity.referenceAssetIds, assetId]).slice(0, 3) }
      : identity)
  } : undefined;
  const masterAssetByCharacter = new Map(characterVisualSpecs.flatMap((spec) => currentMasterAssetId(spec) ? [[spec.id, currentMasterAssetId(spec)!] as const] : []));
  const masterAssetByScene = new Map(sceneVisualSpecs.flatMap((spec) => currentMasterAssetId(spec) ? [[spec.id, currentMasterAssetId(spec)!] as const] : []));
  const shots = project.shots.map((projectShot) => {
    const required = unique([
      ...(projectShot.referenceImageAssetIds ?? []),
      ...(projectShot.characterIds ?? []).flatMap((id) => masterAssetByCharacter.get(id) ?? []),
      ...(projectShot.sceneId && masterAssetByScene.get(canonicalSceneId(projectShot.sceneId)) ? [masterAssetByScene.get(canonicalSceneId(projectShot.sceneId))!] : [])
    ]);
    return { ...projectShot, referenceImageAssetIds: required.slice(0, 12) };
  });
  return { characterVisualSpecs, sceneVisualSpecs, referencePack, visualContinuityBible, shots };
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
