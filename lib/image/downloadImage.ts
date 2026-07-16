import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { DownloadImageInput, DownloadImageResult } from "./types";

function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error("downloadGeneratedImage can only be called on the server.");
  }
}

function stableShotFileName(shotId: string): string {
  const match = shotId.match(/(\d+)/);
  const index = match ? Number.parseInt(match[1], 10) : 1;
  const safeIndex = Number.isFinite(index) && index > 0 ? index : 1;
  return `shot-${safeIndex}.png`;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 80) || "project";
}

function sanitizeDownloadError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown download error";
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]").slice(0, 240);
}

export async function downloadGeneratedImage(input: DownloadImageInput): Promise<DownloadImageResult> {
  assertServerOnly();

  try {
    const response = await fetch(input.imageUrl, { cache: "no-store" });

    if (!response.ok) {
      return {
        success: false,
        cacheStatus: "remote-only",
        error: `Failed to download generated image: HTTP ${response.status}`
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const safeProjectId = safePathSegment(input.projectId);
    const fileName = stableShotFileName(input.shotId);
    const publicDir = path.join(process.cwd(), "public", "generated", "images", safeProjectId);
    const outputPath = path.join(publicDir, fileName);

    await mkdir(publicDir, { recursive: true });
    await writeFile(outputPath, bytes);

    return {
      success: true,
      localUrl: `/generated/images/${safeProjectId}/${fileName}`,
      cacheStatus: "cached"
    };
  } catch (error) {
    return {
      success: false,
      cacheStatus: "remote-only",
      error: sanitizeDownloadError(error)
    };
  }
}
