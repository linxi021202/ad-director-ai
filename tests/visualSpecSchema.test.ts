import { describe, expect, it } from "vitest";

import {
  characterVisualSpecSchema,
  keyframeQAResultSchema,
  productVisualSpecSchema,
  sceneVisualSpecSchema,
  videoQAResultSchema
} from "../lib/schemas/project";
import { serializeProductVisualSpecForPrompt } from "../lib/visual/productVisualSpec";

const now = "2026-09-06T12:00:00.000Z";
const assetId = "11111111-1111-4111-8111-111111111111";

const productSpec = {
  sourceAssetId: assetId,
  containerType: "bottle" as const,
  shape: "slender cylindrical bottle",
  proportions: "height about three times body width",
  capStructure: "short black screw cap",
  materials: ["clear PET", "printed film label"],
  colors: [{ name: "black", hex: "#111111" }, { name: "cyan", hex: "#22d3ee" }],
  labelLayout: "single centered wrap label",
  logoPosition: "upper center of front label",
  readablePackagingText: ["COLD BREW"],
  heroAngle: "front three-quarter view at label height",
  forbiddenContainerTypes: ["carton", "can"],
  forbiddenVariations: ["do not change bottle geometry", "do not move the logo"],
  inspectorModel: "qwen3.7-plus",
  inspectedAt: now
};

describe("visual specification and QA schemas", () => {
  it("accepts a complete Product Visual Spec", () => {
    expect(productVisualSpecSchema.parse(productSpec).containerType).toBe("bottle");
  });

  it("rejects malformed color values", () => {
    expect(productVisualSpecSchema.safeParse({ ...productSpec, colors: [{ name: "black", hex: "111" }] }).success).toBe(false);
  });

  it("serializes Product Visual Spec as a hard identity lock", () => {
    const prompt = serializeProductVisualSpecForPrompt(productVisualSpecSchema.parse(productSpec));
    expect(prompt).toContain("hard identity lock");
    expect(prompt).toContain("forbiddenContainerTypes");
    expect(prompt).toContain("carton");
  });

  it("marks a missing Product Visual Spec as a generation blocker", () => {
    expect(serializeProductVisualSpecForPrompt()).toContain("must be blocked");
  });

  it("supports a locked Character Master", () => {
    const parsed = characterVisualSpecSchema.parse({
      id: "character-main", masterAssetId: assetId, role: "commuter", faceDescription: "oval face",
      hairstyle: "short bob", hairColor: "black", skinTone: "warm medium", wardrobe: ["navy jacket"],
      accessories: [], bodyBuild: "average", immutableTraits: ["oval face", "navy jacket"], locked: true, lockedAt: now
    });
    expect(parsed.locked).toBe(true);
  });

  it("supports a locked Scene Master", () => {
    const parsed = sceneVisualSpecSchema.parse({
      id: "scene-office", masterAssetId: assetId, name: "office", architecture: "glass office",
      furniture: ["dark desk"], heroProps: ["laptop"], timeOfDay: "morning", lightingDirection: "camera left",
      lightingQuality: "soft daylight", palette: ["cool gray", "cyan"], immutableTraits: ["glass wall"], locked: true, lockedAt: now
    });
    expect(parsed.masterAssetId).toBe(assetId);
  });

  it("requires explicit hard checks in keyframe QA", () => {
    const result = keyframeQAResultSchema.safeParse({
      id: assetId, shotId: "shot-01", assetId, attempt: 1, inspectorModel: "qwen3.7-plus", checkedAt: now,
      singleFramePassed: true, productMatchPassed: true, characterMatchPassed: true, sceneMatchPassed: true,
      textSafetyPassed: true, overallPassed: true, issues: []
    });
    expect(result.success).toBe(true);
  });

  it("requires temporal checks in video QA", () => {
    const result = videoQAResultSchema.safeParse({
      id: assetId, shotId: "shot-01", attempt: 2, inspectorModel: "qwen3.7-plus", checkedAt: now,
      singleContinuousShotPassed: true, temporalConsistencyPassed: true, productMatchPassed: true,
      characterMatchPassed: true, sceneMatchPassed: true, textSafetyPassed: true, overallPassed: true, issues: []
    });
    expect(result.success).toBe(true);
  });
});
