import { readClientApiResponse } from "@/lib/api/clientResponse";

type ClearGenerationEventsResult = {
  clearedCount: number;
  version: number;
};

export async function clearProjectGenerationEvents(projectId: string): Promise<ClearGenerationEventsResult> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/events`, {
    method: "DELETE",
    cache: "no-store"
  });
  const payload = await readClientApiResponse<ClearGenerationEventsResult>(response);
  if (!payload.success || !payload.data) {
    throw new Error(payload.error || "无法清空上一轮生成日志，本轮调用尚未开始。");
  }
  return payload.data;
}
