import { createPrivateAsset, getProjectAssetUrl } from "../assets/assetStore";
import { validateGeneratedImage } from "../assets/media";
import type { DownloadImageInput, DownloadImageResult } from "./types";

function assertServerOnly() {
  if (typeof window !== "undefined") throw new Error("downloadGeneratedImage can only be called on the server.");
}

function sanitizeDownloadError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown download error";
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]").replace(/sk-[A-Za-z0-9._-]+/gi, "[redacted]").slice(0, 240);
}

export async function downloadGeneratedImage(input: DownloadImageInput): Promise<DownloadImageResult> {
  assertServerOnly();
  if (!input.sessionId) return { success: false, cacheStatus: "remote-only", error: "Private image persistence requires an anonymous session.", failureStage: "persist" };

  let failureStage: "download" | "persist" = "download";
  try {
    const response = await fetch(input.imageUrl, { cache: "no-store", redirect: "follow" });
    if (!response.ok) {
      return { success: false, cacheStatus: "remote-only", error: `Failed to download generated image: HTTP ${response.status}`, failureStage: "download" };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const inspected = validateGeneratedImage({ bytes, responseContentType: response.headers.get("content-type") });
    failureStage = "persist";
    const asset = await createPrivateAsset(input.sessionId, input.projectId, {
      kind: "keyframe",
      role: input.shotId,
      source: "qwen-image",
      fileName: `${input.shotId}.${inspected.extension}`,
      mimeType: inspected.mimeType,
      bytes,
      width: inspected.width,
      height: inspected.height
    });

    return {
      success: true,
      assetId: asset.id,
      localUrl: getProjectAssetUrl(input.projectId, asset.id),
      cacheStatus: "cached"
    };
  } catch (error) {
    return { success: false, cacheStatus: "remote-only", error: sanitizeDownloadError(error), failureStage };
  }
}
