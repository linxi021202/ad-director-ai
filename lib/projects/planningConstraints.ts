import type { GenerationProject, ProjectPlanningConstraints } from "@/lib/schemas/project";
import { allocateShotDurations, clampTargetDuration } from "@/lib/video/shotConfig";

export function resolveProjectPlanningConstraints(project: GenerationProject): ProjectPlanningConstraints {
  const shotCount = project.planningConstraints?.shotCount ?? project.shotCount ?? project.shots.length;
  const targetDurationSec = clampTargetDuration(
    shotCount,
    project.planningConstraints?.targetDurationSec ?? project.targetDurationSec ?? project.brief.durationSec
  );
  return {
    shotCount,
    targetDurationSec,
    aspectRatio: project.planningConstraints?.aspectRatio ?? project.brief.aspectRatio,
    platform: project.planningConstraints?.platform ?? project.brief.platform
  };
}

export function planningDurationPlan(project: GenerationProject): number[] {
  const constraints = resolveProjectPlanningConstraints(project);
  return allocateShotDurations(constraints.shotCount, constraints.targetDurationSec);
}

export function planningConstraintsFromBrief(
  brief: GenerationProject["brief"],
  shotCount: number,
  targetDurationSec: number
): ProjectPlanningConstraints {
  return { shotCount, targetDurationSec, aspectRatio: brief.aspectRatio, platform: brief.platform };
}

export function assertStoryboardMatchesPlanning(
  project: GenerationProject,
  shots: GenerationProject["shots"]
): void {
  const constraints = resolveProjectPlanningConstraints(project);
  if (shots.length !== constraints.shotCount) throw planningError("SHOT_COUNT_MISMATCH");
  const total = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  if (total !== constraints.targetDurationSec) throw planningError("DURATION_PLAN_MISMATCH");
  const expected = allocateShotDurations(constraints.shotCount, constraints.targetDurationSec);
  if (shots.some((shot, index) => shot.durationSec !== expected[index])) throw planningError("DURATION_PLAN_MISMATCH");
}

function planningError(code: "SHOT_COUNT_MISMATCH" | "DURATION_PLAN_MISMATCH") {
  return Object.assign(new Error(code === "SHOT_COUNT_MISMATCH"
    ? "生成的分镜数量与广告需求中的计划不一致，请重新生成。"
    : "生成的分镜总时长与广告需求中的计划不一致，请重新生成。"), { code });
}
