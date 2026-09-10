import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { deepseekProvider } from "../lib/providers/deepseekProvider";
import { qwenImageProvider, QWEN_IMAGE_PLACEHOLDER_URL } from "../lib/providers/qwenImageProvider";
import { wanVideoProvider } from "../lib/providers/wanVideoProvider";
import { generateBatchShotImages, generatePrompts, generateShotImage, runTextTask, scoreAdPlan, selectProviderModel } from "../lib/providers/providerRouter";

const qwenProviderWithShotImage = qwenImageProvider as typeof qwenImageProvider & { generateShotImage: NonNullable<typeof qwenImageProvider.generateShotImage> };

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.AI_MODE;
  delete process.env.ENABLE_REAL_TEXT;
  delete process.env.ENABLE_REAL_IMAGE;
  delete process.env.ENABLE_REAL_VIDEO;
  delete process.env.WAN_VIDEO_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.QWEN_IMAGE_MODEL;
  delete process.env.QWEN_IMAGE_SIZE;
}

describe("providerRouter", () => {
  beforeEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it("uses mockTextProvider when AI_MODE is mock", async () => {
    process.env.AI_MODE = "mock";
    process.env.ENABLE_REAL_TEXT = "false";

    const route = selectProviderModel({ taskType: "strategy" });
    const result = await runTextTask({ taskType: "strategy", brief: coldBrewDemo.brief });

    expect(route.provider).toBe("mockTextProvider");
    expect(route.model).toBe("coldBrewDemo");
    expect(result.success).toBe(true);
    expect(result.provider).toBe("mockTextProvider");
    expect(result.fallbackUsed).toBe(false);
  });

  it("keeps all text generation on mockTextProvider in mock mode even if ENABLE_REAL_TEXT=true", async () => {
    process.env.AI_MODE = "mock";
    process.env.ENABLE_REAL_TEXT = "true";
    process.env.DEEPSEEK_API_KEY = "test-key";
    const spy = vi.spyOn(deepseekProvider, "generateStrategy");

    const result = await runTextTask({ taskType: "strategy", brief: coldBrewDemo.brief });

    expect(result.provider).toBe("mockTextProvider");
    expect(result.fallbackUsed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps a 12-shot duration plan in mock mode", async () => {
    process.env.AI_MODE = "mock";
    const durations = [3, 4, 5, 6, 7, 8, 3, 4, 5, 5, 5, 5];

    const result = await runTextTask(
      { taskType: "storyboard", brief: coldBrewDemo.brief, strategy: coldBrewDemo.strategy },
      { requestedShotCount: 12, shotDurationPlan: durations }
    );
    const shots = result.data as typeof coldBrewDemo.shots;

    expect(result.success).toBe(true);
    expect(shots).toHaveLength(12);
    expect(shots.map((shot) => shot.durationSec)).toEqual(durations);
    expect(shots.map((shot) => shot.index)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });
  it("routes strategy to deepseekProvider.generateStrategy in real text mode", async () => {
    enableRealTextMode();
    const spy = vi.spyOn(deepseekProvider, "generateStrategy").mockResolvedValue(realTextSuccess(coldBrewDemo.strategy));

    const route = selectProviderModel({ taskType: "strategy" });
    const result = await runTextTask({ taskType: "strategy", brief: coldBrewDemo.brief });

    expect(route.provider).toBe("deepseek");
    expect(route.model).toBe("deepseek-v4-pro");
    expect(spy).toHaveBeenCalledWith(coldBrewDemo.brief);
    expect(result.success).toBe(true);
    expect(result.provider).toBe("deepseek");
    expect(result.fallbackUsed).toBe(false);
  });

  it("routes storyboard to deepseekProvider.generateStoryboard in real text mode", async () => {
    enableRealTextMode();
    const spy = vi.spyOn(deepseekProvider, "generateStoryboard").mockResolvedValue(realTextSuccess(coldBrewDemo.shots));

    const result = await runTextTask({ taskType: "storyboard", brief: coldBrewDemo.brief, strategy: coldBrewDemo.strategy });

    expect(spy).toHaveBeenCalledWith(coldBrewDemo.brief, coldBrewDemo.strategy);
    expect(result.provider).toBe("deepseek");
    expect(result.fallbackUsed).toBe(false);
  });

  it("routes prompt to deepseekProvider.generatePrompts in real text mode", async () => {
    enableRealTextMode();
    const spy = vi.spyOn(deepseekProvider, "generatePrompts").mockResolvedValue(realTextSuccess(coldBrewDemo.shots));

    const result = await generatePrompts(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots);

    expect(spy).toHaveBeenCalledWith(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots);
    expect(result.provider).toBe("deepseek");
    expect(result.fallbackUsed).toBe(false);
  });

  it("routes scoring to deepseekProvider.scoreAdPlan in real text mode", async () => {
    enableRealTextMode();
    const score = {
      overallScore: 88,
      dimensionScores: {
        strategyClarity: 18,
        storyboardExecution: 18,
        promptQuality: 18,
        costControl: 17,
        brandSafety: 17
      },
      passed: true,
      summary: "方案清晰，成本可控。",
      risks: ["Hero Shot 需要准备降级方案。"],
      fixSuggestions: ["继续压缩字幕。"],
      modelRouteCheck: {
        allowedOnly: true,
        usedModels: ["deepseek-v4-pro" as const, "qwen-image" as const, "wan2.7-i2v" as const, "remotion" as const],
        forbiddenModelsFound: []
      },
      videoGenerationStrategyCheck: {
        heroShotOnly: true,
        realVideoShots: 1,
        fallbackReady: true
      }
    };
    const spy = vi.spyOn(deepseekProvider, "scoreAdPlan").mockResolvedValue(realTextSuccess(score));

    const result = await scoreAdPlan(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots);

    expect(spy).toHaveBeenCalledWith(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots);
    expect(result.provider).toBe("deepseek");
    expect(result.data).toEqual(score);
    expect(result.fallbackUsed).toBe(false);
  });

  it("falls back to mockTextProvider when deepseek fails", async () => {
    enableRealTextMode();
    vi.spyOn(deepseekProvider, "generateStrategy").mockResolvedValue({
      success: false,
      data: null,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      latencyMs: 20,
      fallbackUsed: false,
      error: "json validation failed"
    });

    const result = await runTextTask({ taskType: "strategy", brief: coldBrewDemo.brief });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("mockTextProvider");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain("DeepSeek 广告策略失败");
    expect(result.fallbackReason).toContain("json validation failed");
    expect(result.fallbackReason).toContain("本地模板继续");
  });

  it("keeps the requested shot count and duration plan when DeepSeek storyboard falls back", async () => {
    enableRealTextMode();
    const context = { requestedShotCount: 3, targetDurationSec: 24, shotDurationPlan: [8, 8, 8] };
    vi.spyOn(deepseekProvider, "generateStoryboard").mockResolvedValue({
      success: false,
      data: null,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      latencyMs: 20,
      fallbackUsed: false,
      error: "DEEPSEEK_TIMEOUT：DeepSeek 在 20 秒内未响应。"
    });

    const result = await runTextTask(
      { taskType: "storyboard", brief: coldBrewDemo.brief, strategy: coldBrewDemo.strategy },
      context
    );
    const shots = result.data as typeof coldBrewDemo.shots;

    expect(shots).toHaveLength(3);
    expect(shots.map((shot) => shot.durationSec)).toEqual([8, 8, 8]);
  });

  it("falls back to mockTextProvider when real text config is missing DeepSeek key", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_TEXT = "true";
    process.env.DEEPSEEK_API_KEY = "";
    const spy = vi.spyOn(deepseekProvider, "generateStrategy");

    const result = await runTextTask({ taskType: "strategy", brief: coldBrewDemo.brief });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("mockTextProvider");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain("未配置");
    expect(result.fallbackReason).toContain("DEEPSEEK_API_KEY");
    expect(spy).not.toHaveBeenCalled();
  });

  it("routes storyboard, prompt, and scoring metadata to deepseek in real text mode", () => {
    enableRealTextMode();

    for (const taskType of ["storyboard", "prompt", "scoring"] as const) {
      const route = selectProviderModel({ taskType });

      expect(route.provider).toBe("deepseek");
      expect(route.model).toBe("deepseek-v4-pro");
      expect(route.fallbackMode).toContain("mockTextProvider");
    }
  });

  it("routes image generation to mockImageProvider when real image is disabled", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "false";

    const route = selectProviderModel({ taskType: "image", hasChineseText: true });
    const result = await generateShotImage(coldBrewDemo.id, coldBrewDemo.shots[0]);

    expect(route.provider).toBe("mockImageProvider");
    expect(route.model).toBe("mock-keyframe-placeholder");
    expect(result.provider).toBe("mockImageProvider");
    expect(result.fallbackUsed).toBe(false);
  });

  it("routes image generation to qwenImageProvider when real image is enabled", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
    process.env.QWEN_IMAGE_MODEL = "qwen-image";

    const spy = vi.spyOn(qwenProviderWithShotImage, "generateShotImage").mockResolvedValue({
      shotId: coldBrewDemo.shots[0].id,
      imageUrl: "/generated/images/coldbrew-demo-001/shot-1.png",
      localUrl: "/generated/images/coldbrew-demo-001/shot-1.png",
      prompt: coldBrewDemo.shots[0].imagePromptCn,
      provider: "dashscope",
      model: "qwen-image",
      latencyMs: 1200,
      requestId: "req-test",
      size: "1152*2048",
      cacheStatus: "cached",
      fallbackUsed: false,
      error: null
    });

    const route = selectProviderModel({ taskType: "image", hasChineseText: true });
    const result = await generateShotImage(coldBrewDemo.id, coldBrewDemo.shots[0]);

    expect(route.provider).toBe("qwenImageProvider");
    expect(route.model).toBe("qwen-image");
    expect(spy).toHaveBeenCalled();
    expect(result.provider).toBe("dashscope");
    expect(result.fallbackUsed).toBe(false);
  });

  it("passes the previous successful keyframe to the next shot in the same continuity group", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
    const firstAssetId = "11111111-1111-4111-8111-111111111111";
    const secondAssetId = "22222222-2222-4222-8222-222222222222";
    const shots = coldBrewDemo.shots.slice(0, 2).map((shot) => ({ ...shot, continuityGroupId: "office-main" }));
    const spy = vi.spyOn(qwenProviderWithShotImage, "generateShotImage").mockImplementation(async (_projectId, shot) => ({
      shotId: shot.id,
      imageUrl: `/api/assets/${shot.id}`,
      assetId: shot.index === shots[0]!.index ? firstAssetId : secondAssetId,
      localUrl: `/api/assets/${shot.id}`,
      prompt: shot.imagePromptCn,
      provider: "dashscope",
      model: "qwen-image-2.0",
      latencyMs: 10,
      size: "1152*2048",
      cacheStatus: "cached",
      fallbackUsed: false,
      referenceUsed: true,
      error: null
    }));

    await generateBatchShotImages("project-1", shots, { aspectRatio: "9:16", hasChineseText: true });

    expect(spy.mock.calls[0]?.[2]?.continuityImageAssetId).toBeUndefined();
    expect(spy.mock.calls[1]?.[2]?.continuityImageAssetId).toBe(firstAssetId);
  });

  it("preserves a stored continuity reference when regenerating one shot", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
    const storedAssetId = "33333333-3333-4333-8333-333333333333";
    const shot = { ...coldBrewDemo.shots[1]!, continuityGroupId: "office-main" };
    const spy = vi.spyOn(qwenProviderWithShotImage, "generateShotImage").mockResolvedValue({
      shotId: shot.id,
      imageUrl: "/api/assets/regenerated",
      assetId: "44444444-4444-4444-8444-444444444444",
      localUrl: "/api/assets/regenerated",
      prompt: shot.imagePromptCn,
      provider: "dashscope",
      model: "qwen-image-2.0",
      latencyMs: 10,
      size: "1152*2048",
      cacheStatus: "cached",
      fallbackUsed: false,
      referenceUsed: true,
      error: null
    });

    await generateBatchShotImages("project-1", [shot], {
      aspectRatio: "9:16",
      continuityImageAssetId: storedAssetId
    });

    expect(spy.mock.calls[0]?.[2]?.continuityImageAssetId).toBe(storedAssetId);
  });

  it("falls back to placeholder image when qwenImageProvider fails", async () => {
    process.env.AI_MODE = "real";
    process.env.ENABLE_REAL_IMAGE = "true";
    process.env.DASHSCOPE_API_KEY = "test-dashscope-key";

    vi.spyOn(qwenProviderWithShotImage, "generateShotImage").mockRejectedValue(new Error("simulated qwen failure"));

    const result = await generateShotImage(coldBrewDemo.id, coldBrewDemo.shots[0]);

    expect(result.provider).toBe("placeholder");
    expect(result.imageUrl).toContain("data:image/svg+xml");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain("Qwen-Image route failed unexpectedly");
  });

  it("routes new video generation to Wan 2.7 I2V", () => {
    process.env.WAN_VIDEO_MODEL = "wan2.7-i2v";

    const route = selectProviderModel({ taskType: "video", costMode: "lowCost" });

    expect(route.provider).toBe("wan");
    expect(route.model).toBe("wan2.7-i2v");
    expect(route.reason).toContain("Wan 2.7");
  });

  it("returns planned remotion render node", () => {
    const route = selectProviderModel({ taskType: "render" });

    expect(route.provider).toBe("planned");
    expect(route.model).toBe("remotion");
    expect(route.reason).toContain("does not perform real rendering");
  });


  it("keeps Wan provider blocked until session key and project references are ready", async () => {
    const result = await wanVideoProvider.generateHeroVideoFromImage?.({
      imageUrl: "/generated/images/coldbrew-demo-001/shot-3.png",
      prompt: coldBrewDemo.shots[2].videoPromptCn,
      durationSec: 5,
      aspectRatio: "9:16"
    });

    expect(result).toEqual({
      success: false,
      provider: "wan",
      capability: "manual-import",
      apiAvailable: false,
      manualImportAvailable: true,
      status: "waiting-manual-import",
      error: "Wan 2.7 I2V 真实调用当前不可用，可从视频库导入完整广告视频作为备用路径。"
    });
  });  it("does not return legacy video vendors in the primary route", () => {
    const forbidden = /HappyHorse|Kling|Hailuo|fal\\.ai|happyhorse|kling|hailuo/;
    const routes = [
      selectProviderModel({ taskType: "strategy" }),
      selectProviderModel({ taskType: "storyboard" }),
      selectProviderModel({ taskType: "prompt" }),
      selectProviderModel({ taskType: "scoring" }),
      selectProviderModel({ taskType: "image" }),
      selectProviderModel({ taskType: "video" }),
      selectProviderModel({ taskType: "render" })
    ];

    for (const route of routes) {
      expect(JSON.stringify(route)).not.toMatch(forbidden);
    }
  });
});

function enableRealTextMode() {
  process.env.AI_MODE = "real";
  process.env.ENABLE_REAL_TEXT = "true";
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
}

function realTextSuccess<TData>(data: TData) {
  return {
    success: true,
    data,
    provider: "deepseek" as const,
    model: "deepseek-v4-pro",
    latencyMs: 12,
    tokenUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    costEstimate: "estimated CNY 0.0010",
    fallbackUsed: false as const,
    error: null
  };
}













