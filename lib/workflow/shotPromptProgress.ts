import type { GenerationEvent, GenerationProject } from "../schemas/project";
import { isShotPromptReady } from "../prompts/shotPromptReadiness";
import { matchesShotPromptInputFingerprint } from "../prompts/shotPromptFingerprint";

export type ShotPromptStatus = "not-started" | "queued" | "generating" | "checking" | "completed" | "failed" | "outdated";

export function deriveShotPromptProgress(
  shotIds: string[],
  completedShotIds: ReadonlySet<string>,
  events: readonly GenerationEvent[],
  outdatedShotIds: ReadonlySet<string> = new Set()
) {
  const latest = new Map<string, GenerationEvent>();
  for (const event of events) {
    if (event.stage === "prompts" && event.shotId && shotIds.includes(event.shotId)) {
      const previous = latest.get(event.shotId);
      if (!previous || event.startedAt >= previous.startedAt) latest.set(event.shotId, event);
    }
  }
  const shots = shotIds.map((shotId) => {
    if (completedShotIds.has(shotId)) return { shotId, status: "completed" as ShotPromptStatus };
    const event = latest.get(shotId);
    const status: ShotPromptStatus = outdatedShotIds.has(shotId) ? "outdated"
      : event?.status === "failed" ? "failed"
      : event?.status === "qa-review" ? "checking"
      : event?.status === "running" ? "generating"
      : event?.status === "queued" ? "queued"
      : "not-started";
    return { shotId, status };
  });
  return {
    shots,
    completed: shots.filter((shot) => shot.status === "completed").length,
    failed: shots.filter((shot) => shot.status === "failed").length,
    notStarted: shots.filter((shot) => shot.status === "not-started").length
  };
}

export function derivePromptStageShotState(project: GenerationProject, shotId: string) {
  const shot = project.shots.find((item) => item.id === shotId);
  const totalFrames = shot?.frames?.length ?? 0;
  const frameIds = new Set(shot?.frames?.map((frame) => frame.id) ?? []);
  const input = shot ? { brief: project.brief, strategy: project.strategy, shot,
    previousShot: project.shots.find((item) => item.index === shot.index - 1),
    productVisualSpec: project.productVisualSpec, visualContinuityBible: project.visualContinuityBible,
    referencePack: project.referencePack } : undefined;
  const ready = Boolean(shot && isShotPromptReady(project, shot));
  if (ready) return { shotId, status: "ready" as const, completedFrames: totalFrames, completedFrameCount: totalFrames,
    totalFrames, totalFrameCount: totalFrames, completedFrameIds: [...frameIds], failedFrameIds: [] as string[],
    hasPersistedPromptBundle: true, reason: undefined };
  const latest = (project.generationEvents ?? []).filter((item) => item.stage === "prompts" && item.shotId === shotId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  const draft = project.shotPromptDrafts?.find((item) => item.shotId === shotId && input
    && matchesShotPromptInputFingerprint(item.inputFingerprint, input));
  const completedFrames = draft?.framePrompts.filter((frame) => frameIds.has(frame.frameId)).length ?? 0;
  const partial = Boolean(draft?.foundation || completedFrames);
  const status = latest && ["running", "queued", "qa-review"].includes(latest.status) ? "generating" as const
    : partial ? "partial" as const
    : latest && ["failed", "interrupted"].includes(latest.status) ? "failed" as const
    : "not_started" as const;
  const completedFrameIds = new Set(draft?.framePrompts.map((frame) => frame.frameId) ?? []);
  return { shotId, status, completedFrames, completedFrameCount: completedFrames, totalFrames, totalFrameCount: totalFrames,
    completedFrameIds: [...completedFrameIds].filter((id) => frameIds.has(id)),
    failedFrameIds: latest && ["failed", "interrupted"].includes(latest.status)
      ? [...frameIds].filter((id) => !completedFrameIds.has(id)) : [],
    hasPersistedPromptBundle: false, reason: latest?.errorCode };
}

export function derivePromptStageProgress(project: GenerationProject) {
  const shots = project.shots.map((shot) => derivePromptStageShotState(project, shot.id));
  return {
    shots,
    completed: shots.filter((shot) => shot.status === "ready").length,
    failed: shots.filter((shot) => shot.status === "failed" || shot.status === "partial" && Boolean(shot.reason)).length,
    notStarted: shots.filter((shot) => shot.status === "not_started").length,
    failedShots: project.shots.filter((shot) => {
      const current = shots.find((item) => item.shotId === shot.id)!;
      return current.status === "failed" || current.status === "partial" && Boolean(current.reason);
    })
  };
}
