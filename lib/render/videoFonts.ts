import { readFile } from "node:fs/promises";
import path from "node:path";

export const VIDEO_FONT_ASSETS = [
  { fileName: "AdDirectorSans-Regular.woff2", weight: 400 },
  { fileName: "AdDirectorSans-Medium.woff2", weight: 500 },
  { fileName: "AdDirectorSans-Bold.woff2", weight: 700 }
] as const;

export class VideoFontLoadError extends Error {
  readonly code = "FONT_LOAD_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "VideoFontLoadError";
  }
}

export async function assertVideoFontsAvailable(rootDir = process.cwd()) {
  for (const font of VIDEO_FONT_ASSETS) {
    const filePath = path.join(rootDir, "public", "fonts", font.fileName);
    try {
      const bytes = await readFile(filePath);
      const signature = bytes.subarray(0, 4).toString("ascii");
      if (signature !== "wOF2") {
        throw new Error("invalid WOFF2 signature");
      }
    } catch (error) {
      const errorType = error instanceof Error ? error.name : "UnknownError";
      throw new VideoFontLoadError(
        `视频字体加载失败：${font.fileName}（字重 ${font.weight}，${errorType}）。渲染已终止。`
      );
    }
  }
}
