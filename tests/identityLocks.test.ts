import { describe, expect, it } from "vitest";

import { buildProjectContinuity } from "../lib/continuity/projectContinuity";
import { buildVisualMasterSpecs, lockShotVisualMasters, selectLockedMasterAssetIds } from "../lib/continuity/visualMasters";
import type { AdStrategy, GenerationProject, ProductBrief, StoryboardShot } from "../lib/schemas/project";

const characterAssetId = "11111111-1111-4111-8111-111111111111";
const sceneAssetId = "22222222-2222-4222-8222-222222222222";
const brief: ProductBrief = {
  productName: "咖啡", category: "饮品", sellingPoints: ["顺滑"], targetAudience: "上班族",
  platform: "douyin", style: "商业摄影", aspectRatio: "9:16", durationSec: 12
};
const strategy: AdStrategy = {
  audienceInsight: "疲惫", painPoint: "状态不足", coreMessage: "恢复节奏", emotionalHook: "从疲惫到清醒",
  bigIdea: "状态切换", title: "测试", subtitle: "测试", cta: "立即体验"
};
function shot(id: string, index: number, time: "night" | "day"): StoryboardShot {
  return {
    id, index, durationSec: 4, goal: "人物状态变化", visualDescription: `${time === "night" ? "深夜" : "白天"}办公室，同一上班族坐在桌边`,
    cameraAngle: "中景", cameraMovement: "缓慢推近", subtitle: "状态切换", imagePromptCn: `${time === "night" ? "深夜" : "白天"}办公室人物镜头`,
    imagePromptEn: `${time} office with the same person`, videoPromptCn: "人物抬头", recommendedModel: "qwen-image",
    fallbackPlan: "Remotion", continuityGroupId: "character-story", sceneGroupId: "office", characterIds: [`actor-${index}`], containsProduct: false
  };
}

describe("character and scene identity locks", () => {
  const architecture = buildProjectContinuity({ brief, strategy, shots: [shot("shot-1", 1, "night"), shot("shot-2", 2, "night"), shot("shot-3", 3, "day")] });

  it("normalizes all character shots to one Primary Character Master id", () => {
    expect(architecture.shots.flatMap((item) => item.characterIds ?? [])).toEqual(["character-main", "character-main", "character-main"]);
  });

  it("keeps night and day in one Scene Identity with separate Scene States", () => {
    expect(architecture.shots[0]?.sceneId).toBe(architecture.shots[1]?.sceneId);
    expect(architecture.shots[2]?.sceneId).toBe(architecture.shots[1]?.sceneId);
    expect(architecture.shots[2]?.sceneStateId).not.toBe(architecture.shots[1]?.sceneStateId);
    expect(architecture.visualContinuityBible.scenes).toHaveLength(1);
    expect(architecture.visualContinuityBible.scenes[0]?.timeOfDay).toContain("night");
    expect(architecture.visualContinuityBible.scenes[0]?.timeOfDay).toContain("day");
  });

  it("requires an explicit semantic reason for the night-to-day transition", () => {
    expect(architecture.shots[2]?.sceneTransitionReason).toContain("人物身份与默认服装保持不变");
  });

  it("writes one locked character asset id into every matching shot", () => {
    const project = projectFromArchitecture();
    const locked = lockShotVisualMasters(project, architecture.shots[0]!, characterAssetId);
    expect(locked.shots.every((item) => item.referenceImageAssetIds?.includes(characterAssetId))).toBe(true);
  });

  it("writes one Scene Master into every state of the same scene identity", () => {
    const project = projectFromArchitecture();
    const locked = lockShotVisualMasters(project, { ...architecture.shots[0]!, characterIds: [] }, sceneAssetId);
    expect(locked.shots[0]?.referenceImageAssetIds).toContain(sceneAssetId);
    expect(locked.shots[1]?.referenceImageAssetIds).toContain(sceneAssetId);
    expect(locked.shots[2]?.referenceImageAssetIds).toContain(sceneAssetId);
  });

  it("selects the same locked references for repeated shots", () => {
    const base = projectFromArchitecture();
    const characterLocked = lockShotVisualMasters(base, architecture.shots[0]!, characterAssetId);
    const withCharacter = { ...base, ...characterLocked };
    const sceneLocked = lockShotVisualMasters(withCharacter, { ...architecture.shots[0]!, characterIds: [] }, sceneAssetId);
    const project = { ...withCharacter, ...sceneLocked };
    expect(selectLockedMasterAssetIds(project, project.shots[0]!)).toEqual(selectLockedMasterAssetIds(project, project.shots[1]!));
  });

  function projectFromArchitecture(): GenerationProject {
    const project = {
      id: "33333333-3333-4333-8333-333333333333", brief, strategy, ...architecture, status: "draft" as const,
      modelRoutes: [{ taskType: "strategy" as const, primaryModel: "deepseek-v4-pro", backupModel: "deepseek-v4-pro", reason: "test", estimatedCost: 0, estimatedLatency: "0", fallbackMode: "none" }],
      costEstimates: [{ mode: "lowCost" as const, label: "test", minCny: 0, maxCny: 0, explanation: "test" }],
      assets: [], finalVideoUrl: null, generationEvents: [], createdAt: "2026-09-06T12:00:00.000Z", updatedAt: "2026-09-06T12:00:00.000Z"
    } satisfies GenerationProject;
    return { ...project, ...buildVisualMasterSpecs(project) };
  }
});
