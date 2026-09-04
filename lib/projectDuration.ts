import type { GenerationProject } from "@/lib/schemas/project";
import { getProjectDurationSec } from "@/lib/video/durationConfig";

/**
 * Keeps legacy project shots untouched. The effective playback duration always comes from
 * persisted shot durations, while brief.durationSec remains the user's requested duration.
 */
export function normalizeProjectDuration(project: GenerationProject): GenerationProject {
  const actualDurationSec = getProjectDurationSec(project);
  if (project.durationSec === actualDurationSec) return project;
  return { ...project, durationSec: actualDurationSec };
}