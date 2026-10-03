import { getShotKeyframeViewState, type KeyframeProjectSnapshot } from "../image/keyframeViewState";
import { derivePromptStageShotState } from "./shotPromptProgress";

export type ShotGenerationState = "storyboard_ready" | "prompt_generating" | "prompt_partial" | "prompt_failed" | "prompt_ready"
  | "keyframe_generating" | "keyframe_partial" | "keyframe_failed" | "keyframe_ready";

export function deriveShotGenerationState(project: KeyframeProjectSnapshot, shotId: string, busy = false): ShotGenerationState {
  const view = getShotKeyframeViewState(project, shotId, busy);
  const prompt = derivePromptStageShotState(project, shotId);
  const ready = prompt.status === "ready";
  if (view.keyframeGenerationStatus === "completed") return "keyframe_ready";
  if (view.hasAnyKeyframe) return view.keyframeGenerationStatus === "generating" ? "keyframe_generating" : "keyframe_partial";
  if (ready) {
    if (view.keyframeGenerationStatus === "generating") return "keyframe_generating";
    if (view.keyframeGenerationStatus === "failed") return "keyframe_failed";
    return "prompt_ready";
  }
  if (busy || prompt.status === "generating") return "prompt_generating";
  if (prompt.status === "partial") return "prompt_partial";
  if (prompt.status === "failed") return "prompt_failed";
  return "storyboard_ready";
}
