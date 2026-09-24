vi.mock("@/lib/session/api", () => ({
  getAnonymousApiSession: vi.fn(async () => ({
    initialized: true,
    session: { id: "test-session", expiresAt: Date.now() + 60_000 }
  }))
}));
vi.mock("../lib/visual/visualQA", () => ({
  createMockKeyframeQA: vi.fn((shot: { id: string }, _attempt: number, frameId?: string) => ({
    id: crypto.randomUUID(), shotId: shot.id, frameId, attempt: 1, inspectorModel: "mock-visual-qa",
    checkedAt: new Date().toISOString(), singleFramePassed: true, productMatchPassed: true,
    characterMatchPassed: true, sceneMatchPassed: true, textSafetyPassed: true, overallPassed: true, issues: []
  })),
  inspectKeyframe: vi.fn(async (input: { shot: { id: string }; frameId?: string; candidateAssetId: string; attempt: number }) => ({
    id: crypto.randomUUID(), shotId: input.shot.id, frameId: input.frameId, assetId: input.candidateAssetId, attempt: input.attempt,
    inspectorModel: "qwen3.7-plus", checkedAt: new Date().toISOString(), singleFramePassed: true,
    productMatchPassed: true, characterMatchPassed: true, sceneMatchPassed: true,
    textSafetyPassed: true, overallPassed: true, issues: []
  }))
}));
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as generateAssetsPOST } from "../app/api/generate-assets/route";
import { GET as generateImagesGET, POST as generateImagesPOST } from "../app/api/generate-images/route";
import { POST as generateStoryboardPOST } from "../app/api/generate-storyboard/route";
import { POST as generateStrategyPOST } from "../app/api/generate-strategy/route";
import { POST as renderVideoPOST } from "../app/api/render-video/route";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { createPrivateAsset } from "../lib/assets/assetStore";
import { clearQwenModelAvailability } from "../lib/image/qwenImageModelRouter";
import { listModelCallLogs } from "../lib/logs/modelCallStore";
import { GET as exportCallLogs } from "../app/api/call-logs/export/route";
import { buildVisualMasterSpecs } from "../lib/continuity/visualMasters";
import { createMockKeyframeQA, inspectKeyframe } from "../lib/visual/visualQA";
import { deepseekProvider } from "../lib/providers/deepseekProvider";
import {
  createAnonymousProject,
  mutateOwnedAnonymousProject,
  requireOwnedAnonymousProject,
  resetAnonymousProjectQueuesForTests,
  updateOwnedAnonymousProject
} from "../lib/projects/anonymousProjectStore";
import { lockVisualAnchorMaster } from "../lib/visual/visualAnchors";

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

