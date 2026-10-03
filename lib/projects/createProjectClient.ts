import { readClientApiResponse } from "@/lib/api/clientResponse";

export async function createProjectFromBrowser(): Promise<string> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const result = await readClientApiResponse<{ projectId: string }>(response);
  if (!response.ok || !result.success || !result.data?.projectId) {
    throw new Error(result.error || "新建项目失败，请稍后重试。");
  }
  return result.data.projectId;
}
