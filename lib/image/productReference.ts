import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ProductImage } from "../schemas/project";
import { assertServerOnly } from "../server-only";

const MAX_REFERENCE_BYTES = 5 * 1024 * 1024;

export function selectPrimaryProductImage(images?: ProductImage[]): ProductImage | undefined {
  return images?.find((image) => image.role === "main-product") ?? images?.[0];
}

export async function readProductReferenceDataUrl(image?: ProductImage): Promise<string | undefined> {
  if (!image?.localUrl) return undefined;

  const publicUrl = decodeURIComponent((image.localUrl.split("?")[0] ?? "").trim());
  if (!publicUrl.startsWith("/uploads/")) {
    throw new Error("Product reference must use a persisted /uploads/ asset.");
  }

  const publicRoot = path.resolve(process.cwd(), "public");
  const filePath = path.resolve(publicRoot, `.${publicUrl}`);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error("Product reference path is outside the public asset directory.");
  }

  const bytes = await readFile(filePath);
  if (bytes.length === 0 || bytes.length > MAX_REFERENCE_BYTES) {
    throw new Error("Product reference is empty or exceeds the 5MB limit.");
  }

  return `data:${image.type};base64,${bytes.toString("base64")}`;
}