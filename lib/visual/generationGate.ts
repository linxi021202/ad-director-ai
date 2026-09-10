import type { GenerationProject } from "../schemas/project";

export function hasApprovedKeyframeQA(project: GenerationProject, shotId: string, frameId?: string) {
  const frame = project.keyframes?.find((item) => item.shotId === shotId && (!frameId || item.frameId === frameId));
  if (!frame?.assetId || frame.status !== "ready" || frame.fallbackUsed) return false;
  return Boolean((project.keyframeQAResults ?? []).some((result) =>
    result.shotId === shotId && (!frameId || result.frameId === frameId) && result.assetId === frame.assetId && result.overallPassed
  ));
}

export function hasApprovedVideoQA(project: GenerationProject, shotId: string) {
  if (project.heroVideo?.shotId !== shotId || project.heroVideo.status !== "ready") return false;
  if (!project.heroVideo.assetId) return false;
  if (project.heroVideo.source === "user-upload" || project.heroVideo.source === "happyhorse-manual-import") return true;
  return Boolean((project.videoQAResults ?? []).some((result) =>
    result.shotId === shotId && result.overallPassed
  ));
}
