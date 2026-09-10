import type { GenerationProject } from "@/lib/schemas/project";

export function projectReferencesAsset(project: GenerationProject, assetId: string): boolean {
  if (project.finalVideoAssetId === assetId || project.narrationAssetId === assetId || project.backgroundMusicAssetId === assetId) {
    return true;
  }
  if (project.heroVideo?.assetId === assetId || project.finalVideo?.assetId === assetId) return true;
  if (project.brief.productImages?.some((image) => image.assetId === assetId)) return true;
  if (project.keyframes?.some((frame) => frame.assetId === assetId)) return true;
  if (project.narrationPlan?.beats.some((beat) => beat.assetId === assetId)) return true;
  if (project.visualAnchorWorkspace?.characterCandidates.some((candidate) => candidate.assetId === assetId)) return true;
  if (project.visualAnchorWorkspace?.sceneCandidates.some((candidate) => candidate.assetId === assetId)) return true;
  if (project.visualAnchorWorkspace?.productMaster.assetId === assetId) return true;
  if (project.characterVisualSpecs?.some((spec) => spec.masterAssetId === assetId || spec.masterAssetIds?.includes(assetId))) return true;
  if (project.sceneVisualSpecs?.some((spec) => spec.masterAssetId === assetId || spec.masterAssetIds?.includes(assetId))) return true;
  return false;
}

export function collectReferencedAssetIds(project: GenerationProject): string[] {
  return [...new Set([
    project.finalVideoAssetId,
    project.narrationAssetId,
    project.backgroundMusicAssetId,
    project.heroVideo?.assetId,
    project.finalVideo?.assetId,
    ...(project.brief.productImages ?? []).map((image) => image.assetId),
    ...(project.keyframes ?? []).map((frame) => frame.assetId),
    ...(project.narrationPlan?.beats ?? []).map((beat) => beat.assetId),
    project.visualAnchorWorkspace?.productMaster.assetId,
    ...(project.visualAnchorWorkspace?.characterCandidates ?? []).map((candidate) => candidate.assetId),
    ...(project.visualAnchorWorkspace?.sceneCandidates ?? []).map((candidate) => candidate.assetId),
    ...(project.characterVisualSpecs ?? []).flatMap((spec) => [spec.masterAssetId, ...(spec.masterAssetIds ?? [])]),
    ...(project.sceneVisualSpecs ?? []).flatMap((spec) => [spec.masterAssetId, ...(spec.masterAssetIds ?? [])])
  ].filter((value): value is string => Boolean(value)))];
}
