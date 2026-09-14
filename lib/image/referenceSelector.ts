import { shotContainsProduct } from "../continuity/projectContinuity";
import type { GenerationProject, ProductImage, StoryboardShot } from "../schemas/project";
import { canonicalSceneId, currentMasterAssetId } from "../visual/visualAnchors";

export type ShotImageReferenceSelection = {
  productImages: ProductImage[];
  masterReferenceAssetIds: string[];
  referenceRoles: Array<"product" | "character" | "scene">;
};

export function selectImageReferencesForShot(
  project: GenerationProject,
  shot: StoryboardShot
): ShotImageReferenceSelection {
  const productImages = orderedProductImages(project.brief.productImages ?? []);
  const characterIds = new Set(shot.characterIds ?? []);
  const characterAssetId = (project.characterVisualSpecs ?? [])
    .find((spec) => spec.locked && characterIds.has(spec.id) && currentMasterAssetId(spec));
  const sceneAssetId = (project.sceneVisualSpecs ?? [])
    .find((spec) => spec.locked && spec.id === canonicalSceneId(shot.sceneId ?? "") && currentMasterAssetId(spec));
  const character = characterAssetId ? currentMasterAssetId(characterAssetId) : undefined;
  const scene = sceneAssetId ? currentMasterAssetId(sceneAssetId) : undefined;
  const hasProduct = shotContainsProduct(shot);
  const hasCharacter = characterIds.size > 0;
  const productHero = hasProduct && !hasCharacter && (
    shot.productShotType === "packshot"
    || shot.exactProductShot === true
    || /产品|商品|包装|特写|英雄/i.test(`${shot.goal} ${shot.visualDescription}`)
  );

  if (productHero) {
    const selectedProducts = productImages.slice(0, 3);
    return { productImages: selectedProducts, masterReferenceAssetIds: [], referenceRoles: selectedProducts.map(() => "product") };
  }

  if (hasProduct && hasCharacter) {
    const selectedProducts = productImages.slice(0, 1);
    const masters = unique([character, scene].filter(Boolean) as string[]).slice(0, 3 - selectedProducts.length);
    return {
      productImages: selectedProducts,
      masterReferenceAssetIds: masters,
      referenceRoles: [
        ...selectedProducts.map(() => "product" as const),
        ...(character && masters.includes(character) ? ["character" as const] : []),
        ...(scene && masters.includes(scene) ? ["scene" as const] : [])
      ]
    };
  }

  if (hasProduct) {
    const selectedProducts = productImages.slice(0, 2);
    const masters = scene ? [scene].slice(0, 3 - selectedProducts.length) : [];
    return { productImages: selectedProducts, masterReferenceAssetIds: masters, referenceRoles: [...selectedProducts.map(() => "product" as const), ...masters.map(() => "scene" as const)] };
  }

  const masters = unique([character, scene].filter(Boolean) as string[]).slice(0, 3);
  return {
    productImages: [],
    masterReferenceAssetIds: masters,
    referenceRoles: [
      ...(character && masters.includes(character) ? ["character" as const] : []),
      ...(scene && masters.includes(scene) ? ["scene" as const] : [])
    ]
  };
}

function orderedProductImages(images: ProductImage[]) {
  return images
    .filter((image) => image.role !== "logo" && image.assetId)
    .sort((left, right) => Number(right.role === "main-product") - Number(left.role === "main-product"));
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
