import { describe, expect, it } from "vitest";

import { inferExactProductShot, shotContainsProduct } from "../lib/continuity/projectContinuity";
import { validateProductReferenceForShot } from "../lib/providers/qwenImageProvider";
import type { ProductVisualSpec, StoryboardShot } from "../lib/schemas/project";

const productAssetId = "11111111-1111-4111-8111-111111111111";
const baseShot: StoryboardShot = {
  id: "shot-01", index: 1, durationSec: 4, goal: "展示产品", visualDescription: "人物拿起咖啡瓶",
  cameraAngle: "中景", cameraMovement: "连续推近", subtitle: "清醒一下", imagePromptCn: "人物拿起真实咖啡瓶",
  imagePromptEn: "Person holds the real coffee bottle", videoPromptCn: "人物拿起产品", recommendedModel: "qwen-image",
  fallbackPlan: "关键帧动效", containsProduct: true, exactProductShot: false, referenceImageAssetIds: [productAssetId]
};
const spec: ProductVisualSpec = {
  sourceAssetId: productAssetId, containerType: "bottle", shape: "cylinder", proportions: "3:1",
  capStructure: "black screw cap", materials: ["PET"], colors: [{ name: "black", hex: "#111111" }],
  labelLayout: "center wrap", logoPosition: "upper center", readablePackagingText: [],
  heroAngle: "front three-quarter", forbiddenContainerTypes: ["carton", "can"],
  forbiddenVariations: ["no geometry changes"], inspectorModel: "qwen3.7-plus", inspectedAt: "2026-09-06T12:00:00.000Z"
};

describe("product-reference hard gate", () => {
  it("allows a shot that contains no product without a Product Master", () => {
    expect(validateProductReferenceForShot({ ...baseShot, containsProduct: false }, undefined, undefined)).toEqual({ valid: true });
  });

  it("blocks product shots without a Product Master asset", () => {
    expect(validateProductReferenceForShot(baseShot, undefined, spec)).toMatchObject({ valid: false, errorCode: "PRODUCT_REFERENCE_REQUIRED" });
  });

  it("blocks product shots that do not bind the current asset ID", () => {
    expect(validateProductReferenceForShot({ ...baseShot, referenceImageAssetIds: [] }, productAssetId, spec))
      .toMatchObject({ valid: false, errorCode: "PRODUCT_REFERENCE_REQUIRED" });
  });

  it("blocks product shots without a visual spec", () => {
    expect(validateProductReferenceForShot(baseShot, productAssetId, undefined))
      .toMatchObject({ valid: false, errorCode: "PRODUCT_VISUAL_SPEC_REQUIRED" });
  });

  it("blocks a stale visual spec from a replaced Product Master", () => {
    expect(validateProductReferenceForShot(baseShot, productAssetId, { ...spec, sourceAssetId: "22222222-2222-4222-8222-222222222222" }))
      .toMatchObject({ valid: false, errorCode: "PRODUCT_VISUAL_SPEC_REQUIRED" });
  });

  it("allows a fully bound product shot", () => {
    expect(validateProductReferenceForShot(baseShot, productAssetId, spec)).toEqual({ valid: true });
  });

  it("infers product presence from packaging semantics", () => {
    expect(shotContainsProduct({ ...baseShot, containsProduct: undefined, visualDescription: "罐身包装英雄特写" })).toBe(true);
  });

  it("respects an explicit no-product decision", () => {
    expect(shotContainsProduct({ ...baseShot, containsProduct: false })).toBe(false);
  });

  it("marks the ending packshot as exact-product", () => {
    expect(inferExactProductShot({ ...baseShot, index: 8, goal: "CTA 收束", exactProductShot: undefined }, 8)).toBe(true);
  });
});
