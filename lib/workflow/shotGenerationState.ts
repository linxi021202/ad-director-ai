import type { DetailedShotPromptPackage, GenerationProject } from "../schemas/project";

export type ShotGenerationState = "storyboard_ready" | "prompt_generating" | "prompt_partial" | "prompt_failed" | "prompt_ready"
  | "keyframe_generating" | "keyframe_partial" | "keyframe_failed" | "keyframe_ready";

type ShotPipelineSnapshot = Pick<GenerationProject, "shots" | "generationEvents" | "keyframes" | "shotPromptDrafts"> & {
  shotPromptPackages?: Array<Pick<DetailedShotPromptPackage, "shotId" | "schemaVersion" | "inputFingerprint">>;
};
export function deriveShotGenerationState(project: ShotPipelineSnapshot, shotId: string, busy = false): ShotGenerationState {
  const shot = project.shots.find((item) => item.id === shotId);
  const ready = project.shotPromptPackages?.some((item) => item.shotId === shotId && item.schemaVersion === 2 && item.inputFingerprint);
  const promptEvent = project.generationEvents?.filter((event) => event.stage === "prompts" && event.shotId === shotId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const imageEvent = project.generationEvents?.filter((event) => event.stage === "keyframes" && event.shotId === shotId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const images = project.keyframes?.filter((item) => item.shotId === shotId && item.status === "ready") ?? [];
  if (images.length && images.length >= (shot?.frames?.length ?? 1)) return "keyframe_ready";
  if (ready) {
    if (busy || imageEvent && ["queued", "running", "qa-review"].includes(imageEvent.status)) return "keyframe_generating";
    if (images.length) return "keyframe_partial";
    if (imageEvent && ["failed", "interrupted"].includes(imageEvent.status)) return "keyframe_failed";
    return "prompt_ready";
  }
  if (busy || promptEvent && ["queued", "running", "qa-review"].includes(promptEvent.status)) return "prompt_generating";
  const draft = project.shotPromptDrafts?.find((item) => item.shotId === shotId);
  if (draft?.foundation || draft?.framePrompts.length) return "prompt_partial";
  if (promptEvent && ["failed", "interrupted"].includes(promptEvent.status)) return "prompt_failed";
  return "storyboard_ready";
}
