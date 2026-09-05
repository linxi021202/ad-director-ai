import { assertServerOnly } from "../server-only";
import type { DownloadVideoResult } from "./types";

assertServerOnly("generated video download");

const VIDEO_DOWNLOAD_TIMEOUT_MS = 90_000;

export async function downloadRemoteVideo(videoUrl: string): Promise<DownloadVideoResult> {
  try {
    const url = new URL(videoUrl);
    if (!["http:", "https:"].includes(url.protocol)) return { success: false, error: "模型返回的视频地址不是有效的 HTTP URL。" };
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(VIDEO_DOWNLOAD_TIMEOUT_MS)
    });
    if (!response.ok) return { success: false, error: `下载生成视频失败：HTTP ${response.status}` };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) return { success: false, error: "模型返回的视频文件为空。" };
    return { success: true, buffer, sizeBytes: buffer.length, mimeType: normalizeVideoMime(response.headers.get("content-type")) };
  } catch (error) {
    const sanitized = sanitizeVideoError(error);
    return {
      success: false,
      error: /timeout|aborted due to timeout|aborterror/i.test(sanitized)
        ? "VIDEO_DOWNLOAD_TIMEOUT：模型已生成视频，但服务器在 90 秒内未完成下载。"
        : `VIDEO_DOWNLOAD_FAILED：${sanitized}`
    };
  }
}

function normalizeVideoMime(contentType: string | null) {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return type && type.startsWith("video/") ? type : "video/mp4";
}

export function sanitizeVideoError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***").replace(/sk-[A-Za-z0-9_-]{8,}/gi, "sk-***").replace(/dashscope[_-]?api[_-]?key\s*[:=]\s*[^,\s]+/gi, "DASHSCOPE_API_KEY=***");
}
