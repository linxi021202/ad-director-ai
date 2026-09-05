import "server-only";

import { NextResponse } from "next/server";

import { createPrivateAsset, deletePrivateAsset } from "@/lib/assets/assetStore";
import { validateProductImage } from "@/lib/assets/media";
import { getProjectAssetUrl } from "@/lib/assets/url";
import { authorizeOwnedProject } from "@/lib/projects/api";
import { mutateOwnedAnonymousProject } from "@/lib/projects/anonymousProjectStore";
import { productImageRoleSchema } from "@/lib/schemas/project";
import { getAnonymousApiSession } from "@/lib/session/api";

export async function POST(request: Request) {
  const sessionResult = await getAnonymousApiSession();
  if (!sessionResult.initialized) return sessionResult.response;
  const { session } = sessionResult;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const authorization = await authorizeOwnedProject(session.id, String(formData.get("projectId") ?? ""));
    if (!authorization.authorized) return authorization.response;
    if (!(file instanceof File)) return response(false, null, "未收到图片文件。", 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const inspected = validateProductImage({ bytes, declaredMimeType: file.type, fileName: file.name });
    const clientImageId = String(formData.get("assetId") ?? crypto.randomUUID()).trim().slice(0, 120);
    const requestedRole = productImageRoleSchema.safeParse(String(formData.get("role") ?? "main-product"));
    const existingImages = authorization.record.project.brief.productImages ?? [];
    const existingImage = existingImages.find((image) => image.id === clientImageId);
    const role = requestedRole.success
      ? requestedRole.data
      : existingImage?.role ?? (existingImages.some((image) => image.role === "main-product") ? "reference" : "main-product");

    const asset = await createPrivateAsset(session.id, authorization.projectId, {
      kind: role === "logo" ? "logo" : role === "reference" ? "reference-image" : "product-image",
      role,
      source: "user-upload",
      fileName: file.name,
      mimeType: inspected.mimeType,
      bytes,
      width: inspected.width,
      height: inspected.height
    });
    const localUrl = getProjectAssetUrl(authorization.projectId, asset.id);
    const nextImage = {
      id: clientImageId,
      assetId: asset.id,
      name: file.name,
      type: inspected.mimeType,
      size: bytes.byteLength,
      localUrl,
      role
    };
    let replacedAssetId: string | undefined;
    let updated;
    try {
      updated = await mutateOwnedAnonymousProject(session.id, authorization.projectId, (project) => {
        const currentImages = project.brief.productImages ?? [];
        const previous = currentImages.find((image) => image.id === clientImageId);
        const retained = currentImages.filter((image) => image.id !== clientImageId);
        if (retained.length >= 3) throw new Error("PRODUCT_IMAGE_LIMIT_REACHED");
        replacedAssetId = previous?.assetId;
        return {
          ...project,
          brief: {
            ...project.brief,
            productImages: [...retained, nextImage]
          }
        };
      });
    } catch (error) {
      await deletePrivateAsset(session.id, authorization.projectId, asset.id);
      throw error;
    }
    if (replacedAssetId && replacedAssetId !== asset.id) {
      await deletePrivateAsset(session.id, authorization.projectId, replacedAssetId).catch(() => undefined);
    }

    return response(true, {
      assetId: asset.id,
      localUrl,
      version: updated.version,
      width: inspected.width,
      height: inspected.height,
      mimeType: inspected.mimeType,
      sizeBytes: asset.sizeBytes
    }, null, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/PRODUCT_IMAGE_LIMIT_REACHED/.test(message)) return response(false, null, "最多只能保存 3 张产品图。", 400);
    if (/PRODUCT_IMAGE_SIZE_INVALID/.test(message)) return response(false, null, "单张图片必须小于 5MB。", 400);
    if (/MIME|EXTENSION|UNSUPPORTED_OR_CORRUPT_IMAGE/.test(message)) {
      return response(false, null, "图片内容、扩展名或 MIME 类型不一致，仅支持有效的 PNG、JPG、WebP。", 400);
    }
    return response(false, null, "产品图私有保存失败，请重新选择图片。", 500);
  }
}

function response(success: boolean, data: unknown, error: string | null, status: number) {
  return NextResponse.json({ success, data, trace: null, fallbackUsed: false, fallbackReason: null, error }, { status });
}
