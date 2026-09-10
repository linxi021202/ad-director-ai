import { describe, expect, it } from "vitest";

import { buildProjectContinuity, inferProductShotType } from "../lib/continuity/projectContinuity";
import { repairShotProductTerminology, validateProductTerminology } from "../lib/visual/productTerminology";
import type { AdStrategy, ProductBrief, ProductVisualSpec, StoryboardShot } from "../lib/schemas/project";

const assetId = "11111111-1111-4111-8111-111111111111";
const cupSpec: ProductVisualSpec = {
  sourceAssetId: assetId, containerType: "cup", shape: "short tapered cup", proportions: "1:1.3",
  capStructure: "flat sip lid", materials: ["paper", "plastic lid"], colors: [{ name: "white", hex: "#ffffff" }],
  labelLayout: "front", logoPosition: "front center", readablePackagingText: ["BRAND"], heroAngle: "front three-quarter",
  forbiddenContainerTypes: ["bottle", "can", "carton", "jar"], forbiddenVariations: ["no screw cap"],
  inspectorModel: "qwen3.7-plus", inspectedAt: "2026-09-06T12:00:00.000Z"
};
const shot: StoryboardShot = {
  id: "shot-01", index: 1, durationSec: 4, goal: "展示冷萃瓶", visualDescription: "人物拿起塑料饮料瓶",
  cameraAngle: "中景", cameraMovement: "缓慢推近", subtitle: "状态回归", imagePromptCn: "桌面上的玻璃瓶",
  imagePromptEn: "A tall plastic bottle on desk", videoPromptCn: "人物打开瓶盖", videoPromptEn: "Open the bottle",
  recommendedModel: "qwen-image", fallbackPlan: "Remotion"
};
const brief: ProductBrief = {
  productName: "测试咖啡", category: "咖啡", sellingPoints: ["清爽口感"], targetAudience: "上班族",
  platform: "douyin", style: "商业摄影", aspectRatio: "9:16", durationSec: 12,
  productImages: [{ id: "product", assetId, name: "cup.png", type: "image/png", size: 100, role: "main-product" }]
};
const strategy: AdStrategy = {
  audienceInsight: "疲惫", painPoint: "状态不足", coreMessage: "恢复节奏", emotionalHook: "状态切换",
  bigIdea: "状态回归", title: "测试", subtitle: "测试", cta: "立即体验"
};

describe("exact product lock", () => {
  it("detects forbidden bottle terminology for a cup", () => {
    expect(validateProductTerminology(shot.imagePromptEn, cupSpec).conflicts).toContain("bottle");
  });

  it("repairs Chinese and English container conflicts before generation", () => {
    const repaired = repairShotProductTerminology(shot, cupSpec);
    expect(`${repaired.goal} ${repaired.visualDescription} ${repaired.imagePromptCn} ${repaired.imagePromptEn}`).not.toMatch(/瓶|bottle/i);
    expect(repaired.imagePromptEn).toContain("product cup");
  });

  it("defaults every visible product shot to exact fidelity", () => {
    const result = buildProjectContinuity({ brief, strategy, shots: [
      shot,
      { ...shot, id: "shot-02", index: 2, containsProduct: false, visualDescription: "空镜" },
      { ...shot, id: "shot-03", index: 3, containsProduct: false, visualDescription: "空镜结尾" }
    ], productVisualSpec: cupSpec });
    expect(result.shots[0]).toMatchObject({ containsProduct: true, productFidelityMode: "exact" });
  });

  it("classifies human interaction separately from packshots", () => {
    expect(inferProductShotType({ ...shot, containsProduct: true }, 3)).toBe("human-product-interaction");
    expect(inferProductShotType({ ...shot, index: 3, goal: "Ending CTA", exactProductShot: undefined }, 3)).toBe("packshot");
  });

  it("turns risky interaction into the controlled low-risk composition", () => {
    const result = buildProjectContinuity({ brief, strategy, shots: [shot, { ...shot, id: "shot-02", index: 2 }, { ...shot, id: "shot-03", index: 3 }], productVisualSpec: cupSpec });
    expect(result.shots[0]?.lowRiskProductFallback).toBe(true);
    expect(result.shots[0]?.shotDirection?.join(" ")).toContain("不开盖、不饮用、不走动");
  });

  it("binds the authoritative Product Master asset to product shots", () => {
    const result = buildProjectContinuity({ brief, strategy, shots: [shot], productVisualSpec: cupSpec });
    expect(result.shots[0]?.referenceImageAssetIds).toContain(assetId);
  });
});
