vi.mock("server-only", () => ({}));

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPrivateAsset, resetAssetStoreForTests } from "../lib/assets/assetStore";
import { resetRenderAssetTokensForTests, resolveRenderAssetGrant } from "../lib/assets/renderAccess";
import { createAnonymousProject, resetAnonymousProjectQueuesForTests } from "../lib/projects/anonymousProjectStore";
import { resolveWanReferenceImages } from "../lib/video/referenceImages";

const sessionId = "wan-reference-session";
const originalEnv = { ...process.env };
let storageRoot = "";

beforeEach(async () => {
  process.env = { ...originalEnv };
  storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-wan-refs-"));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "wan-reference-test-salt";
  resetAssetStoreForTests();
  resetRenderAssetTokensForTests();
  resetAnonymousProjectQueuesForTests();
});

afterEach(async () => {
  resetAssetStoreForTests();
  resetRenderAssetTokensForTests();
  resetAnonymousProjectQueuesForTests();
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe("Wan private reference transport", () => {
  it("returns externally fetchable signed URLs without embedding image bytes", async () => {
    const project = await createAnonymousProject(sessionId, { templateId: "cold-brew-demo" });
    const product = await createPrivateAsset(sessionId, project.id, {
      kind: "product-image",
      source: "user-upload",
      role: "main-product",
      fileName: "product.png",
      mimeType: "image/png",
      bytes: Buffer.from("product-image")
    });
    const keyframe = await createPrivateAsset(sessionId, project.id, {
      kind: "keyframe",
      source: "qwen-image",
      role: project.project.shots[0]!.id,
      fileName: "keyframe.png",
      mimeType: "image/png",
      bytes: Buffer.from("keyframe-image")
    });

    const references = await resolveWanReferenceImages({
      sessionId,
      projectId: project.id,
      heroImageAssetId: keyframe.id,
      productImages: [{
        id: "product-1",
        assetId: product.id,
        name: "product.png",
        type: "image/png",
        size: product.sizeBytes,
        role: "main-product"
      }],
      assetBaseUrl: "https://example.com"
    });

    expect(references).toHaveLength(2);
    expect(references[0]?.role).toBe("scene");
    expect(references.every((reference) => reference.url.startsWith("https://example.com/api/internal/render-assets/"))).toBe(true);
    expect(references.every((reference) => !reference.url.startsWith("data:"))).toBe(true);
    const signed = new URL(references[0]!.url);
    expect(resolveRenderAssetGrant(signed.searchParams.get("token")!, keyframe.id)?.projectId).toBe(project.id);
  });
});
