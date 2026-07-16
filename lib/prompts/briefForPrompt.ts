import type { ProductBrief } from "../schemas/project";

export function textBriefForPrompt(brief: ProductBrief): Omit<ProductBrief, "productImages"> {
  const { productImages: _productImages, ...textBrief } = brief;
  return textBrief;
}

export function productImageReferenceNote(brief: ProductBrief): string {
  if (!brief.productImages || brief.productImages.length === 0) {
    return "";
  }

  return "User uploaded product reference images. Later keyframe generation must keep product packaging consistent. Do not analyze image content and do not request base64 or file data.";
}
