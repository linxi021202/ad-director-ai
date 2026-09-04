export const MIN_SHOT_COUNT = 3;
export const MAX_SHOT_COUNT = 12;
export const DEFAULT_SHOT_COUNT = 8;

export const MIN_SHOT_DURATION_SEC = 3;
export const MAX_SHOT_DURATION_SEC = 8;
export const DEFAULT_SHOT_DURATION_SEC = 5;
export const MIN_TARGET_DURATION_SEC = 12;
export const MAX_TARGET_DURATION_SEC = 60;
export const DEFAULT_TARGET_DURATION_SEC = 40;
export const DEFAULT_FPS = 30;

type ShotDuration = { durationSec?: number };
type ProjectTimeline = {
  shots: ShotDuration[];
  shotCount?: number;
  durationSec?: number;
  brief?: { durationSec?: number };
};

export type ShotConfigurationErrorCode =
  | "INVALID_SHOT_COUNT"
  | "INVALID_SHOT_DURATION"
  | "SHOT_COUNT_MISMATCH"
  | "SHOT_DURATION_PLAN_MISMATCH";

export type ShotConfigurationValidation = {
  valid: boolean;
  totalDurationSec: number;
  errors: Array<{ code: ShotConfigurationErrorCode; message: string }>;
};

export function clampShotCount(value: number): number {
  return Math.min(MAX_SHOT_COUNT, Math.max(MIN_SHOT_COUNT, Math.round(value)));
}

export function clampShotDuration(value: number): number {
  return Math.min(MAX_SHOT_DURATION_SEC, Math.max(MIN_SHOT_DURATION_SEC, Math.round(value)));
}

export function getAllowedTargetDurationRange(shotCount: number): { min: number; max: number } {
  const count = clampShotCount(shotCount);
  return {
    min: Math.max(MIN_TARGET_DURATION_SEC, count * MIN_SHOT_DURATION_SEC),
    max: Math.min(MAX_TARGET_DURATION_SEC, count * MAX_SHOT_DURATION_SEC)
  };
}

export function clampTargetDuration(shotCount: number, targetDurationSec: number): number {
  const range = getAllowedTargetDurationRange(shotCount);
  const rounded = Number.isFinite(targetDurationSec) ? Math.round(targetDurationSec) : DEFAULT_TARGET_DURATION_SEC;
  return Math.min(range.max, Math.max(range.min, rounded));
}

/**
 * Produces a stable, balanced timeline. Extra seconds go to the central product
 * shots first, then the CTA, without creating alternating short/long jumps.
 */
export function allocateShotDurations(shotCount: number, targetDurationSec: number): number[] {
  const count = clampShotCount(shotCount);
  const target = clampTargetDuration(count, targetDurationSec);
  const base = Math.floor(target / count);
  const durations = Array.from({ length: count }, () => base);
  const remainder = target - base * count;
  const leftCenter = Math.floor((count - 1) / 2);
  const rightCenter = Math.ceil((count - 1) / 2);
  const priority: number[] = [];
  const add = (index: number) => {
    if (index >= 0 && index < count && !priority.includes(index)) priority.push(index);
  };

  add(leftCenter);
  add(rightCenter);
  add(count - 1);
  for (let distance = 1; priority.length < count; distance += 1) {
    add(leftCenter - distance);
    add(rightCenter + distance);
  }
  for (let index = 0; index < remainder; index += 1) durations[priority[index]!] += 1;
  return durations;
}

export function createDefaultShotDurations(shotCount = DEFAULT_SHOT_COUNT): number[] {
  const count = clampShotCount(shotCount);
  return allocateShotDurations(count, count * DEFAULT_SHOT_DURATION_SEC);
}

