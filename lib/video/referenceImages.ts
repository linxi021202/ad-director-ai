import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ProductImage } from "../schemas/project";
import { assertServerOnly } from "../server-only";

assertServerOnly("HappyHorse reference image resolver");

export type HappyHorseReferenceImage = {
  url: string;
  role: "product" | "scene";
};

const MAX_REFERENCE_IMAGES = 9;

export async function resolveHappyHorseReferenceImages(input: {
  heroImageUrl: string;
  productImages?: ProductImage[];
}): Promise<HappyHorseReferenceImage[]> {
  const productImages = [...(input.productImages ?? [])]
    .filter((image) => image.role !== "logo")
    .sort((a, b) => Number(b.role === "main-product") - Number(a.role === "main-product"));

  if (productImages.length === 0) {
    throw new Error("HappyHorse 多参考图生成需要至少一张真实产品图。请先在商品简报上传产品主图，再生成主镜头视频。");
  }

  const references: HappyHorseReferenceImage[] = [];
  for (const image of productImages) {
    const source = image.localUrl || image.remoteUrl || image.url;
    if (!source || source.startsWith("blob:")) continue;
    references.push({
      url: await resolveImageInput(source, image.type),
      role: "product"
    });
  }

  if (references.length === 0) {
    throw new Error("上传的产品图尚未保存为可用素材。请等待产品图保存完成，或重新上传后再生成主镜头视频。");
  }

  const heroSource = input.heroImageUrl.trim();
  if (heroSource) {
    references.push({
      url: await resolveImageInput(heroSource, inferMimeType(heroSource)),
      role: "scene"
    });
  }

  return dedupeReferences(references).slice(0, MAX_REFERENCE_IMAGES);
}

async function resolveImageInput(source: string, mimeType: string): Promise<string> {
  if (/^https?:\/\//i.test(source) || /^data:image\//i.test(source)) return source;
  if (!source.startsWith("/")) {
    throw new Error("参考图地址无效：仅支持项目本地图片、公开 HTTP 地址或图片 Data URL。");
  }

  const publicRoot = path.resolve(process.cwd(), "public");
  const filePath = path.resolve(publicRoot, source.replace(/^\/+/, ""));
  if (filePath !== publicRoot && !filePath.startsWith(publicRoot + path.sep)) {
    throw new Error("参考图路径超出项目 public 目录，已阻止调用。");
  }

  const buffer = await readFile(filePath);
  if (buffer.byteLength > 20 * 1024 * 1024) {
    throw new Error("HappyHorse 单张参考图不能超过 20MB。");
  }

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function inferMimeType(source: string): string {
  const clean = source.split("?")[0]?.toLowerCase() ?? "";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function dedupeReferences(references: HappyHorseReferenceImage[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (seen.has(reference.url)) return false;
    seen.add(reference.url);
    return true;
  });
}
