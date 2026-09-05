import { readFile } from "node:fs/promises";

import { assertPrivateAssetReadable, requirePrivateAsset } from "../assets/assetStore";
import type { ProductImage } from "../schemas/project";
import { assertServerOnly } from "../server-only";

assertServerOnly("video reference image resolver");

export type HappyHorseReferenceImage = {
  url: string;
  role: "product" | "scene";
};

const MAX_REFERENCE_IMAGES = 9;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export async function resolveHappyHorseReferenceImages(input: {
  sessionId: string;
  projectId: string;
  heroImageAssetId?: string;
  productImages?: ProductImage[];
}): Promise<HappyHorseReferenceImage[]> {
  const productImages = [...(input.productImages ?? [])]
    .filter((image) => image.role !== "logo")
    .sort((a, b) => Number(b.role === "main-product") - Number(a.role === "main-product"));

  if (productImages.length === 0) {
    throw new Error("多参考视频生成至少需要一张真实产品图。");
  }

  const references: HappyHorseReferenceImage[] = [];
  for (const image of productImages) {
    if (!image.assetId) continue;
    references.push({
      url: await privateAssetDataUrl(input.sessionId, input.projectId, image.assetId, "product"),
      role: "product"
    });
  }
  if (references.length === 0) throw new Error("产品图尚未保存为当前会话的私有资产。");

  if (input.heroImageAssetId) {
    references.push({
      url: await privateAssetDataUrl(input.sessionId, input.projectId, input.heroImageAssetId, "scene"),
      role: "scene"
    });
  }

  return dedupeReferences(references).slice(0, MAX_REFERENCE_IMAGES);
}

export async function resolveWanReferenceImages(input: {
  sessionId: string;
  projectId: string;
  heroImageAssetId?: string;
  productImages?: ProductImage[];
}): Promise<HappyHorseReferenceImage[]> {
  const references = await resolveHappyHorseReferenceImages(input);
  const scene = references.find((reference) => reference.role === "scene");
  const products = references.filter((reference) => reference.role === "product").slice(0, 4);
  if (!scene) throw new Error("Wan 2.7 R2V 需要当前主镜头关键帧作为首帧参考。");
  return [scene, ...products].slice(0, 5);
}

async function privateAssetDataUrl(
  sessionId: string,
  projectId: string,
  assetId: string,
  role: "product" | "scene"
): Promise<string> {
  const asset = await requirePrivateAsset(sessionId, projectId, assetId);
  const allowedKinds = role === "product"
    ? ["product-image", "reference-image", "logo"]
    : ["keyframe"];
  if (!allowedKinds.includes(asset.kind)) throw new Error("视频参考资产类型不匹配。");
  if (!asset.mimeType.startsWith("image/")) throw new Error("视频参考资产不是图片。");
  const filePath = await assertPrivateAssetReadable(asset);
  const buffer = await readFile(filePath);
  if (buffer.byteLength > MAX_REFERENCE_BYTES) throw new Error("单张视频参考图不能超过 20MB。");
  return `data:${asset.mimeType};base64,${buffer.toString("base64")}`;
}

function dedupeReferences(references: HappyHorseReferenceImage[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.url)) return false;
    seen.add(reference.url);
    return true;
  });
}
