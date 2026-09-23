import { readClientApiResponse } from "../api/clientResponse";
import type { AspectRatio, StoryboardShot } from "../schemas/project";
import type { KeyframeResult } from "@/components/KeyframePreview";

export type KeyframeGenerationData = {
  status: "running" | "completed";
  eventId: string;
  images: KeyframeResult[];
  generatedShots?: number;
  requestedShots?: number;
};

export async function generateProjectKeyframes(input: {
  projectId: string;
  shots: StoryboardShot[];
  aspectRatio: AspectRatio;
  frameIds?: string[];
  onProgress?: () => void | Promise<void>;
}): Promise<KeyframeGenerationData> {
  const response = await fetch("/api/generate-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      shots: input.shots,
      mode: "all-shots",
      aspectRatio: input.aspectRatio,
      ...(input.frameIds?.length ? { frameIds: input.frameIds } : {})
    })
  });
  const result = await readClientApiResponse<KeyframeGenerationData>(response);
  if (!response.ok || !result.success || !result.data) throw new Error(publicKeyframeError(result.error));
  if (result.data.status === "completed") return result.data;
  return pollProjectKeyframes(input.projectId, result.data.eventId, input.onProgress);
}

export async function pollProjectKeyframes(
  projectId: string,
  eventId: string,
  onProgress?: () => void | Promise<void>
): Promise<KeyframeGenerationData> {
  let transportErrors = 0;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 3_000));
    let response: Response;
    try {
      response = await fetch(`/api/generate-images?projectId=${encodeURIComponent(projectId)}&eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
    } catch (error) {
      if (++transportErrors < 12) continue;
      throw error;
    }
    const result = await readClientApiResponse<KeyframeGenerationData>(response);
    await onProgress?.();
    if (result.success && result.data?.status === "completed") return result.data;
    if (result.success && result.data?.status === "running") {
      transportErrors = 0;
      continue;
    }
    if ([502, 503, 504].includes(response.status) && ++transportErrors < 12) continue;
    throw new Error(publicKeyframeError(result.error));
  }
  throw new Error("Qwen-Image 已等待 15 分钟仍未完成。请刷新项目查看保留的任务日志。");
}

function publicKeyframeError(message?: string | null) {
  if (!message || /(?:Zod|JSON|Schema|request.?id|payload|[A-Z][A-Z_]{3,})/.test(message)) {
    return "关键帧暂时未生成成功，请在生成详情中查看原因并重试。";
  }
  return message;
}
