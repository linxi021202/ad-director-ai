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
vi.mock("../lib/image/productReference", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/image/productReference")>(),
  readProductReferenceDataUrl: vi.fn(async () => "data:image/png;base64,AA==")
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
import { sceneRequiresProductReference } from "../lib/visual/anchorPrompts";
import * as storageCapacity from "../lib/assets/storageCapacity";

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
  vi.restoreAllMocks();
  resetAnonymousProjectQueuesForTests();
  await rm(root, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("visual anchor candidate calls", () => {
  it("rejects a full-storage candidate batch before model calls or event writes", async () => {
    const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const continuity = buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots });
    const saved = await mutateOwnedAnonymousProject(session.id, created.id, (project) => ensureVisualAnchorWorkspace({ ...project, ...continuity }));
    vi.spyOn(storageCapacity, "assertImageStorageCapacity").mockRejectedValue(new storageCapacity.StorageCapacityError("STORAGE_CAPACITY_LOW"));
    const response = await POST(new Request(`http://localhost/api/projects/${created.id}/visual-anchors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate-candidates", kind: "scene", targetId: saved.project.sceneVisualSpecs![0]!.id,
        count: 3, expectedVersion: saved.version })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(507);
    expect((await response.json()).error).toContain("存储空间不足");
    expect(generateQwenImageAdaptive).not.toHaveBeenCalled();
    expect(await listModelCallLogs(session.id, { projectId: created.id, stage: "anchors" })).toHaveLength(0);
  });
  it("distinguishes empty scenes from scenes that explicitly place the real product", async () => {
    const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const spec = ensureVisualAnchorWorkspace({ ...created.project,
      ...buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots }) }).sceneVisualSpecs![0]!;
    expect(sceneRequiresProductReference({ ...spec, heroProps: [], layout: undefined }, created.project.brief.productName)).toBe(false);
    expect(sceneRequiresProductReference({ ...spec, heroProps: [created.project.brief.productName], layout: undefined }, created.project.brief.productName)).toBe(true);
  });

  it("passes a real-product scene reference into the edit-model task", async () => {
    const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const continuity = buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots });
    const saved = await mutateOwnedAnonymousProject(session.id, created.id, (project) => {
      const workspace = ensureVisualAnchorWorkspace({ ...project, ...continuity });
      return { ...workspace, sceneVisualSpecs: workspace.sceneVisualSpecs?.map((spec) => ({ ...spec, heroProps: [project.brief.productName] })) };
    });
    vi.mocked(generateQwenImageAdaptive).mockImplementation(async (request) => ({ success: false, provider: "dashscope",
      model: "qwen-image-edit-max-2026-01-16", latencyMs: 10, size: request.size!, errorCode: "INVALID_IMAGE" }));
    const response = await POST(new Request(`http://localhost/api/projects/${created.id}/visual-anchors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate-candidates", kind: "scene", targetId: saved.project.sceneVisualSpecs![0]!.id,
        count: 1, candidateIndex: 1, expectedVersion: saved.version })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(502);
    expect(vi.mocked(generateQwenImageAdaptive).mock.calls[0]?.[0]).toMatchObject({
      taskType: "scene_candidate_with_product_reference", referenceImages: ["data:image/png;base64,AA=="],
      requiredCapabilities: { referenceImageInput: true, highConsistency: true }
    });
  });
  it("records a single scene candidate model failure separately from the outer task", async () => {
    const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const continuity = buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots });
    const saved = await mutateOwnedAnonymousProject(session.id, created.id, (project) => {
      const workspace = ensureVisualAnchorWorkspace({ ...project, ...continuity });
      return { ...workspace, sceneVisualSpecs: workspace.sceneVisualSpecs?.map((spec) => ({ ...spec, heroProps: [], layout: undefined })) };
    });
    const targetId = saved.project.sceneVisualSpecs![0]!.id;
    vi.mocked(generateQwenImageAdaptive).mockImplementation(async (_input, onAttempt) => {
      const startedAt = Date.now();
      await onAttempt?.({ taskType: "scene_candidate_text_only", model: "qwen-image-max-2025-12-30", attempt: 1, status: "failed", startedAt, completedAt: startedAt + 100,
        errorCode: "INVALID_PARAMETER", error: "provider rejected size", providerErrorCode: "InvalidParameter",
        httpStatus: 400, referenceCount: 0, size: "1664*928", mode: "text-to-image", promptExtend: false, watermark: false });
      return { success: false, provider: "dashscope", model: "qwen-image-max-2025-12-30", latencyMs: 100, size: "1664*928",
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
    expect(calls.find((item) => item.model === "qwen-image-max-2025-12-30" && item.mode === "text-to-image")).toMatchObject({
      taskType: "scene_candidate_text_only",
      status: "failed", errorCode: "INVALID_PARAMETER", providerErrorCode: "InvalidParameter",
      httpStatus: 400, failurePhase: "MODEL_REQUEST_FAILED", referenceImageCount: 0, referenceImagesIncluded: false
    });
    expect(logs.some((item) => item.kind === "task" && item.status === "failed")).toBe(true);
    const report = await buildModelCallExport(session.id, { projectId: created.id });
    expect(report.summary).toMatchObject({ failedCalls: 1, failedTasks: 1, affectedCandidates: ["场景候选 1"] });
    expect(modelCallExportMarkdown(report)).toContain("受影响候选：场景候选 1");
  });
});
