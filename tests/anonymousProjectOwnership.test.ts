vi.mock("server-only", () => ({}));

const sessionMock = vi.hoisted(() => ({ id: "session-a" }));

vi.mock("@/lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({
    initialized: true,
    session: { id: sessionMock.id, expiresAt: Date.now() + 60_000 }
  }))
}));

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listProjects, POST as createProject } from "../app/api/projects/route";
import {
  DELETE as deleteProject,
  GET as getProject,
  PATCH as patchProject
} from "../app/api/projects/[projectId]/route";
import { POST as generateStrategy } from "../app/api/generate-strategy/route";
import { POST as generateImages } from "../app/api/generate-images/route";
import { POST as uploadProductImage } from "../app/api/upload-product-image/route";
import { GET as getRender } from "../app/api/projects/[projectId]/render/route";
import {
  AnonymousProjectLimitError,
  AnonymousProjectVersionConflictError,
  createAnonymousProject,
  createColdBrewDemoForSession,
  getOwnedAnonymousProject,
  resetAnonymousProjectQueuesForTests,
  resolveProjectJsonPath,
  saveOwnedProjectBrief,
  updateOwnedAnonymousProject,
  updateOwnedShotDurations
} from "../lib/projects/anonymousProjectStore";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";

let storageRoot = "";
const originalEnv = { ...process.env };

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function context(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

async function createForCurrentSession() {
  const response = await createProject(jsonRequest("http://localhost/api/projects", "POST", {}));
  expect(response.status).toBe(201);
  const payload = await response.json() as { data: { projectId: string } };
  return payload.data.projectId;
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-project-store-"));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "anonymous-project-test-salt";
  process.env.AI_MODE = "mock";
  process.env.ENABLE_REAL_TEXT = "false";
  process.env.ENABLE_REAL_IMAGE = "false";
  sessionMock.id = "session-a";
  resetAnonymousProjectQueuesForTests();
});

