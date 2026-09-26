vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ id: "anchor-live-scene-one" }));
vi.mock("../lib/session/api", () => ({ getAnonymousApiSession: vi.fn(async () => ({ initialized: true, session: { id: session.id } })) }));
vi.mock("../lib/providers/deepseekProvider", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/providers/deepseekProvider")>(),
  generateSceneCandidateDirections: vi.fn(async () => ({ success: false, data: null }))
}));

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/projects/[projectId]/visual-anchors/route";
import { assertPrivateAssetReadable, requirePrivateAsset } from "../lib/assets/assetStore";
import { buildProjectContinuity } from "../lib/continuity/projectContinuity";
import { listModelCallLogs } from "../lib/logs/modelCallStore";
import { createAnonymousProject, mutateOwnedAnonymousProject, requireOwnedAnonymousProject } from "../lib/projects/anonymousProjectStore";
import { ensureVisualAnchorWorkspace } from "../lib/visual/visualAnchors";

describe.skipIf(process.env.RUN_LIVE_ANCHOR_TEST !== "1")("live scene candidate", () => {
  it("submits only scene candidate 1 and verifies its private asset", async () => {
    dotenv.config({ path: ".env.local", quiet: true });
    expect(process.env.DASHSCOPE_API_KEY, "Local DashScope key is required for this opt-in test").toBeTruthy();
    const root = await mkdtemp(path.join(tmpdir(), "ad-anchor-live-"));
    const previous = { ...process.env };
    process.env.STORAGE_ROOT = root;
    process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "anchor-live-test-salt";
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.ALLOW_PLATFORM_KEYS = "true";
    try {
      const created = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
      const continuity = buildProjectContinuity({ brief: created.project.brief, strategy: created.project.strategy!, shots: created.project.shots });
      const saved = await mutateOwnedAnonymousProject(session.id, created.id, (project) =>
        ensureVisualAnchorWorkspace({ ...project, ...continuity }));
      const targetId = saved.project.sceneVisualSpecs![0]!.id;
      const startedAt = Date.now();
      const response = await POST(new Request(`http://localhost/api/projects/${created.id}/visual-anchors`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate-candidates", kind: "scene", targetId, count: 1, candidateIndex: 1, expectedVersion: saved.version })
      }), { params: Promise.resolve({ projectId: created.id }) });
      const project = (await requireOwnedAnonymousProject(session.id, created.id)).project;
      const calls = (await listModelCallLogs(session.id, { projectId: created.id, stage: "anchors", limit: 100 }))
        .filter((item) => item.kind === "call" && item.candidateIndex === 1);
      const candidate = project.visualAnchorWorkspace?.sceneCandidates.find((item) => item.targetId === targetId && item.candidateIndex === 1 && item.status !== "outdated");
      const asset = candidate ? await requirePrivateAsset(session.id, created.id, candidate.assetId) : null;
      const file = asset ? await assertPrivateAssetReadable(asset) : null;
      console.log(JSON.stringify({ httpStatus: response.status, elapsedMs: Date.now() - startedAt,
        models: calls.filter((item) => item.mode !== "anchor-candidate").map((item) => ({ model: item.model, status: item.status,
          errorCode: item.errorCode, providerCode: item.providerErrorCode, httpStatus: item.httpStatus,
          failurePhase: item.failurePhase, durationMs: item.durationMs })),
        candidateCreated: Boolean(candidate), assetPersisted: Boolean(file), assetMimeType: asset?.mimeType ?? null }));
      expect(response.status).toBe(200);
      expect(candidate).toBeTruthy();
      expect(file).toBeTruthy();
    } finally {
      process.env = previous;
      await rm(root, { recursive: true, force: true });
    }
  }, 600_000);
});
