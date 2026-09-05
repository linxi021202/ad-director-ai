vi.mock("server-only", () => ({}));

const sessionMock = vi.hoisted(() => ({ id: "video-library-session-a" }));
vi.mock("@/lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({
    initialized: true,
    session: { id: sessionMock.id, expiresAt: Date.now() + 60_000 }
  }))
}));

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getLibraryVideo } from "../app/api/video-library/[projectId]/[assetId]/route";
import { createPrivateAsset, markPrivateAssetsLifecycle, resetAssetStoreForTests } from "../lib/assets/assetStore";
import { createAnonymousProject, resetAnonymousProjectQueuesForTests } from "../lib/projects/anonymousProjectStore";
import { listSessionVideoLibrary } from "../lib/video/videoLibrary";

const originalEnv = { ...process.env };
let storageRoot = "";

beforeEach(async () => {
  process.env = { ...originalEnv };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-video-library-"));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "video-library-test-salt";
  sessionMock.id = "video-library-session-a";
  resetAnonymousProjectQueuesForTests();
  resetAssetStoreForTests();
});

afterEach(async () => {
  resetAssetStoreForTests();
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("session video library", () => {
  it("lists generated and uploaded videos from every owned project, including history", async () => {
    const first = await createAnonymousProject(sessionMock.id, { templateId: "cold-brew-demo" });
    const second = await createAnonymousProject(sessionMock.id);
    const uploaded = await createPrivateAsset(sessionMock.id, first.id, {
      kind: "hero-video",
      source: "happyhorse-manual-import",
      fileName: "uploaded.mp4",
      mimeType: "video/mp4",
      bytes: new Uint8Array([0, 1, 2, 3]),
      width: 1080,
      height: 1920,
      durationSec: 24
    });
    await markPrivateAssetsLifecycle(sessionMock.id, first.id, [uploaded.id], "orphaned");
    await createPrivateAsset(sessionMock.id, second.id, {
      kind: "final-video",
      source: "remotion",
      fileName: "final.mp4",
      mimeType: "video/mp4",
      bytes: new Uint8Array([4, 5, 6, 7]),
      durationSec: 40
    });

    const videos = await listSessionVideoLibrary(sessionMock.id);
    expect(videos).toHaveLength(2);
    expect(videos.map((video) => video.source)).toEqual(expect.arrayContaining(["happyhorse-manual-import", "remotion"]));
    expect(JSON.stringify(videos)).not.toContain(storageRoot);
    expect(videos[0]?.url).toContain("/api/video-library/");
  });

  it("serves historical video only to the owning anonymous session", async () => {
    const project = await createAnonymousProject(sessionMock.id);
    const asset = await createPrivateAsset(sessionMock.id, project.id, {
      kind: "hero-video",
      source: "happyhorse-api",
      fileName: "generated.mp4",
      mimeType: "video/mp4",
      bytes: new Uint8Array([7, 8, 9, 10]),
      durationSec: 5
    });
    const context = { params: Promise.resolve({ projectId: project.id, assetId: asset.id }) };

    const owned = await getLibraryVideo(new Request("http://localhost/video"), context);
    expect(owned.status).toBe(200);

    sessionMock.id = "video-library-session-b";
    const foreign = await getLibraryVideo(new Request("http://localhost/video"), context);
    expect(foreign.status).toBe(404);
  });
});
