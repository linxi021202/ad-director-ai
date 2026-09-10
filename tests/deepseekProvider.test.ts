import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coldBrewDemo } from "../lib/mock/coldBrewDemo";
import { deepseekProvider } from "../lib/providers/deepseekProvider";

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  process.env.AI_MODE = "real";
  process.env.ENABLE_REAL_TEXT = "true";
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
}

function mockDeepSeekResponse(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("deepseekProvider", () => {
  beforeEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes Zod validation when DeepSeek returns valid JSON", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(mockDeepSeekResponse(JSON.stringify(coldBrewDemo.strategy))));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStrategy(coldBrewDemo.brief);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(coldBrewDemo.strategy);
    expect(result.provider).toBe("deepseek");
    expect(result.model).toBe("deepseek-v4-pro");
    expect(result.tokenUsage?.totalTokens).toBe(150);
    expect(result.costEstimate).toContain("estimated CNY");
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an error after invalid JSON fails retry handling", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(mockDeepSeekResponse("```json\nnot-json\n```")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStrategy(coldBrewDemo.brief);

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBe("DeepSeek返回的JSON格式无效。");
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once when Zod validation fails and then returns valid storyboard", async () => {
    const invalidShots = { shots: [{ ...coldBrewDemo.shots[0], recommendedModel: "forbidden-model" }] };
    const validShots = { shots: coldBrewDemo.shots.map((shot) => ({ ...shot, recommendedModel: "qwen-image" })) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockDeepSeekResponse(JSON.stringify(invalidShots)))
      .mockResolvedValueOnce(mockDeepSeekResponse(JSON.stringify(validShots)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStoryboard(coldBrewDemo.brief, coldBrewDemo.strategy);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(8);
    expect(result.data?.every((shot) => shot.recommendedModel === "qwen-image")).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors a custom storyboard count and duration plan", async () => {
    const durations = [3, 5, 8];
    const shots = coldBrewDemo.shots.slice(0, 3).map((shot, index) => ({
      ...shot,
      id: `shot-${index + 1}`,
      index: index + 1,
      durationSec: durations[index],
      recommendedModel: "qwen-image"
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockDeepSeekResponse(JSON.stringify({ shots }))));

    const result = await deepseekProvider.generateStoryboard(coldBrewDemo.brief, coldBrewDemo.strategy, {
      requestedShotCount: 3,
      shotDurationPlan: durations
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(result.data?.map((shot) => shot.durationSec)).toEqual(durations);
    expect(result.data?.map((shot) => shot.index)).toEqual([1, 2, 3]);
  });
  it("does not fallback to mock when validation keeps failing", async () => {
    const invalidStrategy = { ...coldBrewDemo.strategy, cta: "" };
    const fetchMock = vi.fn().mockResolvedValue(mockDeepSeekResponse(JSON.stringify(invalidStrategy)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.generateStrategy(coldBrewDemo.brief);

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.provider).toBe("deepseek");
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("scores ad plans with validated DeepSeek json", async () => {
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
        usedModels: ["deepseek-v4-pro", "qwen-image", "wan2.7-i2v", "remotion"],
        forbiddenModelsFound: []
      },
      videoGenerationStrategyCheck: {
        heroShotOnly: true,
        realVideoShots: 1,
        fallbackReady: true
      }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockDeepSeekResponse(JSON.stringify(score))));

    const result = await deepseekProvider.scoreAdPlan?.(coldBrewDemo.brief, coldBrewDemo.strategy, coldBrewDemo.shots);

    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ overallScore: 88, passed: true });
    expect(result?.fallbackUsed).toBe(false);
  });
});


