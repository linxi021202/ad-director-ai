import { readFile } from "node:fs/promises";

import { assertPrivateAssetReadable, requirePrivateAsset } from "../assets/assetStore";
import type { ProductImage } from "../schemas/project";
import { assertServerOnly } from "../server-only";

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;
const MAX_CONTINUITY_REFERENCE_BYTES = 10 * 1024 * 1024;
const VISUAL_ASSET_KINDS = ["product-image", "logo", "reference-image", "keyframe"];

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

export async function readContinuityReferenceDataUrl(
  assetId?: string,
  context?: { sessionId?: string; projectId?: string }
): Promise<string | undefined> {
  assertServerOnly("continuity reference");
  if (!assetId) return undefined;
  if (!context?.sessionId || !context.projectId) {
    throw new Error("Continuity reference is missing its private project context.");
  }

  const asset = await requirePrivateAsset(context.sessionId, context.projectId, assetId);
  if (asset.kind !== "keyframe" || !asset.mimeType.startsWith("image/")) {
    throw new Error("Continuity reference is not a generated keyframe image.");
  }
  const filePath = await assertPrivateAssetReadable(asset);
  const bytes = await readFile(filePath);
  if (bytes.length === 0 || bytes.length > MAX_CONTINUITY_REFERENCE_BYTES) {
    throw new Error("Continuity reference is empty or exceeds the 10MB limit.");
  }

  return `data:${asset.mimeType};base64,${bytes.toString("base64")}`;
}

export async function readPrivateVisualAssetDataUrl(
  assetId: string,
  context: { sessionId: string; projectId: string },
  maxBytes = MAX_CONTINUITY_REFERENCE_BYTES
): Promise<string> {
  assertServerOnly("private visual asset");
  const asset = await requirePrivateAsset(context.sessionId, context.projectId, assetId);
  if (!VISUAL_ASSET_KINDS.includes(asset.kind) || !asset.mimeType.startsWith("image/")) {
    throw new Error("Selected private asset is not an inspectable image.");
  }
  const filePath = await assertPrivateAssetReadable(asset);
  const bytes = await readFile(filePath);
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error("Visual asset is empty or exceeds the inspection limit.");
  }
  return `data:${asset.mimeType};base64,${bytes.toString("base64")}`;
}