export function resolveShotPlan(
  requestedShotCount?: number,
  requestedPlan?: number[],
  targetDurationSec?: number
): { shotCount: number; targetDurationSec: number; shotDurationPlan: number[]; totalDurationSec: number } {
  const requestedPlanTotal = requestedPlan?.reduce((sum, duration) => sum + duration, 0);
  const requestedTarget = targetDurationSec ?? requestedPlanTotal ?? DEFAULT_TARGET_DURATION_SEC;
  const inferredCount = requestedPlan && requestedPlan.length > 0
    ? requestedPlan.length
    : Math.round(requestedTarget / DEFAULT_SHOT_DURATION_SEC);
  const shotCount = clampShotCount(requestedShotCount ?? inferredCount);
  const target = clampTargetDuration(shotCount, requestedTarget);
  const shotDurationPlan = requestedPlan?.length === shotCount
    && requestedPlan.every((duration) => Number.isInteger(duration) && duration >= MIN_SHOT_DURATION_SEC && duration <= MAX_SHOT_DURATION_SEC)
    && requestedPlan.reduce((sum, duration) => sum + duration, 0) === target
    ? [...requestedPlan]
    : allocateShotDurations(shotCount, target);
  return {
    shotCount,
    targetDurationSec: target,
    shotDurationPlan,
    totalDurationSec: shotDurationPlan.reduce((sum, duration) => sum + duration, 0)
  };
}
export function getEffectiveShotCount(project: Pick<ProjectTimeline, "shots" | "shotCount">): number {
  return project.shotCount ?? project.shots.length;
}

export function getProjectDurationSec(project: ProjectTimeline): number {
  if (project.shots.length > 0) {
    return project.shots.reduce(
      (sum, shot) => sum + Math.max(0, Math.round(shot.durationSec ?? DEFAULT_SHOT_DURATION_SEC)),
      0
    );
  }
  return Math.max(1, Math.round(project.durationSec ?? project.brief?.durationSec ?? DEFAULT_SHOT_COUNT * DEFAULT_SHOT_DURATION_SEC));
}

export function getProjectDurationInFrames(project: ProjectTimeline, fps = DEFAULT_FPS): number {
  return Math.round(getProjectDurationSec(project) * fps);
}

export function getShotDurationPlan(project: Pick<ProjectTimeline, "shots" | "shotCount">): number[] {
  if (project.shots.length > 0) {
    return project.shots.map((shot) => clampShotDuration(shot.durationSec ?? DEFAULT_SHOT_DURATION_SEC));
  }
  return createDefaultShotDurations(project.shotCount ?? DEFAULT_SHOT_COUNT);
}

export function getDefaultHeroShotArrayIndex(shotCount: number): number {
  const count = Math.max(1, Math.round(shotCount));
  return Math.min(count - 1, Math.max(0, Math.round(count * 0.6) - 1));
}

export function validateShotConfiguration(
  shotCount: number,
  shots: ShotDuration[],
  expectedPlan?: number[]
): ShotConfigurationValidation {
  const errors: ShotConfigurationValidation["errors"] = [];
  if (!Number.isInteger(shotCount) || shotCount < MIN_SHOT_COUNT || shotCount > MAX_SHOT_COUNT) {
    errors.push({ code: "INVALID_SHOT_COUNT", message: "分镜数量必须为 3–12 个。" });
  }
  if (shots.length !== shotCount) {
    errors.push({ code: "SHOT_COUNT_MISMATCH", message: "模型返回的分镜数量与项目设置不一致，请重新生成。" });
  }
  if (shots.some((shot) => !Number.isInteger(shot.durationSec) || (shot.durationSec ?? 0) < MIN_SHOT_DURATION_SEC || (shot.durationSec ?? 0) > MAX_SHOT_DURATION_SEC)) {
    errors.push({ code: "INVALID_SHOT_DURATION", message: "每个分镜时长必须为 3–8 秒。" });
  }
  if (expectedPlan && (expectedPlan.length !== shots.length || expectedPlan.some((duration, index) => duration !== shots[index]?.durationSec))) {
    errors.push({ code: "SHOT_DURATION_PLAN_MISMATCH", message: "模型返回的镜头时长与项目设置不一致。" });
  }
  return {
    valid: errors.length === 0,
    totalDurationSec: shots.reduce((sum, shot) => sum + Math.max(0, Math.round(shot.durationSec ?? 0)), 0),
    errors
  };
}

export type ShotPromptTimeSegment = {
  startSec: number;
  endSec: number;
};

export function createShotPromptTimeSegments(durationSec: number): [ShotPromptTimeSegment, ShotPromptTimeSegment, ShotPromptTimeSegment] {
  const duration = clampShotDuration(durationSec);
  const firstEnd = Math.max(1, Math.round(duration * 0.25));
  const secondEnd = Math.min(duration - 1, Math.max(firstEnd + 1, Math.round(duration * 0.625)));
  return [
    { startSec: 0, endSec: firstEnd },
    { startSec: firstEnd, endSec: secondEnd },
    { startSec: secondEnd, endSec: duration }
  ];
}
