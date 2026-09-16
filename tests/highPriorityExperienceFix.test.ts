import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { selectImageReferencesForShot } from "@/lib/image/referenceSelector";
import { coldBrewDemo } from "@/lib/mock/coldBrewDemo";
import type { GenerationProject, ProductImage, StoryboardShot } from "@/lib/schemas/project";

const productIds = [
  "00000000-0000-4000-8000-000000000011",
  "00000000-0000-4000-8000-000000000012",
  "00000000-0000-4000-8000-000000000013"
];
const characterAssetId = "00000000-0000-4000-8000-000000000021";
const sceneAssetId = "00000000-0000-4000-8000-000000000031";

describe("high-priority experience and generation fixes", () => {
  it("allocates one product, one character and one scene reference to a human-product shot", () => {
    const { project, shot } = referenceProject("human-product-interaction", true);
    const selection = selectImageReferencesForShot(project, shot);
    expect(selection.productImages.map((image) => image.assetId)).toEqual([productIds[0]]);
    expect(selection.masterReferenceAssetIds).toEqual([characterAssetId, sceneAssetId]);
    expect(selection.referenceRoles).toEqual(["product", "character", "scene"]);
  });

  it("uses up to three ordered product views for a product hero shot", () => {
    const { project, shot } = referenceProject("packshot", false);
    const selection = selectImageReferencesForShot(project, shot);
    expect(selection.productImages.map((image) => image.assetId)).toEqual(productIds);
    expect(selection.masterReferenceAssetIds).toEqual([]);
    expect(selection.referenceRoles).toEqual(["product", "product", "product"]);
  });

  it("keeps product upload semantics unified and exposes a useful limit action", () => {
    const uploader = readFileSync("components/ProductImageUploader.tsx", "utf8");
    expect(uploader).toContain("产品图片");
    expect(uploader).toContain("已达到 3 张上限");
    expect(uploader).toContain("设为主产品图");
    expect(uploader).toContain("这张图片包含多个产品视图");
    expect(uploader).toContain("补充参考图");
  });

  it("persists storyboard chunks and maps truncation details to Chinese", () => {
    const route = readFileSync("app/api/generate-storyboard/route.ts", "utf8");
    const provider = readFileSync("lib/providers/deepseekProvider.ts", "utf8");
    expect(route).toContain("saveOwnedStoryboardChunk");
    expect(route).toContain("本次生成内容较长，系统正在拆分生成，请稍候。");
    expect(route).toContain("本次生成内容过多，已超出单次长度限制。系统建议分段生成分镜内容。");
    expect(provider).toContain("durations.length < 4");
    expect(provider).toContain("shotDurationPlan.length > 1");
    expect(provider).toContain("TEXT_OUTPUT_BUDGETS.storyboardChunk");
  });

  it("never returns a raw provider or Zod error from creative generation", () => {
    const route = readFileSync("app/api/projects/[projectId]/creative-directions/route.ts", "utf8");
    expect(route).toContain("friendlyCreativeGenerationError(result.error)");
    expect(route).not.toContain('error: result.error ??');
    expect(route).toContain("创意方案生成失败，请重新尝试。");
  });

  it("keeps desktop workspace columns naturally stretched and non-sticky", () => {
    const workflow = readFileSync("components/GenerateWorkflow.tsx", "utf8");
    const styles = readFileSync("app/workspace-v3.css", "utf8");
    expect(workflow).toContain("workspace-column--main");
    expect(styles).toContain("align-items:stretch");
    expect(styles).toContain("position:relative");
    expect(styles).toContain("height:auto");
    expect(styles).toContain("background:#000!important");
  });
});

function referenceProject(productShotType: StoryboardShot["productShotType"], withCharacter: boolean) {
  const productImages: ProductImage[] = productIds.map((assetId, index) => ({
    id: `product-${index}`,
    assetId,
    name: `product-${index}.png`,
    type: "image/png",
    size: 1000,
    role: index === 0 ? "main-product" : "reference"
  }));
  const shot = {
    ...coldBrewDemo.shots[0]!,
    containsProduct: true,
    exactProductShot: productShotType === "packshot",
    productShotType,
    characterIds: withCharacter ? ["character-1"] : [],
    sceneId: "scene-1",
    goal: productShotType === "packshot" ? "产品英雄特写" : "人物拿起产品"
  } satisfies StoryboardShot;
  const project = {
    ...coldBrewDemo,
    brief: { ...coldBrewDemo.brief, productImages },
    characterVisualSpecs: withCharacter ? [{ id: "character-1", locked: true, masterAssetId: characterAssetId }] : [],
    sceneVisualSpecs: [{ id: "scene-1", locked: true, masterAssetId: sceneAssetId }]
  } as unknown as GenerationProject;
  return { project, shot };
}
