import type { GenerationProject, ProductBrief } from "../schemas/project";

export type ProjectPatchData = {
  project: GenerationProject;
  version: number;
};

export type ProjectBriefDraft = {
  brief: ProductBrief;
  shotCount: number;
  targetDurationSec: number;
};

type ProjectApiPayload = {
  data?: ProjectPatchData;
  error?: { code?: string; message?: string };
};

export async function saveProjectBriefWithConflictRetry(
  projectId: string,
  expectedVersion: number,
  draft: ProjectBriefDraft,
  options: { fetchImpl?: typeof fetch; maxAttempts?: number } = {}
): Promise<ProjectPatchData> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  let version = expectedVersion;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: version,
        saveBrief: {
          brief: { ...draft.brief, durationSec: draft.targetDurationSec },
          shotCount: draft.shotCount,
          targetDurationSec: draft.targetDurationSec
        }
      })
    });
    const payload = await readProjectPayload(response);
    if (response.ok && payload?.data) return payload.data;

    const isConflict = response.status === 409 && payload?.error?.code === "PROJECT_VERSION_CONFLICT";
    if (!isConflict || attempt === maxAttempts - 1) {
      throw new Error(payload?.error?.message || "商品简报保存失败，请重试。");
    }

    const latest = await fetchLatestProject(projectId, fetchImpl);
    version = latest.version;
  }

  throw new Error("商品简报保存失败，请重试。");
}

async function fetchLatestProject(projectId: string, fetchImpl: typeof fetch): Promise<ProjectPatchData> {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
  const payload = await readProjectPayload(response);
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message || "项目刷新失败，请重试。");
  }
  return payload.data;
}

async function readProjectPayload(response: Response): Promise<ProjectApiPayload | null> {
  return response.json().catch(() => null) as Promise<ProjectApiPayload | null>;
}
