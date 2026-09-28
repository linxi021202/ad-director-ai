import { getShotKeyframeViewState, type KeyframeProjectSnapshot } from "../image/keyframeViewState";

export type ShotGenerationState = "storyboard_ready" | "prompt_generating" | "prompt_partial" | "prompt_failed" | "prompt_ready"
  | "keyframe_generating" | "keyframe_partial" | "keyframe_failed" | "keyframe_ready";

export function deriveShotGenerationState(project: KeyframeProjectSnapshot, shotId: string, busy = false): ShotGenerationState {
  const view = getShotKeyframeViewState(project, shotId, busy);
  const ready = view.promptStatus === "ready";
  const promptEvent = project.generationEvents?.filter((event) => event.stage === "prompts" && event.shotId === shotId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (view.keyframeGenerationStatus === "completed") return "keyframe_ready";
  if (view.hasAnyKeyframe) return view.keyframeGenerationStatus === "generating" ? "keyframe_generating" : "keyframe_partial";
  if (ready) {
    if (view.keyframeGenerationStatus === "generating") return "keyframe_generating";
    if (view.keyframeGenerationStatus === "failed") return "keyframe_failed";
    return "prompt_ready";
  }
  if (busy || promptEvent && ["queued", "running", "qa-review"].includes(promptEvent.status)) return "prompt_generating";
  const draft = project.shotPromptDrafts?.find((item) => item.shotId === shotId);
  if (draft?.foundation || draft?.framePrompts.length) return "prompt_partial";
  if (promptEvent && ["failed", "interrupted"].includes(promptEvent.status)) return "prompt_failed";
  return "storyboard_ready";
}
