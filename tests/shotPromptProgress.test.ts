import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { GenerationEvent } from "../lib/schemas/project";
import { deriveShotPromptProgress } from "../lib/workflow/shotPromptProgress";

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
});
