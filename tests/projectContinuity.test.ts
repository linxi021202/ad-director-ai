import { describe, expect, it } from "vitest";

import {
  ensureProjectContinuity,
  selectShotReferences
} from "../lib/continuity/projectContinuity";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import type { GenerationProject } from "../lib/schemas/project";

const PRODUCT_ASSET_ID = "11111111-1111-4111-8111-111111111111";
const PREVIOUS_SHOT_ASSET_ID = "22222222-2222-4222-8222-222222222222";

function projectWithProductReference(): GenerationProject {
  return {
    ...structuredClone(coldBrewDemo),
    brief: {
      ...structuredClone(coldBrewDemo.brief),
      productImages: [{
        id: "product-main",
        assetId: PRODUCT_ASSET_ID,
        name: "product.png",
        type: "image/png",
        size: 1024,
        role: "main-product"
      }]
    },
    shots: structuredClone(coldBrewDemo.shots)
  };
}

describe("project visual continuity architecture", () => {
  it("upgrades a legacy project without changing its timeline", () => {
    const project = structuredClone(coldBrewDemo) as GenerationProject;
    const architecture = ensureProjectContinuity(project);

    expect(architecture.shots).toHaveLength(project.shots.length);
    expect(architecture.shots.map((shot) => shot.durationSec)).toEqual(project.shots.map((shot) => shot.durationSec));
    expect(architecture.creativeBible.commercialStructure.cta).toBe(project.strategy.cta);
    expect(architecture.visualContinuityBible.products).toHaveLength(1);
    expect(architecture.visualContinuityBible.continuityGroups.length).toBeGreaterThan(0);
    expect(architecture.referencePack.continuityAnchors.length).toBeGreaterThan(0);
  });

  it("keeps identity and permanent references stable inside one continuity group", () => {
    const project = projectWithProductReference();
    project.shots = project.shots.map((shot, index) => ({
      ...shot,
      continuityGroupId: "office-main",
      sceneId: "scene-office-main",
      visualDescription: index < 2 ? `同一位上班族人物继续动作，${shot.visualDescription}` : shot.visualDescription
    }));

    const architecture = ensureProjectContinuity(project);
    const first = architecture.shots[0]!;
    const second = architecture.shots[1]!;

    expect(first.sceneId).toBe(second.sceneId);
    expect(first.productIds).toEqual(second.productIds);
    expect(first.characterIds).toEqual(second.characterIds);
    expect(first.referenceImageAssetIds).toContain(PRODUCT_ASSET_ID);
    expect(second.referenceImageAssetIds).toContain(PRODUCT_ASSET_ID);
  });

  it("inherits hand, product and prop state into the next shot", () => {
    const project = projectWithProductReference();
    project.shots = project.shots.slice(0, 2).map((shot) => ({
      ...shot,
      continuityGroupId: "office-main",
      sceneId: "scene-office-main",
      visualDescription: `同一位人物手持产品，${shot.visualDescription}`
    }));
    project.shots[0]!.sceneStateAfter = {
      shotId: project.shots[0]!.id,
      characterStates: [{ characterId: "character-main", productInteraction: "持有 product-master", handState: "右手持握" }],
      productStates: [{ productId: "product-master", opened: true, liquidLevel: "80%" }],
      propStates: [{ propId: "laptop", position: "desk-left", state: "open" }]
    };

    const architecture = ensureProjectContinuity(project);
    const secondBefore = architecture.shots[1]!.sceneStateBefore!;

    expect(secondBefore.characterStates[0]).toMatchObject({ productInteraction: "持有 product-master", handState: "右手持握" });
    expect(secondBefore.productStates[0]).toMatchObject({ opened: true, liquidLevel: "80%" });
    expect(secondBefore.propStates[0]).toMatchObject({ propId: "laptop", position: "desk-left", state: "open" });
  });

  it("treats the previous shot as an auxiliary reference, never as a master", () => {
    const project = projectWithProductReference();
    const architecture = ensureProjectContinuity(project);
    const references = selectShotReferences(
      { ...project, ...architecture, shots: architecture.shots },
      architecture.shots[1]!,
      PREVIOUS_SHOT_ASSET_ID
    );

    expect(references.permanentAssetIds).toContain(PRODUCT_ASSET_ID);
    expect(references.permanentAssetIds).not.toContain(PREVIOUS_SHOT_ASSET_ID);
    expect(references.auxiliaryAssetIds).toEqual([PREVIOUS_SHOT_ASSET_ID]);
  });

  it("preserves master references when one shot is regenerated", () => {
    const project = projectWithProductReference();
    const firstPass = ensureProjectContinuity(project);
    const regeneratedProject: GenerationProject = {
      ...project,
      creativeBible: firstPass.creativeBible,
      visualContinuityBible: firstPass.visualContinuityBible,
      referencePack: firstPass.referencePack,
      shots: firstPass.shots.map((shot, index) => index === 2 ? { ...shot, imagePromptCn: `${shot.imagePromptCn}，低机位` } : shot)
    };
    const secondPass = ensureProjectContinuity(regeneratedProject);

    expect(secondPass.referencePack.productMasters).toEqual(firstPass.referencePack.productMasters);
    expect(secondPass.shots[2]!.referenceImageAssetIds).toEqual(firstPass.shots[2]!.referenceImageAssetIds);
  });

  it("caps motion complexity and assigns text-safe, no-readable-text constraints", () => {
    const architecture = ensureProjectContinuity(projectWithProductReference());

    for (const shot of architecture.shots) {
      expect(shot.motionComplexityScore).toBeLessThanOrEqual(6);
      expect(shot.textSafeZone).toBeTruthy();
      expect(shot.continuityConstraints?.join(" ")).toContain("不得包含任何可读文字");
      expect(shot.negativePromptEn).toContain("no readable text");
    }
    expect(architecture.visualContinuityBible.textRenderingPolicy).toEqual({
      generatedReadableTextAllowed: false,
      brandTextViaRemotion: true,
      subtitleViaRemotion: true,
      ctaViaRemotion: true,
      numericContentViaRemotion: true
    });
  });
});
