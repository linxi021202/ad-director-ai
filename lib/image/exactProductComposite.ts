import "server-only";

import { readFile } from "node:fs/promises";
import sharp from "sharp";

import {
  assertPrivateAssetReadable,
  createPrivateAsset,
  getProjectAssetUrl,
  requirePrivateAsset
} from "../assets/assetStore";
import type { AspectRatio, ProductShotType } from "../schemas/project";

const SIZES: Record<AspectRatio, { width: number; height: number }> = {
  "9:16": { width: 1152, height: 2048 },
  "16:9": { width: 2048, height: 1152 },
  "1:1": { width: 1536, height: 1536 }
};

export async function composeExactProductAsset(input: {
  sessionId: string;
  projectId: string;
  backgroundAssetId: string;
  productAssetId: string;
  shotId: string;
  aspectRatio: AspectRatio;
  shotType: ProductShotType;
}) {
  const [background, product] = await Promise.all([
    requirePrivateAsset(input.sessionId, input.projectId, input.backgroundAssetId),
    requirePrivateAsset(input.sessionId, input.projectId, input.productAssetId)
  ]);
  const [backgroundPath, productPath] = await Promise.all([
    assertPrivateAssetReadable(background),
    assertPrivateAssetReadable(product)
  ]);
  const size = SIZES[input.aspectRatio];
  const productWidthRatio = input.shotType === "human-product-interaction" ? 0.24 : 0.32;
  const productWidth = Math.round(size.width * productWidthRatio);
  const productBuffer = await sharp(await readFile(productPath))
    .rotate()
    .trim({ background: "#ffffff", threshold: 10 })
    .resize({ width: productWidth, height: Math.round(size.height * 0.52), fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .png()
    .toBuffer();
  const productMeta = await sharp(productBuffer).metadata();
  const overlayWidth = productMeta.width ?? productWidth;
  const overlayHeight = productMeta.height ?? Math.round(size.height * 0.36);
  const left = Math.max(0, Math.round((size.width - overlayWidth) * (input.shotType === "human-product-interaction" ? 0.68 : 0.5)));
  const top = Math.max(0, Math.round(size.height * 0.82 - overlayHeight));
  const shadow = Buffer.from(`<svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${left + overlayWidth / 2}" cy="${top + overlayHeight}" rx="${overlayWidth * 0.42}" ry="${Math.max(12, overlayHeight * 0.045)}" fill="rgba(0,0,0,0.34)"/></svg>`);
  const bytes = await sharp(await readFile(backgroundPath))
    .rotate()
    .resize(size.width, size.height, { fit: "cover" })
    .composite([
      { input: shadow, left: 0, top: 0, blend: "over" },
      { input: productBuffer, left, top, blend: "over" }
    ])
    .png()
    .toBuffer();
  const asset = await createPrivateAsset(input.sessionId, input.projectId, {
    kind: "keyframe",
    source: "remotion",
    role: "exact-product-composite",
    fileName: `${input.shotId}-exact-product.png`,
    mimeType: "image/png",
    bytes,
    width: size.width,
    height: size.height
  });
  return { assetId: asset.id, localUrl: getProjectAssetUrl(input.projectId, asset.id), width: size.width, height: size.height };
}
