import { readClientApiResponse } from "../api/clientResponse";
import type { AspectRatio, StoryboardShot } from "../schemas/project";
import type { KeyframeResult } from "@/components/KeyframePreview";

export type KeyframeGenerationData = {
  status: "running" | "completed";
  eventId: string;
  jobId?: string;
  images: KeyframeResult[];
  generatedShots?: number;
  requestedShots?: number;
};

export async function generateProjectKeyframes(input: {
  projectId: string;
  shots: StoryboardShot[];
  aspectRatio: AspectRatio;
  frameIds?: string[];
  retryResponseTimeout?: boolean;
  onProgress?: (progress: KeyframeGenerationData) => void | Promise<void>;
  onConnectionChange?: (reconnecting: boolean) => void;
}): Promise<KeyframeGenerationData> {
  let response: Response;
  try { response = await fetch("/api/generate-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      shots: input.shots,
      mode: "all-shots",
      aspectRatio: input.aspectRatio,
      ...(input.frameIds?.length ? { frameIds: input.frameIds } : {}),
      ...(input.retryResponseTimeout ? { retryResponseTimeout: true } : {})
    })
  }); } catch {
    const snapshot = await fetch(`/api/projects/${encodeURIComponent(input.projectId)}`, { cache: "no-store" }).then((result) => result.json()).catch(() => null) as {
      data?: { project?: { generationEvents?: Array<{ id: string; stage: string; action: string; status: string; startedAt: number }> } }
    } | null;
    const active = snapshot?.data?.project?.generationEvents?.filter((event) => event.stage === "keyframes" && event.action === "生成关键帧批次"
      && ["queued", "running", "qa-review"].includes(event.status)).sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!active) throw new Error("连接暂时中断，无法确认任务是否已创建。请刷新项目查看任务状态，勿立即重复提交。");
    return pollProjectKeyframes(input.projectId, active.id, input.onProgress, input.onConnectionChange);
  }
  const result = await readClientApiResponse<KeyframeGenerationData>(response);
  if (!response.ok || !result.success || !result.data) throw new Error(publicKeyframeError(result.error));
  if (result.data.status === "completed") return result.data;
  return pollProjectKeyframes(input.projectId, result.data.eventId, input.onProgress, input.onConnectionChange);
}

export async function pollProjectKeyframes(
  projectId: string,
  eventId: string,
  onProgress?: (progress: KeyframeGenerationData) => void | Promise<void>,
  onConnectionChange?: (reconnecting: boolean) => void
): Promise<KeyframeGenerationData> {
  let transportErrors = 0;
  for (;;) {
    const delayMs = transportErrors ? Math.min(30_000, 2_000 * 2 ** Math.min(transportErrors - 1, 4)) : 3_000;
    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    let response: Response;
    try {
      response = await fetch(`/api/generate-images?projectId=${encodeURIComponent(projectId)}&eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
    } catch {
      transportErrors += 1;
      onConnectionChange?.(true);
      continue;
    }
    const result = await readClientApiResponse<KeyframeGenerationData>(response);
    if (result.success && result.data?.status === "completed") {
      onConnectionChange?.(false);
      try { await onProgress?.(result.data); } catch { /* The completed job is still authoritative. */ }
      return result.data;
    }
    if (result.success && result.data?.status === "running") {
      transportErrors = 0;
      onConnectionChange?.(false);
      try { await onProgress?.(result.data); } catch { /* A project refresh may fail without failing the job. */ }
      continue;
    }
    if ([502, 503, 504].includes(response.status)) {
      transportErrors += 1;
      onConnectionChange?.(true);
      continue;
    }
    throw new Error(publicKeyframeError(result.error));
  }
}

function publicKeyframeError(message?: string | null) {
  if (message?.includes("响应超时")) return message;
  if (!message || /(?:Zod|JSON|Schema|request.?id|payload|[A-Z][A-Z_]{3,})/.test(message)) {
    return "关键帧暂时未生成成功，请在生成详情中查看原因并重试。";
  }
  return message;
}
