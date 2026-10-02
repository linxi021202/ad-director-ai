import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prompts/shotPromptReadiness", () => ({
  isShotPromptReady: (project: GenerationProject, shot: { id: string }) => project.shotPromptPackages?.some((item) => item.shotId === shot.id) ?? false
}));

import type { GenerationEvent, GenerationProject } from "../lib/schemas/project";
import { buildShotPromptInputFingerprint } from "../lib/prompts/shotPromptFingerprint";
import { derivePromptStageProgress, deriveShotPromptProgress } from "../lib/workflow/shotPromptProgress";

function event(shotId: string, status: GenerationEvent["status"], startedAt: number): GenerationEvent {
  return {
    id: randomUUID(), runId: randomUUID(), projectId: randomUUID(), stage: "prompts", provider: "deepseek",
    action: "生成镜头提示词", message: "任务状态", shotId, status, startedAt
  };
}

describe("shot prompt progress", () => {
  it("shows one failed and three not started after the first shot fails", () => {
    const result = deriveShotPromptProgress(["a", "b", "c", "d"], new Set(), [event("a", "failed", 1)]);
    expect(result).toMatchObject({ completed: 0, failed: 1, notStarted: 3 });
    expect(result.shots.map((shot) => shot.status)).toEqual(["failed", "not-started", "not-started", "not-started"]);
  });

  it("uses latest per-shot event while persisted success remains authoritative", () => {
    const result = deriveShotPromptProgress(["a", "b"], new Set(["a"]), [
      event("a", "failed", 1), event("b", "failed", 2), event("b", "running", 3)
    ]);
    expect(result.shots.map((shot) => shot.status)).toEqual(["completed", "generating"]);
  });

  it("excludes historically failed ready shots and reports only the partial quota-blocked shot", () => {
    const project = {
      shots: [1, 2, 3].map((index) => ({ id: `shot-0${index}`, index, frames: [{ id: `frame-${index}-1` }, { id: `frame-${index}-2` }, { id: `frame-${index}-3` }] })),
      shotPromptPackages: [1, 2].map((index) => ({ shotId: `shot-0${index}`, schemaVersion: 2,
        inputFingerprint: "a".repeat(64), framePrompts: [{}, {}, {}] })),
      shotPromptDrafts: [{ shotId: "shot-03", foundation: { shotId: "shot-03" },
        framePrompts: [{ frameId: "frame-3-1" }, { frameId: "frame-3-2" }] }],
      generationEvents: [event("shot-01", "failed", 1), { ...event("shot-03", "failed", 3), errorCode: "DEEPSEEK_QUOTA_EXHAUSTED" }]
    } as unknown as GenerationProject;
    project.shotPromptDrafts![0]!.inputFingerprint = buildShotPromptInputFingerprint({
      brief: project.brief, strategy: project.strategy, shot: project.shots[2]!, previousShot: project.shots[1]
    });
    const progress = derivePromptStageProgress(project);
    expect(progress.shots.map((shot) => shot.status)).toEqual(["ready", "ready", "partial"]);
    expect(progress.shots[2]).toMatchObject({ completedFrames: 2, totalFrames: 3, reason: "DEEPSEEK_QUOTA_EXHAUSTED" });
    expect(progress.failedShots.map((shot) => shot.id)).toEqual(["shot-03"]);
    expect(progress.completed).toBe(2);
    project.shotPromptPackages!.push({ ...project.shotPromptPackages![0]!, shotId: "shot-03" });
    const completed = derivePromptStageProgress(project);
    expect(completed.failedShots).toEqual([]);
    expect(completed.completed).toBe(3);
  });
});
