import "server-only";

import { requireApiUser } from "@/lib/auth/api";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { MAX_PRODUCT_IMAGE_SIZE_BYTES, SUPPORTED_PRODUCT_IMAGE_TYPES } from "@/lib/productImages";

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};

export async function POST(request: Request) {
  const authResult = await requireApiUser();
  if (!authResult.authenticated) return authResult.response;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const projectId = safeSegment(String(formData.get("projectId") ?? "project"));
    const assetId = safeSegment(String(formData.get("assetId") ?? crypto.randomUUID()));

    if (!(file instanceof File)) return response(false, null, "未收到图片文件。", 400);
    if (!SUPPORTED_PRODUCT_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_PRODUCT_IMAGE_TYPES)[number])) return response(false, null, "仅支持 PNG、JPG、WebP 图片。", 400);
    if (file.size > MAX_PRODUCT_IMAGE_SIZE_BYTES) return response(false, null, "单张图片不能超过 5MB。", 400);

    const extension = extensions[file.type]!;
    const directory = path.join(process.cwd(), "public", "uploads", projectId);
    const fileName = `${assetId}.${extension}`;
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), Buffer.from(await file.arrayBuffer()));

    return response(true, { localUrl: `/uploads/${projectId}/${fileName}` }, null, 200);
  } catch {
    return response(false, null, "产品图本地保存失败，请重新选择图片。", 500);
  }
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 80) || "asset";
}

function response(success: boolean, data: { localUrl: string } | null, error: string | null, status: number) {
  return NextResponse.json({ success, data, trace: null, fallbackUsed: false, fallbackReason: null, error }, { status });
}
