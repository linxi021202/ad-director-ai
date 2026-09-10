import type { ProductImage, ProductImageRole } from "./schemas/project";

export const MAX_PRODUCT_IMAGES = 3;
export const MAX_PRODUCT_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const SUPPORTED_PRODUCT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type ProductImageInput = {
  name: string;
  type: string;
  size: number;
};

export type ProductImageValidationError = "too-many" | "unsupported-type" | "too-large";

export type ProductImageValidationResult =
  | { success: true }
  | { success: false; error: ProductImageValidationError };

export function validateProductImageFiles(files: ProductImageInput[], existingCount: number): ProductImageValidationResult {
  if (existingCount + files.length > MAX_PRODUCT_IMAGES) return { success: false, error: "too-many" };
  for (const file of files) {
    if (!SUPPORTED_PRODUCT_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_PRODUCT_IMAGE_TYPES)[number])) return { success: false, error: "unsupported-type" };
    if (file.size > MAX_PRODUCT_IMAGE_SIZE_BYTES) return { success: false, error: "too-large" };
  }
  return { success: true };
}

export function createProductImageMetadata(
  file: ProductImageInput,
  previewUrl: string,
  role: ProductImageRole = "reference",
  id = `${Date.now()}-${file.name}`
): ProductImage {
  return { id, name: file.name, type: file.type as ProductImage["type"], size: file.size, previewUrl, role };
}

export function resolveProductImageUrl(image?: ProductImage | null): string | undefined {
  return image?.localUrl ?? image?.previewUrl ?? image?.remoteUrl ?? image?.url;
}

export function releaseOwnedProductImageUrl(
  image: ProductImage,
  ownedUrls: Set<string>,
  revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)
): boolean {
  const previewUrl = image.previewUrl;
  if (!previewUrl || !ownedUrls.has(previewUrl)) return false;
  revoke(previewUrl);
  ownedUrls.delete(previewUrl);
  return true;
}

export function setMainProductImage(images: ProductImage[], id: string): ProductImage[] {
  return images.map((image) => ({
    ...image,
    role: image.id === id ? "main-product" : image.role === "main-product" ? "reference" : image.role
  }));
}

export function removeProductImage(images: ProductImage[], id: string): ProductImage[] {
  return images.filter((image) => image.id !== id);
}

export function formatFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(size / 1024, 0.1).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function productImageErrorMessage(error: ProductImageValidationError): string {
  switch (error) {
    case "too-many": return "最多上传 3 张产品图。";
    case "unsupported-type": return "仅支持 PNG、JPG、WebP 图片。";
    case "too-large": return "单张图片不能超过 5MB。";
  }
}
