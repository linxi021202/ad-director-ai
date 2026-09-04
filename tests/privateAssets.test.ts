vi.mock("server-only", () => ({}));

const sessionMock = vi.hoisted(() => ({ id: "private-assets-session-a" }));
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

import {
  GET as getAsset,
  HEAD as headAsset
} from "../app/api/projects/[projectId]/assets/[assetId]/route";
import {
  createPrivateAsset,
  markPrivateAssetsLifecycle,
  resetAssetStoreForTests,
  toPublicProjectAsset
} from "../lib/assets/assetStore";
import {
  issueRenderAssetToken,
  resetRenderAssetTokensForTests,
  resolveRenderAssetGrant,
  revokeRenderAssetToken
} from "../lib/assets/renderAccess";
import { resolveAssetManifestPath } from "../lib/assets/path";
import {
  createAnonymousProject,
  resetAnonymousProjectQueuesForTests,
  updateOwnedAnonymousProject
} from "../lib/projects/anonymousProjectStore";

let storageRoot = "";
let projectId = "";
let assetId = "";
let unreferencedAssetId = "";
const originalEnv = { ...process.env };

function context(id = assetId, project = projectId) {
  return { params: Promise.resolve({ projectId: project, assetId: id }) };
}

beforeEach(async () => {
  process.env = { ...originalEnv };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-private-assets-"));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "private-assets-test-salt";
  sessionMock.id = "private-assets-session-a";
  resetAnonymousProjectQueuesForTests();
  resetAssetStoreForTests();
  resetRenderAssetTokensForTests();

  const record = await createAnonymousProject(sessionMock.id, { templateId: "cold-brew-demo" });
  projectId = record.id;
  const asset = await createPrivateAsset(sessionMock.id, projectId, {
    kind: "product-image",
    source: "user-upload",
    role: "main-product",
    fileName: "product.png",
    mimeType: "image/png",
    bytes: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    width: 1200,
    height: 1600
  });
  assetId = asset.id;
  unreferencedAssetId = (await createPrivateAsset(sessionMock.id, projectId, {
    kind: "reference-image",
    source: "user-upload",
    role: "unused",
    fileName: "unused.png",
    mimeType: "image/png",
    bytes: new Uint8Array([9, 8, 7, 6])
  })).id;
  await updateOwnedAnonymousProject(sessionMock.id, projectId, {
    brief: {
      ...record.project.brief,
      productImages: [{
        id: "product-main",
        assetId,
        name: "product.png",
        type: "image/png",
        size: 10,
        role: "main-product",
        url: `/api/projects/${projectId}/assets/${assetId}`
      }]
    }
  });
});

afterEach(async () => {
  resetRenderAssetTokensForTests();
  resetAssetStoreForTests();
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("private media asset authorization", () => {
  it("serves an owned referenced asset and supports HEAD and byte ranges", async () => {
    const full = await getAsset(
      new Request(`http://localhost/api/projects/${projectId}/assets/${assetId}`),
      context()
    );
    expect(full.status).toBe(200);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    );
    expect(full.headers.get("cache-control")).toContain("private");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");

    const head = await headAsset(
      new Request(`http://localhost/api/projects/${projectId}/assets/${assetId}`, {
        method: "HEAD"
      }),
      context()
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("10");

    const partial = await getAsset(
      new Request(`http://localhost/api/projects/${projectId}/assets/${assetId}`, {
        headers: { Range: "bytes=2-5" }
      }),
      context()
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));
  });

  it("returns 416 for an invalid range", async () => {
    const response = await getAsset(
      new Request(`http://localhost/api/projects/${projectId}/assets/${assetId}`, {
        headers: { Range: "bytes=99-100" }
      }),
      context()
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });

  it("returns the same 404 for foreign, missing and unreferenced assets", async () => {
    const missingId = crypto.randomUUID();
    const unreferenced = await getAsset(
      new Request("http://localhost/private"),
      context(unreferencedAssetId)
    );
    const missing = await getAsset(
      new Request("http://localhost/private"),
      context(missingId)
    );

    sessionMock.id = "private-assets-session-b";
    const foreign = await getAsset(
      new Request("http://localhost/private"),
      context(assetId)
    );
    expect([unreferenced.status, missing.status, foreign.status]).toEqual([404, 404, 404]);
    expect(await unreferenced.json()).toEqual(await missing.json());
    expect(await foreign.json()).toEqual({ success: false, data: null, error: "ASSET_NOT_FOUND" });
  });

  it("never exposes storage paths, checksums or session identifiers to the client", async () => {
    sessionMock.id = "private-assets-session-a";
    const manifest = JSON.parse(await readFile(
      resolveAssetManifestPath(sessionMock.id, projectId),
      "utf8"
    )) as { assets: Array<Record<string, unknown>> };
    const internal = manifest.assets.find((asset) => asset.id === assetId)!;
    const safe = toPublicProjectAsset(internal as never);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain("storageRelativePath");
    expect(serialized).not.toContain("checksumSha256");
    expect(serialized).not.toContain(sessionMock.id);
    expect(serialized).not.toContain(storageRoot);
    expect(safe.url).toBe(`/api/projects/${projectId}/assets/${assetId}`);
  });

  it("issues a short-lived render grant only for explicitly allowed assets", async () => {
    const token = await issueRenderAssetToken({
      sessionId: sessionMock.id,
      projectId,
      renderId: crypto.randomUUID(),
      assetIds: [assetId],
      ttlMs: 60_000
    });
    expect(resolveRenderAssetGrant(token, assetId)).not.toBeNull();
    expect(resolveRenderAssetGrant(token, unreferencedAssetId)).toBeNull();
    revokeRenderAssetToken(token);
    expect(resolveRenderAssetGrant(token, assetId)).toBeNull();
  });
  it("marks invalidated assets as orphaned without deleting their files", async () => {
    await markPrivateAssetsLifecycle(sessionMock.id, projectId, [assetId], "orphaned");
    const manifest = JSON.parse(await readFile(
      resolveAssetManifestPath(sessionMock.id, projectId),
      "utf8"
    )) as { assets: Array<{ id: string; lifecycle?: string }> };
    expect(manifest.assets.find((asset) => asset.id === assetId)?.lifecycle).toBe("orphaned");

    const response = await getAsset(
      new Request(`http://localhost/api/projects/${projectId}/assets/${assetId}`),
      context()
    );
    expect(response.status).toBe(200);
  });
});