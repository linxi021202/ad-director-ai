import { readPrivateVisualAssetDataUrl } from "../image/productReference";
import { selectPrimaryProductImage } from "../image/productReference";
import {
  productContainerTypeSchema,
  productVisualSpecSchema,
  type ProductVisualSpec
} from "../schemas/project";
import type { GenerationProject } from "../schemas/project";
import { callVisualInspector } from "./visualInspector";

const extractedProductSpecSchema = productVisualSpecSchema.omit({
  sourceAssetId: true,
  inspectorModel: true,
  inspectedAt: true
});

export async function extractProductVisualSpec(input: {
  sessionId: string;
  projectId: string;
  productAssetId: string;
}): Promise<{ success: true; spec: ProductVisualSpec } | { success: false; error: string }> {
  let sourceImage: string;
  try {
    sourceImage = await readPrivateVisualAssetDataUrl(input.productAssetId, input);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "PRODUCT_MASTER_UNREADABLE" };
  }

  const result = await callVisualInspector({
    sessionId: input.sessionId,
    images: [sourceImage],
    schema: extractedProductSpecSchema,
    prompt: `Inspect this Product Master image and describe only visually verifiable product identity attributes.
Return JSON with exactly these keys: containerType, shape, proportions, capStructure, materials, colors, labelLayout, logoPosition, readablePackagingText, heroAngle, forbiddenContainerTypes, forbiddenVariations.
containerType must be one of: ${productContainerTypeSchema.options.join(", ")}.
For colors use objects {"name": string, "hex"?: "#RRGGBB"}; omit hex when uncertain.
Transcribe readablePackagingText only when clearly legible; otherwise return an empty array.
forbiddenContainerTypes must list plausible wrong container classes, especially bottle/carton/can alternatives other than the observed type.
forbiddenVariations must explicitly prohibit changes to geometry, proportions, cap, materials, colors, label layout, logo position, and replacement with another container type.
Do not identify or invent hidden sides of the package.`
  });
  if (!result.success || !result.data) {
    return { success: false, error: result.error ?? "PRODUCT_VISUAL_SPEC_EXTRACTION_FAILED" };
  }

  return {
    success: true,
    spec: productVisualSpecSchema.parse({
      ...result.data,
      sourceAssetId: input.productAssetId,
      inspectorModel: result.model,
      inspectedAt: new Date().toISOString()
    })
  };
}

export function serializeProductVisualSpecForPrompt(spec?: ProductVisualSpec) {
  if (!spec) return "Product Visual Spec: MISSING. Product-containing generation must be blocked.";
  return `Product Visual Spec (hard identity lock):\n${JSON.stringify(spec, null, 2)}`;
}

export async function resolveProjectProductVisualSpec(input: {
  sessionId: string;
  project: GenerationProject;
}): Promise<{ spec?: ProductVisualSpec; error?: string }> {
  const productImage = selectPrimaryProductImage(input.project.brief.productImages);
  if (!productImage?.assetId) return { error: "PRODUCT_REFERENCE_REQUIRED" };
  if (input.project.productVisualSpec?.sourceAssetId === productImage.assetId) {
    return { spec: input.project.productVisualSpec };
  }
  const extracted = await extractProductVisualSpec({
    sessionId: input.sessionId,
    projectId: input.project.id,
    productAssetId: productImage.assetId
  });
  return extracted.success ? { spec: extracted.spec } : { error: extracted.error };
}
