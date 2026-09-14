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
  const removedWasMain = images.some((image) => image.id === id && image.role === "main-product");
  const remaining = images.filter((image) => image.id !== id);
  if (!removedWasMain || remaining.some((image) => image.role === "main-product")) return remaining;
  const nextMain = remaining.find((image) => image.role !== "logo");
  return nextMain ? setMainProductImage(remaining, nextMain.id) : remaining;
}

export function buildProductAssetCollection(images: ProductImage[]): {
  primaryProductAssetId?: string;
  productAssetIds: string[];
} {
  const productImages = images.filter((image) => image.role !== "logo" && image.assetId);
  const primaryProductAssetId = productImages.find((image) => image.role === "main-product")?.assetId;
  return {
    ...(primaryProductAssetId ? { primaryProductAssetId } : {}),
    productAssetIds: productImages.flatMap((image) => image.assetId ? [image.assetId] : []).slice(0, MAX_PRODUCT_IMAGES)
  };
}

export async function detectLikelyMultiViewProductImage(file: File): Promise<boolean> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return false;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(24, Math.round(bitmap.width * scale));
    const height = Math.max(24, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, width, height).data;
    const cornerIndexes = [0, width - 1, (height - 1) * width, height * width - 1];
    const background = [0, 1, 2].map((channel) => cornerIndexes.reduce((sum, index) => sum + pixels[index * 4 + channel]!, 0) / 4);
    const occupied = new Uint8Array(width * height);
    for (let index = 0; index < occupied.length; index += 1) {
      const offset = index * 4;
      const distance = Math.abs(pixels[offset]! - background[0]!) + Math.abs(pixels[offset + 1]! - background[1]!) + Math.abs(pixels[offset + 2]! - background[2]!);
      if (pixels[offset + 3]! > 40 && distance > 72) occupied[index] = 1;
    }
    const seen = new Uint8Array(occupied.length);
    const minimumArea = Math.max(24, Math.round(occupied.length * 0.025));
    let significantComponents = 0;
    for (let start = 0; start < occupied.length; start += 1) {
      if (!occupied[start] || seen[start]) continue;
      const queue = [start];
      seen[start] = 1;
      let area = 0;
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor]!;
        area += 1;
        const x = current % width;
        const neighbors = [current - width, current + width, x > 0 ? current - 1 : -1, x < width - 1 ? current + 1 : -1];
        for (const neighbor of neighbors) {
          if (neighbor >= 0 && neighbor < occupied.length && occupied[neighbor] && !seen[neighbor]) {
            seen[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }
      if (area >= minimumArea) significantComponents += 1;
      if (significantComponents >= 3) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function formatFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(size / 1024, 0.1).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function productImageErrorMessage(error: ProductImageValidationError): string {
  switch (error) {
    case "too-many": return "最多可上传 3 张产品图片；一张清晰图片已经可以开始制作。";
    case "unsupported-type": return "仅支持 PNG、JPG、WebP 图片。";
    case "too-large": return "单张图片不能超过 5MB。";
  }
}
