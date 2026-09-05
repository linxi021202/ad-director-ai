import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { assertPrivateAssetReadable, requirePrivateAsset } from "../assets/assetStore";
import { getInternalRenderAssetUrl, issueRenderAssetToken } from "../assets/renderAccess";
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
  assetBaseUrl?: string;
}): Promise<HappyHorseReferenceImage[]> {
  if (!input.heroImageAssetId) throw new Error("Wan 2.7 R2V 需要当前主镜头关键帧作为首帧参考。");
  const productAssetIds = [...(input.productImages ?? [])]
    .filter((image) => image.role !== "logo" && image.assetId)
    .sort((a, b) => Number(b.role === "main-product") - Number(a.role === "main-product"))
    .slice(0, 4)
    .map((image) => image.assetId!);
  if (productAssetIds.length === 0) throw new Error("产品图尚未保存为当前会话的私有资产。");

  const references = [
    { assetId: input.heroImageAssetId, role: "scene" as const },
    ...productAssetIds.map((assetId) => ({ assetId, role: "product" as const }))
  ];
  for (const reference of references) {
    await validatePrivateImageAsset(input.sessionId, input.projectId, reference.assetId, reference.role);
  }

  if (input.assetBaseUrl && isExternallyReachableOrigin(input.assetBaseUrl)) {
    const token = await issueRenderAssetToken({
      sessionId: input.sessionId,
      projectId: input.projectId,
      renderId: `wan-reference-${randomUUID()}`,
      assetIds: references.map((reference) => reference.assetId),
      ttlMs: 45 * 60_000
    });
    return references.map((reference) => ({
      url: getInternalRenderAssetUrl(input.assetBaseUrl!, reference.assetId, token),
      role: reference.role
    }));
  }

  return Promise.all(references.map(async (reference) => ({
    url: await privateAssetDataUrl(input.sessionId, input.projectId, reference.assetId, reference.role),
    role: reference.role
  })));
}

async function privateAssetDataUrl(
  sessionId: string,
  projectId: string,
  assetId: string,
  role: "product" | "scene"
): Promise<string> {
  const { asset, filePath } = await validatePrivateImageAsset(sessionId, projectId, assetId, role);
  const buffer = await readFile(filePath);
  return `data:${asset.mimeType};base64,${buffer.toString("base64")}`;
}

async function validatePrivateImageAsset(
  sessionId: string,
  projectId: string,
  assetId: string,
  role: "product" | "scene"
) {
  const asset = await requirePrivateAsset(sessionId, projectId, assetId);
  const allowedKinds = role === "product"
    ? ["product-image", "reference-image", "logo"]
    : ["keyframe"];
  if (!allowedKinds.includes(asset.kind)) throw new Error("视频参考资产类型不匹配。");
  if (!asset.mimeType.startsWith("image/")) throw new Error("视频参考资产不是图片。");
  const filePath = await assertPrivateAssetReadable(asset);
  if (asset.sizeBytes > MAX_REFERENCE_BYTES) throw new Error("单张视频参考图不能超过 20MB。");
  return { asset, filePath };
}

function isExternallyReachableOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      && !url.hostname.endsWith(".internal");
  } catch {
    return false;
  }
}

function dedupeReferences(references: HappyHorseReferenceImage[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.url)) return false;
    seen.add(reference.url);
    return true;
  });
}
