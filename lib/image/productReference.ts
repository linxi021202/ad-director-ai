import { readFile } from "node:fs/promises";

import { assertPrivateAssetReadable, requirePrivateAsset } from "../assets/assetStore";
import type { ProductImage } from "../schemas/project";
import { assertServerOnly } from "../server-only";

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;

export function selectPrimaryProductImage(images?: ProductImage[]): ProductImage | undefined {
  return images?.find((image) => image.role === "main-product") ?? images?.[0];
}

export async function readProductReferenceDataUrl(
  image?: ProductImage,
  context?: { sessionId?: string; projectId?: string }
): Promise<string | undefined> {
  assertServerOnly("product reference");
  if (!image) return undefined;
  if (!image.assetId || !context?.sessionId || !context.projectId) {
    throw new Error("Product reference is not backed by a private project asset.");
  }

  const asset = await requirePrivateAsset(context.sessionId, context.projectId, image.assetId);
  if (!["product-image", "logo", "reference-image"].includes(asset.kind)) {
    throw new Error("Selected asset is not a product reference image.");
  }
  if (asset.mimeType !== image.type) throw new Error("Product reference MIME metadata does not match.");
  const filePath = await assertPrivateAssetReadable(asset);
  const bytes = await readFile(filePath);
  if (bytes.length === 0 || bytes.length > MAX_REFERENCE_BYTES) {
    throw new Error("Product reference is empty or exceeds the 5MB limit.");
  }

  return `data:${asset.mimeType};base64,${bytes.toString("base64")}`;
}