afterEach(async () => {
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("anonymous project ownership and persistence", () => {
  it("isolates lists and project reads for two anonymous sessions", async () => {
    sessionMock.id = "session-a";
    const projectA = await createForCurrentSession();
    sessionMock.id = "session-b";
    const projectB = await createForCurrentSession();

    sessionMock.id = "session-a";
    const listA = await listProjects().then((response) => response.json()) as { data: { projects: Array<{ projectId: string }> } };
    expect(listA.data.projects.map((item) => item.projectId)).toEqual([projectA]);
    expect(await getProject(new Request("http://localhost"), context(projectB))).toHaveProperty("status", 404);

    sessionMock.id = "session-b";
    const listB = await listProjects().then((response) => response.json()) as { data: { projects: Array<{ projectId: string }> } };
    expect(listB.data.projects.map((item) => item.projectId)).toEqual([projectB]);
    expect(await getProject(new Request("http://localhost"), context(projectA))).toHaveProperty("status", 404);
  });

  it("returns the same 404 contract for missing and foreign projects", async () => {
    sessionMock.id = "session-b";
    const foreignId = await createForCurrentSession();
    sessionMock.id = "session-a";
    const missingId = crypto.randomUUID();

    const foreign = await getProject(new Request("http://localhost"), context(foreignId));
    const missing = await getProject(new Request("http://localhost"), context(missingId));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it("blocks foreign PATCH, DELETE, DeepSeek, Qwen, upload and render requests", async () => {
    sessionMock.id = "session-b";
    const projectB = await createForCurrentSession();
    sessionMock.id = "session-a";

    const patchResponse = await patchProject(
      jsonRequest("http://localhost", "PATCH", { patch: { status: "ready" } }),
      context(projectB)
    );
    expect(patchResponse.status).toBe(404);
    expect((await deleteProject(new Request("http://localhost", { method: "DELETE" }), context(projectB))).status).toBe(404);

    expect((await generateStrategy(jsonRequest("http://localhost", "POST", {
      projectId: projectB,
      brief: coldBrewDemo.brief
    }))).status).toBe(404);

    expect((await generateImages(jsonRequest("http://localhost", "POST", {
      projectId: projectB,
      shots: coldBrewDemo.shots,
      mode: "all-shots"
    }))).status).toBe(404);

    const form = new FormData();
    form.set("projectId", projectB);
    form.set("assetId", "asset-a");
    form.set("file", new File([new Uint8Array([1, 2, 3])], "product.png", { type: "image/png" }));
    expect((await uploadProductImage(new Request("http://localhost", { method: "POST", body: form }))).status).toBe(404);
    expect((await getRender(new Request("http://localhost"), context(projectB))).status).toBe(404);
  });

  it("merges concurrent product uploads and returns the latest project versions", async () => {
    const projectId = await createForCurrentSession();
    const created = await getOwnedAnonymousProject("session-a", projectId);
    await updateOwnedAnonymousProject("session-a", projectId, {
      brief: { ...created!.project.brief, productImages: [] }
    }, created!.version);
    const pngBytes = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");
    const upload = (assetId: string, role: "main-product" | "reference") => {
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("assetId", assetId);
      form.set("role", role);
      form.set("file", new File([pngBytes], `${assetId}.png`, { type: "image/png" }));
      return uploadProductImage(new Request("http://localhost", { method: "POST", body: form }));
    };

    const [mainResponse, referenceResponse] = await Promise.all([
      upload("product-main", "main-product"),
      upload("product-reference", "reference")
    ]);
    expect(mainResponse.status, await mainResponse.clone().text()).toBe(201);
    expect(referenceResponse.status, await referenceResponse.clone().text()).toBe(201);

    const mainPayload = await mainResponse.json() as { data: { assetId: string; version: number } };
    const referencePayload = await referenceResponse.json() as { data: { assetId: string; version: number } };
    expect(mainPayload.data.assetId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(referencePayload.data.assetId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(new Set([mainPayload.data.version, referencePayload.data.version]).size).toBe(2);

    const stored = await getOwnedAnonymousProject("session-a", projectId);
    expect(stored?.project.brief.productImages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "product-main", role: "main-product", assetId: mainPayload.data.assetId }),
      expect.objectContaining({ id: "product-reference", role: "reference", assetId: referencePayload.data.assetId })
    ]));
  });

  it("ignores forged ownership fields and never exposes the owner fingerprint", async () => {
    const forged = await createProject(jsonRequest("http://localhost", "POST", {
      sessionId: "session-b",
      ownerSessionId: "session-b"
    }));
    expect(forged.status).toBe(400);

    const projectId = await createForCurrentSession();
    const responseText = await getProject(new Request("http://localhost"), context(projectId)).then((response) => response.text());
    expect(responseText).not.toContain("ownerFingerprint");
    expect(responseText).not.toContain("session-a");
    expect(responseText).not.toContain(storageRoot);
  });

  it("enforces three projects per anonymous session", async () => {
    await createAnonymousProject("session-a");
    await createAnonymousProject("session-a");
    await createAnonymousProject("session-a");
    await expect(createAnonymousProject("session-a")).rejects.toBeInstanceOf(AnonymousProjectLimitError);
  });

  it("creates the supported 3-shot and 12-shot project boundaries", async () => {
    const three = await createAnonymousProject("session-a", { shotCount: 3 });
    const twelve = await createAnonymousProject("session-a", { shotCount: 12 });

    expect(three.project.shotCount).toBe(3);
    expect(three.project.shots).toHaveLength(3);
    expect(three.project.targetDurationSec).toBe(24);
    expect(three.project.shots.map((shot) => shot.durationSec)).toEqual([8, 8, 8]);
    expect(three.project.creativeBible).toBeDefined();
    expect(three.project.visualContinuityBible?.continuityGroups.length).toBeGreaterThan(0);
    expect(three.project.referencePack).toBeDefined();
    expect(three.project.shots.every((shot) => Boolean(shot.sceneStateBefore && shot.sceneStateAfter))).toBe(true);
    expect(twelve.project.shotCount).toBe(12);
    expect(twelve.project.shots).toHaveLength(12);
    expect(twelve.project.targetDurationSec).toBe(40);
    expect(twelve.project.brief.durationSec).toBe(40);
    expect(twelve.project.shots.reduce((sum, shot) => sum + shot.durationSec, 0)).toBe(40);
  });

  it("persists duration edits, updates total time and invalidates the old final video", async () => {
    const created = await createAnonymousProject("session-a");
    const withFinal = await updateOwnedAnonymousProject("session-a", created.id, {
      finalVideo: {
        status: "completed",
        url: "/api/projects/final",
        progress: 1,
        durationSec: 40,
        storageTransition: "PRIVATE_ASSET_V1"
      },
      finalVideoUrl: "/api/projects/final"
    }, created.version);

    const updated = await updateOwnedShotDurations("session-a", created.id, [
      { shotId: withFinal.project.shots[0]!.id, durationSec: 3 },
      { shotId: withFinal.project.shots[1]!.id, durationSec: 8 }
    ], withFinal.version);

    expect(updated.project.shots.slice(0, 2).map((shot) => shot.durationSec)).toEqual([3, 8]);
    expect(updated.project.durationSec).toBe(41);
    expect(updated.project.brief.durationSec).toBe(40);
    expect(updated.project.targetDurationSec).toBe(40);
    expect(updated.project.finalVideo?.status).toBe("outdated");
    expect(updated.project.finalVideoUrl).toBeNull();
    expect(updated.project.workflowSteps?.render).toBe("pending");
    expect(updated.project.generationEvents.at(-1)?.message).toContain("项目总时长更新为 41 秒");

    resetAnonymousProjectQueuesForTests();
    const restored = await getOwnedAnonymousProject("session-a", created.id);
    expect(restored?.project.shots.slice(0, 2).map((shot) => shot.durationSec)).toEqual([3, 8]);
    expect(restored?.project.durationSec).toBe(41);
  });

  it("saves a brief explicitly and restores its shot plan and revision", async () => {
    const created = await createAnonymousProject("session-a");
    expect(created.project.briefStatus).toBe("draft");
    expect(created.project.workflowSteps?.brief).toBe("pending");

    const saved = await saveOwnedProjectBrief("session-a", created.id, {
      brief: { ...created.project.brief, productName: "已保存的商品", durationSec: 43 },
      shotCount: 8,
      targetDurationSec: 43
    }, created.version);

    expect(saved.project.briefStatus).toBe("saved");
    expect(saved.project.briefRevision).toBe(1);
    expect(saved.project.briefSavedAt).toEqual(expect.any(Number));
    expect(saved.project.workflowSteps?.brief).toBe("completed");
    expect(saved.project.targetDurationSec).toBe(43);
    expect(saved.project.shots.map((shot) => shot.durationSec)).toEqual([5, 5, 5, 6, 6, 5, 5, 6]);

    resetAnonymousProjectQueuesForTests();
    const restored = await getOwnedAnonymousProject("session-a", created.id);
    expect(restored?.project.brief.productName).toBe("已保存的商品");
    expect(restored?.project.targetDurationSec).toBe(43);
    await expect(saveOwnedProjectBrief("session-b", created.id, {
      brief: created.project.brief,
      shotCount: 8,
      targetDurationSec: 40
    })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    await expect(saveOwnedProjectBrief("session-a", created.id, {
      brief: created.project.brief,
      shotCount: 8,
      targetDurationSec: 40
    }, created.version)).rejects.toBeInstanceOf(AnonymousProjectVersionConflictError);
  });

  it("preserves server-owned product asset links when a stale draft is saved", async () => {
    const created = await createAnonymousProject("session-a");
    const imageId = "product-image-1";
    const assetId = crypto.randomUUID();
    const withUploadedImage = await updateOwnedAnonymousProject("session-a", created.id, {
      brief: {
        ...created.project.brief,
        productImages: [{
          id: imageId,
          assetId,
          name: "product.png",
          type: "image/png",
          size: 1024,
          localUrl: `/api/projects/${created.id}/assets/${assetId}`,
          role: "main-product"
        }]
      }
    }, created.version);

    const saved = await saveOwnedProjectBrief("session-a", created.id, {
      brief: {
        ...withUploadedImage.project.brief,
        productImages: [{
          id: imageId,
          name: "product.png",
          type: "image/png",
          size: 1024,
          previewUrl: "blob:stale-preview",
          role: "main-product"
        }]
      },
      shotCount: withUploadedImage.project.shots.length,
      targetDurationSec: withUploadedImage.project.targetDurationSec ?? withUploadedImage.project.brief.durationSec
    }, withUploadedImage.version);

    expect(saved.project.brief.productImages?.[0]).toMatchObject({
      id: imageId,
      assetId,
      localUrl: `/api/projects/${created.id}/assets/${assetId}`
    });
    expect(saved.project.brief.productImages?.[0]?.previewUrl).toBeUndefined();
  });

  it("rejects invalid, foreign and stale duration updates", async () => {
    const created = await createAnonymousProject("session-a");
    const shotId = created.project.shots[0]!.id;

    await expect(updateOwnedShotDurations("session-a", created.id, [{ shotId, durationSec: 2 }], created.version))
      .rejects.toMatchObject({ code: "INVALID_SHOT_DURATION" });
    await expect(updateOwnedShotDurations("session-a", created.id, [{ shotId, durationSec: 9 }], created.version))
      .rejects.toMatchObject({ code: "INVALID_SHOT_DURATION" });
    await expect(updateOwnedShotDurations("session-b", created.id, [{ shotId, durationSec: 6 }], created.version))
      .rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });

    const updated = await updateOwnedShotDurations("session-a", created.id, [{ shotId, durationSec: 6 }], created.version);
    expect(updated.version).toBe(created.version + 1);
    await expect(updateOwnedShotDurations("session-a", created.id, [{ shotId, durationSec: 7 }], created.version))
      .rejects.toBeInstanceOf(AnonymousProjectVersionConflictError);
  });
  it("persists UTF-8 project JSON across store queue resets", async () => {
    const record = await createAnonymousProject("session-a", { name: "低糖冷萃测试" });
    await updateOwnedAnonymousProject("session-a", record.id, { status: "ready" });
    resetAnonymousProjectQueuesForTests();

    const restored = await getOwnedAnonymousProject("session-a", record.id);
    expect(restored?.project.brief.productName).toBe("低糖冷萃测试");
    expect(restored?.project.status).toBe("ready");
    const raw = await readFile(resolveProjectJsonPath("session-a", record.id), "utf8");
    expect(raw).toContain("低糖冷萃测试");
    expect(raw).toContain("visualContinuityBible");
    expect(raw).toContain("referencePack");
    expect(raw).not.toContain("session-a");
    expect(raw).not.toMatch(/(?:[A-Z]:\\|file:\/\/|blob:)/i);
  });

  it("does not expose an old project after the anonymous session changes", async () => {
    sessionMock.id = "session-a";
    const projectA = await createForCurrentSession();

    sessionMock.id = "replacement-session";
    const response = await getProject(new Request("http://localhost"), context(projectA));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "PROJECT_NOT_FOUND", message: "项目不存在或已失效。" }
    });
  });

  it("clones the demo into distinct projects for separate anonymous sessions", async () => {
    const demoA = await createColdBrewDemoForSession("session-a");
    const demoB = await createColdBrewDemoForSession("session-b");

    expect(demoA.id).not.toBe(demoB.id);
    expect(demoA.project.brief.productName).toBe(coldBrewDemo.brief.productName);
    expect(demoB.project.brief.productName).toBe(coldBrewDemo.brief.productName);
    expect(await getOwnedAnonymousProject("session-a", demoB.id)).toBeNull();
    expect(await getOwnedAnonymousProject("session-b", demoA.id)).toBeNull();
  });
  it("rejects stale versions and unsafe project IDs", async () => {
    const record = await createAnonymousProject("session-a");
    await updateOwnedAnonymousProject("session-a", record.id, { status: "ready" }, record.version);
    await expect(updateOwnedAnonymousProject("session-a", record.id, { status: "failed" }, record.version))
      .rejects.toBeInstanceOf(AnonymousProjectVersionConflictError);
    expect(await getOwnedAnonymousProject("session-a", "../other/project.json")).toBeNull();
  });
});
