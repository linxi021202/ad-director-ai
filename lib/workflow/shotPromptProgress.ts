import type { GenerationEvent } from "../schemas/project";

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
