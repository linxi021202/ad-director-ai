import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { deepseekProvider } from "../lib/providers/deepseekProvider";
import { qwenImageProvider, QWEN_IMAGE_PLACEHOLDER_URL } from "../lib/providers/qwenImageProvider";
import { happyHorseVideoProvider } from "../lib/providers/happyHorseVideoProvider";
import { generatePrompts, generateShotImage, runTextTask, scoreAdPlan, selectProviderModel } from "../lib/providers/providerRouter";

const qwenProviderWithShotImage = qwenImageProvider as typeof qwenImageProvider & { generateShotImage: NonNullable<typeof qwenImageProvider.generateShotImage> };

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.AI_MODE;
  delete process.env.ENABLE_REAL_TEXT;
  delete process.env.ENABLE_REAL_IMAGE;
  delete process.env.ENABLE_REAL_VIDEO;
  delete process.env.HAPPYHORSE_MODEL;
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

  it("routes strategy to deepseekProvider.generateStrategy in real text mode", async () => {
    enableRealTextMode();
    const spy = vi.spyOn(deepseekProvider, "generateStrategy").mockResolvedValue(realTextSuccess(coldBrewDemo.strategy));

    const route = selectProviderModel({ taskType: "strategy" });
    const result = await runTextTask({ taskType: "strategy", brief: coldBrewDemo.brief });

    expect(route.provider).toBe("deepseek");
    expect(route.model).toBe("deepseek-v4-flash");
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
        usedModels: ["deepseek-v4-flash" as const, "qwen-image" as const, "happyhorse-1.0-r2v" as const, "remotion" as const],
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
      model: "deepseek-v4-flash",
      latencyMs: 20,
      fallbackUsed: false,
      error: "json validation failed"
    });

    const result = await runTextTask({ taskType: "strategy", brief: coldBrewDemo.brief });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("mockTextProvider");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain("DeepSeek strategy failed");
    expect(result.fallbackReason).toContain("json validation failed");
    expect(result.fallbackReason).toContain("mockTextProvider");
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
    expect(result.fallbackReason).toContain("AI config is invalid");
    expect(result.fallbackReason).toContain("DEEPSEEK_API_KEY");
    expect(spy).not.toHaveBeenCalled();
  });

  it("routes storyboard, prompt, and scoring metadata to deepseek in real text mode", () => {
    enableRealTextMode();

    for (const taskType of ["storyboard", "prompt", "scoring"] as const) {
      const route = selectProviderModel({ taskType });

      expect(route.provider).toBe("deepseek");
      expect(route.model).toBe("deepseek-v4-flash");
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

  it("returns planned HappyHorse video node", () => {
    process.env.HAPPYHORSE_MODEL = "happyhorse-1.0-r2v";

    const route = selectProviderModel({ taskType: "video", costMode: "lowCost" });

    expect(route.provider).toBe("happyhorse");
    expect(route.model).toBe("happyhorse-1.0-r2v");
    expect(route.reason).toContain("HappyHorse");
  });

  it("returns planned remotion render node", () => {
    const route = selectProviderModel({ taskType: "render" });

    expect(route.provider).toBe("planned");
    expect(route.model).toBe("remotion");
    expect(route.reason).toContain("does not perform real rendering");
  });


  it("keeps HappyHorse provider reserved without real API calls", async () => {
    const result = await happyHorseVideoProvider.generateHeroVideoFromImage?.({
      imageUrl: "/generated/images/coldbrew-demo-001/shot-3.png",
      prompt: coldBrewDemo.shots[2].videoPromptCn,
      durationSec: 5,
      aspectRatio: "9:16"
    });

    expect(result).toEqual({
      success: false,
      provider: "happyhorse",
      capability: "manual-import",
      apiAvailable: false,
      manualImportAvailable: true,
      status: "waiting-manual-import",
      error: "HappyHorse 真实调用当前不可用，可改用手动导入视频作为备用路径。"
    });
  });  it("does not return legacy video vendors in the MVP main route", () => {
    const forbidden = /Wan|Kling|Hailuo|fal\\.ai|wan|kling|hailuo/;
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
  process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
}

function realTextSuccess<TData>(data: TData) {
  return {
    success: true,
    data,
    provider: "deepseek" as const,
    model: "deepseek-v4-flash",
    latencyMs: 12,
    tokenUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    costEstimate: "estimated CNY 0.0010",
    fallbackUsed: false as const,
    error: null
  };
}













