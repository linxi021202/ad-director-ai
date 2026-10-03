vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ id: "temporary-workspace-owner" }));
vi.mock("@/lib/session/api", () => ({ getAnonymousApiSession: vi.fn(async () => ({
  initialized: true, session: { id: session.id, expiresAt: Date.now() + 60000 }
})) }));

import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnonymousProject, listAnonymousProjects } from "../lib/projects/anonymousProjectStore";
import { completeGenerationEvent, startGenerationEvent } from "../lib/projects/generationEvents";
import { createPrivateAsset } from "../lib/assets/assetStore";
import { getSessionStorageNamespace, resolveInsideStorage } from "../lib/assets/path";
import { resetWorkspaceForVisit, listArchivedVideos } from "../lib/projects/temporaryWorkspace";
import { listSessionVideoLibrary } from "../lib/video/videoLibrary";
import { GET as getVideo } from "../app/api/video-library/[projectId]/[assetId]/route";
import { POST as visit } from "../app/api/workspace/visit/route";

const originalEnv = { ...process.env };
let root = "";
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "workspace-reset-"));
  process.env.STORAGE_ROOT = root;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "workspace-reset-test";
  session.id = "temporary-workspace-owner";
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); process.env = { ...originalEnv }; });

describe("temporary workspace lifecycle", () => {
  it("deletes project data and logs but leaves built-in templates and unrelated files alone", async () => {
    await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    const directory = resolveInsideStorage("sessions", getSessionStorageNamespace(session.id));
    await writeFile(path.join(directory, "model-calls.json"), "[]");
    await writeFile(path.join(directory, "workspace.json"), "{}");
    await writeFile(path.join(directory, "settings.json"), "keep");
    expect((await resetWorkspaceForVisit(session.id, randomUUID())).deletedProjects).toBe(1);
    expect(await listAnonymousProjects(session.id)).toEqual([]);
    expect(await readdir(directory)).not.toContain("model-calls.json");
    expect(await readFile(path.join(directory, "settings.json"), "utf8")).toBe("keep");
    const demo = await createAnonymousProject(session.id, { templateId: "cold-brew-demo" });
    expect(demo.project.shots.length).toBeGreaterThan(0);
  });

  it("does not clear progress on refresh or repeated initialization of the same visit", async () => {
    const id = randomUUID();
    await resetWorkspaceForVisit(session.id, id);
    const project = await createAnonymousProject(session.id);
    expect((await resetWorkspaceForVisit(session.id, id)).reset).toBe(false);
    expect((await listAnonymousProjects(session.id))[0]?.id).toBe(project.id);
    expect((await resetWorkspaceForVisit(session.id, randomUUID())).deletedProjects).toBe(1);
  });

  it("serializes duplicate initialization and does not clear another session", async () => {
    await createAnonymousProject("other-session");
    const id = randomUUID();
    const result = await Promise.all([resetWorkspaceForVisit(session.id, id), resetWorkspaceForVisit(session.id, id)]);
    expect(result.map((value) => value.reset)).toEqual([true, false]);
    expect(await listAnonymousProjects("other-session")).toHaveLength(1);
  });

  it("archives uploaded videos, deletes generated video and pictures, and still serves the upload privately", async () => {
    const project = await createAnonymousProject(session.id);
    const upload = await createPrivateAsset(session.id, project.id, {
      kind: "hero-video", source: "happyhorse-manual-import", fileName: "upload.mp4",
      mimeType: "video/mp4", bytes: new Uint8Array([1, 2, 3]), durationSec: 5
    });
    await createPrivateAsset(session.id, project.id, {
      kind: "final-video", source: "remotion", fileName: "generated.mp4",
      mimeType: "video/mp4", bytes: new Uint8Array([4, 5, 6]), durationSec: 5
    });
    await createPrivateAsset(session.id, project.id, {
      kind: "product-image", source: "user-upload", fileName: "product.png",
      mimeType: "image/png", bytes: new Uint8Array([7, 8, 9])
    });
    const result = await resetWorkspaceForVisit(session.id, randomUUID());
    expect(result.preservedVideos).toBe(1);
    expect(await listAnonymousProjects(session.id)).toEqual([]);
    expect((await listSessionVideoLibrary(session.id)).map((item) => item.id)).toEqual([upload.id]);
    const context = { params: Promise.resolve({ projectId: project.id, assetId: upload.id }) };
    const owned = await getVideo(new Request("http://localhost/video"), context);
    expect(owned.status).toBe(200);
    expect(new Uint8Array(await owned.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    await resetWorkspaceForVisit(session.id, randomUUID());
    expect(await listArchivedVideos(session.id)).toHaveLength(1);
    session.id = "foreign-session";
    expect((await getVideo(new Request("http://localhost/video"), context)).status).toBe(404);
  });

  it("rejects malformed asset paths before deleting an uploaded video", async () => {
    const project = await createAnonymousProject(session.id);
    const directory = resolveInsideStorage("sessions", getSessionStorageNamespace(session.id), "projects", project.id);
    const upload = await createPrivateAsset(session.id, project.id, {
      kind: "hero-video", source: "user-upload", fileName: "upload.mp4", mimeType: "video/mp4", bytes: new Uint8Array([1])
    });
    await writeFile(path.join(directory, "assets.json"), JSON.stringify({ version: 1,
      assets: [{ ...upload, storageRelativePath: "../outside.mp4" }] }));
    await expect(resetWorkspaceForVisit(session.id, randomUUID())).rejects.toThrow("UNSAFE_WORKSPACE_PATH");
    expect(await listAnonymousProjects(session.id)).toHaveLength(1);
  });

  it("clears expired project directories too", async () => {
    const directory = resolveInsideStorage("sessions", getSessionStorageNamespace(session.id), "projects", randomUUID());
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "old.txt"), "expired data");
    expect((await resetWorkspaceForVisit(session.id, randomUUID())).deletedProjects).toBe(1);
  });

  it("allows entry without deleting an outstanding generation request, then clears on the next visit", async () => {
    const project = await createAnonymousProject(session.id);
    const event = await startGenerationEvent(session.id, project.id, {
      stage: "anchors", action: "生成候选", provider: "qwen-image", message: "正在生成候选"
    });
    const visitId = randomUUID();
    expect(await resetWorkspaceForVisit(session.id, visitId)).toMatchObject({ reset: false, deferred: true });
    expect(await resetWorkspaceForVisit(session.id, visitId)).toMatchObject({ reset: false, deletedProjects: 0 });
    expect(await listAnonymousProjects(session.id)).toHaveLength(1);
    await completeGenerationEvent(session.id, project.id, event.id, "生成完成");
    expect(await resetWorkspaceForVisit(session.id, visitId)).toMatchObject({ reset: false, deletedProjects: 0 });
    expect(await resetWorkspaceForVisit(session.id, randomUUID())).toMatchObject({ reset: true, deletedProjects: 1 });
    expect(await listAnonymousProjects(session.id)).toHaveLength(0);
  });

  it("returns a usable visit response while a generation request is active", async () => {
    const project = await createAnonymousProject(session.id);
    await startGenerationEvent(session.id, project.id, {
      stage: "keyframes", action: "制作单镜关键帧", provider: "system", message: "正在生成关键帧"
    });
    const response = await visit(new NextRequest("http://localhost:3000/api/workspace/visit", {
      method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify({ visitId: randomUUID() })
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ reset: false, deferred: true });
    expect(await listAnonymousProjects(session.id)).toHaveLength(1);
  });

  it("rejects cross-origin requests before cleanup", async () => {
    const response = await visit(new NextRequest("https://app.example/api/workspace/visit", {
      method: "POST", headers: { origin: "https://foreign.example" }, body: JSON.stringify({ visitId: randomUUID() })
    }));
    expect(response.status).toBe(403);
  });

  it("supports same-origin requests behind Railway proxy headers", async () => {
    const response = await visit(new NextRequest("http://localhost:3000/api/workspace/visit", {
      method: "POST", headers: { origin: "https://app.example", "x-forwarded-host": "app.example", "x-forwarded-proto": "https" },
      body: JSON.stringify({ visitId: randomUUID() })
    }));
    expect(response.status).toBe(200);
  });
});
