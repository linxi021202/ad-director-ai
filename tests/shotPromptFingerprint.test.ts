import { describe, expect, it } from "vitest";

import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { buildShotPromptInputFingerprint } from "../lib/prompts/shotPromptFingerprint";

function input() {
  return {
    brief: coldBrewDemo.brief,
    strategy: coldBrewDemo.strategy,
    shot: coldBrewDemo.shots[0]!,
    previousShot: undefined,
    productVisualSpec: {
      sourceAssetId: "00000000-0000-4000-8000-000000000001",
      containerType: "cup" as const,
      shape: "锥形杯身",
      proportions: "高宽比 1.3:1",
      capStructure: "平盖",
      materials: ["纸杯"],
      colors: [{ name: "白色", hex: "#ffffff" }],
      labelLayout: "正面居中",
      logoPosition: "正面居中",
      readablePackagingText: [],
      heroAngle: "正面四十五度",
      forbiddenContainerTypes: ["bottle" as const, "can" as const],
      forbiddenVariations: ["禁止改变杯体结构"],
      inspectorModel: "qwen3.7-plus",
      inspectedAt: "2026-01-01T00:00:00.000Z"
    },
    visualContinuityBible: coldBrewDemo.visualContinuityBible,
    referencePack: coldBrewDemo.referencePack
  };
}

describe("shot prompt input fingerprint", () => {
  it("stays stable when only generated prompt text changes", () => {
    const source = input();
    const changed = {
      ...source,
      shot: {
        ...source.shot,
        imagePromptCn: "扩写后的图片提示词",
        videoPromptCn: "扩写后的视频提示词",
        continuityConstraints: ["扩写后写回的连续性约束"],
        frames: source.shot.frames?.map((frame) => ({ ...frame, imagePromptCn: "扩写后的画格提示词" }))
      }
    };
    expect(buildShotPromptInputFingerprint(changed)).toBe(buildShotPromptInputFingerprint(source));
  });

  it("changes when storyboard source content changes", () => {
    const source = input();
    const changed = { ...source, shot: { ...source.shot, goal: `${source.shot.goal}，强化商品展示` } };
    expect(buildShotPromptInputFingerprint(changed)).not.toBe(buildShotPromptInputFingerprint(source));
  });

  it("changes when the product identity reference changes", () => {
    const source = input();
    const changed = {
      ...source,
      productVisualSpec: source.productVisualSpec
        ? { ...source.productVisualSpec, colors: [...source.productVisualSpec.colors, { name: "银灰", hex: "#c0c0c0" }] }
        : undefined
    };
    expect(buildShotPromptInputFingerprint(changed)).not.toBe(buildShotPromptInputFingerprint(source));
  });
});