async function completedImageResponse(response: Response) {
  let body = await responseJson(response);
  const initial = body.data as { status?: string; eventId?: string } | undefined;
  if (initial?.status !== "running" || !initial.eventId) return body;

  for (let attempt = 0; attempt < 500; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const statusResponse = await generateImagesGET(new Request(
      `http://localhost/api/generate-images?projectId=${encodeURIComponent(testProjectId)}&eventId=${encodeURIComponent(initial.eventId!)}`
    ));
    body = await responseJson(statusResponse);
    if ((body.data as { status?: string } | undefined)?.status === "completed" || body.success === false) return body;
  }

  throw new Error("Timed out waiting for the image batch test job.");
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
    clearQwenModelAvailability("test-session");
    const created = await createAnonymousProject("test-session");
    const noProductShots = created.project.shots.map((shot) => ({
      ...shot,
      containsProduct: false,
      exactProductShot: false,
      characterIds: [],
      productIds: [],
      referenceImageAssetIds: []
    }));
    let updated = await updateOwnedAnonymousProject("test-session", created.id, { shots: noProductShots });
    const sceneMaster = await createPrivateAsset("test-session", created.id, {
      kind: "keyframe",
      source: "qwen-image",
      role: "test-scene-master",
      fileName: "scene-master.png",
      mimeType: "image/png",
      bytes: VALID_PNG_BYTES
    });
    const productMaster = await createPrivateAsset("test-session", created.id, {
      kind: "product-image",
      source: "user-upload",
      role: "main-product",
      fileName: "product-master.png",
      mimeType: "image/png",
      bytes: VALID_PNG_BYTES
    });
    const masterSpecs = buildVisualMasterSpecs(updated.project);
    updated = await updateOwnedAnonymousProject("test-session", created.id, {
      brief: {
        ...updated.project.brief,
        productImages: [{
          id: "test-product-master",
          assetId: productMaster.id,
          name: "product-master.png",
          type: "image/png",
          size: VALID_PNG_BYTES.byteLength,
          localUrl: `/api/projects/${created.id}/assets/${productMaster.id}`,
          role: "main-product"
        }]
      },
      productVisualSpec: {
        sourceAssetId: productMaster.id,
        containerType: "cup",
        shape: "tapered cup",
        proportions: "1.3:1",
        capStructure: "flat lid",
        materials: ["paper"],
        colors: [{ name: "white", hex: "#ffffff" }],
        labelLayout: "front center",
        logoPosition: "front center",
        readablePackagingText: [],
        heroAngle: "front three-quarter",
        forbiddenContainerTypes: ["bottle", "can", "carton", "jar"],
        forbiddenVariations: ["no geometry changes"],
        inspectorModel: "qwen3.7-plus",
        inspectedAt: new Date().toISOString()
      },
      characterVisualSpecs: masterSpecs.characterVisualSpecs.map((spec) => ({
        ...spec,
        masterAssetId: sceneMaster.id,
        masterAssetIds: [sceneMaster.id],
        locked: true,
        lockedAt: new Date().toISOString()
      })),
      sceneVisualSpecs: masterSpecs.sceneVisualSpecs.map((spec) => ({
        ...spec,
        masterAssetId: sceneMaster.id,
        masterAssetIds: [sceneMaster.id],
        locked: true,
        lockedAt: new Date().toISOString()
      }))
    });
    updated = await mutateOwnedAnonymousProject("test-session", created.id, (project) => {
      const productLocked = lockVisualAnchorMaster(project, "product");
      return {
        ...productLocked,
        stageStates: {
          ...productLocked.stageStates!,
          anchors: { status: "locked", updatedAt: Date.now(), lockedAt: Date.now(), lockedVersion: 1 }
        }
      };
    });
    testProjectId = created.id;
    testProjectShots = updated.project.shots;
    testHeroShotId = updated.project.heroShotId ?? null;
    vi.restoreAllMocks();
    vi.mocked(createMockKeyframeQA).mockImplementation((shot, _attempt, frameId) => ({
      id: crypto.randomUUID(), shotId: shot.id, frameId, attempt: 1, inspectorModel: "mock-visual-qa",
      checkedAt: new Date().toISOString(), singleFramePassed: true, productMatchPassed: true,
      characterMatchPassed: true, sceneMatchPassed: true, textSafetyPassed: true, overallPassed: true, issues: []
    }));
    vi.mocked(inspectKeyframe).mockImplementation(async (input) => ({
      id: crypto.randomUUID(), shotId: input.shot.id, frameId: input.frameId, assetId: input.candidateAssetId, attempt: input.attempt,
      inspectorModel: "qwen3.7-plus", checkedAt: new Date().toISOString(), singleFramePassed: true,
      productMatchPassed: true, characterMatchPassed: true, sceneMatchPassed: true,
      textSafetyPassed: true, overallPassed: true, issues: []
    }));
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
    expect(JSON.stringify(body)).toContain("wan2.7-i2v");
  });


  it("generate-images hero-only returns independent frames without video calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateImagesPOST(
      jsonRequest({ projectId: testProjectId, shots: testProjectShots, mode: "hero-only" })
    );
    const body = await responseJson(response);
    const data = body.data as { images: Array<{ shotId: string; provider: string }>; failedShots: unknown[] };

    expect(body.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(data.images).toHaveLength(4);
    expect(data.images[0].shotId).toBe(testHeroShotId);
    expect(data.images[0].provider).toBe("mockImageProvider");
    expect(data.failedShots).toHaveLength(0);
  });

  it("generate-images does not truncate a multi-frame shot architecture", async () => {
    process.env.MAX_IMAGES_PER_RUN = "2";

    const response = await generateImagesPOST(
      jsonRequest({ projectId: testProjectId, shots: testProjectShots, mode: "all-shots" })
    );
    const body = await responseJson(response);
    const data = body.data as { images: unknown[]; requestedShots: number; generatedShots: number };

    expect(body.success).toBe(true);
    expect(data.requestedShots).toBe(8);
    expect(data.generatedShots).toBe(32);
    expect(data.images).toHaveLength(32);
  }, 12_000);

  it("generate-images uses the actual 12-shot project count", async () => {
    process.env.MAX_IMAGES_PER_RUN = "12";
    const template = await createAnonymousProject("test-session", { shotCount: 12 });
    const twelveShotProject = await updateOwnedAnonymousProject("test-session", testProjectId, {
      shotCount: 12,
      shots: template.project.shots.map((shot) => ({
        ...shot,
        containsProduct: false,
        exactProductShot: false,
        characterIds: [],
        productIds: []
      }))
    });

    const response = await generateImagesPOST(
      jsonRequest({
        projectId: testProjectId,
        shots: twelveShotProject.project.shots,
        mode: "all-shots"
      })
    );
    const body = await responseJson(response);
    const data = body.data as { images: unknown[]; requestedShots: number; generatedShots: number };

    expect(body.success).toBe(true);
    expect(data.requestedShots).toBe(12);
    expect(data.generatedShots).toBe(28);
    expect(data.images).toHaveLength(28);
  }, 12_000);
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
    expect(data.generatedShots).toBe(32);
    expect(data.images).toHaveLength(32);
  }, 12_000);

  it("generate-images supports partial success when one shot falls back", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-secret-test-key";
    process.env.MAX_IMAGES_PER_RUN = "2";

    let submissionCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "https://example.com/shot-1.png" || url === "https://example.com/master.png") {
          return new Response(VALID_PNG_BYTES, {
            status: 200,
            headers: { "Content-Type": "image/png" }
          });
        }

        if (/Character Master 参考图|Scene Master 空场参考图/i.test(String(init?.body ?? ""))) {
          return new Response(
            JSON.stringify({ request_id: "req-master", output: { results: [{ url: "https://example.com/master.png" }] } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        submissionCount += 1;
        if (submissionCount === 1) {
          return new Response(
            JSON.stringify({ request_id: "req-shot-1", output: { results: [{ url: "https://example.com/shot-1.png" }] } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
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
    expect(response.status).toBe(202);
    const body = await completedImageResponse(response);
    const data = body.data as { images: Array<{ fallbackUsed: boolean; localUrl?: string }>; failedShots: unknown[] };

    expect(body.success, JSON.stringify(body)).toBe(true);
    expect(data.images).toHaveLength(8);
    expect(data.images[0].fallbackUsed).toBe(false);
    expect(data.images[0].localUrl).toContain(
      `/api/projects/${testProjectId}/assets/`
    );
    expect(data.images.slice(1).some((image) => image.fallbackUsed)).toBe(true);
    expect(data.failedShots.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("sk-dashscope-secret-test-key");
    const saved = await requireOwnedAnonymousProject("test-session", testProjectId);
    const imageEvents = saved.project.generationEvents?.filter((event) => event.provider === "qwen-image") ?? [];
    expect(imageEvents.some((event) => event.status === "running")).toBe(false);
    expect(imageEvents.some((event) => event.status === "failed" && event.message.includes("provider failed"))).toBe(true);
  }, 12_000);


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
    expect(data.images).toHaveLength(4);
    expect(data.images[0].fallbackUsed).toBe(false);
    expect(data.images[0].requestId).toBe("req-task");
    expect(data.images[0].localUrl).toContain(
      `/api/projects/${testProjectId}/assets/`
    );
    expect(callCount).toBeGreaterThanOrEqual(3);
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
  it("saves a single keyframe with the fallback model and exports its Qwen attempts", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "sk-dashscope-secret-test-key";
    const shot = testProjectShots[0]!;
    const frameId = shot.frames![0]!.id;
    const requestedModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://example.com/fallback-frame.png") return new Response(VALID_PNG_BYTES, { status: 200, headers: { "Content-Type": "image/png" } });
      const body = JSON.parse(String(init?.body)) as { model: string; input: { messages: Array<{ content: unknown[] }> } };
      requestedModels.push(body.model);
      expect(body.input.messages[0]?.content.some((item) => typeof item === "object" && item !== null && "image" in item)).toBe(true);
      if (body.model === "qwen-image-3.0") return new Response(JSON.stringify({ code: "QuotaExceeded", message: "Free allocated quota exceeded" }), { status: 429 });
      return new Response(JSON.stringify({ request_id: "req-2", output: { results: [{ image_url: "https://example.com/fallback-frame.png" }] } }), { status: 200 });
    }));
    const response = await generateImagesPOST(jsonRequest({ projectId: testProjectId, shots: [shot], mode: "all-shots", frameIds: [frameId] }));
    const body = await responseJson(response);
    const data = body.data as { images: Array<{ model: string; assetId?: string; referenceUsed: boolean; fallbackUsed: boolean }> };
    expect(requestedModels).toEqual(["qwen-image-3.0", "qwen-image-2.0"]);
    expect(data.images[0]).toMatchObject({ model: "qwen-image-2.0", referenceUsed: true, fallbackUsed: false });
    expect(data.images[0]?.assetId).toBeTruthy();
    const saved = await requireOwnedAnonymousProject("test-session", testProjectId);
    expect(saved.project.keyframes?.find((frame) => frame.frameId === frameId)).toMatchObject({ model: "qwen-image-2.0", assetId: data.images[0]?.assetId });
    const entries = await listModelCallLogs("test-session", { projectId: testProjectId, stage: "keyframes", shotId: shot.id, frameId });
    expect(entries.filter((entry) => entry.kind === "call").map((entry) => [entry.model, entry.status, entry.errorCode])).toEqual([
      ["qwen-image-2.0", "completed", undefined], ["qwen-image-3.0", "failed", "QUOTA_EXHAUSTED"], ["qwen-image", "blocked", "MODEL_SKIPPED_CAPABILITY_MISMATCH"]
    ]);
    const taskId = entries.find((entry) => entry.kind === "task")!.taskId;
    const reportResponse = await exportCallLogs(new Request(`http://localhost/api/call-logs/export?projectId=${testProjectId}&taskId=${taskId}&format=json`));
    const report = await reportResponse.json() as { summary: { failedCalls: number }; entries: Array<{ model: string }> };
    expect(report.summary.failedCalls).toBe(1);
    expect(report.entries.some((entry) => entry.model === "qwen-image-2.0")).toBe(true);
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






