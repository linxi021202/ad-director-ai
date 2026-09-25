vi.mock("server-only", () => ({}));
vi.mock("../lib/secrets/resolver", () => ({ resolveProviderApiKey: vi.fn(async () => "sk-image-test-key") }));
vi.mock("../lib/assets/assetStore", () => ({
  createPrivateAsset: vi.fn(),
  getProjectAssetUrl: vi.fn(() => "/api/projects/project-test/assets/asset-test")
}));
vi.mock("../lib/assets/media", () => ({
  validateGeneratedImage: vi.fn(() => ({ extension: "png", mimeType: "image/png", width: 32, height: 32 }))
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrivateAsset } from "../lib/assets/assetStore";
import { callQwenImage } from "../lib/image/qwenImageClient";

const input = { prompt: "单帧广告", model: "qwen-image-2.0", projectId: "project-test", shotId: "shot-test", sessionId: "session-test" };

beforeEach(() => { vi.stubEnv("AI_MODE", "real"); vi.stubEnv("ENABLE_REAL_IMAGE", "true"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.mocked(createPrivateAsset).mockReset(); });

describe("Qwen private asset failures", () => {
  it("classifies a failed image download separately from model generation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("example.com")
      ? new Response("unavailable", { status: 503 })
      : new Response(JSON.stringify({ output: { results: [{ image_url: "https://example.com/generated.png" }] } }))));
    const result = await callQwenImage(input);
    expect(result).toMatchObject({ success: false, errorCode: "ASSET_DOWNLOAD_FAILED", cacheStatus: "remote-only" });
    expect(result.assetId).toBeUndefined();
    expect(createPrivateAsset).not.toHaveBeenCalled();
  });

  it("classifies a private asset write failure separately from download", async () => {
    vi.mocked(createPrivateAsset).mockRejectedValue(new Error("storage unavailable"));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("example.com")
      ? new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "Content-Type": "image/png" } })
      : new Response(JSON.stringify({ output: { results: [{ image_url: "https://example.com/generated.png" }] } }))));
    const result = await callQwenImage(input);
    expect(result).toMatchObject({ success: false, errorCode: "ASSET_PERSIST_FAILED", cacheStatus: "remote-only" });
    expect(result.assetId).toBeUndefined();
    expect(createPrivateAsset).toHaveBeenCalledTimes(1);
  });
});
