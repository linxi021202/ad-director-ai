vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ id: "anchor-call-test-session" }));
vi.mock("../lib/session/api", () => ({ getAnonymousApiSession: vi.fn(async () => ({ initialized: true, session: { id: session.id } })) }));
vi.mock("../lib/providers/deepseekProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/providers/deepseekProvider")>(),
  generateCharacterAnchorBriefs: vi.fn(async () => ({ success: false, data: null, provider: "deepseek", model: "test", latencyMs: 1, fallbackUsed: false })),
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
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/projects/[projectId]/visual-anchors/route";
import { AnonymousProjectVersionConflictError, createAnonymousProject, mutateOwnedAnonymousProject, requireOwnedAnonymousProject, resetAnonymousProjectQueuesForTests } from "../lib/projects/anonymousProjectStore";
import { buildProjectContinuity } from "../lib/continuity/projectContinuity";
import { generateQwenImageAdaptive } from "../lib/image/qwenImageModelRouter";
import { generateCharacterAnchorBriefs } from "../lib/providers/deepseekProvider";
import { createPrivateAsset } from "../lib/assets/assetStore";
import * as projectStore from "../lib/projects/anonymousProjectStore";
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
  it("retries a project version conflict with the same three generated asset IDs", async () => {
    const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const continuity = buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots });
    const saved = await mutateOwnedAnonymousProject(session.id, created.id, (project) => {
      const workspace = ensureVisualAnchorWorkspace({ ...project, ...continuity });
      return { ...workspace, sceneVisualSpecs: workspace.sceneVisualSpecs?.map((spec) => ({ ...spec, heroProps: [], layout: undefined })) };
    });
    let calls = 0;
    const ids = Array.from({ length: 3 }, () => randomUUID());
    vi.mocked(generateQwenImageAdaptive).mockImplementation(async () => {
      calls += 1;
      if (calls === 3) vi.spyOn(projectStore, "mutateOwnedAnonymousProject")
        .mockRejectedValueOnce(new AnonymousProjectVersionConflictError());
      return { success: true, provider: "dashscope", model: "test-scene-model", latencyMs: 1,
        size: "2048*1152", assetId: ids[calls - 1] };
    });
    const response = await POST(new Request(`http://localhost/api/projects/${created.id}/visual-anchors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate-candidates", kind: "scene", targetId: saved.project.sceneVisualSpecs![0]!.id,
        count: 3, expectedVersion: saved.version })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(200);
    const final = await requireOwnedAnonymousProject(session.id, created.id);
    expect(final.project.visualAnchorWorkspace?.sceneCandidates.map((item) => item.assetId)).toEqual(ids);
    expect(final.project.generationEvents?.findLast((item) => item.action === "生成场景候选方案")?.status).toBe("completed");
    expect((await listModelCallLogs(session.id, { projectId: created.id, stage: "anchors", limit: 100 }))
      .some((entry) => entry.mode === "project-version-conflict" && entry.persistStatus === "conflict")).toBe(true);
    const diagnostic = await buildModelCallExport(session.id, { projectId: created.id, taskId: final.project.generationEvents!
      .findLast((item) => item.action === "生成场景候选方案")!.id });
    expect(diagnostic.summary).toMatchObject({ failedCalls: 0, failedSystemCalls: 1, failedTasks: 0 });
    expect(modelCallExportMarkdown(diagnostic)).toContain("保存前版本");
    expect(calls).toBe(3);
  });

  it("does not erase scene candidates when an older visual initialization finishes later", async () => {
    const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const continuity = buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots });
    const saved = await mutateOwnedAnonymousProject(session.id, created.id, (project) =>
      ensureVisualAnchorWorkspace({ ...project, ...continuity }));
    const targetId = saved.project.sceneVisualSpecs![0]!.id;
    const candidateId = randomUUID(), assetId = randomUUID();
    vi.mocked(generateCharacterAnchorBriefs).mockImplementationOnce(async () => {
      await mutateOwnedAnonymousProject(session.id, created.id, (latest) => ({ ...latest,
        visualAnchorWorkspace: { ...latest.visualAnchorWorkspace!, sceneCandidates: [{
          id: candidateId, kind: "scene", candidateIndex: 1, targetId, assetId, label: "场景方案 1",
          prompt: "已生成的场景候选", status: "ready", version: 1, createdAt: new Date().toISOString()
        }] } }));
      return { success: false, data: null, provider: "deepseek", model: "test", latencyMs: 1, fallbackUsed: false };
    });
    const response = await POST(new Request(`http://localhost/api/projects/${created.id}/visual-anchors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "initialize", expectedVersion: saved.version })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(200);
    const latest = await requireOwnedAnonymousProject(session.id, created.id);
    expect(latest.project.visualAnchorWorkspace?.sceneCandidates).toEqual([expect.objectContaining({ id: candidateId, assetId })]);
  });

  it("does not complete the task when all model calls succeed but the project patch fails", async () => {
    const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const continuity = buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots });
    const saved = await mutateOwnedAnonymousProject(session.id, created.id, (project) => {
      const workspace = ensureVisualAnchorWorkspace({ ...project, ...continuity });
      return { ...workspace, sceneVisualSpecs: workspace.sceneVisualSpecs?.map((spec) => ({ ...spec, heroProps: [], layout: undefined })) };
    });
    let calls = 0;
    vi.mocked(generateQwenImageAdaptive).mockImplementation(async () => {
      calls += 1;
      if (calls === 3) vi.spyOn(projectStore, "mutateOwnedAnonymousProject").mockRejectedValueOnce(new Error("DISK_FULL"));
      return { success: true, provider: "dashscope", model: "test-scene-model", latencyMs: 1,
        size: "2048*1152", assetId: `55555555-5555-4555-8555-55555555555${calls}` };
    });
    const response = await POST(new Request(`http://localhost/api/projects/${created.id}/visual-anchors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate-candidates", kind: "scene", targetId: saved.project.sceneVisualSpecs![0]!.id,
        count: 3, expectedVersion: saved.version })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(500);
    const final = await requireOwnedAnonymousProject(session.id, created.id);
    expect(final.project.generationEvents?.findLast((item) => item.action === "生成场景候选方案"))
      .toMatchObject({ status: "failed", errorCode: "PROJECT_PERSIST_FAILED" });
    expect(final.project.visualAnchorWorkspace?.sceneCandidates).toHaveLength(0);
    expect(calls).toBe(3);
  });

  it("keeps generated scene assets through a concurrent version change and recovers missing records without Qwen", async () => {
    const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const continuity = buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots });
    const saved = await mutateOwnedAnonymousProject(session.id, created.id, (project) => {
      const workspace = ensureVisualAnchorWorkspace({ ...project, ...continuity });
      return { ...workspace, sceneVisualSpecs: workspace.sceneVisualSpecs?.map((spec) => ({ ...spec, heroProps: [], layout: undefined })) };
    });
    const targetId = saved.project.sceneVisualSpecs![0]!.id;
    const assets = await Promise.all(Array.from({ length: 3 }, (_, index) => createPrivateAsset(session.id, created.id, {
      kind: "reference-image", source: "qwen-image", fileName: `scene-${index + 1}.png`, mimeType: "image/png",
      bytes: Uint8Array.from([137, 80, 78, 71, index + 1])
    })));
    let modelCalls = 0;
    vi.mocked(generateQwenImageAdaptive).mockImplementation(async () => {
      if (modelCalls++ === 0) {
        await mutateOwnedAnonymousProject(session.id, created.id, (project) => ({ ...project,
          strategy: { ...project.strategy!, title: "用户期间更新的策略名" } }));
      }
      return { success: true, provider: "dashscope", model: "test-scene-model", latencyMs: 1, size: "2048*1152", assetId: assets[modelCalls - 1]!.id };
    });
    const response = await POST(new Request(`http://localhost/api/projects/${created.id}/visual-anchors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate-candidates", kind: "scene", targetId, count: 3, expectedVersion: saved.version - 1 })
    }), { params: Promise.resolve({ projectId: created.id }) });
    expect(response.status).toBe(200);
    const after = await requireOwnedAnonymousProject(session.id, created.id);
    expect(after.project.strategy?.title).toBe("用户期间更新的策略名");
    expect(after.project.visualAnchorWorkspace?.sceneCandidates.filter((item) => item.targetId === targetId && item.status !== "outdated"))
      .toHaveLength(3);
    const event = after.project.generationEvents?.findLast((item) => item.action === "生成场景候选方案");
    expect(event?.status).toBe("completed");
    expect((await listModelCallLogs(session.id, { projectId: created.id, stage: "anchors", limit: 100 }))
      .some((entry) => entry.mode === "project-read-after-write-verified" && entry.projectVersionAtStart! < entry.projectVersionBeforePersist!)).toBe(true);

    await mutateOwnedAnonymousProject(session.id, created.id, (project) => ({ ...project,
      visualAnchorWorkspace: { ...project.visualAnchorWorkspace!, sceneCandidates: [] } }));
    const recoveryRequest = () => new Request(`http://localhost/api/projects/${created.id}/visual-anchors`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recover-candidates", kind: "scene", targetId, taskId: event!.id,
        expectedVersion: saved.version })
    });
    expect((await POST(recoveryRequest(), { params: Promise.resolve({ projectId: created.id }) })).status).toBe(200);
    expect((await POST(recoveryRequest(), { params: Promise.resolve({ projectId: created.id }) })).status).toBe(200);
    const recovered = await requireOwnedAnonymousProject(session.id, created.id);
    expect(recovered.project.visualAnchorWorkspace?.sceneCandidates.map((item) => item.assetId).sort())
      .toEqual(assets.map((item) => item.id).sort());
    expect(recovered.project.strategy?.title).toBe("用户期间更新的策略名");
    expect(modelCalls).toBe(3);
    const laterAsset = await createPrivateAsset(session.id, created.id, { kind: "reference-image", source: "qwen-image",
      fileName: "later-choice.png", mimeType: "image/png", bytes: Uint8Array.from([137, 80, 78, 71, 9]) });
    await mutateOwnedAnonymousProject(session.id, created.id, (project) => ({ ...project,
      visualAnchorWorkspace: { ...project.visualAnchorWorkspace!,
        sceneCandidates: [...project.visualAnchorWorkspace!.sceneCandidates.map((candidate) => candidate.candidateIndex === 1
          ? { ...candidate, status: "outdated" as const } : candidate),
        { ...project.visualAnchorWorkspace!.sceneCandidates.find((candidate) => candidate.candidateIndex === 1)!,
          id: randomUUID(), assetId: laterAsset.id, status: "ready" as const, version: 2, setVersion: 2 }]
      } }));
    expect((await POST(recoveryRequest(), { params: Promise.resolve({ projectId: created.id }) })).status).toBe(200);
    const latest = await requireOwnedAnonymousProject(session.id, created.id);
    const active = latest.project.visualAnchorWorkspace!.sceneCandidates.filter((item) => item.status !== "outdated");
    expect(active).toHaveLength(3);
    expect(active.find((item) => item.candidateIndex === 1)?.assetId).toBe(laterAsset.id);
    expect(modelCalls).toBe(3);
  });

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
