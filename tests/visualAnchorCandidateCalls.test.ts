vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ id: "anchor-call-test-session" }));
vi.mock("../lib/session/api", () => ({ getAnonymousApiSession: vi.fn(async () => ({ initialized: true, session: { id: session.id } })) }));
vi.mock("../lib/providers/deepseekProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/providers/deepseekProvider")>(),
  generateSceneCandidateDirections: vi.fn(async () => ({ success: false, data: null }))
}));
vi.mock("../lib/image/qwenImageModelRouter", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/image/qwenImageModelRouter")>(),
  generateQwenImageAdaptive: vi.fn()
}));

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/projects/[projectId]/visual-anchors/route";
import { createAnonymousProject, mutateOwnedAnonymousProject, resetAnonymousProjectQueuesForTests } from "../lib/projects/anonymousProjectStore";
import { buildProjectContinuity } from "../lib/continuity/projectContinuity";
import { generateQwenImageAdaptive } from "../lib/image/qwenImageModelRouter";
import { listModelCallLogs } from "../lib/logs/modelCallStore";
import { buildModelCallExport, modelCallExportMarkdown } from "../lib/logs/modelCallExport";
import { ensureVisualAnchorWorkspace } from "../lib/visual/visualAnchors";

const originalEnv = { ...process.env };
let root = "";

beforeEach(async () => {
  process.env = { ...originalEnv };
  root = await mkdtemp(path.join(tmpdir(), "ad-anchor-calls-"));
  process.env.STORAGE_ROOT = root;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "anchor-call-test-salt";
  resetAnonymousProjectQueuesForTests();
  vi.mocked(generateQwenImageAdaptive).mockReset();
});
afterEach(async () => {
  resetAnonymousProjectQueuesForTests();
  await rm(root, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("visual anchor candidate calls", () => {
  it("records a single scene candidate model failure separately from the outer task", async () => {
    const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const continuity = buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots });
    const saved = await mutateOwnedAnonymousProject(session.id, created.id, (project) =>
      ensureVisualAnchorWorkspace({ ...project, ...continuity }));
    const targetId = saved.project.sceneVisualSpecs![0]!.id;
    vi.mocked(generateQwenImageAdaptive).mockImplementation(async (_input, onAttempt) => {
      const startedAt = Date.now();
      await onAttempt?.({ model: "qwen-image", attempt: 1, status: "failed", startedAt, completedAt: startedAt + 100,
        errorCode: "INVALID_PARAMETER", error: "provider rejected size", providerErrorCode: "InvalidParameter",
        httpStatus: 400, referenceCount: 0, size: "1664*928", mode: "text-keyframe", promptExtend: false, watermark: false });
      return { success: false, provider: "dashscope", model: "qwen-image", latencyMs: 100, size: "1664*928",
        errorCode: "INVALID_PARAMETER", error: "provider rejected size", providerErrorCode: "InvalidParameter",
        httpStatus: 400, requestStartedAt: startedAt, requestCompletedAt: startedAt + 100 };
    });
    const response = await POST(new Request(`http://localhost/api/projects/${created.id}/visual-anchors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate-candidates", kind: "scene", targetId, count: 1, candidateIndex: 1, expectedVersion: saved.version })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(502);
    expect(generateQwenImageAdaptive).toHaveBeenCalledTimes(1);
    const logs = await listModelCallLogs(session.id, { projectId: created.id, stage: "anchors" });
    const calls = logs.filter((item) => item.kind === "call");
    expect(calls).toHaveLength(1);
    expect(calls.every((item) => item.anchorType === "scene" && item.candidateIndex === 1 && item.candidateId)).toBe(true);
    expect(calls.find((item) => item.model === "qwen-image" && item.mode === "text-keyframe")).toMatchObject({
      status: "failed", errorCode: "INVALID_PARAMETER", providerErrorCode: "InvalidParameter",
      httpStatus: 400, failurePhase: "MODEL_REQUEST_FAILED", referenceImageCount: 0, referenceImagesIncluded: false
    });
    expect(logs.some((item) => item.kind === "task" && item.status === "failed")).toBe(true);
    const report = await buildModelCallExport(session.id, { projectId: created.id });
    expect(report.summary).toMatchObject({ failedCalls: 1, failedTasks: 1, affectedCandidates: ["场景候选 1"] });
    expect(modelCallExportMarkdown(report)).toContain("受影响候选：场景候选 1");
  });
});
