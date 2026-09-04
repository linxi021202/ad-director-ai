import type { GenerationProject } from "@/lib/schemas/project";

export function projectReferencesAsset(project: GenerationProject, assetId: string): boolean {
  if (project.finalVideoAssetId === assetId || project.narrationAssetId === assetId || project.backgroundMusicAssetId === assetId) {
    return true;
  }
  if (project.heroVideo?.assetId === assetId || project.finalVideo?.assetId === assetId) return true;
  if (project.brief.productImages?.some((image) => image.assetId === assetId)) return true;
  if (project.keyframes?.some((frame) => frame.assetId === assetId)) return true;
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
    ...(project.keyframes ?? []).map((frame) => frame.assetId)
  ].filter((value): value is string => Boolean(value)))];
}
