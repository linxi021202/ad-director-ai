import type { GenerationProject } from "./schemas/project";

export function normalizeProjectDuration(project: GenerationProject, fallbackDurationSec = 28): GenerationProject {
  const requested = Math.round(project.brief.durationSec || fallbackDurationSec);
  const target = requested >= 25 && requested <= 30 ? requested : fallbackDurationSec;
  const sourceTotal = project.shots.reduce((sum, shot) => sum + Math.max(1, shot.durationSec), 0);
  if (project.brief.durationSec === target && sourceTotal === target) return project;
  const minimum = project.shots.length;
  const distributable = Math.max(0, target - minimum);
  const weighted = project.shots.map((shot, index) => {
    const raw = sourceTotal > 0 ? (Math.max(1, shot.durationSec) / sourceTotal) * distributable : distributable / project.shots.length;
    return { index, seconds: 1 + Math.floor(raw), remainder: raw - Math.floor(raw) };
  });
  let allocated = weighted.reduce((sum, item) => sum + item.seconds, 0);
  const priority = [...weighted].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let cursor = 0; allocated < target; cursor += 1) {
    priority[cursor % priority.length]!.seconds += 1;
    allocated += 1;
  }
  const durations = weighted.sort((a, b) => a.index - b.index).map((item) => item.seconds);
  return {
    ...project,
    brief: { ...project.brief, durationSec: target },
    shots: project.shots.map((shot, index) => ({ ...shot, durationSec: durations[index] ?? shot.durationSec })),
    updatedAt: new Date().toISOString()
  };
}

