import type { StoryboardShot } from "@/lib/schemas/project";
import {
  DEFAULT_FPS,
  DEFAULT_SHOT_COUNT,
  DEFAULT_SHOT_DURATION_SEC,
  createDefaultShotDurations,
  getDefaultHeroShotArrayIndex,
  getProjectDurationSec,
  validateShotConfiguration
} from "./shotConfig";

export * from "./shotConfig";

/** Compatibility exports for existing previews and legacy fixtures. */
export const DEFAULT_AD_DURATION_SEC = DEFAULT_SHOT_COUNT * DEFAULT_SHOT_DURATION_SEC;
export const DEFAULT_SHOT_DURATIONS_SEC = createDefaultShotDurations(DEFAULT_SHOT_COUNT);
export const DEFAULT_HERO_SHOT_INDEX = getDefaultHeroShotArrayIndex(DEFAULT_SHOT_COUNT);
export const MIN_AD_DURATION_SEC = 9;
export const MAX_AD_DURATION_SEC = 96;
export const SUPPORTED_AD_DURATIONS_SEC = [] as const;

/** @deprecated New flows select shot count directly. */
export function getShotCountForDuration(targetDurationSec: number): number {
  return Math.min(12, Math.max(3, Math.round(targetDurationSec / DEFAULT_SHOT_DURATION_SEC)));
}

/** @deprecated Pass a shot count to createDefaultShotDurations instead. */
export function getDefaultShotDurations(targetDurationSec: number): number[] {
  return createDefaultShotDurations(getShotCountForDuration(targetDurationSec));
}

export { getProjectDurationSec };

export function validateShotDurations(
  shots: Pick<StoryboardShot, "durationSec">[],
  targetDurationSec: number
): { valid: boolean; totalDurationSec: number; errors: string[] } {
  const result = validateShotConfiguration(shots.length, shots);
  const errors = result.errors.map((item) => item.message);
  if (result.totalDurationSec !== Math.round(targetDurationSec)) errors.push("镜头时长总和与目标时长不一致。");
  return { valid: errors.length === 0, totalDurationSec: result.totalDurationSec, errors };
}

export function getDurationInFrames(shots: Pick<StoryboardShot, "durationSec">[], fps = DEFAULT_FPS): number {
  return Math.round(sumShotDurations(shots) * fps);
}

export function sumShotDurations(shots: Pick<StoryboardShot, "durationSec">[]): number {
  return shots.reduce((sum, shot) => sum + Math.max(0, shot.durationSec), 0);
}