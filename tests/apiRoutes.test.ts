vi.mock("@/lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({
    initialized: true,
    session: { id: "test-session", expiresAt: Date.now() + 60_000 }
  }))
}));
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as generateAssetsPOST } from "../app/api/generate-assets/route";
import { POST as generateImagesPOST } from "../app/api/generate-images/route";
import { POST as generateStoryboardPOST } from "../app/api/generate-storyboard/route";
import { POST as generateStrategyPOST } from "../app/api/generate-strategy/route";
import { POST as renderVideoPOST } from "../app/api/render-video/route";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { deepseekProvider } from "../lib/providers/deepseekProvider";
import { createAnonymousProject, resetAnonymousProjectQueuesForTests } from "../lib/projects/anonymousProjectStore";

const originalEnv = { ...process.env };
let storageRoot = "";
let testProjectId = "";
let testProjectShots = coldBrewDemo.shots;
let testHeroShotId: string | null = null;
const VALID_PNG_BYTES = new Uint8Array(Buffer.concat([
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lX4xQwAAAABJRU5ErkJggg==",
    "base64"
  ),
  Buffer.alloc(1024)
]));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("second-stage API routes", () => {
  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.AI_MODE = "mock";
    process.env.ENABLE_REAL_TEXT = "false";
    process.env.ENABLE_REAL_IMAGE = "false";
    process.env.ENABLE_REAL_VIDEO = "false";
    storageRoot = await mkdtemp(path.join(tmpdir(), "ad-director-api-routes-"));
    process.env.STORAGE_ROOT = storageRoot;
    process.env.ANONYMOUS_SESSION_OWNERSHIP_SALT = "api-route-test-salt";
    resetAnonymousProjectQueuesForTests();
    const created = await createAnonymousProject("test-session");
    testProjectId = created.id;
    testProjectShots = created.project.shots;
    testHeroShotId = created.project.heroShotId ?? null;
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    resetAnonymousProjectQueuesForTests();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("generate-strategy validates ProductBrief and returns strategy plus trace", async () => {
    const response = await generateStrategyPOST(jsonRequest({ projectId: testProjectId, brief: coldBrewDemo.brief }));
    const body = await responseJson(response);

    expect(body).toMatchObject({ success: true, fallbackUsed: false, fallbackReason: null, error: null });
    expect(body.data).toHaveProperty("strategy");
    expect(body.trace).toMatchObject({ route: "generate-strategy", taskType: "strategy", provider: "mockTextProvider" });
  });

  it("generate-strategy rejects invalid ProductBrief", async () => {
    const response = await generateStrategyPOST(jsonRequest({ brief: { productName: "" } }));
    const body = await responseJson(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, data: null, fallbackUsed: false });
    expect(body.trace).toMatchObject({ route: "generate-strategy", stage: "validation" });
  });

  it("generate-storyboard validates brief and strategy then returns shots plus trace", async () => {
    const response = await generateStoryboardPOST(jsonRequest({ projectId: testProjectId, brief: coldBrewDemo.brief, strategy: coldBrewDemo.strategy }));
    const body = await responseJson(response);

    expect(body).toMatchObject({ success: true, fallbackUsed: false, fallbackReason: null, error: null });
    expect(body.data).toHaveProperty("shots");
    expect(body.trace).toMatchObject({ route: "generate-storyboard", taskType: "storyboard", provider: "mockTextProvider" });
  });

  it("generate-assets does not call a real image or video API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateAssetsPOST(
      jsonRequest({ projectId: testProjectId, brief: coldBrewDemo.brief, strategy: coldBrewDemo.strategy, shots: testProjectShots })
    );
    const body = await responseJson(response);

    expect(body.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).toContain("plannedAssets");
    expect(JSON.stringify(body)).toContain("qwen-image");
    expect(JSON.stringify(body)).toContain("wan2.7-r2v");
  });


  it("generate-images hero-only returns one planned keyframe without video calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateImagesPOST(
      jsonRequest({ projectId: testProjectId, shots: testProjectShots, mode: "hero-only" })
    );
    const body = await responseJson(response);
    const data = body.data as { images: Array<{ shotId: string; provider: string }>; failedShots: unknown[] };

    expect(body.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(data.images).toHaveLength(1);
    expect(data.images[0].shotId).toBe(testHeroShotId);
    expect(data.images[0].provider).toBe("mockImageProvider");
    expect(data.failedShots).toHaveLength(0);
  });

  it("generate-images all-shots respects MAX_IMAGES_PER_RUN", async () => {
    process.env.MAX_IMAGES_PER_RUN = "2";

    const response = await generateImagesPOST(
      jsonRequest({ projectId: testProjectId, shots: testProjectShots, mode: "all-shots" })
    );
    const body = await responseJson(response);
    const data = body.data as { images: unknown[]; requestedShots: number; generatedShots: number };

    expect(body.success).toBe(true);
    expect(data.requestedShots).toBe(8);
    expect(data.generatedShots).toBe(2);
    expect(data.images).toHaveLength(2);
  });

  it("generate-images uses the actual 12-shot project count", async () => {
    process.env.MAX_IMAGES_PER_RUN = "12";
    const twelveShotProject = await createAnonymousProject("test-session", { shotCount: 12 });

    const response = await generateImagesPOST(
      jsonRequest({
        projectId: twelveShotProject.id,
        shots: twelveShotProject.project.shots,
        mode: "all-shots"
      })
    );
    const body = await responseJson(response);
    const data = body.data as { images: unknown[]; requestedShots: number; generatedShots: number };

    expect(body.success).toBe(true);
    expect(data.requestedShots).toBe(12);
    expect(data.generatedShots).toBe(12);
    expect(data.images).toHaveLength(12);
  });
  it("generate-images rejects invalid input", async () => {
    const response = await generateImagesPOST(jsonRequest({ projectId: "", shots: [], mode: "all-shots" }));
    const body = await responseJson(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, data: null, fallbackUsed: false });
    expect(body.trace).toMatchObject({ route: "generate-images", stage: "validation" });
  });


  it("generate-images all-shots uses the current project shot count", async () => {
    process.env.MAX_IMAGES_PER_RUN = "10";

    const response = await generateImagesPOST(
      jsonRequest({ projectId: testProjectId, shots: testProjectShots, mode: "all-shots" })
    );
    const body = await responseJson(response);
    const data = body.data as { images: unknown[]; generatedShots: number };

    expect(body.success).toBe(true);
    expect(data.generatedShots).toBe(8);
    expect(data.images).toHaveLength(8);
  });

  it("generate-images supports partial success when one shot falls back", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-secret-test-key";
    process.env.MAX_IMAGES_PER_RUN = "2";

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount += 1;

        if (callCount === 1) {
          return new Response(
            JSON.stringify({ request_id: "req-shot-1", output: { results: [{ url: "https://example.com/shot-1.png" }] } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (callCount === 2) {
          return new Response(VALID_PNG_BYTES, {
            status: 200,
            headers: { "Content-Type": "image/png" }
          });
        }

        return new Response(JSON.stringify({ code: "ImageFailed", message: "provider failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      })
    );

    const response = await generateImagesPOST(
      jsonRequest({ projectId: testProjectId, shots: testProjectShots.slice(0, 2), mode: "all-shots" })
    );
    const body = await responseJson(response);
    const data = body.data as { images: Array<{ fallbackUsed: boolean; localUrl?: string }>; failedShots: unknown[] };

    expect(body.success).toBe(true);
    expect(data.images).toHaveLength(2);
    expect(data.images[0].fallbackUsed).toBe(false);
    expect(data.images[0].localUrl).toContain(
      `/api/projects/${testProjectId}/assets/`
    );
    expect(data.images[1].fallbackUsed).toBe(true);
    expect(data.failedShots).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("sk-dashscope-secret-test-key");
  });


  it("generate-images does not force DashScope async mode by default", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-secret-test-key";

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      callCount += 1;
      if (callCount === 1) {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-DashScope-Async")).toBeNull();
        return new Response(
          JSON.stringify({ request_id: "req-sync", output: { results: [{ image_url: "https://example.com/sync-shot.png" }] } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(VALID_PNG_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateImagesPOST(
      jsonRequest({ projectId: testProjectId, shots: testProjectShots.slice(0, 1), mode: "all-shots" })
    );
    const body = await responseJson(response);
    const data = body.data as { images: Array<{ fallbackUsed: boolean }> };

    expect(body.success).toBe(true);
    expect(data.images[0].fallbackUsed).toBe(false);
  });
  it("generate-images polls DashScope task result when initial response only returns task_id", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-secret-test-key";

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount += 1;

        if (callCount === 1) {
          return new Response(
            JSON.stringify({ request_id: "req-create", output: { task_id: "task-123", task_status: "PENDING" } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (callCount === 2) {
          return new Response(
            JSON.stringify({ request_id: "req-task", output: { task_status: "SUCCEEDED", results: [{ image_url: "https://example.com/task-shot.png" }] } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(VALID_PNG_BYTES, {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      })
    );

    const response = await generateImagesPOST(
      jsonRequest({ projectId: testProjectId, shots: testProjectShots.slice(0, 1), mode: "all-shots" })
    );
    const body = await responseJson(response);
    const data = body.data as { images: Array<{ fallbackUsed: boolean; requestId?: string; localUrl?: string }> };

    expect(body.success).toBe(true);
    expect(data.images).toHaveLength(1);
    expect(data.images[0].fallbackUsed).toBe(false);
    expect(data.images[0].requestId).toBe("req-task");
    expect(data.images[0].localUrl).toContain(
      `/api/projects/${testProjectId}/assets/`
    );
    expect(callCount).toBe(3);
  });
  it("generate-images response does not leak DashScope API key", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-secret-test-key";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "InvalidApiKey", message: "Bearer sk-dashscope-secret-test-key failed" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const response = await generateImagesPOST(
      jsonRequest({ projectId: testProjectId, shots: testProjectShots.slice(0, 1), mode: "all-shots" })
    );
    const text = await response.text();

    expect(text).not.toContain("sk-dashscope-secret-test-key");
    expect(text).toContain("[redacted]");
    expect(text).toContain("fallbackUsed");
  });
  it("render-video no longer returns mock or planned final video URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await renderVideoPOST(jsonRequest({ projectId: testProjectId, shots: testProjectShots }));
    const body = await responseJson(response);

    expect(response.status).toBe(410);
    expect(body.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("/mock/");
    expect(JSON.stringify(body)).toContain("/api/projects/");
  });

  it("generate-strategy can call DeepSeek through providerRouter in real text mode", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_TEXT = "true";
    process.env.DEEPSEEK_API_KEY = "sk-super-secret-test-key";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";

    vi.spyOn(deepseekProvider, "generateStrategy").mockResolvedValue({
      success: true,
      data: coldBrewDemo.strategy,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      latencyMs: 10,
      tokenUsage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 },
      costEstimate: "estimated CNY 0.0010",
      fallbackUsed: false,
      error: null
    });

    const response = await generateStrategyPOST(jsonRequest({ projectId: testProjectId, brief: coldBrewDemo.brief }));
    const body = await responseJson(response);

    expect(body.success).toBe(true);
    expect(body.trace).toMatchObject({ provider: "deepseek", model: "deepseek-v4-flash", latencyMs: 10 });
    expect(JSON.stringify(body)).not.toContain("sk-super-secret-test-key");
  });

  it("API responses do not leak API key values in fallback errors", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_TEXT = "true";
    process.env.DEEPSEEK_API_KEY = "sk-super-secret-test-key";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";

    vi.spyOn(deepseekProvider, "generateStrategy").mockResolvedValue({
      success: false,
      data: null,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      latencyMs: 10,
      fallbackUsed: false,
      error: "simulated provider failure with Bearer sk-super-secret-test-key and DEEPSEEK_API_KEY=sk-super-secret-test-key"
    });

    const response = await generateStrategyPOST(jsonRequest({ projectId: testProjectId, brief: coldBrewDemo.brief }));
    const text = await response.text();

    expect(text).not.toContain("sk-super-secret-test-key");
    expect(text).not.toContain("DEEPSEEK_API_KEY=sk-super-secret-test-key");
    expect(text).toContain("fallbackUsed");
    expect(text).toContain("[redacted]");
  });
});






