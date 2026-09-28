import { describe, expect, it } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { deriveShotGenerationState } from "../lib/workflow/shotGenerationState";
import type { GenerationEvent } from "../lib/schemas/project";

const shotId = coldBrewDemo.shots[0]!.id;
const failedPrompt: GenerationEvent = { id: "prompt-event", runId: "run", projectId: coldBrewDemo.id, stage: "prompts", provider: "deepseek",
  action: "生成提示词", status: "failed", startedAt: 1, completedAt: 2, message: "提示词失败" };
describe("shot prompt and image state separation", () => {
  it("never labels a prompt failure as a Qwen image failure", () => {
    const project = { ...coldBrewDemo, generationEvents: [{ ...failedPrompt, shotId }], shotPromptPackages: [], keyframes: [] };
    expect(deriveShotGenerationState(project, shotId)).toBe("prompt_failed");
    expect(deriveShotGenerationState(project, shotId, true)).toBe("prompt_generating");
  });
  it("uses valid current packages rather than historical failed calls", () => {
    const project = { ...coldBrewDemo, generationEvents: [{ ...failedPrompt, shotId }], keyframes: [],
      shotPromptPackages: [{ shotId, schemaVersion: 2 as const, inputFingerprint: "a".repeat(64) }] };
    expect(deriveShotGenerationState(project, shotId)).toBe("prompt_ready");
    expect(deriveShotGenerationState(project, shotId, true)).toBe("keyframe_generating");
    expect(deriveShotGenerationState({ ...project, generationEvents: [{ ...failedPrompt, shotId, stage: "keyframes", provider: "qwen-image" }] }, shotId)).toBe("keyframe_failed");
  });
});
